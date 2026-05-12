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

import { describe, it, expect } from "vitest";
import {
  definePlugin,
  defineTrait,
  Registry,
  World,
  z,
} from "@vtt/substrate";
import { permissions } from "@vtt/permissions";
import {
  BelongsToNote,
  EditorCompletionSourcesSlot,
  MarkdownPostRenderSlot,
  NotesReferenceSlot,
  Page,
  PageBodySet,
} from "@vtt/notes/shared";
import { adventures } from "./manifest.js";
import {
  BlockKindsSlot,
  defineBlockKind,
  wikiLink,
} from "./shared/index.js";
import { buildBlockReferenceSections } from "./shared/block-reference-provider.js";

// A tiny stub for the notes plugin so the adventures plugin's
// dependency declarations validate without pulling the real notes
// build (which depends on solid + client code). Matches the shape used
// in yaml-block-completion.test.ts.
const StubTrait = defineTrait({
  name: "@vtt/adventures-block-ref-test/Stub",
  schema: z.object({ x: z.string() }),
});

const notesStub = definePlugin({
  name: "@vtt/notes",
  version: "0.1.0",
  traits: [Page, BelongsToNote, StubTrait],
  events: [PageBodySet],
  slots: [
    MarkdownPostRenderSlot,
    EditorCompletionSourcesSlot,
    NotesReferenceSlot,
  ],
});

const ItemSchema = z.object({
  type: z.enum(["weapon", "armor", "supply"]).default("weapon"),
  weight: z.number().int().min(0).max(10).default(1),
  slot: z.string().optional(),
  carries: z.array(wikiLink("item")).default([]),
  description: z.string().describe("Free text shown on the chip"),
});

const itemKind = defineBlockKind({
  name: "item",
  description: "A test item kind",
  schema: ItemSchema,
  project: () => ({ traits: [] }),
  snippet: () => `\${1:name}
type: \${2|weapon,armor,supply|}
weight: \${3:1}`,
});

const stubPlugin = definePlugin({
  name: "@vtt/adventures-ref-stub",
  version: "0",
  dependsOn: ["@vtt/adventures@^0"],
  traits: [],
  fills: { [BlockKindsSlot.name]: [itemKind as never] },
});

function setup() {
  const registry = new Registry();
  registry.load(permissions);
  registry.load(notesStub);
  registry.load(adventures);
  registry.load(stubPlugin);
  registry.validate();
  return registry;
}

describe("buildBlockReferenceSections", () => {
  it("emits one section per registered block kind", () => {
    const registry = setup();
    const sections = buildBlockReferenceSections({
      world: new World(),
      registry,
    });
    expect(sections.length).toBe(1);
    expect(sections[0]!.id).toBe("block:item");
    expect(sections[0]!.title).toBe("item");
    expect(sections[0]!.group).toBe("Fenced blocks");
  });

  it("surfaces the kind description as the section summary", () => {
    const registry = setup();
    const sections = buildBlockReferenceSections({
      world: new World(),
      registry,
    });
    expect(sections[0]!.summary).toBe("A test item kind");
  });

  it("expands the kind's snippet into a fenced example", () => {
    const registry = setup();
    const sections = buildBlockReferenceSections({
      world: new World(),
      registry,
    });
    const example = sections[0]!.example;
    expect(example).toBeDefined();
    expect(example).toContain("```item example");
    // Snippet placeholders should be substituted.
    expect(example).not.toContain("${");
    expect(example).toContain("name");
    expect(example).toContain("type: weapon");
  });

  it("includes the schema-derived field table", () => {
    const registry = setup();
    const sections = buildBlockReferenceSections({
      world: new World(),
      registry,
    });
    const fields = sections[0]!.fields ?? [];
    const byPath = Object.fromEntries(fields.map((f) => [f.path, f]));
    expect(byPath.type!.type).toBe("enum: weapon | armor | supply");
    expect(byPath.type!.default).toBe('"weapon"');
    expect(byPath.weight!.type).toBe("integer (0–10)");
    expect(byPath.slot!.required).toBe(false);
    expect(byPath.carries!.type).toBe("array<wikilink:item>");
    expect(byPath.description!.description).toBe(
      "Free text shown on the chip",
    );
  });

  it("returns an empty list when no kinds are registered", () => {
    const registry = new Registry();
    const sections = buildBlockReferenceSections({
      world: new World(),
      registry,
    });
    expect(sections).toEqual([]);
  });
});
