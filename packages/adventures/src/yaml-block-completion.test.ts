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
import { definePlugin, defineTrait, Registry, World, z } from "@vtt/substrate";
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
import { BlockKindsSlot, defineBlockKind, wikiLink } from "./shared/index.js";
import { buildBlockYamlCompletionSource } from "./client/yaml-block-completion.js";

const Stat = defineTrait({
  name: "@vtt/adventures-yaml-test/Stat",
  schema: z.object({ label: z.string() }),
});

const StatSchema = z.object({
  type: z.enum(["weapon", "armor", "supply"]),
  level: z.number().int().min(1).max(10).optional(),
  carries: z.array(wikiLink("item")),
});

const statKind = defineBlockKind({
  name: "stat",
  description: "A test stat block",
  schema: StatSchema,
  project: () => ({ traits: [] }),
});

const stubKindPlugin = definePlugin({
  name: "@vtt/adventures-yaml-test-stub",
  version: "0",
  dependsOn: ["@vtt/adventures@^0"],
  traits: [Stat],
  fills: { [BlockKindsSlot.name]: [statKind as never] },
});

const notesStub = definePlugin({
  name: "@vtt/notes",
  version: "0.1.0",
  traits: [Page, BelongsToNote],
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
  return { registry, world: new World() };
}

function makeCmCtx(doc: string, pos: number, explicit = true) {
  return {
    pos,
    explicit,
    state: {
      doc: {
        toString: () => doc,
        lineAt: (p: number) => {
          // Cheap line lookup for tests.
          const before = doc.slice(0, p);
          const lineStart = before.lastIndexOf("\n") + 1;
          const lineEnd = doc.indexOf("\n", p);
          return {
            from: lineStart,
            to: lineEnd === -1 ? doc.length : lineEnd,
            text: doc.slice(lineStart, lineEnd === -1 ? doc.length : lineEnd),
            number: before.split("\n").length,
          };
        },
        length: doc.length,
      },
    },
    matchBefore: (re: RegExp) => {
      const before = doc.slice(0, pos);
      const m = before.match(new RegExp(re.source + "$"));
      return m ? { from: pos - m[0].length, to: pos, text: m[0] } : null;
    },
  };
}

describe("buildBlockYamlCompletionSource", () => {
  const { registry, world } = setup();
  const source = buildBlockYamlCompletionSource({ registry, world, worldId: "w" });

  it("returns null when cursor is outside any fenced block", () => {
    const doc = "regular markdown\nno fence\n";
    const r = source(makeCmCtx(doc, doc.length));
    expect(r).toBeNull();
  });

  it("returns null when cursor is inside a fence whose kind isn't registered", () => {
    const doc = "```typescript\nconst x = 1;\n";
    const r = source(makeCmCtx(doc, doc.length));
    expect(r).toBeNull();
  });

  it("suggests keys at the start of an empty line inside a registered fence", () => {
    const doc = "```stat thing\n";
    const r = source(makeCmCtx(doc, doc.length));
    expect(r).not.toBeNull();
    const labels = r!.options.map((o) => o.label).sort();
    expect(labels).toContain("type");
    expect(labels).toContain("level");
    expect(labels).toContain("carries");
  });

  it("filters keys by typed prefix", () => {
    const doc = "```stat thing\nt";
    const r = source(makeCmCtx(doc, doc.length));
    expect(r).not.toBeNull();
    expect(r!.options.map((o) => o.label)).toEqual(["type"]);
  });

  it("suggests enum values after `type: `", () => {
    const doc = "```stat thing\ntype: ";
    const r = source(makeCmCtx(doc, doc.length));
    expect(r).not.toBeNull();
    const labels = r!.options.map((o) => o.label).sort();
    expect(labels).toEqual(["armor", "supply", "weapon"]);
  });

  it("filters enum values by typed prefix", () => {
    const doc = "```stat thing\ntype: w";
    const r = source(makeCmCtx(doc, doc.length));
    expect(r).not.toBeNull();
    expect(r!.options.map((o) => o.label)).toEqual(["weapon"]);
  });

  it("doesn't compete with [[…]] wiki-link autocomplete inside YAML", () => {
    const doc = "```stat thing\ndescription: see [[character:Skarra";
    const r = source(makeCmCtx(doc, doc.length));
    expect(r).toBeNull();
  });

  it("apply for key slot includes ': ' suffix", () => {
    const doc = "```stat thing\n";
    const r = source(makeCmCtx(doc, doc.length));
    const opt = r!.options.find((o) => o.label === "type");
    expect(opt!.apply).toBe("type: ");
  });

  it("suggests registered kinds when the cursor is on an empty opening fence line", () => {
    const doc = "```";
    const r = source(makeCmCtx(doc, doc.length));
    expect(r).not.toBeNull();
    const labels = r!.options.map((o) => o.label).sort();
    expect(labels).toContain("stat");
  });

  it("filters fence-kind suggestions by typed prefix", () => {
    const doc = "```st";
    const r = source(makeCmCtx(doc, doc.length));
    expect(r).not.toBeNull();
    const labels = r!.options.map((o) => o.label);
    expect(labels).toEqual(["stat"]);
    // The applied text is the kind name + trailing space, ready for
    // the author to type the info-string name.
    expect(r!.options[0]!.apply).toBe("stat ");
  });

  it("does NOT suggest kinds when the cursor is inside a fence body line that happens to start with ```", () => {
    // First fence opens then we're past it.
    const doc = "```stat thing\nnotes: ```";
    const r = source(makeCmCtx(doc, doc.length));
    // Inside the body, the `\`\`\`` mid-line isn't an opening fence —
    // and our key/value source returns null in this odd state. The
    // important thing is we don't pop fence-kind suggestions.
    if (r) {
      const fenceLabels = r.options.map((o) => o.label);
      expect(fenceLabels).not.toContain("stat");
    }
  });
});
