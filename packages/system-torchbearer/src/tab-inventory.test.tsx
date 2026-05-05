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

import { afterEach, describe, it, expect } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { buildCharacterHarness, mountWithClient } from "@vtt/characters/testing";
import { items } from "@vtt/items";
import { runCatalogMerge } from "@vtt/items/shared";
import { definePlugin } from "@vtt/substrate";

afterEach(() => {
  cleanup();
});
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
} from "./shared/index.js";
import {
  TbEntryStateSystem,
  TbItemDropSystem,
  TbItemEquipSystem,
  TbItemMoveSystem,
  TbItemPickUpSystem,
  TbItemUnequipSystem,
} from "./server/index.js";
import { TbInventoryTabFill } from "./client/index.js";

const tbItemsTestPlugin = definePlugin({
  name: "@vtt/system-torchbearer-inventory-tab-test",
  version: "0",
  dependsOn: ["@vtt/items@^0", "@vtt/characters@^0"],
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

function setupHarness() {
  return buildCharacterHarness({
    asGm: true,
    plugins: [items, tbItemsTestPlugin],
    setupWorld: ({ world, registry, characterId }) => {
      world.set(characterId, TbCarries, { entries: [] });
      runCatalogMerge({
        world,
        registry,
        pluginName: "@vtt/system-torchbearer",
        templates: [
          {
            templateId: "tb/weapons/sword",
            traits: {
              ItemIdentity: { name: "Sword", description: "" },
              TbItemSlotOptions: { options: { handR: 1, handL: 1, belt: 1 } },
              TbWeapon: { wield: 1 },
            },
          },
          {
            templateId: "tb/containers/backpack",
            traits: {
              ItemIdentity: { name: "Backpack", description: "" },
              TbItemSlotOptions: { options: { torso: 2 } },
              TbContainer: { containerType: "backpack", containerSlots: 6 },
            },
          },
        ],
      });
    },
  });
}

describe("Tab body — Inventory (TbCarries)", () => {
  it("renders three sections: body slots, containers, catalog picker", () => {
    const h = setupHarness();
    mountWithClient(h, () =>
      TbInventoryTabFill.render({
        characterId: h.characterId,
      }) as import("solid-js").JSX.Element,
    );
    expect(screen.getByText(/On Your Person/i)).toBeInTheDocument();
    expect(screen.getByText(/Carried Containers/i)).toBeInTheDocument();
    expect(screen.getByText(/Add from Catalog/i)).toBeInTheDocument();
  });

  it("filtering the catalog picker narrows the list", () => {
    const h = setupHarness();
    mountWithClient(h, () =>
      TbInventoryTabFill.render({
        characterId: h.characterId,
      }) as import("solid-js").JSX.Element,
    );
    expect(screen.getAllByText("Sword").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Backpack").length).toBeGreaterThan(0);
    fireEvent.input(screen.getByPlaceholderText("filter…"), {
      target: { value: "back" },
    });
    expect(screen.queryByText("Sword")).toBeNull();
    expect(screen.getAllByText("Backpack").length).toBeGreaterThan(0);
  });

  it("the picker renders an equip button per catalog template", () => {
    const h = setupHarness();
    mountWithClient(h, () =>
      TbInventoryTabFill.render({
        characterId: h.characterId,
      }) as import("solid-js").JSX.Element,
    );
    expect(screen.getAllByTestId("tb-equip-tb/weapons/sword")).toHaveLength(1);
    expect(screen.getAllByTestId("tb-equip-tb/containers/backpack")).toHaveLength(1);
  });

  it("clicking 'equip' on a sword dispatches EquipItem with a hand or belt slot", async () => {
    const h = setupHarness();
    mountWithClient(h, () =>
      TbInventoryTabFill.render({
        characterId: h.characterId,
      }) as import("solid-js").JSX.Element,
    );
    fireEvent.click(screen.getByTestId("tb-equip-tb/weapons/sword"));
    await waitFor(() => {
      expect(h.dispatched.some((d) => d.type === EquipItem.name)).toBe(true);
    });
    const dispatched = h.dispatched.find((d) => d.type === EquipItem.name)!;
    const payload = dispatched.payload as {
      slot: string;
      slotsConsumed: number;
      itemId: string;
    };
    expect(["handR", "handL", "belt"]).toContain(payload.slot);
    expect(payload.slotsConsumed).toBe(1);
  });

  it("equipping a backpack dispatches with torso slot", async () => {
    const h = setupHarness();
    mountWithClient(h, () =>
      TbInventoryTabFill.render({
        characterId: h.characterId,
      }) as import("solid-js").JSX.Element,
    );
    fireEvent.click(screen.getByTestId("tb-equip-tb/containers/backpack"));
    await waitFor(() => {
      expect(h.dispatched.some((d) => d.type === EquipItem.name)).toBe(true);
    });
    const dispatched = h.dispatched.find((d) => d.type === EquipItem.name)!;
    const payload = dispatched.payload as { slot: string; slotsConsumed: number };
    expect(payload.slot).toBe("torso");
    expect(payload.slotsConsumed).toBe(2);
  });
});
