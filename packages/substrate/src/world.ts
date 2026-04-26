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
