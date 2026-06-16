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
import { Permissions, ownedBy } from "@vtt/permissions/shared";
import { Asset } from "@vtt/assets/shared";
import { Book, BookCreated, CreateBook } from "@vtt/books/shared";
import { BookSpawningSystem } from "@vtt/books/server";
import { PdfDocument, PdfDocumentSet, SetPdfDocument } from "./shared/index.js";
import { PdfDocumentSetSystem } from "./server/systems.js";

// Bundle a stripped server plugin combining books + pdf-book so the
// pipeline can run end-to-end without pulling in the whole client/UI
// surface area. Mirrors the `sceneServerPlugin` approach in
// scene.test.ts. Asset trait is registered (no spawning system needed
// — tests seed Asset entities directly via world.spawnAt).
const serverPlugin = definePlugin({
  name: "@vtt/pdf-book-test",
  version: "0.1.0",
  traits: [Book, PdfDocument, Asset, Permissions],
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
async function dispatch(pipeline: CommandPipeline, cmd: CommandInstance, session: unknown) {
  return pipeline.dispatch({
    id: `cmd-${++cmdSeq}`,
    issuedBy: "tester",
    issuedAt: Date.now(),
    cmd,
    session,
  });
}

async function makeBook(pipeline: CommandPipeline, world: World): Promise<EntityId> {
  await dispatch(pipeline, CreateBook({ name: "PHB" }), GM);
  return world.query([Book])[0]!.id;
}

function seedAsset(
  world: World,
  opts: { mime: string; ownerUserId?: string } = { mime: "application/pdf" },
): EntityId {
  const id = world.allocateId();
  world.spawnAt(id, [
    Asset({
      mime: opts.mime,
      sizeBytes: 1024,
      sha256: "f".repeat(64),
      filename: "rules.pdf",
      width: null,
      height: null,
      uploadedAt: Date.now(),
    }),
    Permissions(ownedBy(opts.ownerUserId ?? GM.userId)),
  ]);
  return id;
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
    it("GM binds a PDF asset; mirror attaches PdfDocument trait to the Book entity", async () => {
      const bookId = await makeBook(pipeline, world);
      const assetId = seedAsset(world);
      const res = await dispatch(pipeline, SetPdfDocument({ bookId, assetId }), GM);
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([PdfDocumentSet.name]);
      const got = world.get(bookId, [Book, PdfDocument]) as {
        Book: { name: string };
        PdfDocument: { assetId: EntityId };
      };
      expect(got.PdfDocument.assetId).toBe(assetId);
    });

    it("rebinding to a different asset overwrites the bound assetId", async () => {
      const bookId = await makeBook(pipeline, world);
      const a1 = seedAsset(world);
      const a2 = seedAsset(world);
      await dispatch(pipeline, SetPdfDocument({ bookId, assetId: a1 }), GM);
      await dispatch(pipeline, SetPdfDocument({ bookId, assetId: a2 }), GM);
      const got = world.get(bookId, [PdfDocument]) as {
        PdfDocument: { assetId: EntityId };
      };
      expect(got.PdfDocument.assetId).toBe(a2);
    });

    it("rejects a player dispatch (write requires GM or book owner)", async () => {
      const bookId = await makeBook(pipeline, world);
      const assetId = seedAsset(world);
      const res = await dispatch(pipeline, SetPdfDocument({ bookId, assetId }), PLAYER);
      expect(res.result.ok).toBe(false);
    });

    it("rejects when the bookId does not exist", async () => {
      const assetId = seedAsset(world);
      const res = await dispatch(
        pipeline,
        SetPdfDocument({ bookId: "ghost-book" as EntityId, assetId }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects when the assetId does not exist", async () => {
      const bookId = await makeBook(pipeline, world);
      const res = await dispatch(
        pipeline,
        SetPdfDocument({ bookId, assetId: "ghost-asset" as EntityId }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects an asset whose mime is not application/pdf", async () => {
      const bookId = await makeBook(pipeline, world);
      const imageAsset = seedAsset(world, { mime: "image/png" });
      const res = await dispatch(pipeline, SetPdfDocument({ bookId, assetId: imageAsset }), GM);
      expect(res.result.ok).toBe(false);
      if (!res.result.ok) {
        expect(res.result.reason).toContain("application/pdf");
      }
    });

    it("rejects an empty assetId at the schema layer", () => {
      expect(() =>
        SetPdfDocument({
          bookId: "book-x" as EntityId,
          assetId: "" as EntityId,
        }),
      ).toThrow();
    });
  });

  describe("systems", () => {
    it("PdfDocumentSetSystem is wired to PdfDocumentSet and writes PdfDocument", () => {
      expect(PdfDocumentSetSystem.on.name).toBe(PdfDocumentSet.name);
      expect(PdfDocumentSetSystem.writes.map((t) => t.name)).toContain(PdfDocument.name);
    });

    it("PdfDocumentSetSystem is a no-op for a despawned bookId", () => {
      const events = PdfDocumentSetSystem.run({
        event: {
          bookId: "ghost" as EntityId,
          assetId: "asset-1" as EntityId,
        } as never,
        world,
        registry,
      });
      expect(events).toEqual([]);
    });
  });
});
