import type { TraitMeta } from "./define.js";
import {
  type EntityId,
  type TraitName,
  type WorldId,
  DEFAULT_WORLD_ID,
} from "./schema.js";

type TraitValue = unknown;
type EntityRecord = Map<TraitName, TraitValue>;

/**
 * Serialised World shape used by snapshots — opaque JSON to everyone except
 * `dump`/`restore`. The structure is deliberately simple: a record of
 * entityId → traitName → traitValue, plus the auto-id counter so replay
 * after a snapshot keeps assigning IDs in lockstep with the original run.
 */
export interface WorldState {
  readonly nextId: number;
  readonly entities: Record<string, Record<string, unknown>>;
}

export class World {
  readonly worldId: WorldId;
  private entities = new Map<EntityId, EntityRecord>();
  private nextId = 1;
  private listeners = new Set<(id: EntityId, trait: TraitName) => void>();

  constructor(worldId: WorldId = DEFAULT_WORLD_ID) {
    this.worldId = worldId;
  }

  /**
   * Auto-allocate an id and spawn an entity at it. Legitimate **only**
   * in two places:
   *   1. Tests and harness `setupWorld` callbacks (no networking, no
   *      per-side mirrors — there is only one World).
   *   2. Systems whose trigger event has `broadcast: false` (i.e. the
   *      system runs on the server only, so there is no client mirror
   *      whose counter could drift).
   *
   * Anywhere else — universal-mirror systems reacting to broadcast
   * events — you must use `allocateId()` inside the command's `apply`,
   * embed the id in the event, and call `spawnAt(event.<id>, ...)` from
   * the system. Auto-incrementing on every side and praying the counters
   * stay in sync is silently broken under per-recipient visibility
   * filtering and any future per-side codepath difference.
   *
   * See "Entity ids are server-authoritative" in `design/basics.md`.
   */
  spawn(traits: Array<{ name: TraitName; value: TraitValue }> = []): EntityId {
    const id = `e${this.nextId++}`;
    const rec: EntityRecord = new Map();
    for (const t of traits) rec.set(t.name, t.value);
    this.entities.set(id, rec);
    for (const t of traits) {
      for (const fn of this.listeners) fn(id, t.name);
    }
    return id;
  }

  /**
   * Allocate the next entity id without spawning — used by command
   * `apply` to pre-allocate server-authoritative ids that get embedded
   * in events and reused by spawn systems via `spawnAt`. This is the
   * substrate's escape hatch from the brittle "every side independently
   * auto-increments and prays the counters match" universal-mirror
   * pattern: with ids fixed at allocate-time, no per-recipient event
   * filtering or fixpoint timing can desync client and server.
   */
  allocateId(): EntityId {
    return `e${this.nextId++}`;
  }

  /**
   * Spawn an entity at a caller-provided id. The id must not already
   * exist. Ensures `nextId` advances past `id` so future `spawn`/
   * `allocateId` calls don't collide. Used by mirror systems that
   * receive the id from an event payload.
   */
  spawnAt(
    id: EntityId,
    traits: Array<{ name: TraitName; value: TraitValue }> = [],
  ): void {
    if (this.entities.has(id)) {
      throw new Error(`entity ${id} already exists`);
    }
    const rec: EntityRecord = new Map();
    for (const t of traits) rec.set(t.name, t.value);
    this.entities.set(id, rec);
    const num = Number.parseInt(id.slice(1), 10);
    if (Number.isFinite(num) && num >= this.nextId) {
      this.nextId = num + 1;
    }
    for (const t of traits) {
      for (const fn of this.listeners) fn(id, t.name);
    }
  }

  despawn(id: EntityId): void {
    const rec = this.entities.get(id);
    if (!rec) return;
    const removed = [...rec.keys()];
    this.entities.delete(id);
    for (const traitName of removed) {
      for (const fn of this.listeners) fn(id, traitName);
    }
  }

  has(id: EntityId): boolean {
    return this.entities.has(id);
  }

  get<T extends ReadonlyArray<TraitMeta>>(
    id: EntityId,
    traits: T,
  ): { [K in T[number]["name"]]: unknown } | undefined {
    const rec = this.entities.get(id);
    if (!rec) return undefined;
    const out: Record<string, unknown> = {};
    for (const t of traits) {
      const v = rec.get(t.name);
      if (v === undefined) return undefined;
      const short = t.name.split("/").pop() ?? t.name;
      out[short] = v;
    }
    return out as { [K in T[number]["name"]]: unknown };
  }

  set(id: EntityId, trait: TraitMeta, value: unknown): void {
    const rec = this.entities.get(id);
    if (!rec) throw new Error(`unknown entity: ${id}`);
    rec.set(trait.name, trait.schema.parse(value));
    for (const fn of this.listeners) fn(id, trait.name);
  }

  subscribe(fn: (id: EntityId, trait: TraitName) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  query(traits: ReadonlyArray<TraitMeta>): Array<{ id: EntityId; values: Record<string, unknown> }> {
    const out: Array<{ id: EntityId; values: Record<string, unknown> }> = [];
    outer: for (const [id, rec] of this.entities) {
      const values: Record<string, unknown> = {};
      for (const t of traits) {
        const v = rec.get(t.name);
        if (v === undefined) continue outer;
        const short = t.name.split("/").pop() ?? t.name;
        values[short] = v;
      }
      out.push({ id, values });
    }
    return out;
  }

  /**
   * Serialise the entire World to a JSON-safe shape. Used by snapshotting
   * (durable) and by client catchup (synthetic snapshot of in-memory state).
   * Includes `nextId` so a restored World keeps assigning IDs in lockstep
   * with the original — important because event replay re-runs systems that
   * spawn entities, and divergent IDs would break references.
   *
   * The optional `include` predicate filters which traits make it into the
   * dump. Persisted snapshots pass `(traitName) => !traitMeta.transient` so
   * session/presence state doesn't end up on disk; synthetic client-catchup
   * snapshots use the default (no filter) since clients need the live
   * presence picture as part of joining.
   *
   * Entities whose every trait is filtered out are omitted from the dump
   * entirely — they have no state to persist.
   */
  dump(include?: (trait: TraitName) => boolean): WorldState {
    const entities: Record<string, Record<string, unknown>> = {};
    for (const [id, rec] of this.entities) {
      const t: Record<string, unknown> = {};
      for (const [name, value] of rec) {
        if (include && !include(name)) continue;
        t[name] = value;
      }
      if (Object.keys(t).length > 0) entities[id] = t;
    }
    return { nextId: this.nextId, entities };
  }

  /**
   * Replace this World's contents with a serialised state and fire
   * subscribers for every (entity, trait) pair in the union of the old and
   * new states — so reactivity hooks (`useTrait`, `useQuery`) refresh
   * across the wholesale swap. This is what makes "client connects, snapshot
   * arrives, roll cards appear" work without requiring views to subscribe
   * to a separate "world replaced" signal.
   */
  restore(state: WorldState): void {
    // Capture old (id, trait) pairs before clearing — any signals tracking
    // them need to know they've gone away (or possibly been replaced).
    const old: Array<[EntityId, TraitName]> = [];
    for (const [id, rec] of this.entities) {
      for (const trait of rec.keys()) old.push([id, trait]);
    }

    this.entities.clear();
    for (const [id, traitMap] of Object.entries(state.entities)) {
      const rec: EntityRecord = new Map();
      for (const [name, value] of Object.entries(traitMap)) {
        rec.set(name as TraitName, value);
      }
      this.entities.set(id as EntityId, rec);
    }
    this.nextId = state.nextId;

    // Fire for the union of old and new pairs. Dedup so a trait that
    // existed before AND after only notifies once — its value may have
    // changed but listeners just need to re-read.
    const seen = new Set<string>();
    const notify = (id: EntityId, trait: TraitName): void => {
      const key = `${id}|${trait}`;
      if (seen.has(key)) return;
      seen.add(key);
      for (const fn of this.listeners) fn(id, trait);
    };
    for (const [id, trait] of old) notify(id, trait);
    for (const [id, rec] of this.entities) {
      for (const trait of rec.keys()) notify(id, trait);
    }
  }
}
