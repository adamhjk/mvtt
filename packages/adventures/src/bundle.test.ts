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
  defineCommand,
  defineEvent,
  definePlugin,
  defineSystem,
  defineTrait,
  EntityId,
  Registry,
  World,
  ok,
  z,
} from "@vtt/substrate";
import { permissions } from "@vtt/permissions";
import {
  Note,
  NoteOrdering,
  Page,
  PageOrdering,
  BelongsToNote,
  PageBodySet,
  MarkdownPostRenderSlot,
  EditorCompletionSourcesSlot,
  NotesReferenceSlot,
} from "@vtt/notes/shared";
import { adventures } from "./manifest.js";
import {
  AdventureProvenance,
  BlockKindsSlot,
  defineBlockKind,
  buildBlockKindIndex,
} from "./shared/index.js";
import {
  buildBundle,
  bundleFromJson,
  bundleToJson,
  computeReferenceClosure,
  importBundle,
  sha256Hex,
} from "./server/bundle.js";
import { runBlockParse } from "./server/block-parse-system.js";

// Stub block kind: a minimal "stat" block.
const Stat = defineTrait({
  name: "@vtt/adventures-bundle-test/Stat",
  schema: z.object({ label: z.string(), value: z.number() }),
});

const StatSchema = z.object({
  label: z.string().min(1),
  value: z.number().int(),
});

const statKind = defineBlockKind({
  name: "stat",
  description: "A test stat block",
  schema: StatSchema,
  project: (parsed) => {
    const p = parsed as z.infer<typeof StatSchema>;
    return {
      traits: [{ trait: Stat, value: { label: p.label, value: p.value } }],
    };
  },
});

const stubKindPlugin = definePlugin({
  name: "@vtt/adventures-bundle-test-stub",
  version: "0",
  dependsOn: ["@vtt/adventures@^0"],
  traits: [Stat],
  fills: { [BlockKindsSlot.name]: [statKind as never] },
});

const notesStub = definePlugin({
  name: "@vtt/notes",
  version: "0.1.0",
  traits: [Note, NoteOrdering, BelongsToNote, Page, PageOrdering],
  events: [PageBodySet],
  slots: [MarkdownPostRenderSlot, EditorCompletionSourcesSlot, NotesReferenceSlot],
});

function setup() {
  const registry = new Registry();
  registry.load(permissions);
  registry.load(notesStub);
  registry.load(adventures);
  registry.load(stubKindPlugin);
  registry.validate();
  const world = new World();
  return { registry, world };
}

describe("sha256Hex", () => {
  it("produces the canonical SHA-256 of an empty string", async () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
  it("produces the canonical SHA-256 of 'hello'", async () => {
    expect(sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
  it("matches expected output for short markdown bodies", async () => {
    const body = "```stat foo\nlabel: a\nvalue: 1\n```";
    expect(sha256Hex(body)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("buildBundle", () => {
  let registry: Registry;
  let world: World;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
  });

  it("captures one note + its pages", async () => {
    const noteId = world.spawn([
      Note({ title: "Bywater Bridge", createdAt: 0 }),
      NoteOrdering({ ordinal: 0 }),
    ]);
    world.spawn([
      Page({ title: "Setting", body: "Long bridge over deep water.", bodyRev: 1 }),
      BelongsToNote({ noteId }),
      PageOrdering({ ordinal: 0 }),
    ]);
    const bundle = await buildBundle(world, {
      bundleId: "uuid-test-1",
      name: "Test Bundle",
      version: "1.0.0",
      noteIds: [noteId],
    });
    expect(bundle.manifest.notes).toHaveLength(1);
    expect(bundle.manifest.notes[0]!.title).toBe("Bywater Bridge");
    expect(bundle.manifest.notes[0]!.pages).toHaveLength(1);
    expect(bundle.manifest.notes[0]!.pages[0]!.body).toContain("deep water");
    expect(bundle.manifest.notes[0]!.pages[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("excludes notes not in the selected list", async () => {
    const noteA = world.spawn([
      Note({ title: "A", createdAt: 0 }),
      NoteOrdering({ ordinal: 0 }),
    ]);
    const noteB = world.spawn([
      Note({ title: "B", createdAt: 0 }),
      NoteOrdering({ ordinal: 1 }),
    ]);
    world.spawn([
      Page({ title: "p", body: "x", bodyRev: 1 }),
      BelongsToNote({ noteId: noteA }),
      PageOrdering({ ordinal: 0 }),
    ]);
    world.spawn([
      Page({ title: "p", body: "y", bodyRev: 1 }),
      BelongsToNote({ noteId: noteB }),
      PageOrdering({ ordinal: 0 }),
    ]);
    const bundle = await buildBundle(world, {
      bundleId: "uuid-test-2",
      name: "T",
      version: "1.0.0",
      noteIds: [noteA],
    });
    expect(bundle.manifest.notes).toHaveLength(1);
    expect(bundle.manifest.notes[0]!.title).toBe("A");
  });
});

describe("importBundle round-trip", () => {
  it("export from world A, import into world B → same notes + page bodies", async () => {
    const a = setup();
    const noteId = a.world.spawn([
      Note({ title: "Bywater", createdAt: 0 }),
      NoteOrdering({ ordinal: 0 }),
    ]);
    a.world.spawn([
      Page({
        title: "Intro",
        body: ["```stat foo", "label: a", "value: 1", "```"].join("\n"),
        bodyRev: 1,
      }),
      BelongsToNote({ noteId }),
      PageOrdering({ ordinal: 0 }),
    ]);
    const bundle = await buildBundle(a.world, {
      bundleId: "uuid-roundtrip",
      name: "Bywater",
      version: "1.0.0",
      noteIds: [noteId],
    });

    const b = setup();
    const idx = buildBlockKindIndex(b.registry);
    const result = await importBundle(b.world, bundle, idx);
    expect(result.notesCreated).toBe(1);
    expect(result.pagesCreated).toBe(1);

    // The imported note carries AdventureProvenance pointing at the bundle.
    const noteRows = b.world.query([Note, AdventureProvenance]);
    expect(noteRows).toHaveLength(1);
    const prov = noteRows[0]!.values.AdventureProvenance as {
      bundleId: string;
      bundleName: string;
      version: string;
    };
    expect(prov.bundleId).toBe("uuid-roundtrip");
    expect(prov.bundleName).toBe("Bywater");
    expect(prov.version).toBe("1.0.0");

    // The page body parsed → block entity materialized.
    const stats = b.world.query([Stat]);
    expect(stats).toHaveLength(1);
    const v = stats[0]!.values.Stat as { label: string; value: number };
    expect(v).toEqual({ label: "a", value: 1 });
  });

  it("survives a JSON serialization round-trip", async () => {
    const a = setup();
    const noteId = a.world.spawn([
      Note({ title: "Test", createdAt: 0 }),
      NoteOrdering({ ordinal: 0 }),
    ]);
    a.world.spawn([
      Page({ title: "p", body: "hello", bodyRev: 1 }),
      BelongsToNote({ noteId }),
      PageOrdering({ ordinal: 0 }),
    ]);
    const bundle = await buildBundle(a.world, {
      bundleId: "u",
      name: "Test",
      version: "1.0.0",
      noteIds: [noteId],
    });
    const json = bundleToJson(bundle);
    const reparsed = bundleFromJson(json);
    expect(reparsed.manifest).toEqual(bundle.manifest);
  });

  it("re-running import is additive (a second import creates a fresh set)", async () => {
    const a = setup();
    const noteId = a.world.spawn([
      Note({ title: "T", createdAt: 0 }),
      NoteOrdering({ ordinal: 0 }),
    ]);
    a.world.spawn([
      Page({ title: "p", body: "x", bodyRev: 1 }),
      BelongsToNote({ noteId }),
      PageOrdering({ ordinal: 0 }),
    ]);
    const bundle = await buildBundle(a.world, {
      bundleId: "u2",
      name: "T",
      version: "1.0.0",
      noteIds: [noteId],
    });
    const b = setup();
    const idx = buildBlockKindIndex(b.registry);
    await importBundle(b.world, bundle, idx);
    await importBundle(b.world, bundle, idx);
    // Two imports create two notes — v1 import is additive; the
    // detect-already-imported-via-provenance flow lives in the
    // update service (Phase 7).
    expect(b.world.query([Note]).length).toBe(2);
  });
});

describe("asset bundling", () => {
  it("walks asset references in note bodies and includes bytes via loadAssetBytes hook", async () => {
    const a = setup();
    const { Asset } = await import("@vtt/assets/shared");
    const assetId = a.world.spawn([
      Asset({
        mime: "image/png",
        sizeBytes: 5,
        sha256: "a".repeat(64),
        filename: "thing.png",
        width: null,
        height: null,
        uploadedAt: 0,
      }),
    ]);
    const noteId = a.world.spawn([
      Note({ title: "WithAsset", createdAt: 0 }),
      NoteOrdering({ ordinal: 0 }),
    ]);
    a.world.spawn([
      Page({
        title: "p",
        body: `Here: ![[asset:${assetId}]] and chip [[asset:${assetId}]]`,
        bodyRev: 1,
      }),
      BelongsToNote({ noteId }),
      PageOrdering({ ordinal: 0 }),
    ]);
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const bundle = await buildBundle(a.world, {
      bundleId: "u-asset",
      name: "WithAsset",
      version: "1.0.0",
      noteIds: [noteId],
      loadAssetBytes: (id) => (id === assetId ? bytes : null),
    });
    expect(bundle.manifest.assets).toHaveLength(1);
    expect(bundle.manifest.assets[0]!.sha256).toBe("a".repeat(64));
    expect(bundle.manifest.assets[0]!.sourceEntityId).toBe(assetId);
    expect(bundle.assets.get("a".repeat(64))).toEqual(bytes);
  });

  it("import rewrites [[asset:<oldId>]] refs to new ids when saveAssetBytes is provided", async () => {
    const { Asset } = await import("@vtt/assets/shared");
    const a = setup();
    const oldAssetId = a.world.spawn([
      Asset({
        mime: "image/png",
        sizeBytes: 5,
        sha256: "b".repeat(64),
        filename: "img.png",
        width: null,
        height: null,
        uploadedAt: 0,
      }),
    ]);
    const noteId = a.world.spawn([
      Note({ title: "X", createdAt: 0 }),
      NoteOrdering({ ordinal: 0 }),
    ]);
    a.world.spawn([
      Page({
        title: "p",
        body: `![[asset:${oldAssetId}]]`,
        bodyRev: 1,
      }),
      BelongsToNote({ noteId }),
      PageOrdering({ ordinal: 0 }),
    ]);
    const bundle = await buildBundle(a.world, {
      bundleId: "u-rewrite",
      name: "X",
      version: "1.0.0",
      noteIds: [noteId],
      loadAssetBytes: () => new Uint8Array([9, 9, 9]),
    });

    const b = setup();
    const idx = buildBlockKindIndex(b.registry);
    const mintedNewId = "newAssetXYZ";
    await importBundle(b.world, bundle, idx, {
      saveAssetBytes: () => mintedNewId as never,
    });
    const pages = b.world.query([Page]);
    const body = (pages[0]!.values.Page as { body: string }).body;
    expect(body).toContain(`[[asset:${mintedNewId}]]`);
    expect(body).not.toContain(oldAssetId);
  });

  it("captureUncoverables synthesizes a `notes/captured.md` for manual entities", async () => {
    const { Character } = await import("@vtt/characters/shared");
    const { ItemIdentity } = await import("@vtt/items/shared");
    const a = setup();
    // Spawn a manual character (no block provenance).
    const manualNpc = a.world.spawn([Character({ name: "Wanderer" })]);
    a.world.spawn([
      ItemIdentity({ name: "Mystery Coin", description: "Glints faintly", img: "" }),
    ]);
    const noteId = a.world.spawn([
      Note({ title: "Refs", createdAt: 0 }),
      NoteOrdering({ ordinal: 0 }),
    ]);
    a.world.spawn([
      Page({
        title: "p",
        body: [
          "```stat foo",
          "label: refs [[character:Wanderer]] and [[item:Mystery Coin]]",
          "value: 1",
          "```",
        ].join("\n"),
        bodyRev: 1,
      }),
      BelongsToNote({ noteId }),
      PageOrdering({ ordinal: 0 }),
    ]);
    const idx = buildBlockKindIndex(a.registry);
    const bundle = await buildBundle(a.world, {
      bundleId: "u-cap",
      name: "Cap",
      version: "1.0.0",
      noteIds: [noteId],
      captureUncoverables: true,
      kindIndex: idx,
    });
    const captured = bundle.manifest.notes.find((n) => n.bundlePath === "notes/captured.md");
    expect(captured).toBeDefined();
    const body = captured!.pages[0]!.body;
    expect(body).toContain("```character Wanderer");
    expect(body).toContain("```item Mystery Coin");
    void manualNpc;
  });
});

describe("computeReferenceClosure", () => {
  let registry: Registry;
  let world: World;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
  });

  it("classifies in-selected, in-unselected, and uncoverable references", async () => {
    // Note A: defines `stat:foo`.
    const noteA = world.spawn([
      Note({ title: "A", createdAt: 0 }),
      NoteOrdering({ ordinal: 0 }),
    ]);
    const pageA = world.spawn([
      Page({
        title: "p",
        body: ["```stat foo", "label: x", "value: 1", "```"].join("\n"),
        bodyRev: 1,
      }),
      BelongsToNote({ noteId: noteA }),
      PageOrdering({ ordinal: 0 }),
    ]);
    // Note B: defines `stat:bar` and references `[[stat:foo]]`.
    const noteB = world.spawn([
      Note({ title: "B", createdAt: 0 }),
      NoteOrdering({ ordinal: 1 }),
    ]);
    const pageB = world.spawn([
      Page({
        title: "p",
        body: [
          "```stat bar",
          "label: refs [[stat:foo]]",
          "value: 2",
          "```",
        ].join("\n"),
        bodyRev: 1,
      }),
      BelongsToNote({ noteId: noteB }),
      PageOrdering({ ordinal: 0 }),
    ]);

    const idx = buildBlockKindIndex(registry);
    runBlockParse(world, pageA, ["```stat foo", "label: x", "value: 1", "```"].join("\n"), idx);
    runBlockParse(world, pageB, [
      "```stat bar",
      "label: refs [[stat:foo]]",
      "value: 2",
      "```",
    ].join("\n"), idx);

    // Selecting noteB only — `[[stat:foo]]` should classify as
    // "in unselected" (auxiliary include candidate).
    const closure = computeReferenceClosure(world, [noteB], idx);
    expect(closure.inUnselected.length).toBeGreaterThan(0);
    expect(closure.inUnselected[0]!.kind).toBe("stat");
  });
});

void EntityId;
void defineCommand;
void defineEvent;
void defineSystem;
void ok;
