// mvtt, an RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of mvtt.
//
// mvtt is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// mvtt is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with mvtt.  If not, see <https://www.gnu.org/licenses/>.

import type { CommandInstance, EventInstance, PluginDef } from "./define.js";
import { Registry } from "./registry.js";
import { World } from "./world.js";
import { EventBus } from "./event-bus.js";
import { WireMsg } from "./protocol.js";
import { createConnection } from "./connection.js";
import type { EntityId, EventName, QualifiedName, TraitName } from "./schema.js";
import { substrateCorePlugin } from "./core-plugin.js";
import { runSystemsToFixpoint } from "./systems-runner.js";
import { createContext, createSignal, useContext } from "solid-js";

export interface ClientOptions {
  url: string;
  plugins: ReadonlyArray<PluginDef>;
}

/**
 * High-frequency, non-event-sourced side channel — drag ghosts, cursors,
 * "X is typing", anything where freshness matters and durability doesn't.
 * The substrate fans `publish`ed payloads out to all OTHER clients (the
 * originator already knows the value locally); `subscribe` runs the
 * provided callback for incoming payloads on the named channel.
 */
export interface PresenceApi {
  publish(channel: string, payload: unknown, opts?: { to?: string[] }): void;
  subscribe<T = unknown>(
    channel: string,
    fn: (payload: T) => void,
  ): () => void;
}

/**
 * Resolution of a dispatched command: ok/reason as the server reported
 * it on the wire. Resolves once the server's `ack` for this command id
 * arrives. Never rejects — a connection drop after dispatch resolves
 * with `ok: false, reason: "disconnected"` so callers can clear UI
 * busy-state instead of hanging.
 */
export interface DispatchAck {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface DispatchHandle {
  /** The wire-level command id; useful for correlating with logs. */
  readonly id: string;
  /** Resolves when the server acks this command. */
  readonly ack: Promise<DispatchAck>;
}

export interface ClientHandle {
  readonly registry: Registry;
  readonly world: World;
  readonly bus: EventBus;
  readonly presence: PresenceApi;
  readonly clientId: () => string | null;
  /** The worldId this client is connected to, as advertised by the server's hello. Null until connected. */
  readonly worldId: () => string | null;
  /**
   * True while a live socket is open. The client auto-reconnects on any
   * drop (see connection.ts), so false is a transient "reconnecting…"
   * state, not a terminal one — surface it, don't treat it as fatal.
   */
  readonly connected: () => boolean;
  /** Highest event seq this client has applied (snapshot.atSeq or event.seq). */
  readonly lastAppliedSeq: () => number;
  /**
   * True once the server has sent `synced` — catchup is complete. Resets
   * to false on disconnect and flips true again after each reconnect's
   * snapshot replay, so `connected() && !synced()` means "resyncing".
   */
  readonly synced: () => boolean;
  dispatch(cmd: CommandInstance, opts?: { causalState?: unknown }): DispatchHandle;
  onConnect(fn: () => void): () => void;
  /**
   * Fires when the client transitions from catchup to live mode — once
   * on initial connect and again after every reconnect resync.
   */
  onSynced(fn: () => void): () => void;
  /**
   * Per-client registry of pending optimistic-trait writes, keyed by the
   * entity the trait lives on. `createOptimisticTrait` registers a flush
   * callback when it mounts and unregisters on cleanup. Call sites that
   * need the server to observe the *current* optimistic state (cross-user
   * verbs like `ShareTab`, anything that reads-then-acts on the server)
   * `await flushOptimisticWrites(entityId)` first; the registry runs every
   * registered flush in parallel and resolves once the dispatched commands
   * have been ack'd, so the next command's server-side view of the world
   * already includes the flushed writes.
   */
  readonly optimisticFlushes: OptimisticFlushRegistry;
  close(): void;
}

/**
 * Per-entity collection of pending-write flushers. `createOptimisticTrait`
 * registers a flush function on construction and unregisters on cleanup,
 * keyed by the entity the trait lives on. The trait's name isn't part of
 * the key — multiple plugins can attach optimistic traits to the same
 * sentinel and they all flush together.
 *
 * Implementation detail: a `Set` per entity, swapped to an array before
 * iteration so a flush whose own ack-handler unregisters itself doesn't
 * mutate the set mid-iteration.
 */
export interface OptimisticFlushRegistry {
  /** Register a flush callback for an entity. Returns an unregister fn. */
  register(entityId: EntityId, flush: () => Promise<void>): () => void;
  /** Run every registered flush for `entityId` in parallel; resolve when all settle. */
  flushFor(entityId: EntityId): Promise<void>;
}

export function createOptimisticFlushRegistry(): OptimisticFlushRegistry {
  const byEntity = new Map<EntityId, Set<() => Promise<void>>>();
  return {
    register: (entityId, flush) => {
      let set = byEntity.get(entityId);
      if (!set) {
        set = new Set();
        byEntity.set(entityId, set);
      }
      set.add(flush);
      return () => {
        const cur = byEntity.get(entityId);
        if (!cur) return;
        cur.delete(flush);
        if (cur.size === 0) byEntity.delete(entityId);
      };
    },
    flushFor: async (entityId) => {
      const set = byEntity.get(entityId);
      if (!set || set.size === 0) return;
      // Snapshot first — a flush may resolve quickly and remove itself
      // (e.g. the writer unmounts on the same tick), and mutating the set
      // while iterating loses subsequent entries.
      const flushes = Array.from(set);
      await Promise.allSettled(flushes.map((f) => f()));
    },
  };
}

let cmdCounter = 1;
const newCmdId = () =>
  `cmd-${Date.now().toString(36)}-${cmdCounter++}-${Math.random().toString(36).slice(2, 8)}`;

export function startClient(opts: ClientOptions): ClientHandle {
  const registry = new Registry();
  registry.load(substrateCorePlugin);
  for (const p of opts.plugins) registry.load(p);
  registry.validate();

  const world = new World();
  const bus = new EventBus();

  // These are exposed to the UI (clientId, connected, synced, lastAppliedSeq)
  // and are read inside Solid `createMemo`/`createEffect`. Storing them as
  // Solid signals — not plain closure variables — makes views that depend
  // on them re-render correctly when they change. The rule for client
  // state that views observe: signal, not closure.
  const [clientId, setClientId] = createSignal<string | null>(null);
  const [worldId, setWorldId] = createSignal<string | null>(null);
  const [connected, setConnected] = createSignal(false);
  const [lastAppliedSeq, setLastAppliedSeq] = createSignal(0);
  const [synced, setSynced] = createSignal(false);
  const connectListeners = new Set<() => void>();
  const syncedListeners = new Set<() => void>();
  // commandId -> deferred ack. Set on dispatch, drained on the matching
  // `ack` wire frame (or on disconnect, see the close handler below).
  const pendingAcks = new Map<
    string,
    { resolve: (ack: DispatchAck) => void }
  >();

  // The connection layer owns the socket lifecycle: auto-reconnect with
  // backoff, resume-trigger reconnects (visibilitychange/pageshow/online),
  // and a zombie watchdog for sockets that die without a close event —
  // Safari's signature failure after tab suspension. Every reconnect is a
  // fresh server handshake (hello → snapshot → synced), and the snapshot
  // handler below resyncs the local World wholesale via `world.restore`,
  // so missed events during the gap are recovered automatically.
  const conn = createConnection({
    url: opts.url,
    onOpen: () => {
      setConnected(true);
    },
    onDisconnect: () => {
      setConnected(false);
      // Back to catchup mode: the next connection replays a full
      // snapshot before `synced` arrives again. UI reading `synced()`
      // can distinguish "reconnecting" from "resyncing".
      setSynced(false);
      // Drain pending acks so callers awaiting them don't hang forever.
      // Disconnect mid-dispatch is indistinguishable from a server-side
      // failure from the caller's perspective; surface it as not-ok with
      // a reason so UI busy-states can clear.
      for (const pending of pendingAcks.values()) {
        pending.resolve({ ok: false, reason: "disconnected" });
      }
      pendingAcks.clear();
    },
    // Declared below; safe because frames can only arrive after
    // startClient returns.
    onMessage: (data) => handleWireMessage(data),
  });

  const handleWireMessage = (data: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const msg = WireMsg.safeParse(parsed);
    if (!msg.success) return;
    switch (msg.data.kind) {
      case "hello":
        setClientId(msg.data.clientId);
        setWorldId(msg.data.worldId);
        for (const fn of connectListeners) fn();
        break;
      case "snapshot":
        // Server-authoritative state replacement: apply directly to the
        // local World without running systems. The snapshot is "frozen
        // state" — the server already ran the systems that produced it.
        world.restore(msg.data.state);
        setLastAppliedSeq(msg.data.atSeq);
        break;
      case "synced": {
        const atSeq = msg.data.atSeq;
        setSynced(true);
        setLastAppliedSeq((prev) => Math.max(prev, atSeq));
        for (const fn of syncedListeners) fn();
        break;
      }
      case "event": {
        const evType = msg.data.event.type as EventName;
        const def = registry.events.get(evType);
        if (!def) return;
        const ev: EventInstance = {
          type: evType,
          payload: def.schema.parse(msg.data.event.payload),
        };
        // Apply through the same fixpoint runner the server uses so the
        // client's local World mirrors authoritative state. The dirty map
        // is wired the same way the server's pipeline wires it: every
        // (entity, trait) write that lands during this tick — whether
        // from a universal-mirror system reacting to the wire event or
        // from a follow-on local emission — feeds the next derivation
        // pass. Without this, a server-side derivation's `*Changed`
        // broadcast arrives but the derived trait never gets written
        // into the client's world (no system listens to derivation
        // events directly), and views reading the trait stay stale.
        const dirty = new Map<EntityId, Set<TraitName>>();
        const unsub = world.subscribe((id, trait) => {
          let s = dirty.get(id);
          if (!s) {
            s = new Set();
            dirty.set(id, s);
          }
          s.add(trait);
        });
        let all: EventInstance[];
        try {
          all = runSystemsToFixpoint(registry, world, [ev], dirty, "client");
        } finally {
          unsub();
        }
        for (const e of all) bus.emit(e);
        const seq = msg.data.seq;
        if (typeof seq === "number") {
          setLastAppliedSeq((prev) => Math.max(prev, seq));
        }
        break;
      }
      case "entity-revealed": {
        // Server granted us read access to an entity that wasn't in our
        // local world (or updates one we already had with the latest
        // trait values). Spawn-or-update; the bus stays quiet because
        // there's no plugin event for "entity appeared" — every
        // reactive view re-evaluates via `world.subscribe` once the
        // traits land.
        const { entityId, traits } = msg.data;
        const arr: Array<{ name: TraitName; value: unknown }> = [];
        for (const [name, val] of Object.entries(traits)) {
          const meta = registry.traits.get(name as never);
          if (!meta) continue;
          arr.push({ name: meta.name, value: val });
        }
        if (world.has(entityId as EntityId)) {
          for (const { name, value } of arr) {
            const meta = registry.traits.get(name as never);
            if (meta) world.set(entityId as EntityId, meta, value);
          }
        } else {
          world.spawnAt(entityId as EntityId, arr);
        }
        const revealedSeq = msg.data.seq;
        if (typeof revealedSeq === "number") {
          setLastAppliedSeq((prev) => Math.max(prev, revealedSeq));
        }
        break;
      }
      case "entity-hidden": {
        // Server revoked our read access. Despawn locally; existing
        // `useTrait` / `useQuery` subscriptions react via
        // `world.subscribe`. Any tab bound to the entity falls back to
        // the empty-state UI naturally.
        const { entityId } = msg.data;
        if (world.has(entityId as EntityId)) {
          world.despawn(entityId as EntityId);
        }
        const hiddenSeq = msg.data.seq;
        if (typeof hiddenSeq === "number") {
          setLastAppliedSeq((prev) => Math.max(prev, hiddenSeq));
        }
        break;
      }
      case "ack": {
        const pending = pendingAcks.get(msg.data.commandId);
        if (pending) {
          pendingAcks.delete(msg.data.commandId);
          pending.resolve({
            ok: msg.data.ok,
            reason: msg.data.reason,
          });
        }
        break;
      }
      case "presence": {
        const subs = presenceSubs.get(msg.data.channel as QualifiedName);
        if (subs) for (const fn of subs) fn(msg.data.payload);
        break;
      }
      // "pong" frames exist purely to bump the connection layer's
      // activity clock, which already happened on receipt; "ping" and
      // "command" are client→server only and never arrive here.
    }
  };

  // Presence: per-channel listeners, not buffered. Late-joining a channel
  // means you start hearing from "now"; the design is for ephemeral state
  // (cursor positions, drag ghosts) where stale snapshots aren't useful.
  const presenceSubs = new Map<QualifiedName, Set<(payload: unknown) => void>>();
  const presence: PresenceApi = {
    publish(channel, payload, pubOpts) {
      // Presence is ephemeral by design — while disconnected, payloads
      // are dropped, not queued. A stale cursor position replayed after
      // a reconnect would be worse than no cursor at all.
      conn.send(
        JSON.stringify({
          kind: "presence",
          channel,
          payload,
          to: pubOpts?.to,
        }),
      );
    },
    subscribe(channel, fn) {
      const key = channel as QualifiedName;
      let set = presenceSubs.get(key);
      if (!set) {
        set = new Set();
        presenceSubs.set(key, set);
      }
      set.add(fn as (p: unknown) => void);
      return () => {
        set!.delete(fn as (p: unknown) => void);
      };
    },
  };

  return {
    registry,
    world,
    bus,
    presence,
    clientId,
    worldId,
    connected,
    lastAppliedSeq,
    synced,
    dispatch(cmd, dispatchOpts) {
      const id = newCmdId();
      let resolve!: (ack: DispatchAck) => void;
      const ack = new Promise<DispatchAck>((r) => {
        resolve = r;
      });
      // Fail fast while disconnected: `send` on a non-OPEN socket is a
      // silent browser no-op, and an ack registered after the disconnect
      // drain would hang forever. Commands are NOT queued for replay —
      // a command issued against a pre-disconnect world could act on
      // state that moved during the gap; the caller sees not-ok and the
      // user retries against the resynced world.
      const sent = conn.send(
        JSON.stringify({
          kind: "command",
          id,
          issuedAt: Date.now(),
          cmd,
          causalState: dispatchOpts?.causalState,
        }),
      );
      if (sent) {
        pendingAcks.set(id, { resolve });
      } else {
        resolve({ ok: false, reason: "disconnected" });
      }
      return { id, ack };
    },
    onConnect(fn) {
      connectListeners.add(fn);
      if (clientId() !== null) fn();
      return () => connectListeners.delete(fn);
    },
    onSynced(fn) {
      syncedListeners.add(fn);
      if (synced()) fn();
      return () => syncedListeners.delete(fn);
    },
    optimisticFlushes: createOptimisticFlushRegistry(),
    close() {
      conn.close();
    },
  };
}

const ClientContext = createContext<ClientHandle>();
export const ClientProvider = ClientContext.Provider;

export function useClient(): ClientHandle {
  const c = useContext(ClientContext);
  if (!c) throw new Error("useClient must be used inside ClientProvider");
  return c;
}

export {
  Surface,
  useTrait,
  useTraitPath,
  useQuery,
  createOptimisticTrait,
} from "./reactivity.jsx";
export type { QueryRow, OptimisticTraitOptions } from "./reactivity.jsx";
export type { PluginDef } from "./define.js";
