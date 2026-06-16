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

// End-to-end test for the file-system → bundle compiler:
//
//   working-dir layout → buildBundleFromDir → bundleToZip
//   → zipToBundle → importBundle → target world
//
// Locks in:
//   - bundle.json + notes/<dir>/index.md + NN-slug.md pages → manifest
//   - assets/<filename> → descriptor with slug-derived sourceEntityId
//   - body refs `![[asset:<slug>]]` survive zip round-trip and get
//     rewritten to live entity ids at import time
//   - rejected on missing bundle.json / empty note dir

import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CommandPipeline,
  EventBus,
  Registry,
  World,
  definePlugin,
  type EntityId,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { permissions as permissionsPlugin } from "@vtt/permissions";
import { Permissions } from "@vtt/permissions/shared";
import { assets as assetsPlugin } from "@vtt/assets";
import { Asset, RegisterAsset } from "@vtt/assets/shared";
import { Note, Page, BelongsToNote, PageOrdering } from "@vtt/notes/shared";
import { notes as notesPlugin } from "@vtt/notes";
import { adventures } from "./manifest.js";
import { buildBlockKindIndex } from "./shared/block-kinds.js";
import { buildBundleFromDir } from "@vtt/adventures/server/build-from-dir";
import { importBundle } from "./server/bundle.js";
import { bundleToZip, zipToBundle } from "./server/zip.js";

const GM: AuthSession = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

const testInfraPlugin = definePlugin({
  name: "@vtt/adventures-build-from-dir",
  version: "0",
  dependsOn: ["@vtt/notes@^0", "@vtt/assets@^0", "@vtt/adventures@^0"],
});

function makeWorld() {
  const registry = new Registry();
  registry.load(permissionsPlugin);
  registry.load(notesPlugin);
  registry.load(assetsPlugin);
  registry.load(adventures);
  registry.load(testInfraPlugin);
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  return { registry, world, pipeline };
}

async function scaffoldFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "advt-build-"));
  await writeFile(
    join(root, "bundle.json"),
    JSON.stringify(
      {
        bundleId: "uuid-fixture",
        name: "Fixture Adventure",
        version: "1.0.0",
        author: "tests",
        summary: "round-trip fixture",
        gameSystem: "@vtt/system-torchbearer",
        requires: ["@vtt/system-torchbearer@^0"],
      },
      null,
      2,
    ),
  );

  const noteDir = join(root, "notes", "fixture-note");
  await mkdir(noteDir, { recursive: true });
  await writeFile(join(noteDir, "index.md"), "---\ntitle: Fixture Note\n---\n");
  await writeFile(
    join(noteDir, "01-overview.md"),
    "---\ntitle: Overview\n---\n\nFirst page body with ![[asset:portrait]] image.\n",
  );
  await writeFile(
    join(noteDir, "02-details.md"),
    "---\ntitle: Details\n---\n\nSecond page body — no assets here.\n",
  );

  const assetsDir = join(root, "assets");
  await mkdir(assetsDir, { recursive: true });
  // PNG magic bytes + a few extras so sha256 is deterministic and
  // mime sniffing has something to chew on.
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xee]);
  await writeFile(join(assetsDir, "portrait.png"), png);

  return root;
}

describe("buildBundleFromDir", () => {
  it("round-trips a working dir → zip → import with asset-ref rewrite", async () => {
    const dir = await scaffoldFixture();
    try {
      const bundle = await buildBundleFromDir({ dir });

      expect(bundle.manifest.name).toBe("Fixture Adventure");
      expect(bundle.manifest.gameSystem).toBe("@vtt/system-torchbearer");
      expect(bundle.manifest.notes).toHaveLength(1);
      expect(bundle.manifest.notes[0]!.title).toBe("Fixture Note");
      expect(bundle.manifest.notes[0]!.bundlePath).toBe("fixture-note");
      expect(bundle.manifest.notes[0]!.pages).toHaveLength(2);
      expect(bundle.manifest.notes[0]!.pages[0]!.title).toBe("Overview");
      expect(bundle.manifest.notes[0]!.pages[1]!.title).toBe("Details");
      expect(bundle.manifest.assets).toHaveLength(1);
      const assetDesc = bundle.manifest.assets[0]!;
      expect(assetDesc.name).toBe("portrait.png");
      expect(assetDesc.mime).toBe("image/png");
      expect(assetDesc.sourceEntityId).toBe("portrait");
      expect(bundle.assets.get(assetDesc.sha256)).toBeDefined();

      // ZIP round-trip — proves the manifest survives JSON serialise +
      // unzip + zod re-parse.
      const rehydrated = zipToBundle(bundleToZip(bundle));
      expect(rehydrated.manifest.assets[0]!.sourceEntityId).toBe("portrait");
      expect(rehydrated.assets.get(assetDesc.sha256)!.length).toBe(10);

      // Import into a fresh world.
      const dst = makeWorld();
      const result = await importBundle(dst.world, rehydrated, buildBlockKindIndex(dst.registry), {
        importerUserId: GM.userId,
        saveAssetBytes: async (bytes, desc) => {
          const res = await dst.pipeline.dispatch({
            id: `import-asset-${desc.sha256}`,
            issuedBy: "tester",
            issuedAt: Date.now(),
            cmd: RegisterAsset({
              mime: desc.mime,
              sizeBytes: desc.bytes,
              sha256: desc.sha256,
              filename: desc.name,
              width: null,
              height: null,
            }),
            session: GM,
          });
          const registered = res.events.find((e) => e.type === "@vtt/assets/AssetRegistered") as
            | { payload: { assetId: EntityId } }
            | undefined;
          if (!registered) throw new Error("RegisterAsset did not fire");
          expect(bytes.length).toBe(10);
          return registered.payload.assetId;
        },
      });
      expect(result.notesCreated).toBe(1);
      expect(result.pagesCreated).toBe(2);
      expect(result.assetsUploaded).toBe(1);

      // Note + pages materialised.
      const noteRows = dst.world.query([Note, Permissions]);
      expect(noteRows).toHaveLength(1);
      const importedNoteId = noteRows[0]!.id as EntityId;

      const pageRows = dst.world
        .query([Page, BelongsToNote, PageOrdering])
        .filter((r) => (r.values.BelongsToNote as { noteId: EntityId }).noteId === importedNoteId)
        .sort(
          (a, b) =>
            (a.values.PageOrdering as { ordinal: number }).ordinal -
            (b.values.PageOrdering as { ordinal: number }).ordinal,
        );
      expect(pageRows).toHaveLength(2);
      expect((pageRows[0]!.values.Page as { title: string }).title).toBe("Overview");
      expect((pageRows[1]!.values.Page as { title: string }).title).toBe("Details");

      // Asset created.
      const assetRows = dst.world.query([Asset, Permissions]);
      expect(assetRows).toHaveLength(1);
      const newAssetId = assetRows[0]!.id as EntityId;

      // The slug-keyed asset ref `![[asset:portrait]]` was rewritten
      // to the live asset id during import. This is the load-bearing
      // assertion: it proves a hand-authored bundle from this tool
      // arrives at the same end state as one exported from a live
      // world.
      const firstPageBody = (pageRows[0]!.values.Page as { body: string }).body;
      expect(firstPageBody).toContain(`![[asset:${newAssetId}]]`);
      expect(firstPageBody).not.toContain("![[asset:portrait]]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a working dir missing bundle.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "advt-build-bad-"));
    try {
      await expect(buildBundleFromDir({ dir })).rejects.toThrow(/missing bundle\.json/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a note dir with no page files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "advt-build-empty-"));
    try {
      await writeFile(
        join(dir, "bundle.json"),
        JSON.stringify({
          bundleId: "uuid-empty",
          name: "Empty",
          version: "1.0.0",
        }),
      );
      const noteDir = join(dir, "notes", "lonely");
      await mkdir(noteDir, { recursive: true });
      await writeFile(join(noteDir, "index.md"), "---\ntitle: Lonely\n---\n");
      await expect(buildBundleFromDir({ dir })).rejects.toThrow(/no page files/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
