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
import { definePlugin, EntityId, Registry, World } from "@vtt/substrate";
import { items } from "@vtt/items";
import { permissions } from "@vtt/permissions";
import { adventures } from "@vtt/adventures";
import { BlockKindsSlot, BLOCK_ENTITY_INDEX_ID, BlockEntityIndex } from "@vtt/adventures/shared";
import { runBlockParse, blockEntityId } from "@vtt/adventures/server";
import { buildBlockKindIndex } from "@vtt/adventures/shared";
import {
  Page,
  BelongsToNote,
  PageBodySet,
  MarkdownPostRenderSlot,
  EditorCompletionSourcesSlot,
  NotesReferenceSlot,
} from "@vtt/notes/shared";
import { ItemDerivedFrom, ItemEconomics, ItemIdentity } from "@vtt/items/shared";
import {
  TbArmor,
  TbContainer,
  TbItemSlotOptions,
  TbSupply,
  TbWeapon,
  TbItemSpecialRules,
  TbSkillBonuses,
} from "./shared/index.js";
import { itemBlockKind } from "./shared/blocks/item.js";

// Matches the @vtt/notes-stub-for-adv-test pattern: stand in for the
// real notes plugin without dragging in shell-workbench fills.
const notesStub = definePlugin({
  name: "@vtt/notes",
  version: "0.1.0",
  traits: [Page, BelongsToNote],
  events: [PageBodySet],
  slots: [MarkdownPostRenderSlot, EditorCompletionSourcesSlot, NotesReferenceSlot],
});

const tbBlocksStub = definePlugin({
  name: "@vtt/system-torchbearer-blocks-test",
  version: "0",
  dependsOn: ["@vtt/items@^0", "@vtt/adventures@^0"],
  traits: [
    TbItemSlotOptions,
    TbWeapon,
    TbArmor,
    TbSupply,
    TbContainer,
    TbItemSpecialRules,
    TbSkillBonuses,
  ],
  fills: {
    [BlockKindsSlot.name]: [itemBlockKind as never],
  },
});

function setup() {
  const registry = new Registry();
  registry.load(permissions);
  registry.load(notesStub);
  registry.load(items);
  registry.load(adventures);
  registry.load(tbBlocksStub);
  registry.validate();
  const world = new World();
  return { registry, world };
}

describe("TB item block kind", () => {
  let registry: Registry;
  let world: World;
  let pageId: EntityId;
  let noteId: EntityId;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
    noteId = world.spawn([]);
    pageId = world.spawn([Page({ title: "p", body: "", bodyRev: 0 }), BelongsToNote({ noteId })]);
  });

  function parseBody(body: string) {
    const idx = buildBlockKindIndex(registry);
    return runBlockParse(world, pageId, body, idx);
  }

  it("a weapon block projects to ItemIdentity + TbItemSlotOptions + TbWeapon", () => {
    const body = [
      "```item Longsword",
      "type: weapon",
      "slot: handR",
      "weight: 1",
      "weapon:",
      "  wield: 1",
      "  attack: 1",
      "  defend: 1",
      "  feint: 1",
      "  maneuver: 0",
      "description: A standard double-edged blade.",
      "```",
    ].join("\n");
    parseBody(body);
    const eid = blockEntityId(pageId, "longsword");
    expect(world.has(eid)).toBe(true);
    const traits = world.get(eid, [ItemIdentity, TbItemSlotOptions, TbWeapon, ItemDerivedFrom]) as
      | {
          ItemIdentity: { name: string; description: string };
          TbItemSlotOptions: { options: Record<string, number> };
          TbWeapon: {
            wield: number;
            conflictBonuses: Record<string, { type: string; value: number }>;
          };
          ItemDerivedFrom: { templateId: string; pluginName: string };
        }
      | undefined;
    expect(traits).toBeDefined();
    expect(traits!.ItemIdentity.name).toBe("Longsword");
    expect(traits!.ItemIdentity.description).toBe("A standard double-edged blade.");
    expect(traits!.TbItemSlotOptions.options).toEqual({ handR: 1 });
    expect(traits!.TbWeapon.wield).toBe(1);
    expect(traits!.TbWeapon.conflictBonuses.attack).toEqual({ type: "dice", value: 1 });
    expect(traits!.TbWeapon.conflictBonuses.maneuver).toEqual({ type: "dice", value: 0 });
    expect(traits!.ItemDerivedFrom.pluginName).toBe("@vtt/adventures");
  });

  it("an armor block projects to ItemIdentity + TbArmor", () => {
    const body = [
      "```item Chain Mail",
      "type: armor",
      "slots:",
      "  torso: 2",
      "armor:",
      "  armorType: chain",
      "  absorbs: 2",
      "```",
    ].join("\n");
    parseBody(body);
    const eid = blockEntityId(pageId, "chain-mail");
    const traits = world.get(eid, [TbArmor, TbItemSlotOptions]) as
      | {
          TbArmor: { armorType: string; absorbs: number };
          TbItemSlotOptions: { options: Record<string, number> };
        }
      | undefined;
    expect(traits).toBeDefined();
    expect(traits!.TbArmor.armorType).toBe("chain");
    expect(traits!.TbArmor.absorbs).toBe(2);
    expect(traits!.TbItemSlotOptions.options).toEqual({ torso: 2 });
  });

  it("a supply block projects to TbSupply", () => {
    const body = [
      "```item Torch",
      "type: supply",
      "slot: pocket",
      "supply:",
      "  supplyType: light",
      "  turnsRemaining: 3",
      "  lit: false",
      "  nameSingular: torch",
      "```",
    ].join("\n");
    parseBody(body);
    const eid = blockEntityId(pageId, "torch");
    const got = world.get(eid, [TbSupply]) as
      | { TbSupply: { supplyType: string; turnsRemaining: number; lit: boolean } }
      | undefined;
    expect(got).toBeDefined();
    expect(got!.TbSupply.supplyType).toBe("light");
    expect(got!.TbSupply.turnsRemaining).toBe(3);
  });

  it("a container block projects to TbContainer", () => {
    const body = [
      "```item Backpack",
      "type: container",
      "slot: torso",
      "container:",
      "  containerType: backpack",
      "  containerSlots: 6",
      "```",
    ].join("\n");
    parseBody(body);
    const eid = blockEntityId(pageId, "backpack");
    const got = world.get(eid, [TbContainer]) as
      | { TbContainer: { containerType: string; containerSlots: number } }
      | undefined;
    expect(got).toBeDefined();
    expect(got!.TbContainer.containerSlots).toBe(6);
  });

  it("editing the block updates the item entity in place (no new entity)", () => {
    parseBody(
      ["```item Longsword", "type: weapon", "slot: handR", "description: original", "```"].join(
        "\n",
      ),
    );
    const eid = blockEntityId(pageId, "longsword");
    const before = (world.get(eid, [ItemIdentity]) as { ItemIdentity: { description: string } })
      .ItemIdentity.description;
    expect(before).toBe("original");

    parseBody(
      ["```item Longsword", "type: weapon", "slot: handR", "description: revised", "```"].join(
        "\n",
      ),
    );
    expect(world.has(eid)).toBe(true);
    const after = (world.get(eid, [ItemIdentity]) as { ItemIdentity: { description: string } })
      .ItemIdentity.description;
    expect(after).toBe("revised");
    // Same id (no new entity).
    const idx = world.get(BLOCK_ENTITY_INDEX_ID, [BlockEntityIndex]) as
      | { BlockEntityIndex: { entries: Record<string, { entityId: EntityId }> } }
      | undefined;
    expect(idx!.BlockEntityIndex.entries[`${pageId}::longsword`]!.entityId).toBe(eid);
  });

  it("the weapon block's slots map form takes precedence over slot+weight", () => {
    const body = [
      "```item Mace",
      "type: weapon",
      "slots:",
      "  handR: 1",
      "  handL: 1",
      "weapon:",
      "  attack: 1",
      "```",
    ].join("\n");
    parseBody(body);
    const eid = blockEntityId(pageId, "mace");
    const got = world.get(eid, [TbItemSlotOptions]) as
      | { TbItemSlotOptions: { options: Record<string, number> } }
      | undefined;
    expect(got!.TbItemSlotOptions.options).toEqual({ handR: 1, handL: 1 });
  });

  it("ItemDerivedFrom marks block-authored items distinct from system-seeded ones", () => {
    parseBody(["```item Knife", "type: weapon", "slot: handR", "```"].join("\n"));
    const eid = blockEntityId(pageId, "knife");
    const got = world.get(eid, [ItemDerivedFrom]) as
      | { ItemDerivedFrom: { pluginName: string; templateId: string } }
      | undefined;
    expect(got).toBeDefined();
    expect(got!.ItemDerivedFrom.pluginName).toBe("@vtt/adventures");
    expect(got!.ItemDerivedFrom.templateId).toBe("block:Knife");
  });

  it("ItemEconomics records cost when present", () => {
    parseBody(["```item Apple", "type: gear", "slot: pocket", "cost: 3", "```"].join("\n"));
    const eid = blockEntityId(pageId, "apple");
    const got = world.get(eid, [ItemEconomics]) as { ItemEconomics: { cost?: number } } | undefined;
    expect(got!.ItemEconomics.cost).toBe(3);
  });

  it("specialRules text projects to TbItemSpecialRules", () => {
    parseBody(
      [
        "```item Holy Water",
        "type: supply",
        "slot: pocket",
        "supply:",
        "  supplyType: sacramental",
        "specialRules: |",
        "  Splash on undead — kill 1d6.",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "holy-water");
    const got = world.get(eid, [TbItemSpecialRules]) as
      | { TbItemSpecialRules: { text: string } }
      | undefined;
    expect(got!.TbItemSpecialRules.text).toContain("Splash on undead");
  });
});
