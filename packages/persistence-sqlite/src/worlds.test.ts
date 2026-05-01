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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { WorldId } from "@vtt/substrate";
import { SqliteWorldsRepository, SqlitePersistence } from "./index.js";

const W: WorldId = "world-1";
const W2: WorldId = "world-2";

describe("SqliteWorldsRepository", () => {
  let db: Database.Database;
  let repo: SqliteWorldsRepository;

  beforeEach(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    repo = new SqliteWorldsRepository(db);
    await repo.migrate();
  });

  afterEach(() => db.close());

  it("inserts and reads back a world", async () => {
    const w = await repo.insert({
      id: W,
      name: "Greyhawk",
      gameSystemPlugin: "@vtt/system-simple",
      ownerUserId: "user-gm",
    });
    expect(w.id).toBe(W);
    expect(w.archivedAt).toBeNull();
    const got = await repo.get(W);
    expect(got).toEqual(w);
  });

  it("list excludes archived by default and includes them on request", async () => {
    await repo.insert({ id: W, name: "A", gameSystemPlugin: "@vtt/x", ownerUserId: "u" });
    await repo.insert({ id: W2, name: "B", gameSystemPlugin: "@vtt/x", ownerUserId: "u" });
    await repo.archive(W);
    expect((await repo.list()).map((w) => w.id)).toEqual([W2]);
    const all = await repo.list({ includeArchived: true });
    expect(all.map((w) => w.id).sort()).toEqual([W, W2].sort());
  });

  it("archive sets archivedAt; unarchive clears it", async () => {
    await repo.insert({ id: W, name: "A", gameSystemPlugin: "@vtt/x", ownerUserId: "u" });
    await repo.archive(W);
    const archived = await repo.get(W);
    expect(archived!.archivedAt).not.toBeNull();
    await repo.unarchive(W);
    expect((await repo.get(W))!.archivedAt).toBeNull();
  });

  it("hardDelete removes world and its memberships in one transaction", async () => {
    await repo.insert({ id: W, name: "A", gameSystemPlugin: "@vtt/x", ownerUserId: "u" });
    await repo.addMembership({ worldId: W, userId: "p1", role: "player" });
    await repo.addMembership({ worldId: W, userId: "p2", role: "player" });
    await repo.hardDelete(W);
    expect(await repo.get(W)).toBeNull();
    expect(await repo.listMemberships(W)).toEqual([]);
  });

  it("addMembership is idempotent (replaces on conflict)", async () => {
    await repo.insert({ id: W, name: "A", gameSystemPlugin: "@vtt/x", ownerUserId: "u" });
    await repo.addMembership({ worldId: W, userId: "p1", role: "player" });
    await repo.addMembership({ worldId: W, userId: "p1", role: "gm" });
    const ms = await repo.listMemberships(W);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.role).toBe("gm");
  });

  it("removeMembership drops the row", async () => {
    await repo.insert({ id: W, name: "A", gameSystemPlugin: "@vtt/x", ownerUserId: "u" });
    await repo.addMembership({ worldId: W, userId: "p1", role: "player" });
    await repo.removeMembership(W, "p1");
    expect(await repo.listMemberships(W)).toEqual([]);
  });

  it("worldsForUser returns owned + member-of, excludes archived, deduplicates", async () => {
    await repo.insert({ id: W, name: "Owned", gameSystemPlugin: "@vtt/x", ownerUserId: "gm" });
    await repo.insert({ id: W2, name: "Invited", gameSystemPlugin: "@vtt/x", ownerUserId: "other" });
    await repo.insert({ id: "world-3", name: "Hidden", gameSystemPlugin: "@vtt/x", ownerUserId: "other" });
    await repo.insert({ id: "world-4", name: "Archived", gameSystemPlugin: "@vtt/x", ownerUserId: "gm" });
    await repo.archive("world-4");
    await repo.addMembership({ worldId: W2, userId: "gm", role: "player" });
    // GM is also redundantly added as their own member — dedup must hold.
    await repo.addMembership({ worldId: W, userId: "gm", role: "gm" });
    const got = await repo.worldsForUser("gm");
    expect(got.map((w) => w.id).sort()).toEqual([W, W2].sort());
  });
});

describe("SqlitePersistence.hardDeleteWorld", () => {
  let db: Database.Database;
  let p: SqlitePersistence;

  beforeEach(async () => {
    db = new Database(":memory:");
    p = new SqlitePersistence({ db });
    await p.migrate();
  });

  afterEach(() => db.close());

  it("drops events and snapshots for the named world only", async () => {
    await p.appendEvents("a", [
      { worldId: "a", seq: 1, type: "@x/y/A", payloadVersion: 1, payload: {}, at: 0 },
    ]);
    await p.appendEvents("b", [
      { worldId: "b", seq: 1, type: "@x/y/A", payloadVersion: 1, payload: {}, at: 0 },
    ]);
    await p.writeSnapshot({ worldId: "a", atSeq: 1, state: { nextId: 1, entities: {} }, takenAt: 1 });
    await p.writeSnapshot({ worldId: "b", atSeq: 1, state: { nextId: 1, entities: {} }, takenAt: 1 });

    await p.hardDeleteWorld("a");

    expect(await p.readEventsSince("a", 0)).toEqual([]);
    expect(await p.loadLatestSnapshot("a")).toBeNull();
    // b is untouched
    expect((await p.readEventsSince("b", 0)).length).toBe(1);
    expect(await p.loadLatestSnapshot("b")).not.toBeNull();
  });
});
