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
  CreateBook,
} from "@vtt/books/shared";
import {
  BookSpawningSystem,
} from "@vtt/books/server";
import {
  PdfDocument,
  PdfDocumentSet,
  SetPdfDocument,
} from "./shared/index.js";
import { PdfDocumentSetSystem } from "./server/systems.js";

// Bundle a stripped server plugin combining books + pdf-book so the
// pipeline can run end-to-end without pulling in the whole client/UI
// surface area. Mirrors the `sceneServerPlugin` approach in
// scene.test.ts.
const serverPlugin = definePlugin({
  name: "@vtt/pdf-book-test",
  version: "0.1.0",
  traits: [Book, PdfDocument],
  events: [BookCreated, PdfDocumentSet],
  commands: [CreateBook, SetPdfDocument],
  systems: [BookSpawningSystem, PdfDocumentSetSystem],
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
  registry.load(serverPlugin);
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
) {
  return pipeline.dispatch({
    id: `cmd-${++cmdSeq}`,
    issuedBy: "tester",
    issuedAt: Date.now(),
    cmd,
    session,
  });
}

async function makeBook(
  pipeline: CommandPipeline,
  world: World,
): Promise<EntityId> {
  await dispatch(pipeline, CreateBook({ name: "PHB" }), GM);
  return world.query([Book])[0]!.id;
}

describe("@vtt/pdf-book", () => {
  let pipeline: CommandPipeline;
  let world: World;
  let registry: Registry;

  beforeEach(() => {
    ({ pipeline, world, registry } = setup());
  });

  it("uses plugin-namespaced ubiquitous-language names", () => {
    expect(SetPdfDocument.name).toBe("@vtt/pdf-book/SetPdfDocument");
    expect(PdfDocumentSet.name).toBe("@vtt/pdf-book/PdfDocumentSet");
    expect(PdfDocument.name).toBe("@vtt/pdf-book/PdfDocument");
  });

  describe("SetPdfDocument", () => {
    it("GM sets a PDF; recording system attaches PdfDocument trait to the Book entity", async () => {
      const bookId = await makeBook(pipeline, world);
      const url = `/plugin-data/default/@vtt/pdf-book/books/${bookId}/document.pdf?v=12345`;
      const res = await dispatch(
        pipeline,
        SetPdfDocument({ bookId, url }),
        GM,
      );
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([PdfDocumentSet.name]);
      const got = world.get(bookId, [Book, PdfDocument]) as {
        Book: { name: string };
        PdfDocument: { url: string };
      };
      expect(got.PdfDocument.url).toBe(url);
    });

    it("replacing an existing PDF overwrites the URL", async () => {
      const bookId = await makeBook(pipeline, world);
      const u1 = `/plugin-data/default/@vtt/pdf-book/books/${bookId}/document.pdf?v=1`;
      const u2 = `/plugin-data/default/@vtt/pdf-book/books/${bookId}/document.pdf?v=2`;
      await dispatch(pipeline, SetPdfDocument({ bookId, url: u1 }), GM);
      await dispatch(pipeline, SetPdfDocument({ bookId, url: u2 }), GM);
      const got = world.get(bookId, [PdfDocument]) as {
        PdfDocument: { url: string };
      };
      expect(got.PdfDocument.url).toBe(u2);
    });

    it("rejects a player dispatch", async () => {
      const bookId = await makeBook(pipeline, world);
      const res = await dispatch(
        pipeline,
        SetPdfDocument({
          bookId,
          url: `/plugin-data/default/@vtt/pdf-book/books/${bookId}/document.pdf`,
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects when the bookId does not exist", async () => {
      const res = await dispatch(
        pipeline,
        SetPdfDocument({
          bookId: "ghost-book" as EntityId,
          url: "/plugin-data/default/@vtt/pdf-book/books/ghost-book/document.pdf",
        }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects a URL pointing at a different book", async () => {
      const bookId = await makeBook(pipeline, world);
      const res = await dispatch(
        pipeline,
        SetPdfDocument({
          bookId,
          url: "/plugin-data/default/@vtt/pdf-book/books/some-other-book/document.pdf",
        }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects a URL outside the plugin-data prefix", async () => {
      const bookId = await makeBook(pipeline, world);
      const res = await dispatch(
        pipeline,
        SetPdfDocument({
          bookId,
          url: "https://evil.example/payload.pdf",
        }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects a URL containing path traversal", async () => {
      const bookId = await makeBook(pipeline, world);
      const res = await dispatch(
        pipeline,
        SetPdfDocument({
          bookId,
          url: `/plugin-data/default/@vtt/pdf-book/books/${bookId}/../../../etc/passwd.pdf`,
        }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects an empty url at the schema layer", () => {
      expect(() =>
        SetPdfDocument({
          bookId: "book-x" as EntityId,
          url: "",
        }),
      ).toThrow();
    });
  });

  describe("systems", () => {
    it("PdfDocumentSetSystem is wired to PdfDocumentSet and writes PdfDocument", () => {
      expect(PdfDocumentSetSystem.on.name).toBe(PdfDocumentSet.name);
      expect(PdfDocumentSetSystem.writes.map((t) => t.name)).toContain(
        PdfDocument.name,
      );
    });

    it("PdfDocumentSetSystem is a no-op for a despawned bookId", () => {
      const events = PdfDocumentSetSystem.run({
        event: {
          bookId: "ghost" as EntityId,
          url: "/plugin-data/default/@vtt/pdf-book/books/ghost/document.pdf",
        } as never,
        world,
        registry,
      });
      expect(events).toEqual([]);
    });
  });
});
