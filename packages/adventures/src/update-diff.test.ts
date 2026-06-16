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
import { defineEvent, definePlugin, defineTrait, Registry, World, z } from "@vtt/substrate";
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
import { BlockKindsSlot, defineBlockKind, buildBlockKindIndex } from "./shared/index.js";
import {
  buildBundle,
  importBundle,
  computeUpdateDiff,
  applyUpdateResolution,
} from "./server/index.js";

const Stat = defineTrait({
  name: "@vtt/adventures-update-test/Stat",
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
  name: "@vtt/adventures-update-test-stub",
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

async function buildSourceBundle(version: string, body: string) {
  const a = setup();
  const noteId = a.world.spawn([
    Note({ title: "Bywater", createdAt: 0 }),
    NoteOrdering({ ordinal: 0 }),
  ]);
  a.world.spawn([
    Page({ title: "p", body, bodyRev: 1 }),
    BelongsToNote({ noteId }),
    PageOrdering({ ordinal: 0 }),
  ]);
  return buildBundle(a.world, {
    bundleId: "bundle-1",
    name: "Bywater",
    version,
    noteIds: [noteId],
  });
}

describe("computeUpdateDiff", () => {
  let registry: Registry;
  let world: World;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
  });

  it("classifies an unchanged note correctly", async () => {
    const body = ["```stat foo", "label: a", "value: 1", "```"].join("\n");
    const v1 = await buildSourceBundle("1.0.0", body);
    const idx = buildBlockKindIndex(registry);
    await importBundle(world, v1, idx);
    const v1Again = await buildSourceBundle("1.0.0", body);
    const diff = computeUpdateDiff(world, v1Again, new Set(["stat"]));
    expect(diff.notes).toHaveLength(1);
    expect(diff.notes[0]!.kind).toBe("unchanged");
  });

  it("classifies a fast-forward when only the bundle changed", async () => {
    const v1Body = ["```stat foo", "label: a", "value: 1", "```"].join("\n");
    const v1 = await buildSourceBundle("1.0.0", v1Body);
    const idx = buildBlockKindIndex(registry);
    await importBundle(world, v1, idx);
    const v2Body = ["```stat foo", "label: a", "value: 99", "```"].join("\n");
    const v2 = await buildSourceBundle("2.0.0", v2Body);
    const diff = computeUpdateDiff(world, v2, new Set(["stat"]));
    expect(diff.notes).toHaveLength(1);
    expect(diff.notes[0]!.kind).toBe("fast-forward");
    expect(diff.notes[0]!.blocks.find((b) => b.blockKey === "foo")?.kind).toBe("block-changed");
  });

  it("classifies a conflict when both bundle AND world changed", async () => {
    const v1Body = ["```stat foo", "label: a", "value: 1", "```"].join("\n");
    const v1 = await buildSourceBundle("1.0.0", v1Body);
    const idx = buildBlockKindIndex(registry);
    await importBundle(world, v1, idx);
    // Mutate the world's page body — simulating a GM edit after import.
    const pageRow = world.query([Page, BelongsToNote])[0]!;
    world.set(pageRow.id, Page, {
      title: "p",
      body: ["```stat foo", "label: a", "value: 5", "```"].join("\n"),
      bodyRev: 2,
    });
    const v2Body = ["```stat foo", "label: a", "value: 99", "```"].join("\n");
    const v2 = await buildSourceBundle("2.0.0", v2Body);
    const diff = computeUpdateDiff(world, v2, new Set(["stat"]));
    expect(diff.notes[0]!.kind).toBe("conflict");
  });

  it("classifies a 'new' note when the bundle adds one", async () => {
    // Empty world (no prior import). Brand-new bundle = every note is new.
    const v1 = await buildSourceBundle(
      "1.0.0",
      ["```stat foo", "label: a", "value: 1", "```"].join("\n"),
    );
    const diff = computeUpdateDiff(world, v1, new Set(["stat"]));
    expect(diff.notes[0]!.kind).toBe("new");
  });
});

describe("applyUpdateResolution", () => {
  let registry: Registry;
  let world: World;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
  });

  it("'take-theirs' rewrites the world page and re-converges block entities", async () => {
    const v1Body = ["```stat foo", "label: a", "value: 1", "```"].join("\n");
    const v1 = await buildSourceBundle("1.0.0", v1Body);
    const idx = buildBlockKindIndex(registry);
    await importBundle(world, v1, idx);
    const stat = world.query([Stat])[0]!;
    expect((stat.values.Stat as { value: number }).value).toBe(1);

    const v2Body = ["```stat foo", "label: a", "value: 99", "```"].join("\n");
    const v2 = await buildSourceBundle("2.0.0", v2Body);
    const result = applyUpdateResolution(
      world,
      v2,
      [{ bundlePath: "notes/bywater.md", action: "take-theirs" }],
      idx,
    );
    expect(result.applied).toBe(1);
    const stat2 = world.query([Stat])[0]!;
    expect((stat2.values.Stat as { value: number }).value).toBe(99);
  });

  it("'keep-mine' leaves world body alone", async () => {
    const v1Body = ["```stat foo", "label: a", "value: 1", "```"].join("\n");
    const v1 = await buildSourceBundle("1.0.0", v1Body);
    const idx = buildBlockKindIndex(registry);
    await importBundle(world, v1, idx);
    const v2Body = ["```stat foo", "label: a", "value: 99", "```"].join("\n");
    const v2 = await buildSourceBundle("2.0.0", v2Body);
    const result = applyUpdateResolution(
      world,
      v2,
      [{ bundlePath: "notes/bywater.md", action: "keep-mine" }],
      idx,
    );
    expect(result.skipped).toBe(1);
    const stat = world.query([Stat])[0]!;
    expect((stat.values.Stat as { value: number }).value).toBe(1);
  });

  it("'import-new' creates a fresh note", async () => {
    const v1Body = ["```stat foo", "label: a", "value: 1", "```"].join("\n");
    const v1 = await buildSourceBundle("1.0.0", v1Body);
    const idx = buildBlockKindIndex(registry);
    const result = applyUpdateResolution(
      world,
      v1,
      [{ bundlePath: "notes/bywater.md", action: "import-new" }],
      idx,
    );
    expect(result.applied).toBe(1);
    expect(world.query([Note]).length).toBe(1);
    expect(world.query([Stat]).length).toBe(1);
  });

  it("'merge' applies per-block choices: take-theirs replaces specific blocks", async () => {
    const v1Body = [
      "```stat foo",
      "label: a",
      "value: 1",
      "```",
      "",
      "```stat bar",
      "label: b",
      "value: 2",
      "```",
    ].join("\n");
    const v1 = await buildSourceBundle("1.0.0", v1Body);
    const idx = buildBlockKindIndex(registry);
    await importBundle(world, v1, idx);

    // Mutate the world body so we have something to merge AGAINST.
    const pageRow = world.query([Page, BelongsToNote])[0]!;
    world.set(pageRow.id, Page, {
      title: "p",
      body: [
        "```stat foo",
        "label: a",
        "value: 10", // GM tweaked
        "```",
        "",
        "```stat bar",
        "label: b",
        "value: 20", // GM tweaked
        "```",
      ].join("\n"),
      bodyRev: 2,
    });

    // Now build v2 with BOTH blocks changed upstream.
    const v2Body = [
      "```stat foo",
      "label: a",
      "value: 100",
      "```",
      "",
      "```stat bar",
      "label: b",
      "value: 200",
      "```",
    ].join("\n");
    const v2 = await buildSourceBundle("2.0.0", v2Body);

    // Merge: take theirs for foo, keep mine for bar.
    const result = applyUpdateResolution(
      world,
      v2,
      [
        {
          bundlePath: "notes/bywater.md",
          action: "merge",
          blockChoices: { foo: "take-theirs", bar: "keep-mine" },
        },
      ],
      idx,
    );
    expect(result.applied).toBe(1);
    const stats = world.query([Stat]).map((r) => r.values.Stat as { value: number });
    const values = stats.map((s) => s.value).sort((a, b) => a - b);
    // foo took theirs → 100; bar kept mine → 20
    expect(values).toEqual([20, 100]);
  });
});

void defineEvent;
