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

import { describe, expect, it } from "vitest";
import { definePlugin, Registry, World } from "@vtt/substrate";
import { items } from "@vtt/items";
import { ItemIdentity } from "@vtt/items/shared";
import {
  TbCarries,
  TbItemSlotOptions,
  TbWeapon,
  TbArmor,
  TbSupply,
  TbContainer,
  TbSkillBonuses,
  TbItemSpecialRules,
  ItemPosition,
  EquipItem,
  MoveItem,
  SetEntryState,
  DropItem,
  PickUpItem,
  UnequipItem,
  ItemEquipped,
  ItemMoved,
  EntryStateChanged,
  ItemDropped,
  ItemPickedUp,
  ItemUnequipped,
  suggestedItemModifiersFor,
} from "./shared/index.js";
import {
  TbEntryStateSystem,
  TbItemDropSystem,
  TbItemEquipSystem,
  TbItemMoveSystem,
  TbItemPickUpSystem,
  TbItemUnequipSystem,
} from "./server/index.js";

const tbItemsTestPlugin = definePlugin({
  name: "@vtt/system-torchbearer-modifiers-test",
  version: "0",
  dependsOn: ["@vtt/items@^0"],
  traits: [
    TbItemSlotOptions,
    TbWeapon,
    TbArmor,
    TbSupply,
    TbContainer,
    TbSkillBonuses,
    TbItemSpecialRules,
    TbCarries,
    ItemPosition,
  ],
  events: [
    ItemEquipped,
    ItemMoved,
    EntryStateChanged,
    ItemDropped,
    ItemPickedUp,
    ItemUnequipped,
  ],
  commands: [
    EquipItem,
    MoveItem,
    SetEntryState,
    DropItem,
    PickUpItem,
    UnequipItem,
  ],
  systems: [
    TbItemEquipSystem,
    TbItemMoveSystem,
    TbEntryStateSystem,
    TbItemDropSystem,
    TbItemPickUpSystem,
    TbItemUnequipSystem,
  ],
  gameSystem: true,
});

interface S {
  registry: Registry;
  world: World;
  characterId: string;
  swordId: string;
  glovesId: string;
  damagedAxeId: string;
}

function setup(): S {
  const registry = new Registry();
  registry.load(items);
  registry.load(tbItemsTestPlugin);
  registry.validate();
  const world = new World();
  const swordId = world.spawn([
    ItemIdentity({ name: "Sword" }),
    TbItemSlotOptions({ options: { handR: 1 } }),
    TbWeapon({
      wield: 1,
      conflictBonuses: {
        attack: { type: "dice", value: 1 },
        defend: { type: "dice", value: 0 },
        feint: { type: "dice", value: 0 },
        maneuver: { type: "dice", value: 0 },
      },
    }),
  ]);
  const glovesId = world.spawn([
    ItemIdentity({ name: "Burglar's Gloves" }),
    TbItemSlotOptions({ options: { wornHand: 1 } }),
    TbSkillBonuses({
      entries: [
        { skill: "Criminal", value: 1, condition: "sleight of hand, locks" },
      ],
    }),
  ]);
  const damagedAxeId = world.spawn([
    ItemIdentity({ name: "Hand Axe" }),
    TbItemSlotOptions({ options: { handR: 1 } }),
    TbWeapon({
      wield: 1,
      conflictBonuses: {
        attack: { type: "dice", value: 1 },
        defend: { type: "dice", value: 0 },
        feint: { type: "dice", value: 0 },
        maneuver: { type: "dice", value: 0 },
      },
    }),
  ]);
  const characterId = world.spawn([
    TbCarries({
      entries: [
        {
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: swordId,
          quantity: 1,
        },
        {
          slot: "wornHand",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
          itemId: glovesId,
          quantity: 1,
        },
        {
          slot: "handL",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: damagedAxeId,
          quantity: 1,
          state: { damaged: true },
        },
      ],
    }),
  ]);
  return { registry, world, characterId, swordId, glovesId, damagedAxeId };
}

describe("suggestedItemModifiersFor", () => {
  it("emits no item modifiers for a non-skill roll", () => {
    const s = setup();
    const out = suggestedItemModifiersFor({
      world: s.world,
      characterId: s.characterId,
      kind: "ability",
      sourceId: "will",
    });
    expect(out).toHaveLength(0);
  });

  it("offers a sword's attack bonus on a Fighter skill roll", () => {
    const s = setup();
    const out = suggestedItemModifiersFor({
      world: s.world,
      characterId: s.characterId,
      kind: "skill",
      sourceId: "fighter",
    });
    const swordSuggestion = out.find((m) =>
      m.id.startsWith("item:weapon:") && m.id.includes(s.swordId),
    );
    expect(swordSuggestion).toBeDefined();
    expect(swordSuggestion!.modifier.value).toBe(1);
    expect(swordSuggestion!.modifier.kind).toBe("dice");
    expect(swordSuggestion!.modifier.source).toBe("gear");
  });

  it("skips a damaged weapon's bonus", () => {
    const s = setup();
    const out = suggestedItemModifiersFor({
      world: s.world,
      characterId: s.characterId,
      kind: "skill",
      sourceId: "fighter",
    });
    const axeSuggestion = out.find((m) => m.id.includes(s.damagedAxeId));
    expect(axeSuggestion).toBeUndefined();
  });

  it("offers a skill-bonus item's modifier on a matching skill", () => {
    const s = setup();
    const out = suggestedItemModifiersFor({
      world: s.world,
      characterId: s.characterId,
      kind: "skill",
      sourceId: "Criminal",
    });
    const glovesSuggestion = out.find((m) => m.id.includes(s.glovesId));
    expect(glovesSuggestion).toBeDefined();
    expect(glovesSuggestion!.modifier.value).toBe(1);
    expect(glovesSuggestion!.note).toContain("sleight of hand");
  });

  it("does not offer a skill-bonus item's modifier on an unrelated skill", () => {
    const s = setup();
    const out = suggestedItemModifiersFor({
      world: s.world,
      characterId: s.characterId,
      kind: "skill",
      sourceId: "scholar",
    });
    const glovesSuggestion = out.find((m) => m.id.includes(s.glovesId));
    expect(glovesSuggestion).toBeUndefined();
  });

  it("returns an empty list for a character with no TbCarries", () => {
    const s = setup();
    const ghostId = s.world.spawn([]);
    const out = suggestedItemModifiersFor({
      world: s.world,
      characterId: ghostId,
      kind: "skill",
      sourceId: "fighter",
    });
    expect(out).toEqual([]);
  });

  it("respects the `dropped` state flag (mid-combat drop, item still on character)", () => {
    const s = setup();
    // Mark the sword entry as dropped.
    const carries = s.world.get(s.characterId, [TbCarries]) as {
      TbCarries: { entries: Array<Record<string, unknown>> };
    };
    const updated = carries.TbCarries.entries.map((e) =>
      e.itemId === s.swordId ? { ...e, state: { dropped: true } } : e,
    );
    s.world.set(s.characterId, TbCarries, { entries: updated });
    const out = suggestedItemModifiersFor({
      world: s.world,
      characterId: s.characterId,
      kind: "skill",
      sourceId: "fighter",
    });
    expect(out.find((m) => m.id.includes(s.swordId))).toBeUndefined();
  });
});
