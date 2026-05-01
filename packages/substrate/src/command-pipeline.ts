// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import type { CommandInstance, EventInstance } from "./define.js";
import type { Registry } from "./registry.js";
import type { World } from "./world.js";
import type { EventBus } from "./event-bus.js";
import type { ClientId, EntityId, TraitName } from "./schema.js";
import type { PersistenceAdapter } from "./persistence.js";
import { toPersistedEvent } from "./persistence.js";
import { fail, ok, type Result } from "./result.js";
import { runSystemsToFixpoint } from "./systems-runner.js";

export interface CommandEnvelope {
  readonly id: string;
  readonly issuedBy: ClientId;
  readonly issuedAt: number;
  readonly cmd: CommandInstance;
  /**
   * Optional opaque session attached at the WS upgrade. The substrate doesn't
   * inspect it; auth-aware plugins read it via a typed accessor in their
   * own context (e.g. `@vtt/auth`'s `requireSession(ctx.session)`).
   */
  readonly session?: unknown;
  /**
   * Optional opaque "what the client believed" payload — the design's CAS
   * slot. The substrate threads it into `CommandContext.causalState` for
   * the command's `validate` to compare against current World state.
   * Plugin-defined shape; common pattern is `{ entityId, seenAt: number }`
   * for "reject if the entity has changed since I saw it." v0 doesn't
   * implement optimistic prediction or rollback; this is just the seam.
   */
  readonly causalState?: unknown;
}

export interface DispatchResult {
  readonly result: Result;
  readonly events: ReadonlyArray<EventInstance>;
  readonly seq: number;
}

export interface CommandPipelineOptions {
  /**
   * Optional persistence. When provided, durable events are written
   * synchronously inside the dispatch path *before* the broadcast — a crash
   * after persist but before broadcast is recovered by the next client's
   * snapshot+tail; a crash before persist effectively rolls the command back.
   */
  readonly persistence?: PersistenceAdapter;
  /**
   * Cap on the in-memory `log` ring. Older entries are dropped once the cap
   * is hit; the persistence adapter (if any) holds the durable history.
   * Defaults to 200, matching the default snapshot cadence.
   */
  readonly logCapacity?: number;
}

/**
 * Single-threaded command queue per World.
 * dedup → validate → apply → systems-to-fixpoint → persist → broadcast.
 *
 * Dispatches are serialized through an internal promise chain so seq stays
 * monotonic even when multiple WS messages arrive concurrently. (Node is
 * single-threaded but each `await` releases the microtask, so without
 * serialization two near-simultaneous dispatches could both observe the
 * same `nextSeq`.)
 */
export class CommandPipeline {
  private nextSeq = 1;
  private seenIds = new Set<string>();
  /**
   * Hot in-memory ring buffer — most-recent committed events for cheap
   * recent-tail lookups. The persistence adapter (if any) holds the
   * authoritative history. Capped by `logCapacity`; older entries are
   * dropped on overflow.
   */
  readonly log: Array<{ seq: number; event: EventInstance }> = [];
  /**
   * Reverse index: EventInstance → seq for currently-broadcasting events.
   * Populated when the pipeline commits, looked up by the WS broadcast
   * handler so it can stamp `seq` on outgoing event envelopes without
   * scanning the log. WeakMap so entries are GC'd with their event.
   */
  private readonly seqOf = new WeakMap<EventInstance, number>();
  private readonly persistence?: PersistenceAdapter;
  private readonly logCapacity: number;
  private inFlight: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly registry: Registry,
    private readonly world: World,
    private readonly bus: EventBus,
    options: CommandPipelineOptions = {},
  ) {
    this.persistence = options.persistence;
    this.logCapacity = Math.max(1, options.logCapacity ?? 200);
  }

  /**
   * Look up the seq number assigned to an in-flight event. Returns null
   * for transient events (which never get a seq), for events older than
   * the in-memory ring, and for events the pipeline didn't commit.
   */
  seqFor(event: EventInstance): number | null {
    return this.seqOf.get(event) ?? null;
  }

  /**
   * Cold-boot helper: tell the pipeline what the next sequence number
   * should be after replaying persisted events. The registry validates
   * monotonicity if the adapter rejects out-of-order inserts.
   */
  setNextSeq(seq: number): void {
    this.nextSeq = seq;
  }

  /** Highest seq that has been committed (broadcast). 0 if nothing has happened yet. */
  get currentSeq(): number {
    return this.nextSeq - 1;
  }

  dispatch(env: CommandEnvelope): Promise<DispatchResult> {
    const next = this.inFlight.then(() => this.dispatchInternal(env));
    this.inFlight = next.catch(() => undefined);
    return next;
  }

  private async dispatchInternal(env: CommandEnvelope): Promise<DispatchResult> {
    if (this.seenIds.has(env.id)) {
      return { result: fail("duplicate command"), events: [], seq: -1 };
    }
    this.seenIds.add(env.id);

    const def = this.registry.commands.get(env.cmd.type);
    if (!def) return { result: fail(`unknown command: ${env.cmd.type}`), events: [], seq: -1 };

    const ctx = {
      cmd: env.cmd.payload,
      world: this.world,
      registry: this.registry,
      actor: env.issuedBy,
      session: env.session,
      causalState: env.causalState,
    };

    const validation = def.validate(ctx);
    if (!validation.ok) return { result: validation, events: [], seq: -1 };

    // Track every (entity, trait) write across apply + the system fixpoint
    // so derivations can react to writes from the command's apply (spawn,
    // direct world.set) as well as writes from reactive systems. The runner
    // consumes from this map between fixpoint passes.
    const dirty = new Map<EntityId, Set<TraitName>>();
    const unsub = this.world.subscribe((id, trait) => {
      let s = dirty.get(id);
      if (!s) {
        s = new Set();
        dirty.set(id, s);
      }
      s.add(trait);
    });

    let all: EventInstance[];
    try {
      const initial = def.apply(ctx);
      all = runSystemsToFixpoint(this.registry, this.world, initial, dirty);
    } finally {
      unsub();
    }

    // Assign seqs first so we can persist them as one atomic batch.
    const startSeq = this.nextSeq;
    const committed: Array<{ seq: number; event: EventInstance }> = [];
    for (const ev of all) {
      const evDef = this.registry.events.get(ev.type);
      if (evDef && !evDef.transient) {
        const seq = this.nextSeq++;
        committed.push({ seq, event: ev });
      }
    }

    if (this.persistence && committed.length > 0) {
      const at = Date.now();
      await this.persistence.appendEvents(
        this.world.worldId,
        committed.map((c) => toPersistedEvent(this.world.worldId, c.seq, c.event, at)),
      );
    }

    // Persistence has succeeded; commit to the in-memory log + index and broadcast.
    for (const c of committed) {
      this.log.push(c);
      this.seqOf.set(c.event, c.seq);
      if (this.log.length > this.logCapacity) this.log.shift();
    }
    for (const ev of all) this.bus.emit(ev);

    return { result: ok(), events: all, seq: startSeq };
  }
}
