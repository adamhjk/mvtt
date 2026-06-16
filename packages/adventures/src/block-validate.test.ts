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

// Build-time block validation: `validateBlockBodies` (the world-free
// schema check the bundler runs) and the `kindIndex` opt-in on
// `buildBundleFromDir`. Locks in that the check shares the importer's
// YAML + wiki-link + Zod path, ignores unrecognised fences, and aborts
// the build with a precise report when a block is malformed.

import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { definePlugin, Registry, z } from "@vtt/substrate";
import { permissions } from "@vtt/permissions";
import {
  Page,
  BelongsToNote,
  PageBodySet,
  MarkdownPostRenderSlot,
  EditorCompletionSourcesSlot,
  NotesReferenceSlot,
} from "@vtt/notes/shared";
import { adventures } from "./manifest.js";
import {
  defineBlockKind,
  BlockKindsSlot,
  buildBlockKindIndex,
  buildBlockKindIndexFromPlugins,
  wikiLink,
  type BlockKindIndex,
} from "./shared/index.js";
import { validateBlockBodies } from "./server/block-parse-system.js";
import { buildBundleFromDir } from "@vtt/adventures/server/build-from-dir";

// Two stub kinds: a plain `stat` block and a `creature` block whose
// `weapons` list is a flow array of `wikiLink("item")` slots — the
// shape that only parses correctly when the wiki-link preprocessing
// runs before YAML.load.
const StatSchema = z.object({
  label: z.string().min(1),
  value: z.number().int(),
});
const statKind = defineBlockKind({
  name: "stat",
  schema: StatSchema,
  project: () => ({ traits: [] }),
});

const CreatureSchema = z.object({
  might: z.number().int().min(0).max(10),
  weapons: z.array(wikiLink("item")).default([]),
});
const creatureKind = defineBlockKind({
  name: "creature",
  schema: CreatureSchema,
  project: () => ({ traits: [] }),
});

const stubPlugin = definePlugin({
  name: "@vtt/adventures-validate-stub",
  version: "0",
  dependsOn: ["@vtt/adventures@^0"],
  fills: {
    [BlockKindsSlot.name]: [statKind as never, creatureKind as never],
  },
});

const notesStub = definePlugin({
  name: "@vtt/notes",
  version: "0.1.0",
  traits: [Page, BelongsToNote],
  events: [PageBodySet],
  slots: [MarkdownPostRenderSlot, EditorCompletionSourcesSlot, NotesReferenceSlot],
});

function stubIndex(): BlockKindIndex {
  return buildBlockKindIndexFromPlugins([stubPlugin]);
}

function fence(kind: string, info: string, body: string): string {
  return ["```" + `${kind} ${info}`.trim(), body, "```"].join("\n");
}

describe("buildBlockKindIndexFromPlugins", () => {
  it("matches a registry-built index for the same plugin fills", () => {
    const registry = new Registry();
    registry.load(permissions);
    registry.load(notesStub);
    registry.load(adventures);
    registry.load(stubPlugin);
    registry.validate();
    const fromRegistry = buildBlockKindIndex(registry);
    const fromPlugins = stubIndex();
    expect([...fromPlugins.byName.keys()].sort()).toEqual([...fromRegistry.byName.keys()].sort());
    expect(fromPlugins.byName.get("stat")).toBe(statKind);
    expect(fromPlugins.byName.get("creature")).toBe(creatureKind);
  });
});

describe("validateBlockBodies", () => {
  const idx = stubIndex();

  it("returns no errors for a well-formed block", () => {
    const body = fence("stat", "Arcane Defence", "label: defense\nvalue: 4");
    expect(validateBlockBodies(body, idx)).toEqual([]);
  });

  it("flags a missing required field with its path", () => {
    const body = fence("stat", "Broken", "label: defense");
    const errs = validateBlockBodies(body, idx);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.kind).toBe("stat");
    expect(errs[0]!.blockKey).toBe("broken");
    expect(errs[0]!.stage).toBe("schema");
    expect(errs[0]!.issues.some((i) => i.path === "value")).toBe(true);
  });

  it("flags a wrong-typed field", () => {
    const body = fence("stat", "Wrong", "label: defense\nvalue: not-a-number");
    const errs = validateBlockBodies(body, idx);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.issues.some((i) => i.path === "value")).toBe(true);
  });

  it("reports malformed YAML at the yaml stage", () => {
    const body = fence("stat", "Bad YAML", "label: defense\n  value: : 4");
    const errs = validateBlockBodies(body, idx);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.stage).toBe("yaml");
  });

  it("ignores fences whose kind isn't registered (setdesign, plain code)", () => {
    const body = [
      fence("setdesign", "A Room", "**Door** -> locked"),
      "```js\nconst x = 1;\n```",
    ].join("\n\n");
    expect(validateBlockBodies(body, idx)).toEqual([]);
  });

  it("accepts wiki-links in a block sequence (shared preprocessing path)", () => {
    // `[[ … ]]` would break a raw YAML.load; it only parses because
    // validateBlockBodies runs the same prepareYaml/restoreWikiLinks
    // preprocessing the importer does.
    const body = fence(
      "creature",
      "Goblin",
      "might: 2\nweapons:\n  - [[item:curved knife]]\n  - [[item:short bow]]",
    );
    expect(validateBlockBodies(body, idx)).toEqual([]);
  });

  it("collects errors across multiple bad blocks on one page", () => {
    const body = [fence("stat", "One", "label: a"), fence("stat", "Two", "value: 3")].join("\n\n");
    const errs = validateBlockBodies(body, idx);
    expect(errs).toHaveLength(2);
    expect(errs.map((e) => e.blockKey).sort()).toEqual(["one", "two"]);
  });
});

describe("buildBundleFromDir — block validation", () => {
  async function scaffold(pageBody: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "advt-validate-"));
    await writeFile(
      join(root, "bundle.json"),
      JSON.stringify({
        bundleId: "uuid-fixture",
        name: "Validate Fixture",
        version: "1.0.0",
        author: "tests",
        summary: "block-validation fixture",
        gameSystem: "@vtt/system-torchbearer",
        requires: ["@vtt/system-torchbearer@^0"],
      }),
    );
    const noteDir = join(root, "notes", "fixture-note");
    await mkdir(noteDir, { recursive: true });
    await writeFile(join(noteDir, "index.md"), "---\ntitle: Fixture Note\n---\n");
    await writeFile(join(noteDir, "01-overview.md"), `---\ntitle: Overview\n---\n\n${pageBody}\n`);
    return root;
  }

  it("throws naming the page + kind when a block is malformed", async () => {
    const dir = await scaffold(fence("stat", "Broken", "label: defense"));
    try {
      await expect(buildBundleFromDir({ dir, kindIndex: stubIndex() })).rejects.toThrow(
        /block validation failed[\s\S]*Overview[\s\S]*stat[\s\S]*value/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("builds clean when the same bad block is present but no kindIndex is passed", async () => {
    const dir = await scaffold(fence("stat", "Broken", "label: defense"));
    try {
      const bundle = await buildBundleFromDir({ dir });
      expect(bundle.manifest.notes[0]!.pages[0]!.title).toBe("Overview");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("builds clean when all blocks are valid", async () => {
    const dir = await scaffold(fence("stat", "Good", "label: defense\nvalue: 4"));
    try {
      const bundle = await buildBundleFromDir({ dir, kindIndex: stubIndex() });
      expect(bundle.manifest.name).toBe("Validate Fixture");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
