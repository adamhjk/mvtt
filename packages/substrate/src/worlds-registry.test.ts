// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  defineCommand,
  defineEvent,
  definePlugin,
  defineSystem,
  defineTrait,
  ok,
  type EventInstance,
  type PersistenceAdapter,
  type WorldId,
} from "./index.js";
import { WorldsRegistry } from "./worlds-registry.js";
import { WorldsService } from "./worlds-service.js";
import type {
  MembershipRecord,
  WorldRecord,
  WorldRole,
  WorldsRepository,
} from "./worlds-repository.js";

// ---- minimal in-memory deps (mirror worlds-service.test.ts) ----

class MemoryWorldsRepo implements WorldsRepository {
  worlds = new Map<WorldId, WorldRecord>();
  memberships: MembershipRecord[] = [];
  async migrate(): Promise<void> {}
  async list(opts?: { includeArchived?: boolean }): Promise<WorldRecord[]> {
    return [...this.worlds.values()].filter(
      (w) => opts?.includeArchived || w.archivedAt === null,
    );
  }
  async get(id: WorldId): Promise<WorldRecord | null> {
    return this.worlds.get(id) ?? null;
  }
  async insert(input: {
    id: WorldId;
    name: string;
    gameSystemPlugin: string;
    ownerUserId: string;
  }): Promise<WorldRecord> {
    const w: WorldRecord = {
      id: input.id,
      name: input.name,
      gameSystemPlugin: input.gameSystemPlugin,
      ownerUserId: input.ownerUserId,
      createdAt: Date.now(),
      archivedAt: null,
    };
    this.worlds.set(input.id, w);
    return w;
  }
  async archive(id: WorldId): Promise<void> {
    const w = this.worlds.get(id);
    if (w) this.worlds.set(id, { ...w, archivedAt: Date.now() });
  }
  async unarchive(): Promise<void> {}
  async hardDelete(id: WorldId): Promise<void> {
    this.worlds.delete(id);
  }
  async addMembership(input: {
    worldId: WorldId;
    userId: string;
    role: WorldRole;
  }): Promise<void> {
    this.memberships.push({ ...input, addedAt: Date.now() });
  }
  async removeMembership(): Promise<void> {}
  async listMemberships(worldId: WorldId): Promise<MembershipRecord[]> {
    return this.memberships.filter((m) => m.worldId === worldId);
  }
  async worldsForUser(): Promise<WorldRecord[]> {
    return [];
  }
}

class MemoryPersistence implements PersistenceAdapter {
  events = new Map<WorldId, EventInstance[]>();
  async migrate(): Promise<void> {}
  async appendEvents(worldId: WorldId, events: ReadonlyArray<{ payload: unknown; type: string; seq: number; worldId: WorldId; payloadVersion: number; at: number }>): Promise<void> {
    const arr = this.events.get(worldId) ?? [];
    for (const e of events) {
      arr.push({ type: e.type as EventInstance["type"], payload: e.payload });
    }
    this.events.set(worldId, arr);
  }
  async readEventsSince(): Promise<[]> {
    return [];
  }
  async highestSeq(): Promise<number> {
    return 0;
  }
  async loadLatestSnapshot(): Promise<null> {
    return null;
  }
  async writeSnapshot(): Promise<void> {}
  async hardDeleteWorld(): Promise<void> {}
}

// ---- a tiny game-system plugin: ping → pong ----

const Counter = defineTrait({
  name: "@vtt/test-game/Counter",
  schema: z.object({ value: z.number() }),
});
const Pong = defineEvent({
  name: "@vtt/test-game/Pong",
  schema: z.object({ at: z.number() }),
});
const Ping = defineCommand({
  name: "@vtt/test-game/Ping",
  schema: z.object({ at: z.number() }),
  validate: () => ok(),
  apply: (ctx) => [Pong({ at: ctx.cmd.at })],
});
const Counts = defineSystem({
  name: "Counts",
  on: Pong,
  reads: [Counter],
  writes: [Counter],
  run: ({ world }) => {
    // Spawn-or-bump a singleton counter trait.
    const existing = world.query([Counter]);
    if (existing.length > 0) {
      const row = existing[0]!;
      const cur = (row.values.Counter as { value: number }).value;
      world.set(row.id, Counter, { value: cur + 1 });
    } else {
      world.spawn([Counter({ value: 1 })]);
    }
    return [];
  },
});
const testGame = definePlugin({
  name: "@vtt/test-game",
  version: "0",
  dependsOn: ["@vtt/substrate@^0"],
  traits: [Counter],
  events: [Pong],
  commands: [Ping],
  systems: [Counts],
  gameSystem: true,
});

// ---- tests ----

describe("WorldsRegistry", () => {
  let repo: MemoryWorldsRepo;
  let persistence: MemoryPersistence;
  let svc: WorldsService;
  let registry: WorldsRegistry;

  beforeEach(() => {
    repo = new MemoryWorldsRepo();
    persistence = new MemoryPersistence();
    svc = new WorldsService({ worldsRepo: repo, persistence });
    registry = new WorldsRegistry({
      worldsRepo: repo,
      persistence,
      infrastructure: [],
      optional: [testGame],
      snapshotEvery: 1000,
    });
  });

  it("acquire creates a runtime with the world's filtered Registry", async () => {
    const w = await svc.create({
      name: "T",
      gameSystemPlugin: "@vtt/test-game",
      ownerUserId: "u",
    });
    const rt = await registry.acquire(w.id);
    expect(rt.worldId).toBe(w.id);
    expect(rt.registry.commands.has(Ping.name)).toBe(true);
    expect(rt.registry.events.has(Pong.name)).toBe(true);
  });

  it("acquire is idempotent — second call returns the same instance", async () => {
    const w = await svc.create({
      name: "T",
      gameSystemPlugin: "@vtt/test-game",
      ownerUserId: "u",
    });
    const a = await registry.acquire(w.id);
    const b = await registry.acquire(w.id);
    expect(a).toBe(b);
  });

  it("concurrent acquire requests for the same worldId coalesce to one runtime", async () => {
    const w = await svc.create({
      name: "T",
      gameSystemPlugin: "@vtt/test-game",
      ownerUserId: "u",
    });
    const [a, b, c] = await Promise.all([
      registry.acquire(w.id),
      registry.acquire(w.id),
      registry.acquire(w.id),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("acquire throws for archived worlds", async () => {
    const w = await svc.create({
      name: "T",
      gameSystemPlugin: "@vtt/test-game",
      ownerUserId: "u",
    });
    await svc.archive(w.id);
    await expect(registry.acquire(w.id)).rejects.toThrow(/archived/);
  });

  it("acquire throws for unknown worlds", async () => {
    await expect(registry.acquire("ghost-world")).rejects.toThrow(/does not exist/);
  });

  it("two worlds run independent state machines — no cross-talk", async () => {
    const wA = await svc.create({
      name: "Alpha",
      gameSystemPlugin: "@vtt/test-game",
      ownerUserId: "u",
    });
    const wB = await svc.create({
      name: "Beta",
      gameSystemPlugin: "@vtt/test-game",
      ownerUserId: "u",
    });
    const rtA = await registry.acquire(wA.id);
    const rtB = await registry.acquire(wB.id);

    // Sanity: distinct objects all the way down.
    expect(rtA).not.toBe(rtB);
    expect(rtA.world).not.toBe(rtB.world);
    expect(rtA.bus).not.toBe(rtB.bus);
    expect(rtA.pipeline).not.toBe(rtB.pipeline);
    expect(rtA.registry).not.toBe(rtB.registry);

    // Subscribe to each bus and dispatch on A only.
    const seenA: string[] = [];
    const seenB: string[] = [];
    rtA.bus.onAny((e) => seenA.push(e.type));
    rtB.bus.onAny((e) => seenB.push(e.type));

    await rtA.pipeline.dispatch({
      id: "cmd-1",
      issuedBy: "client-1",
      issuedAt: 0,
      cmd: Ping({ at: 1 }),
    });

    expect(seenA).toContain(Pong.name);
    expect(seenB).toEqual([]);

    // World state matches: A has 1 counter entity, B has 0.
    expect(rtA.world.query([Counter])).toHaveLength(1);
    expect(rtB.world.query([Counter])).toHaveLength(0);

    // Each pipeline has its own seq sequence — A is at 1, B at 0.
    expect(rtA.pipeline.currentSeq).toBeGreaterThan(0);
    expect(rtB.pipeline.currentSeq).toBe(0);
  });

  it("onRuntimeCreated fires once per world", async () => {
    const seen: WorldId[] = [];
    const r = new WorldsRegistry({
      worldsRepo: repo,
      persistence,
      infrastructure: [],
      optional: [testGame],
      onRuntimeCreated: (rt) => seen.push(rt.worldId),
    });
    const w = await svc.create({
      name: "T",
      gameSystemPlugin: "@vtt/test-game",
      ownerUserId: "u",
    });
    await r.acquire(w.id);
    await r.acquire(w.id);
    await r.acquire(w.id);
    expect(seen).toEqual([w.id]);
  });

  it("closeAll takes a final snapshot for each runtime", async () => {
    let snapshots = 0;
    const persistence: PersistenceAdapter = {
      migrate: async () => {},
      appendEvents: async () => {},
      readEventsSince: async () => [],
      highestSeq: async () => 0,
      loadLatestSnapshot: async () => null,
      writeSnapshot: async () => {
        snapshots++;
      },
      hardDeleteWorld: async () => {},
    };
    const svc2 = new WorldsService({ worldsRepo: repo, persistence });
    const r = new WorldsRegistry({
      worldsRepo: repo,
      persistence,
      infrastructure: [],
      optional: [testGame],
    });
    const w = await svc2.create({
      name: "T",
      gameSystemPlugin: "@vtt/test-game",
      ownerUserId: "u",
    });
    const rt = await r.acquire(w.id);
    // Drive a durable event so currentSeq > 0 (otherwise takeSnapshot is a no-op).
    await rt.pipeline.dispatch({
      id: "x",
      issuedBy: "c",
      issuedAt: 0,
      cmd: Ping({ at: 0 }),
    });
    await r.closeAll();
    expect(snapshots).toBeGreaterThan(0);
  });
});
