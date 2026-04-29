import type { EventInstance, PluginDef } from "./define.js";
import { Registry } from "./registry.js";
import { World } from "./world.js";
import { EventBus } from "./event-bus.js";
import { CommandPipeline } from "./command-pipeline.js";
import { runSystemsToFixpoint } from "./systems-runner.js";
import { substrateCorePlugin } from "./core-plugin.js";
import type { PersistenceAdapter } from "./persistence.js";
import type { WorldRecord, WorldsRepository } from "./worlds-repository.js";
import { resolveActivePlugins } from "./active-plugins.js";
import type { TraitName, WorldId } from "./schema.js";

/**
 * One live World aggregate, fully wired: filtered Registry, World,
 * EventBus, and CommandPipeline. The WorldsRegistry creates one of
 * these per worldId on first connection and keeps it for the life of
 * the process. Cold-boot replay (snapshot + tail) runs in the
 * constructor before the runtime becomes visible.
 */
export class WorldRuntime {
  readonly registry: Registry;
  readonly world: World;
  readonly bus: EventBus;
  readonly pipeline: CommandPipeline;

  private eventsSinceSnapshot = 0;
  private closed = false;

  private constructor(
    readonly record: WorldRecord,
    private readonly persistence: PersistenceAdapter | undefined,
    private readonly snapshotEvery: number,
    private readonly snapshotsToKeep: number,
    activePlugins: ReadonlyArray<PluginDef>,
  ) {
    this.registry = new Registry();
    this.registry.load(substrateCorePlugin);
    for (const p of activePlugins) this.registry.load(p);
    this.registry.validate();

    this.world = new World(record.id);
    this.bus = new EventBus();
    this.pipeline = new CommandPipeline(this.registry, this.world, this.bus, {
      persistence,
    });
  }

  /**
   * Build a runtime for `record` and run cold-boot replay so its
   * in-memory state matches the latest persisted seq before any client
   * is allowed to attach. Caller resolves the active plugin set first
   * (via `resolveActivePlugins`) and passes it in.
   */
  static async create(args: {
    record: WorldRecord;
    activePlugins: ReadonlyArray<PluginDef>;
    persistence?: PersistenceAdapter;
    snapshotEvery: number;
    snapshotsToKeep: number;
  }): Promise<WorldRuntime> {
    const rt = new WorldRuntime(
      args.record,
      args.persistence,
      args.snapshotEvery,
      args.snapshotsToKeep,
      args.activePlugins,
    );
    await rt.coldBootReplay();
    return rt;
  }

  get worldId(): WorldId {
    return this.record.id;
  }

  private async coldBootReplay(): Promise<void> {
    if (!this.persistence) return;
    const snapshot = await this.persistence.loadLatestSnapshot(this.worldId);
    if (snapshot) this.world.restore(snapshot.state);
    const sinceSeq = snapshot?.atSeq ?? 0;
    const tail = await this.persistence.readEventsSince(this.worldId, sinceSeq);
    if (tail.length > 0) {
      const events: EventInstance[] = tail.map((e) => ({
        type: e.type as EventInstance["type"],
        payload: e.payload,
      }));
      // Replay through systems but DON'T re-persist or re-broadcast — the
      // events are already in the log and there's no one connected yet.
      runSystemsToFixpoint(this.registry, this.world, events);
    }
    const highest = await this.persistence.highestSeq(this.worldId);
    this.pipeline.setNextSeq(highest + 1);
  }

  /**
   * Server hook called from each broadcast. Drives snapshot cadence: a
   * snapshot lands every `snapshotEvery` durable events. Transient
   * events don't count.
   */
  observeBroadcast(event: EventInstance): void {
    if (!this.persistence) return;
    const def = this.registry.events.get(event.type);
    if (!def || def.transient) return;
    this.eventsSinceSnapshot++;
    if (this.eventsSinceSnapshot >= this.snapshotEvery) {
      void this.takeSnapshot().catch((err) => {
        // eslint-disable-next-line no-console
        console.error(
          `[mvtt] snapshot write failed for ${this.worldId}:`,
          (err as Error).message,
        );
      });
    }
  }

  async takeSnapshot(): Promise<void> {
    if (!this.persistence) return;
    const atSeq = this.pipeline.currentSeq;
    if (atSeq === 0) return;
    const isDurableTrait = (traitName: TraitName): boolean => {
      const def = this.registry.traits.get(traitName);
      return def ? !def.transient : true;
    };
    await this.persistence.writeSnapshot({
      worldId: this.worldId,
      atSeq,
      state: this.world.dump(isDurableTrait),
      takenAt: Date.now(),
    });
    if (this.persistence.pruneSnapshots) {
      await this.persistence.pruneSnapshots(this.worldId, this.snapshotsToKeep);
    }
    this.eventsSinceSnapshot = 0;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.takeSnapshot();
    } catch {
      // best-effort — shutdown shouldn't crash on snapshot failure
    }
  }
}

export interface WorldsRegistryOptions {
  readonly worldsRepo: WorldsRepository;
  readonly persistence?: PersistenceAdapter;
  /**
   * Plugins loaded into every world's Registry regardless of game
   * system: substrate-core (auto), auth, identity, permissions, comms,
   * shell-workbench, etc. The deployment decides what counts as
   * infrastructure — the substrate doesn't hardcode a list.
   */
  readonly infrastructure: ReadonlyArray<PluginDef>;
  /**
   * The universe of optional plugins compiled into the binary. Each
   * world's Registry is filtered to its chosen game system + that
   * system's transitive `dependsOn`, drawn from this set.
   */
  readonly optional: ReadonlyArray<PluginDef>;
  readonly snapshotEvery?: number;
  readonly snapshotsToKeep?: number;
  /**
   * Called once per runtime, after cold-boot replay and before any
   * connection is attached. The server uses this to subscribe to
   * `runtime.bus.onAny` and wire WS broadcast scoped to that runtime.
   */
  readonly onRuntimeCreated?: (runtime: WorldRuntime) => void;
}

/**
 * One process, many in-memory WorldRuntimes. Lazily acquires a runtime
 * the first time a WS connection asks for `worldId`; subsequent calls
 * return the same instance. The persisted store is shared across all
 * runtimes (each row is keyed by worldId).
 */
export class WorldsRegistry {
  private readonly runtimes = new Map<WorldId, WorldRuntime>();
  private readonly inFlight = new Map<WorldId, Promise<WorldRuntime>>();

  constructor(private readonly opts: WorldsRegistryOptions) {}

  has(worldId: WorldId): boolean {
    return this.runtimes.has(worldId);
  }

  get(worldId: WorldId): WorldRuntime | null {
    return this.runtimes.get(worldId) ?? null;
  }

  /**
   * Get-or-create the runtime for `worldId`. Cold-boot replay completes
   * before this resolves. Concurrent acquires for the same id are
   * coalesced — every caller awaits the same in-flight promise so we
   * never race two cold-boots.
   *
   * Throws if the world doesn't exist, is archived, or its game system
   * plugin can't be resolved.
   */
  async acquire(worldId: WorldId): Promise<WorldRuntime> {
    const existing = this.runtimes.get(worldId);
    if (existing) return existing;
    const pending = this.inFlight.get(worldId);
    if (pending) return pending;

    const promise = this.create(worldId);
    this.inFlight.set(worldId, promise);
    try {
      const rt = await promise;
      this.runtimes.set(worldId, rt);
      this.opts.onRuntimeCreated?.(rt);
      return rt;
    } finally {
      this.inFlight.delete(worldId);
    }
  }

  private async create(worldId: WorldId): Promise<WorldRuntime> {
    const record = await this.opts.worldsRepo.get(worldId);
    if (!record) {
      throw new Error(`world ${JSON.stringify(worldId)} does not exist`);
    }
    if (record.archivedAt !== null) {
      throw new Error(
        `world ${JSON.stringify(worldId)} is archived and cannot be acquired`,
      );
    }
    const { plugins } = resolveActivePlugins({
      infrastructure: this.opts.infrastructure,
      optional: this.opts.optional,
      gameSystemPlugin: record.gameSystemPlugin,
    });
    return WorldRuntime.create({
      record,
      activePlugins: plugins,
      persistence: this.opts.persistence,
      snapshotEvery: this.opts.snapshotEvery ?? 200,
      snapshotsToKeep: this.opts.snapshotsToKeep ?? 3,
    });
  }

  /**
   * Iterate every currently-loaded runtime. Useful for the server's
   * heartbeat and shutdown paths.
   */
  all(): ReadonlyArray<WorldRuntime> {
    return [...this.runtimes.values()];
  }

  /**
   * Take a final snapshot for every loaded runtime and drop them. Called
   * during graceful shutdown.
   */
  async closeAll(): Promise<void> {
    const snapshots = [...this.runtimes.values()].map((rt) => rt.close());
    await Promise.allSettled(snapshots);
    this.runtimes.clear();
  }
}
