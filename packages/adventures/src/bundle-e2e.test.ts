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

// End-to-end round-trip for adventure bundles:
//
//   source world (commands) → buildBundle → bundleToZip
//   → zipToBundle → importBundle → target world
//
// Replicates the HTTP route's plumbing (loadAssetBytes + saveAssetBytes
// hooks both wired). Locks in:
//   - exporter captures Asset entities + their bytes
//   - the .advt.zip really contains the asset bytes
//   - importer materialises notes / pages / assets in the target world
//   - importer rewrites `![[asset:<old>]]` refs to point at the new
//     world's asset ids
//   - imported notes carry Permissions so the hub list (which queries
//     `[Note, Permissions]`) finds them

import { describe, it, expect } from "vitest";
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
import { permissions as permissionsPlugin } from "@vtt/permissions";
import { Permissions } from "@vtt/permissions/shared";
import { assets as assetsPlugin } from "@vtt/assets";
import { Asset, RegisterAsset } from "@vtt/assets/shared";
import {
  CreateNote,
  AddPage,
  BeginEdit,
  SetPageBody,
  Note,
  Page,
  BelongsToNote,
  PageOrdering,
} from "@vtt/notes/shared";
import { notes as notesPlugin } from "@vtt/notes";
import { adventures } from "./manifest.js";
import { buildBlockKindIndex } from "./shared/block-kinds.js";
import { buildBundle, importBundle } from "./server/bundle.js";
import { bundleToZip, zipToBundle } from "./server/zip.js";

const GM: AuthSession = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

let cmdSeq = 0;
async function dispatch(
  pipeline: CommandPipeline,
  cmd: CommandInstance,
  session: AuthSession = GM,
): Promise<{ ok: boolean; events: ReadonlyArray<{ type: string; payload: unknown }> }> {
  const res = await pipeline.dispatch({
    id: `cmd-${++cmdSeq}`,
    issuedBy: "tester",
    issuedAt: Date.now(),
    cmd,
    session,
  });
  return { ok: res.result.ok, events: res.events };
}

const testInfraPlugin = definePlugin({
  name: "@vtt/adventures-bundle-e2e",
  version: "0",
  dependsOn: ["@vtt/notes@^0", "@vtt/assets@^0", "@vtt/adventures@^0"],
});

function makeWorld(): {
  registry: Registry;
  world: World;
  pipeline: CommandPipeline;
} {
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

describe("Adventure bundle E2E: export → zip → import", () => {
  it("round-trips note + page bodies, asset bytes, and rewrites asset refs in the target world", async () => {
    /* -------------- SOURCE WORLD -------------- */
    const src = makeWorld();

    // Dispatch CreateNote → real NoteCreated event, NoteSpawnSystem
    // attaches Note + NoteOrdering + Permissions(ownedBy(GM)).
    const createNoteRes = await dispatch(src.pipeline, CreateNote({ title: "Goblin Cave" }));
    expect(createNoteRes.ok).toBe(true);
    const noteId = src.world.query([Note])[0]!.id as EntityId;

    // CreateNote also fires PageAdded for the first page; we read its
    // server-allocated id off the world rather than the event payload
    // (the test doesn't need event-payload inspection here).
    const firstPageRow = src.world.query([Page])[0]!;
    const firstPageId = firstPageRow.id as EntityId;

    // RegisterAsset — exercise the actual command + system. The asset
    // bytes hook on the HTTP route does this server-dispatched; we
    // do it inline here. AssetSpawningSystem materialises the entity.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xee, 0xdd]);
    const sha = "a".repeat(64);
    const assetRes = await dispatch(
      src.pipeline,
      RegisterAsset({
        mime: "image/png",
        sizeBytes: png.length,
        sha256: sha,
        filename: "portrait.png",
        width: null,
        height: null,
      }),
    );
    expect(assetRes.ok).toBe(true);
    const sourceAssetId = src.world.query([Asset])[0]!.id as EntityId;

    // SetPageBody requires an edit lock — BeginEdit first.
    const beginRes = await dispatch(src.pipeline, BeginEdit({ pageId: firstPageId }));
    expect(beginRes.ok).toBe(true);

    // SetPageBody — store the markdown that references the asset.
    // Body uses `![[asset:<sourceAssetId>]]` — same shape the GM
    // would author through the editor's `[[`-completion.
    const body = `# Bad guys\n\n![[asset:${sourceAssetId}]]\n\nAfter the image, narrative text.`;
    const setBodyRes = await dispatch(src.pipeline, SetPageBody({ pageId: firstPageId, body }));
    expect(setBodyRes.ok).toBe(true);

    /* -------------- EXPORT -------------- */
    // In-memory map of "disk" bytes the loadAssetBytes hook reads.
    const onDisk = new Map<string, Uint8Array>([[sourceAssetId, png]]);
    const bundle = await buildBundle(src.world, {
      bundleId: "uuid-e2e",
      name: "E2E",
      version: "1.0.0",
      noteIds: [noteId],
      loadAssetBytes: async (aid) => onDisk.get(aid) ?? null,
    });

    // Bundle's manifest must carry the asset descriptor, and the
    // bytes map must hold the actual bytes.
    expect(bundle.manifest.assets).toHaveLength(1);
    expect(bundle.manifest.assets[0]!.sourceEntityId).toBe(sourceAssetId);
    expect(bundle.manifest.assets[0]!.sha256).toBe(sha);
    expect(bundle.assets.get(sha)).toBeDefined();
    expect(bundle.assets.get(sha)!.length).toBe(png.length);

    /* -------------- ZIP ROUND-TRIP -------------- */
    const zipped = bundleToZip(bundle);
    const rehydrated = zipToBundle(zipped);
    // The reparsed bundle still has the asset descriptor + the bytes.
    expect(rehydrated.manifest.assets).toHaveLength(1);
    expect(rehydrated.assets.get(sha)).toBeDefined();
    expect(rehydrated.assets.get(sha)!.length).toBe(png.length);

    /* -------------- IMPORT into FRESH WORLD -------------- */
    const dst = makeWorld();
    let savedBytes: Uint8Array | null = null;
    let savedDescriptor: unknown = null;
    const result = await importBundle(dst.world, rehydrated, buildBlockKindIndex(dst.registry), {
      importerUserId: GM.userId,
      saveAssetBytes: async (bytes, descriptor) => {
        // Mirror the HTTP route's hook: persist bytes + dispatch
        // RegisterAsset → AssetSpawningSystem spawns the Asset entity
        // → we return its new id so importBundle can rewrite body
        // refs.
        savedBytes = bytes;
        savedDescriptor = descriptor;
        const res = await dst.pipeline.dispatch({
          id: `import-asset-${descriptor.sha256}`,
          issuedBy: "tester",
          issuedAt: Date.now(),
          cmd: RegisterAsset({
            mime: descriptor.mime,
            sizeBytes: descriptor.bytes,
            sha256: descriptor.sha256,
            filename: descriptor.name,
            width: null,
            height: null,
          }),
          session: GM,
        });
        const registered = res.events.find((e) => e.type === "@vtt/assets/AssetRegistered") as
          | { payload: { assetId: EntityId } }
          | undefined;
        if (!registered) throw new Error("RegisterAsset did not fire");
        return registered.payload.assetId;
      },
    });
    expect(savedBytes).toBeDefined();
    expect(savedDescriptor).toBeDefined();
    expect(result.notesCreated).toBe(1);
    expect(result.assetsUploaded).toBe(1);

    /* -------------- ASSERT TARGET WORLD -------------- */
    // Notes hub queries `[Note, Permissions]` — the imported note
    // must be visible to that query.
    const noteRows = dst.world.query([Note, Permissions]);
    expect(noteRows).toHaveLength(1);
    const importedNoteId = noteRows[0]!.id as EntityId;

    // Asset entity exists in the target world.
    const targetAssetRows = dst.world.query([Asset, Permissions]);
    expect(targetAssetRows).toHaveLength(1);
    const newAssetId = targetAssetRows[0]!.id as EntityId;
    expect(newAssetId).not.toBe(sourceAssetId);

    // Page body should reference the NEW asset id, not the source
    // world's id. Without the rewrite, `[[asset:<sourceId>]]` would
    // be a dangling reference in the target world.
    const pageRow = dst.world
      .query([Page, BelongsToNote, PageOrdering])
      .find((r) => (r.values.BelongsToNote as { noteId: EntityId }).noteId === importedNoteId);
    expect(pageRow).toBeDefined();
    const importedBody = (pageRow!.values.Page as { body: string }).body;
    expect(importedBody).toContain(`![[asset:${newAssetId}]]`);
    expect(importedBody).not.toContain(`![[asset:${sourceAssetId}]]`);
    expect(importedBody).toContain("After the image, narrative text.");
  });
});
