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

import { describe, it, expect, beforeEach } from "vitest";
import {
  CommandPipeline,
  EventBus,
  Registry,
  World,
  definePlugin,
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import {
  Book,
  BookCreated,
  BookRemoved,
  BookUpdated,
  CreateBook,
  RemoveBook,
  UpdateBook,
  BookCanvasSurface,
} from "./shared/index.js";
import {
  BookSpawningSystem,
  BookRemovalSystem,
  BookUpdateSystem,
} from "./server/systems.js";

import { Permissions } from "@vtt/permissions/shared";

const booksServerPlugin = definePlugin({
  name: "@vtt/books",
  version: "0.1.0",
  traits: [Book, Permissions],
  events: [BookCreated, BookRemoved, BookUpdated],
  commands: [CreateBook, RemoveBook, UpdateBook],
  systems: [BookSpawningSystem, BookRemovalSystem, BookUpdateSystem],
  surfaces: [BookCanvasSurface],
});

const GM: AuthSession = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

const PLAYER: AuthSession = {
  userId: "player-1",
  email: "p@test.dev",
  name: "Player",
  role: "player",
};

function setup() {
  const registry = new Registry();
  registry.load(booksServerPlugin);
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  return { registry, world, bus, pipeline };
}

let cmdSeq = 0;
async function dispatch(
  pipeline: CommandPipeline,
  cmd: CommandInstance,
  session: unknown,
  causalState?: unknown,
) {
  return pipeline.dispatch({
    id: `cmd-${++cmdSeq}`,
    issuedBy: "tester",
    issuedAt: Date.now(),
    cmd,
    session,
    causalState,
  });
}

async function makeBook(
  pipeline: CommandPipeline,
  name = "Player's Handbook",
) {
  const res = await dispatch(pipeline, CreateBook({ name }), GM);
  expect(res.result.ok).toBe(true);
  return res;
}

describe("@vtt/books", () => {
  let pipeline: CommandPipeline;
  let world: World;
  let bus: EventBus;
  let registry: Registry;

  beforeEach(() => {
    ({ pipeline, world, bus, registry } = setup());
  });

  it("uses plugin-namespaced ubiquitous-language names", () => {
    expect(CreateBook.name).toBe("@vtt/books/CreateBook");
    expect(RemoveBook.name).toBe("@vtt/books/RemoveBook");
    expect(UpdateBook.name).toBe("@vtt/books/UpdateBook");
    expect(BookCreated.name).toBe("@vtt/books/BookCreated");
    expect(BookRemoved.name).toBe("@vtt/books/BookRemoved");
    expect(BookUpdated.name).toBe("@vtt/books/BookUpdated");
    expect(Book.name).toBe("@vtt/books/Book");
  });

  describe("CreateBook", () => {
    it("GM dispatch spawns one Book entity carrying the trait values", async () => {
      const seen: string[] = [];
      bus.onAny((e) => seen.push(e.type));
      const res = await makeBook(pipeline, "Tomb of Annihilation");
      expect(res.events.map((e) => e.type)).toEqual([BookCreated.name]);
      expect(seen).toEqual([BookCreated.name]);
      const rows = world.query([Book]);
      expect(rows).toHaveLength(1);
      const v = rows[0]!.values.Book as { name: string };
      expect(v).toMatchObject({ name: "Tomb of Annihilation" });
    });

    it("any authenticated user may create a book; spawned with Permissions(ownedBy(creator))", async () => {
      const res = await dispatch(
        pipeline,
        CreateBook({ name: "Tomb" }),
        PLAYER,
      );
      expect(res.result.ok).toBe(true);
      expect(world.query([Book])).toHaveLength(1);
    });

    it("rejects an unauthenticated dispatch", async () => {
      const res = await dispatch(
        pipeline,
        CreateBook({ name: "Tomb" }),
        undefined,
      );
      expect(res.result.ok).toBe(false);
      expect(world.query([Book])).toHaveLength(0);
    });
  });

  describe("RemoveBook", () => {
    it("GM removes the book; the entity is despawned", async () => {
      await makeBook(pipeline);
      const bookId = world.query([Book])[0]!.id;
      expect(world.has(bookId)).toBe(true);
      const res = await dispatch(pipeline, RemoveBook({ bookId }), GM);
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([BookRemoved.name]);
      expect(world.has(bookId)).toBe(false);
    });

    it("rejects a player dispatch", async () => {
      await makeBook(pipeline);
      const bookId = world.query([Book])[0]!.id;
      const res = await dispatch(pipeline, RemoveBook({ bookId }), PLAYER);
      expect(res.result.ok).toBe(false);
      expect(world.has(bookId)).toBe(true);
    });

    it("rejects when bookId does not exist", async () => {
      const res = await dispatch(
        pipeline,
        RemoveBook({ bookId: "ghost-book" as EntityId }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });
  });

  describe("UpdateBook", () => {
    it("GM rename merges over the existing trait", async () => {
      await makeBook(pipeline, "Original");
      const bookId = world.query([Book])[0]!.id;
      const res = await dispatch(
        pipeline,
        UpdateBook({ bookId, name: "Renamed Book" }),
        GM,
      );
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([BookUpdated.name]);
      const after = world.get(bookId, [Book]) as { Book: { name: string } };
      expect(after.Book.name).toBe("Renamed Book");
    });

    it("rejects a player dispatch", async () => {
      await makeBook(pipeline);
      const bookId = world.query([Book])[0]!.id;
      const res = await dispatch(
        pipeline,
        UpdateBook({ bookId, name: "Hax" }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
      const after = world.get(bookId, [Book]) as { Book: { name: string } };
      expect(after.Book.name).not.toBe("Hax");
    });

    it("rejects when the bookId does not exist", async () => {
      const res = await dispatch(
        pipeline,
        UpdateBook({ bookId: "ghost-book" as EntityId, name: "x" }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects empty-string name at the schema layer", () => {
      expect(() =>
        UpdateBook({ bookId: "book-x" as EntityId, name: "" }),
      ).toThrow();
    });
  });

  describe("schema validation", () => {
    it("rejects empty book name", () => {
      expect(() => CreateBook({ name: "" })).toThrow();
    });

    it("rejects name longer than 160 chars", () => {
      expect(() => CreateBook({ name: "a".repeat(161) })).toThrow();
    });
  });

  describe("systems", () => {
    it("BookSpawningSystem: handler is wired to BookCreated and writes Book", () => {
      expect(BookSpawningSystem.name).toBe("BookSpawning");
      expect(BookSpawningSystem.on.name).toBe(BookCreated.name);
      expect(BookSpawningSystem.writes.map((t) => t.name)).toContain(
        Book.name,
      );
    });

    it("BookRemovalSystem is wired to BookRemoved", () => {
      expect(BookRemovalSystem.on.name).toBe(BookRemoved.name);
    });

    it("BookRemovalSystem is a no-op for an already-despawned id", () => {
      const events = BookRemovalSystem.run({
        event: { bookId: "ghost" as EntityId } as never,
        world,
        registry,
      });
      expect(events).toEqual([]);
    });

    it("BookUpdateSystem is wired to BookUpdated and read/writes Book", () => {
      expect(BookUpdateSystem.on.name).toBe(BookUpdated.name);
      expect(BookUpdateSystem.reads.map((t) => t.name)).toContain(Book.name);
      expect(BookUpdateSystem.writes.map((t) => t.name)).toContain(Book.name);
    });

    it("BookUpdateSystem is a no-op for a despawned book id", () => {
      const events = BookUpdateSystem.run({
        event: { bookId: "ghost" as EntityId, name: "x" } as never,
        world,
        registry,
      });
      expect(events).toEqual([]);
    });
  });
});
