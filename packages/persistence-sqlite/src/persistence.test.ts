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
import Database from "better-sqlite3";
import { DEFAULT_WORLD_ID } from "@vtt/substrate";
import { SqlitePersistence } from "./index.js";

describe("SqlitePersistence", () => {
  let db: Database.Database;
  let p: SqlitePersistence;

  beforeEach(async () => {
    db = new Database(":memory:");
    p = new SqlitePersistence({ db });
    await p.migrate();
  });

  afterEach(() => {
    db.close();
  });

  it("appends and reads back events in seq order", async () => {
    await p.appendEvents(DEFAULT_WORLD_ID, [
      {
        worldId: DEFAULT_WORLD_ID,
        seq: 1,
        type: "@x/y/A",
        payloadVersion: 1,
        payload: { a: 1 },
        at: 100,
      },
      {
        worldId: DEFAULT_WORLD_ID,
        seq: 2,
        type: "@x/y/B",
        payloadVersion: 1,
        payload: { b: 2 },
        at: 110,
      },
    ]);
    const events = await p.readEventsSince(DEFAULT_WORLD_ID, 0);
    expect(events.map((e) => [e.seq, e.type])).toEqual([
      [1, "@x/y/A"],
      [2, "@x/y/B"],
    ]);
    expect(events[0]!.payload).toEqual({ a: 1 });
  });

  it("readEventsSince filters by sinceSeq", async () => {
    await p.appendEvents(DEFAULT_WORLD_ID, [
      { worldId: DEFAULT_WORLD_ID, seq: 1, type: "@x/y/A", payloadVersion: 1, payload: {}, at: 0 },
      { worldId: DEFAULT_WORLD_ID, seq: 2, type: "@x/y/B", payloadVersion: 1, payload: {}, at: 0 },
      { worldId: DEFAULT_WORLD_ID, seq: 3, type: "@x/y/C", payloadVersion: 1, payload: {}, at: 0 },
    ]);
    const tail = await p.readEventsSince(DEFAULT_WORLD_ID, 1);
    expect(tail.map((e) => e.seq)).toEqual([2, 3]);
  });

  it("highestSeq returns 0 for empty world", async () => {
    expect(await p.highestSeq(DEFAULT_WORLD_ID)).toBe(0);
  });

  it("highestSeq returns the largest seq committed", async () => {
    await p.appendEvents(DEFAULT_WORLD_ID, [
      { worldId: DEFAULT_WORLD_ID, seq: 1, type: "@x/y/A", payloadVersion: 1, payload: {}, at: 0 },
      { worldId: DEFAULT_WORLD_ID, seq: 2, type: "@x/y/A", payloadVersion: 1, payload: {}, at: 0 },
    ]);
    expect(await p.highestSeq(DEFAULT_WORLD_ID)).toBe(2);
  });

  it("rejects an event whose worldId doesn't match the batch's world", async () => {
    await expect(
      p.appendEvents(DEFAULT_WORLD_ID, [
        { worldId: "other-world", seq: 1, type: "@x/y/A", payloadVersion: 1, payload: {}, at: 0 },
      ]),
    ).rejects.toThrow(/worldId mismatch/);
  });

  it("rejects duplicate seq inserts (PK violation)", async () => {
    await p.appendEvents(DEFAULT_WORLD_ID, [
      { worldId: DEFAULT_WORLD_ID, seq: 1, type: "@x/y/A", payloadVersion: 1, payload: {}, at: 0 },
    ]);
    await expect(
      p.appendEvents(DEFAULT_WORLD_ID, [
        {
          worldId: DEFAULT_WORLD_ID,
          seq: 1,
          type: "@x/y/dup",
          payloadVersion: 1,
          payload: {},
          at: 0,
        },
      ]),
    ).rejects.toThrow();
  });

  it("snapshot round-trip preserves state", async () => {
    const state = {
      nextId: 7,
      entities: { e1: { "@x/y/A": { value: "hello" } } },
    };
    await p.writeSnapshot({
      worldId: DEFAULT_WORLD_ID,
      atSeq: 12,
      state,
      takenAt: 1000,
    });
    const got = await p.loadLatestSnapshot(DEFAULT_WORLD_ID);
    expect(got).not.toBeNull();
    expect(got!.atSeq).toBe(12);
    expect(got!.state).toEqual(state);
  });

  it("loadLatestSnapshot returns the most-recent atSeq", async () => {
    await p.writeSnapshot({
      worldId: DEFAULT_WORLD_ID,
      atSeq: 5,
      state: { nextId: 1, entities: {} },
      takenAt: 1,
    });
    await p.writeSnapshot({
      worldId: DEFAULT_WORLD_ID,
      atSeq: 12,
      state: { nextId: 1, entities: {} },
      takenAt: 2,
    });
    await p.writeSnapshot({
      worldId: DEFAULT_WORLD_ID,
      atSeq: 8,
      state: { nextId: 1, entities: {} },
      takenAt: 3,
    });
    const got = await p.loadLatestSnapshot(DEFAULT_WORLD_ID);
    expect(got!.atSeq).toBe(12);
  });

  it("pruneSnapshots keeps only the N most-recent", async () => {
    for (let i = 1; i <= 5; i++) {
      await p.writeSnapshot({
        worldId: DEFAULT_WORLD_ID,
        atSeq: i,
        state: { nextId: 1, entities: {} },
        takenAt: i,
      });
    }
    await p.pruneSnapshots!(DEFAULT_WORLD_ID, 2);
    // We can't read all snapshots through the public API, but the latest is
    // still findable, and writing a sixth and pruning to 1 should leave only it.
    await p.writeSnapshot({
      worldId: DEFAULT_WORLD_ID,
      atSeq: 6,
      state: { nextId: 1, entities: {} },
      takenAt: 6,
    });
    await p.pruneSnapshots!(DEFAULT_WORLD_ID, 1);
    expect((await p.loadLatestSnapshot(DEFAULT_WORLD_ID))!.atSeq).toBe(6);
  });

  it("worlds are isolated by worldId", async () => {
    await p.appendEvents("world-a", [
      { worldId: "world-a", seq: 1, type: "@x/y/A", payloadVersion: 1, payload: {}, at: 0 },
    ]);
    await p.appendEvents("world-b", [
      { worldId: "world-b", seq: 1, type: "@x/y/A", payloadVersion: 1, payload: {}, at: 0 },
    ]);
    expect((await p.readEventsSince("world-a", 0)).length).toBe(1);
    expect((await p.readEventsSince("world-b", 0)).length).toBe(1);
    expect(await p.highestSeq("world-a")).toBe(1);
    expect(await p.highestSeq("world-b")).toBe(1);
  });
});
