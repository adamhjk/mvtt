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
import { definePlugin, Registry, World, z } from "@vtt/substrate";
import { adventures } from "@vtt/adventures";
import { BlockKindsSlot, buildBlockKindIndex } from "@vtt/adventures/shared";
import { permissions } from "@vtt/permissions";
import { Character, Team } from "@vtt/characters/shared";
import {
  BelongsToNote,
  EditorCompletionSourcesSlot,
  MarkdownPostRenderSlot,
  NotesReferenceSlot,
  Page,
  PageBodySet,
} from "@vtt/notes/shared";
import { buildBlockYamlCompletionSource } from "@vtt/adventures/client";
import {
  CharacterTraits,
  Conditions,
  Heroic,
  Identity,
  MonsterTemplate,
  Pools,
  RawAbilities,
  Skills,
  TbMonster,
  TownAbilities,
  WhatYouFightFor,
  Wises,
} from "./shared/index.js";
import { TbCarries, TbItemSlotOptions } from "./shared/items/index.js";
import { TbNpc } from "./shared/npc-traits.js";
import { characterBlockKind, monsterBlockKind } from "./shared/blocks/character.js";
import { npcBlockKind } from "./shared/blocks/npc.js";

const notesStub = definePlugin({
  name: "@vtt/notes",
  version: "0.1.0",
  traits: [Page, BelongsToNote],
  events: [PageBodySet],
  slots: [MarkdownPostRenderSlot, EditorCompletionSourcesSlot, NotesReferenceSlot],
});

const charactersStub = definePlugin({
  name: "@vtt/characters",
  version: "0.1.0",
  traits: [Character, Team],
});

const itemsStub = definePlugin({
  name: "@vtt/items",
  version: "0.1.0",
  traits: [],
});

const tbBlocksStub = definePlugin({
  name: "@vtt/system-torchbearer-blocks-test",
  version: "0",
  dependsOn: ["@vtt/adventures@^0", "@vtt/characters@^0"],
  traits: [
    Identity,
    RawAbilities,
    TownAbilities,
    Conditions,
    Heroic,
    Pools,
    WhatYouFightFor,
    Skills,
    Wises,
    CharacterTraits,
    TbMonster,
    MonsterTemplate,
    TbCarries,
    TbItemSlotOptions,
    TbNpc,
  ],
  fills: {
    [BlockKindsSlot.name]: [
      characterBlockKind as never,
      monsterBlockKind as never,
      npcBlockKind as never,
    ],
  },
});

function setup() {
  const registry = new Registry();
  registry.load(permissions);
  registry.load(charactersStub);
  registry.load(itemsStub);
  registry.load(notesStub);
  registry.load(adventures);
  registry.load(tbBlocksStub);
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

void z;

describe("npc block YAML autocomplete", () => {
  const { registry, world } = setup();

  it("buildBlockKindIndex finds npc kind", () => {
    const idx = buildBlockKindIndex(registry);
    expect(idx.byName.has("npc")).toBe(true);
    const npc = idx.byName.get("npc");
    expect(npc?.name).toBe("npc");
    expect(npc?.schema).toBeDefined();
  });

  it("suggests keys at the start of an empty line inside an `npc` fence", () => {
    const source = buildBlockYamlCompletionSource({
      registry,
      world,
      worldId: "w",
    });
    const doc = "```npc Skarra Wormtongue\n";
    const r = source(makeCmCtx(doc, doc.length));
    expect(r).not.toBeNull();
    const labels = r!.options.map((o) => o.label).sort();
    expect(labels).toContain("role");
    expect(labels).toContain("stock");
    expect(labels).toContain("class");
    expect(labels).toContain("notes");
  });

  it("filters npc keys by typed prefix", () => {
    const source = buildBlockYamlCompletionSource({
      registry,
      world,
      worldId: "w",
    });
    const doc = "```npc Skarra\nr";
    const r = source(makeCmCtx(doc, doc.length));
    expect(r).not.toBeNull();
    const labels = r!.options.map((o) => o.label);
    expect(labels).toContain("role");
    // Should NOT include keys that don't start with "r".
    expect(labels).not.toContain("stock");
  });

  it("suggests team enum values after `team: `", () => {
    const source = buildBlockYamlCompletionSource({
      registry,
      world,
      worldId: "w",
    });
    const doc = "```npc Skarra\nteam: ";
    const r = source(makeCmCtx(doc, doc.length));
    expect(r).not.toBeNull();
    const labels = r!.options.map((o) => o.label).sort();
    expect(labels).toEqual(["enemy", "neutral", "party"]);
  });
});
