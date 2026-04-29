import type { EventInstance } from "./define.js";
import type { WorldState } from "./world.js";
import type { WorldId } from "./schema.js";
import type { Visibility } from "./visibility.js";

/**
 * One persisted event row. `seq` is monotonically increasing per worldId
 * and assigned by the substrate's CommandPipeline (not by the adapter).
 * `payloadVersion` is reserved as `1` from day one — when a plugin's event
 * schema changes, the adapter still loads the row but the consumer is
 * expected to upcast on read. `visibility` mirrors the runtime
 * `EventInstance.visibility` so a future "since: N" reconnect can replay
 * tail events with the same per-recipient filter applied.
 */
export interface PersistedEvent {
  readonly worldId: WorldId;
  readonly seq: number;
  readonly type: string;
  readonly payloadVersion: number;
  readonly payload: unknown;
  /** Mirrors `EventInstance.visibility`. `null` (or omitted) = public. */
  readonly visibility?: Visibility | null;
  readonly at: number;
}

/**
 * One persisted snapshot row. The `state` field is the full World dump as
 * of `atSeq`. To recover World state at any point N: load the latest
 * snapshot with `atSeq <= N`, restore it, then replay events with
 * `seq > snapshot.atSeq AND seq <= N`.
 */
export interface PersistedSnapshot {
  readonly worldId: WorldId;
  readonly atSeq: number;
  readonly state: WorldState;
  readonly takenAt: number;
}

/**
 * Storage abstraction for the World aggregate's event-sourced spine.
 *
 * Every method is worldId-scoped: even though v1 servers only host the
 * `"default"` world, the schema and API have multi-world primary keys from
 * day one so adding multi-tenancy later is a wiring change, not a migration.
 *
 * Concrete implementations (`@vtt/persistence-sqlite`, eventually
 * in-memory for tests) live in their own packages — the substrate stays
 * adapter-agnostic.
 */
export interface PersistenceAdapter {
  /**
   * Append a batch of events for `worldId`. The seq numbers must be
   * contiguous starting from `current highest seq + 1` for the world.
   * Implementations must perform the writes inside a single transaction
   * and reject the entire batch on conflict (for monotonicity).
   */
  appendEvents(worldId: WorldId, events: ReadonlyArray<PersistedEvent>): Promise<void>;

  /**
   * Read all durable events for `worldId` with `seq > sinceSeq`, ordered
   * by seq ascending. Used by cold-boot replay and by client catchup when
   * the gap from a snapshot is small.
   */
  readEventsSince(worldId: WorldId, sinceSeq: number): Promise<PersistedEvent[]>;

  /**
   * Highest seq currently persisted for `worldId`, or 0 if no events. Used
   * to seed `CommandPipeline.nextSeq` on cold boot.
   */
  highestSeq(worldId: WorldId): Promise<number>;

  /**
   * Most recent snapshot for `worldId`, or null if none. The substrate
   * uses this to short-circuit replay on cold boot.
   */
  loadLatestSnapshot(worldId: WorldId): Promise<PersistedSnapshot | null>;

  /**
   * Persist a snapshot of `worldId`'s state at seq `atSeq`. Concurrent
   * snapshots at the same atSeq are idempotent (insert-or-replace).
   */
  writeSnapshot(snapshot: PersistedSnapshot): Promise<void>;

  /**
   * Optional: drop snapshots older than the keep-most-recent count.
   * Implementations may no-op if they prefer external retention policy.
   */
  pruneSnapshots?(worldId: WorldId, keepMostRecent: number): Promise<void>;

  /**
   * Drop every event row + snapshot row for `worldId`. Called by
   * `WorldsService.hardDelete` when the GM permanently destroys a world
   * (along with the worlds-index row and the per-world plugin-data dir).
   */
  hardDeleteWorld(worldId: WorldId): Promise<void>;

  /**
   * Run any schema migrations / table creation. Idempotent. Called once
   * during server startup before any other adapter method.
   */
  migrate(): Promise<void>;

  /**
   * Release resources (close DB handle, etc.). Optional — adapters that
   * share a long-lived resource (e.g. a process-wide SQLite handle owned
   * by the auth package) may no-op.
   */
  close?(): Promise<void> | void;
}

/**
 * Convenience: turn an in-memory EventInstance into a PersistedEvent. The
 * pipeline uses this when committing the fixpoint output.
 */
export function toPersistedEvent(
  worldId: WorldId,
  seq: number,
  event: EventInstance,
  at: number = Date.now(),
): PersistedEvent {
  return {
    worldId,
    seq,
    type: event.type,
    payloadVersion: 1,
    payload: event.payload,
    visibility: event.visibility ?? null,
    at,
  };
}
