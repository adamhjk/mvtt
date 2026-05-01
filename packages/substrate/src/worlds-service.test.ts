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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type {
  PersistedEvent,
  PersistedSnapshot,
  PersistenceAdapter,
  WorldsRepository,
  WorldRecord,
  MembershipRecord,
  WorldRole,
  WorldId,
} from "./index.js";
import { WorldsService } from "./worlds-service.js";

/**
 * In-memory WorldsRepository for service tests. Mirrors the SQLite
 * implementation's surface but lives in plain Maps — keeps these tests
 * focused on the service's orchestration logic, not on storage.
 */
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
  async unarchive(id: WorldId): Promise<void> {
    const w = this.worlds.get(id);
    if (w) this.worlds.set(id, { ...w, archivedAt: null });
  }
  async hardDelete(id: WorldId): Promise<void> {
    this.worlds.delete(id);
    this.memberships = this.memberships.filter((m) => m.worldId !== id);
  }
  async addMembership(input: {
    worldId: WorldId;
    userId: string;
    role: WorldRole;
  }): Promise<void> {
    this.memberships = this.memberships.filter(
      (m) => !(m.worldId === input.worldId && m.userId === input.userId),
    );
    this.memberships.push({ ...input, addedAt: Date.now() });
  }
  async removeMembership(worldId: WorldId, userId: string): Promise<void> {
    this.memberships = this.memberships.filter(
      (m) => !(m.worldId === worldId && m.userId === userId),
    );
  }
  async listMemberships(worldId: WorldId): Promise<MembershipRecord[]> {
    return this.memberships.filter((m) => m.worldId === worldId);
  }
  async worldsForUser(userId: string): Promise<WorldRecord[]> {
    const ownIds = new Set(
      [...this.worlds.values()]
        .filter((w) => w.ownerUserId === userId && w.archivedAt === null)
        .map((w) => w.id),
    );
    const memberIds = new Set(
      this.memberships.filter((m) => m.userId === userId).map((m) => m.worldId),
    );
    const result: WorldRecord[] = [];
    for (const w of this.worlds.values()) {
      if (w.archivedAt !== null) continue;
      if (ownIds.has(w.id) || memberIds.has(w.id)) result.push(w);
    }
    return result;
  }
}

class MemoryPersistence implements PersistenceAdapter {
  events = new Map<WorldId, PersistedEvent[]>();
  snapshots = new Map<WorldId, PersistedSnapshot[]>();
  async migrate(): Promise<void> {}
  async appendEvents(worldId: WorldId, events: ReadonlyArray<PersistedEvent>): Promise<void> {
    const arr = this.events.get(worldId) ?? [];
    arr.push(...events);
    this.events.set(worldId, arr);
  }
  async readEventsSince(worldId: WorldId, sinceSeq: number): Promise<PersistedEvent[]> {
    return (this.events.get(worldId) ?? []).filter((e) => e.seq > sinceSeq);
  }
  async highestSeq(worldId: WorldId): Promise<number> {
    const arr = this.events.get(worldId) ?? [];
    return arr.length === 0 ? 0 : Math.max(...arr.map((e) => e.seq));
  }
  async loadLatestSnapshot(worldId: WorldId): Promise<PersistedSnapshot | null> {
    const arr = this.snapshots.get(worldId) ?? [];
    if (arr.length === 0) return null;
    return arr.reduce((a, b) => (a.atSeq > b.atSeq ? a : b));
  }
  async writeSnapshot(snapshot: PersistedSnapshot): Promise<void> {
    const arr = this.snapshots.get(snapshot.worldId) ?? [];
    arr.push(snapshot);
    this.snapshots.set(snapshot.worldId, arr);
  }
  async hardDeleteWorld(worldId: WorldId): Promise<void> {
    this.events.delete(worldId);
    this.snapshots.delete(worldId);
  }
}

describe("WorldsService", () => {
  let repo: MemoryWorldsRepo;
  let persistence: MemoryPersistence;
  let dataDir: string;
  let svc: WorldsService;

  beforeEach(() => {
    repo = new MemoryWorldsRepo();
    persistence = new MemoryPersistence();
    dataDir = mkdtempSync(resolve(tmpdir(), "mvtt-worlds-"));
    svc = new WorldsService({
      worldsRepo: repo,
      persistence,
      pluginDataRoot: dataDir,
    });
  });

  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  it("create generates a slug-based id and persists the world", async () => {
    const w = await svc.create({
      name: "My Cool Campaign!",
      gameSystemPlugin: "@vtt/system-simple",
      ownerUserId: "user-gm",
    });
    expect(w.id).toMatch(/^my-cool-campaign-[0-9a-f]{6}$/);
    expect(w.name).toBe("My Cool Campaign!");
    expect(w.archivedAt).toBeNull();
    const got = await svc.get(w.id);
    expect(got).toEqual(w);
  });

  it("create handles names that slug to empty strings", async () => {
    const w = await svc.create({
      name: "🎲🎲🎲",
      gameSystemPlugin: "@vtt/x",
      ownerUserId: "u",
    });
    expect(w.id).toMatch(/^world-[0-9a-f]{6}$/);
  });

  it("hardDelete cleans up worlds, events, snapshots, and plugin-data dir", async () => {
    const w = await svc.create({
      name: "Doomed",
      gameSystemPlugin: "@vtt/x",
      ownerUserId: "gm",
    });
    await svc.addMember({ worldId: w.id, userId: "p1", role: "player" });
    await persistence.appendEvents(w.id, [
      { worldId: w.id, seq: 1, type: "@x/y/A", payloadVersion: 1, payload: {}, at: 0 },
    ]);
    await persistence.writeSnapshot({
      worldId: w.id,
      atSeq: 1,
      state: { nextId: 1, entities: {} },
      takenAt: 0,
    });
    const worldDir = resolve(dataDir, w.id);
    mkdirSync(worldDir, { recursive: true });
    writeFileSync(resolve(worldDir, "image.png"), "fake-bytes");

    await svc.hardDelete(w.id);

    expect(await svc.get(w.id)).toBeNull();
    expect(await svc.listMembers(w.id)).toEqual([]);
    expect(await persistence.readEventsSince(w.id, 0)).toEqual([]);
    expect(await persistence.loadLatestSnapshot(w.id)).toBeNull();
    expect(existsSync(worldDir)).toBe(false);
  });

  it("hardDelete is idempotent (second call is a no-op)", async () => {
    const w = await svc.create({
      name: "Twice",
      gameSystemPlugin: "@vtt/x",
      ownerUserId: "gm",
    });
    await svc.hardDelete(w.id);
    await expect(svc.hardDelete(w.id)).resolves.toBeUndefined();
  });

  it("canAccess: owner yes, member yes, stranger no, archived no", async () => {
    const w = await svc.create({
      name: "Members Only",
      gameSystemPlugin: "@vtt/x",
      ownerUserId: "gm",
    });
    await svc.addMember({ worldId: w.id, userId: "p1", role: "player" });
    expect(await svc.canAccess(w.id, "gm")).toBe(true);
    expect(await svc.canAccess(w.id, "p1")).toBe(true);
    expect(await svc.canAccess(w.id, "stranger")).toBe(false);
    await svc.archive(w.id);
    expect(await svc.canAccess(w.id, "gm")).toBe(false);
    expect(await svc.canAccess(w.id, "p1")).toBe(false);
  });

  it("roleFor: owner is gm, member returns membership role, stranger is null", async () => {
    const w = await svc.create({
      name: "Roles",
      gameSystemPlugin: "@vtt/x",
      ownerUserId: "gm",
    });
    await svc.addMember({ worldId: w.id, userId: "p1", role: "player" });
    await svc.addMember({ worldId: w.id, userId: "p2", role: "gm" });
    expect(await svc.roleFor(w.id, "gm")).toBe("gm");
    expect(await svc.roleFor(w.id, "p1")).toBe("player");
    expect(await svc.roleFor(w.id, "p2")).toBe("gm");
    expect(await svc.roleFor(w.id, "stranger")).toBeNull();
  });

  it("worldsForUser includes owned and member-of, excludes archived", async () => {
    await svc.create({ name: "Mine", gameSystemPlugin: "@vtt/x", ownerUserId: "gm" });
    const invited = await svc.create({
      name: "Invited",
      gameSystemPlugin: "@vtt/x",
      ownerUserId: "other",
    });
    await svc.addMember({ worldId: invited.id, userId: "gm", role: "player" });
    const archived = await svc.create({
      name: "Old",
      gameSystemPlugin: "@vtt/x",
      ownerUserId: "gm",
    });
    await svc.archive(archived.id);
    const got = await svc.worldsForUser("gm");
    const names = got.map((w) => w.name).sort();
    expect(names).toEqual(["Invited", "Mine"]);
  });
});
