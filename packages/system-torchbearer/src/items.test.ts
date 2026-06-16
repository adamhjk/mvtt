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

import { beforeEach, describe, expect, it } from "vitest";
import { CommandPipeline, definePlugin, EventBus, Registry, World } from "@vtt/substrate";
import { items } from "@vtt/items";
import { ItemIdentity, runCatalogMerge } from "@vtt/items/shared";
import {
  DropItem,
  EntryStateChanged,
  EquipItem,
  ItemDropped,
  ItemEquipped,
  ItemMoved,
  ItemPickedUp,
  ItemPosition,
  ItemUnequipped,
  MoveItem,
  PickUpItem,
  SetEntryState,
  TbArmor,
  TbCarries,
  TbContainer,
  TbItemSlotOptions,
  TbItemSpecialRules,
  TbSkillBonuses,
  TbSupply,
  TbWeapon,
  UnequipItem,
  summarizeCapacity,
} from "./shared/index.js";
import {
  TbEntryStateSystem,
  TbItemDropSystem,
  TbItemEquipSystem,
  TbItemMoveSystem,
  TbItemPickUpSystem,
  TbItemUnequipSystem,
} from "./server/index.js";

// A minimal plugin that registers ONLY the TB items pieces — used to
// test items in isolation without dragging in the rest of the TB
// manifest's fills (which depend on @vtt/characters etc.).
const tbItemsTestPlugin = definePlugin({
  name: "@vtt/system-torchbearer-items-test",
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
  events: [ItemEquipped, ItemMoved, EntryStateChanged, ItemDropped, ItemPickedUp, ItemUnequipped],
  commands: [EquipItem, MoveItem, SetEntryState, DropItem, PickUpItem, UnequipItem],
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

interface TestSetup {
  registry: Registry;
  world: World;
  pipeline: CommandPipeline;
  characterId: string;
  swordId: string;
  backpackId: string;
  shieldId: string;
}

function makeSetup(): TestSetup {
  const registry = new Registry();
  registry.load(items);
  registry.load(tbItemsTestPlugin);
  registry.validate();
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);

  const characterId = world.spawn([TbCarries({ entries: [] })]);

  // Catalog: a one-handed sword (carried/belt), a backpack
  // (torso 2, container 6), a shield (carried/torso).
  runCatalogMerge({
    world,
    registry,
    pluginName: "@vtt/system-torchbearer",
    templates: [
      {
        templateId: "tb/sword",
        traits: {
          ItemIdentity: { name: "Sword", description: "" },
          TbItemSlotOptions: { options: { carried: 1, belt: 1 } },
          TbWeapon: { wield: 1 },
        },
      },
      {
        templateId: "tb/backpack",
        traits: {
          ItemIdentity: { name: "Backpack", description: "" },
          TbItemSlotOptions: { options: { torso: 2 } },
          TbContainer: { containerType: "backpack", containerSlots: 6 },
        },
      },
      {
        templateId: "tb/shield",
        traits: {
          ItemIdentity: { name: "Shield", description: "" },
          TbItemSlotOptions: { options: { carried: 1, torso: 1 } },
          TbWeapon: { wield: 1 },
        },
      },
    ],
  });

  const swordId = findByTemplate(world, "tb/sword");
  const backpackId = findByTemplate(world, "tb/backpack");
  const shieldId = findByTemplate(world, "tb/shield");

  return { registry, world, pipeline, characterId, swordId, backpackId, shieldId };
}

function findByTemplate(world: World, templateId: string): string {
  for (const row of world.query([TbItemSlotOptions])) {
    // Look up by ItemDerivedFrom on the same entity:
    const got = world.get(row.id, [
      // import-light: avoid cycles by reaching through the items shared barrel.
      // We can use traitsOn for a cleaner check:
    ]);
    void got;
    const traits = world.traitsOn(row.id);
    for (const [name, value] of traits) {
      if (name === "@vtt/items/ItemDerivedFrom") {
        const v = value as { templateId: string };
        if (v.templateId === templateId) return row.id;
      }
    }
  }
  throw new Error(`no entity for ${templateId}`);
}

describe("@vtt/system-torchbearer items", () => {
  let setup: TestSetup;
  beforeEach(() => {
    setup = makeSetup();
  });

  describe("EquipItem — placement validation", () => {
    it("equips a sword in the right hand (carried channel)", async () => {
      const res = await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.swordId,
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
        }),
      });
      expect(res.result.ok).toBe(true);
      const got = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ slot: string; itemId: string }> };
      };
      expect(got.TbCarries.entries).toHaveLength(1);
      expect(got.TbCarries.entries[0]!.slot).toBe("handR");
      expect(got.TbCarries.entries[0]!.itemId).toBe(setup.swordId);
    });

    it("rejects equipping a sword in a slot not in slotOptions", async () => {
      const res = await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.swordId,
          slot: "head",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
        }),
      });
      expect(res.result.ok).toBe(false);
    });

    it("rejects equipping a backpack with the wrong slotsConsumed", async () => {
      // Catalog says torso 2, but trying torso 1.
      const res = await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.backpackId,
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
        }),
      });
      expect(res.result.ok).toBe(false);
    });

    it("accepts overfill (validator no longer caps capacity) and reports it via summarizeCapacity", async () => {
      // Equip the backpack (2 torso slots), then a shield on torso (1
      // slot, total = 3 = capacity). A second torso-1 item lands
      // anyway — overfill is a soft constraint surfaced through the
      // capacity summary so the UI can flag the slot red while the
      // player shuffles things around.
      await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.backpackId,
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
        }),
      });
      await setup.pipeline.dispatch({
        id: "e2",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.shieldId,
          slot: "torso",
          slotIndex: 1,
          channel: "default",
          slotsConsumed: 1,
        }),
      });
      const filler = setup.world.spawn([TbItemSlotOptions({ options: { torso: 1 } })]);
      const res = await setup.pipeline.dispatch({
        id: "e3",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: filler,
          slot: "torso",
          slotIndex: 2,
          channel: "default",
          slotsConsumed: 1,
        }),
      });
      expect(res.result.ok).toBe(true);
      const cap = summarizeCapacity({
        world: setup.world,
        holderId: setup.characterId,
        slot: "torso",
        channel: "default",
      });
      expect(cap.used).toBe(4);
      expect(cap.limit).toBe(3);
      expect(cap.wouldOverfill(0)).toBe(true);
    });
  });

  describe("EquipItem — auto-fork on catalog container", () => {
    it("equipping a catalog backpack forks to a fresh entity", async () => {
      const beforeIds = new Set(setup.world.query([TbContainer]).map((r) => r.id));
      const res = await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.backpackId,
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
        }),
      });
      expect(res.result.ok).toBe(true);
      const afterIds = new Set(setup.world.query([TbContainer]).map((r) => r.id));
      expect(afterIds.size).toBe(beforeIds.size + 1);
      const carries = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      const entryId = carries.TbCarries.entries[0]!.itemId;
      expect(entryId).not.toBe(setup.backpackId);
      // The catalog backpack still exists with its TbContainer.
      expect(setup.world.has(setup.backpackId)).toBe(true);
    });

    it("equipping a catalog non-container does NOT fork", async () => {
      const res = await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.swordId,
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
        }),
      });
      expect(res.result.ok).toBe(true);
      const carries = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      expect(carries.TbCarries.entries[0]!.itemId).toBe(setup.swordId);
    });

    it("equipping a catalog bundle (e.g. torches) auto-forks so split is per-character", async () => {
      // Seed a fresh template with ItemBundle and pull its id.
      runCatalogMerge({
        world: setup.world,
        registry: setup.registry,
        pluginName: "@vtt/system-torchbearer",
        templates: [
          {
            templateId: "tb/torch",
            traits: {
              ItemIdentity: { name: "Torch", description: "" },
              TbItemSlotOptions: { options: { carried: 1, pack: 1 } },
              ItemBundle: { count: 4, capacity: 4 },
            },
          },
        ],
      });
      const torchId = findByTemplate(setup.world, "tb/torch");
      const res = await setup.pipeline.dispatch({
        id: "et",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: torchId,
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
        }),
      });
      expect(res.result.ok).toBe(true);
      const carries = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      const equippedId = carries.TbCarries.entries.at(-1)!.itemId;
      expect(equippedId).not.toBe(torchId);
      // Catalog template still exists at its original count.
      expect(setup.world.has(torchId)).toBe(true);
    });
  });

  describe("SetEntryState — light gating", () => {
    it("rejects lighting an entry that lives inside a container", async () => {
      // Equip a torch directly into the backpack's container slot.
      const torchTemplate = setup.world.spawn([
        ItemIdentity({ name: "Torch" }),
        TbItemSlotOptions({ options: { pack: 1 } }),
        TbSupply({
          supplyType: "light",
          turnsRemaining: 2,
          lit: false,
          nameSingular: "Torch",
        }),
      ]);
      // Equip backpack first (auto-fork on catalog container).
      await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.backpackId,
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
        }),
      });
      const carries = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      const backpackInstanceId = carries.TbCarries.entries[0]!.itemId;
      // Stow torch inside the backpack: equip with the container slot.
      await setup.pipeline.dispatch({
        id: "e2",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: backpackInstanceId as never,
          itemId: torchTemplate,
          slot: `container:${backpackInstanceId}` as never,
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
        }),
      });
      // Try to light it.
      const res = await setup.pipeline.dispatch({
        id: "s1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: SetEntryState({
          holderId: backpackInstanceId as never,
          entryIndex: 0,
          state: { lit: true, turnsRemaining: 2 },
        }),
      });
      expect(res.result.ok).toBe(false);
    });

    it("auto-douses a lit torch when moved into a container", async () => {
      // Create a torch + backpack, equip both on the character, light
      // the torch, then move it into the backpack. The move must
      // succeed AND the entry must come out doused.
      const torchId = setup.world.spawn([
        ItemIdentity({ name: "Torch" }),
        TbItemSlotOptions({ options: { carried: 1, pack: 1 } }),
        TbSupply({
          supplyType: "light",
          turnsRemaining: 2,
          lit: false,
          nameSingular: "Torch",
        }),
      ]);
      // Equip backpack into torso (auto-fork).
      await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.backpackId,
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
        }),
      });
      const carries0 = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      const backpackInstanceId = carries0.TbCarries.entries[0]!.itemId;
      // Equip torch into the right hand (carried).
      await setup.pipeline.dispatch({
        id: "e2",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: torchId,
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
        }),
      });
      // Light it.
      await setup.pipeline.dispatch({
        id: "s1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: SetEntryState({
          holderId: setup.characterId,
          entryIndex: 1,
          state: { lit: true, turnsRemaining: 2 },
        }),
      });
      // Move it into the backpack (same holder; container slot).
      const res = await setup.pipeline.dispatch({
        id: "m1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: MoveItem({
          holderId: setup.characterId,
          fromIndex: 1,
          toSlot: `container:${backpackInstanceId}` as never,
          toSlotIndex: 0,
          toChannel: "default",
        }),
      });
      expect(res.result.ok).toBe(true);
      const after = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: {
          entries: Array<{ slot: string; state?: { lit?: boolean } }>;
        };
      };
      expect(after.TbCarries.entries[1]!.slot).toBe(`container:${backpackInstanceId}`);
      expect(after.TbCarries.entries[1]!.state?.lit).toBe(false);
    });

    it("allows non-lit state changes on an entry inside a container", async () => {
      // Equip a torch directly into the backpack so the entry's
      // slot is `container:<id>`; then mark it dropped (which
      // should still be allowed even though `lit:true` would not).
      const torchTemplate = setup.world.spawn([
        ItemIdentity({ name: "Torch" }),
        TbItemSlotOptions({ options: { pack: 1 } }),
        TbSupply({
          supplyType: "light",
          turnsRemaining: 2,
          lit: false,
          nameSingular: "Torch",
        }),
      ]);
      await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.backpackId,
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
        }),
      });
      const carries = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      const backpackInstanceId = carries.TbCarries.entries[0]!.itemId;
      await setup.pipeline.dispatch({
        id: "e2",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: backpackInstanceId as never,
          itemId: torchTemplate,
          slot: `container:${backpackInstanceId}` as never,
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
        }),
      });
      const res = await setup.pipeline.dispatch({
        id: "s1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: SetEntryState({
          holderId: backpackInstanceId as never,
          entryIndex: 0,
          state: { damaged: true },
        }),
      });
      expect(res.result.ok).toBe(true);
    });
  });

  describe("MoveItem", () => {
    it("relocates an existing entry from belt to handR", async () => {
      await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.swordId,
          slot: "belt",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
        }),
      });
      const res = await setup.pipeline.dispatch({
        id: "m1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: MoveItem({
          holderId: setup.characterId,
          fromIndex: 0,
          toSlot: "handR",
          toSlotIndex: 0,
          toChannel: "carried",
        }),
      });
      expect(res.result.ok).toBe(true);
      const carries = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ slot: string }> };
      };
      expect(carries.TbCarries.entries[0]!.slot).toBe("handR");
    });

    it("rejects a move to a slot outside the item's slotOptions", async () => {
      await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.swordId,
          slot: "belt",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
        }),
      });
      const res = await setup.pipeline.dispatch({
        id: "m1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: MoveItem({
          holderId: setup.characterId,
          fromIndex: 0,
          toSlot: "head",
          toSlotIndex: 0,
          toChannel: "default",
        }),
      });
      expect(res.result.ok).toBe(false);
    });
  });

  describe("SetEntryState", () => {
    it("patches damaged + lit + turnsRemaining onto the right entry", async () => {
      await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.swordId,
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
        }),
      });
      const res = await setup.pipeline.dispatch({
        id: "s1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: SetEntryState({
          holderId: setup.characterId,
          entryIndex: 0,
          state: { damaged: true, turnsRemaining: 3 },
        }),
      });
      expect(res.result.ok).toBe(true);
      const carries = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: {
          entries: Array<{ state?: { damaged?: boolean; turnsRemaining?: number } }>;
        };
      };
      expect(carries.TbCarries.entries[0]!.state?.damaged).toBe(true);
      expect(carries.TbCarries.entries[0]!.state?.turnsRemaining).toBe(3);
    });
  });

  describe("DropItem + PickUpItem", () => {
    it("drop removes from holder and stamps Position; pickup transfers entity intact", async () => {
      // Equip the sword.
      await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.swordId,
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
        }),
      });
      const sceneId = setup.world.spawn([]);
      // Drop.
      const drop = await setup.pipeline.dispatch({
        id: "d1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: DropItem({
          holderId: setup.characterId,
          entryIndex: 0,
          sceneId,
          x: 5,
          y: 7,
        }),
      });
      expect(drop.result.ok).toBe(true);
      expect(setup.world.get(setup.swordId, [ItemPosition])).toBeDefined();
      const carries = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<unknown> };
      };
      expect(carries.TbCarries.entries).toHaveLength(0);

      // Pick up by character B.
      const characterB = setup.world.spawn([TbCarries({ entries: [] })]);
      const pickup = await setup.pipeline.dispatch({
        id: "p1",
        issuedBy: "bob",
        issuedAt: 0,
        cmd: PickUpItem({
          holderId: characterB,
          itemId: setup.swordId,
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
        }),
      });
      expect(pickup.result.ok).toBe(true);
      const bCarries = setup.world.get(characterB, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      expect(bCarries.TbCarries.entries[0]!.itemId).toBe(setup.swordId);
      // ItemPosition is cleared.
      expect(setup.world.get(setup.swordId, [ItemPosition])).toBeUndefined();
    });

    it("dropping a forked container takes its contents along by reference", async () => {
      // Equip backpack (auto-fork).
      await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.backpackId,
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
        }),
      });
      const carries = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      const forkedBackpackId = carries.TbCarries.entries[0]!.itemId;

      // Bootstrap a TbCarries on the backpack with a fake "arrows" entry.
      // (We don't have a real arrows-template, but contents-on-container
      // is the only thing under test here.)
      const arrowId = setup.world.spawn([TbItemSlotOptions({ options: { pack: 1 } })]);
      setup.world.set(forkedBackpackId, TbCarries, {
        entries: [
          {
            slot: `container:${forkedBackpackId}`,
            slotIndex: 0,
            channel: "default",
            slotsConsumed: 1,
            itemId: arrowId,
            quantity: 1,
          },
        ],
      });

      const sceneId = setup.world.spawn([]);
      const drop = await setup.pipeline.dispatch({
        id: "d1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: DropItem({
          holderId: setup.characterId,
          entryIndex: 0,
          sceneId,
          x: 5,
          y: 5,
        }),
      });
      expect(drop.result.ok).toBe(true);

      // Backpack is on the floor with its contents intact.
      expect(setup.world.get(forkedBackpackId, [ItemPosition])).toBeDefined();
      const backpackCarries = setup.world.get(forkedBackpackId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      expect(backpackCarries.TbCarries.entries).toHaveLength(1);
      expect(backpackCarries.TbCarries.entries[0]!.itemId).toBe(arrowId);

      // Character B picks it up.
      const characterB = setup.world.spawn([TbCarries({ entries: [] })]);
      const pickup = await setup.pipeline.dispatch({
        id: "p1",
        issuedBy: "bob",
        issuedAt: 0,
        cmd: PickUpItem({
          holderId: characterB,
          itemId: forkedBackpackId,
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
        }),
      });
      expect(pickup.result.ok).toBe(true);
      // Contents still on the backpack — they came along.
      const after = setup.world.get(forkedBackpackId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      expect(after.TbCarries.entries[0]!.itemId).toBe(arrowId);
    });

    it("PickUpItem rejects an item that has no Position (not on the floor)", async () => {
      const characterB = setup.world.spawn([TbCarries({ entries: [] })]);
      const res = await setup.pipeline.dispatch({
        id: "p1",
        issuedBy: "bob",
        issuedAt: 0,
        cmd: PickUpItem({
          holderId: characterB,
          itemId: setup.swordId,
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
        }),
      });
      expect(res.result.ok).toBe(false);
    });
  });

  describe("UnequipItem", () => {
    it("removes the entry without dropping the item", async () => {
      await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.swordId,
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
        }),
      });
      const res = await setup.pipeline.dispatch({
        id: "u1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: UnequipItem({
          holderId: setup.characterId,
          entryIndex: 0,
        }),
      });
      expect(res.result.ok).toBe(true);
      const carries = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<unknown> };
      };
      expect(carries.TbCarries.entries).toHaveLength(0);
      // Item entity is intact.
      expect(setup.world.has(setup.swordId)).toBe(true);
      // No Position.
      expect(setup.world.get(setup.swordId, [ItemPosition])).toBeUndefined();
    });
  });

  describe("Container target slots", () => {
    it("places an item into a container target with capacity respected", async () => {
      // Equip the backpack (auto-forks).
      await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.backpackId,
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
        }),
      });
      const carries = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      const forkedBackpackId = carries.TbCarries.entries[0]!.itemId;

      // Equip the sword INTO the backpack.
      const res = await setup.pipeline.dispatch({
        id: "e2",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: forkedBackpackId,
          itemId: setup.swordId,
          slot: `container:${forkedBackpackId}`,
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 1,
        }),
      });
      expect(res.result.ok).toBe(true);
      const bp = setup.world.get(forkedBackpackId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      expect(bp.TbCarries.entries).toHaveLength(1);
      expect(bp.TbCarries.entries[0]!.itemId).toBe(setup.swordId);
    });

    it("dropped entries don't count toward body-slot capacity", async () => {
      // A backpack placed at torso then dropped should leave torso
      // empty (3/3 → 0/3) — its body presence vanishes when the
      // dropped flag is set.
      await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.backpackId,
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
        }),
      });
      const beforeDrop = summarizeCapacity({
        world: setup.world,
        holderId: setup.characterId,
        slot: "torso",
        channel: "default",
      });
      expect(beforeDrop.used).toBe(2);
      // Drop it.
      await setup.pipeline.dispatch({
        id: "s1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: SetEntryState({
          holderId: setup.characterId,
          entryIndex: 0,
          state: { dropped: true },
        }),
      });
      const afterDrop = summarizeCapacity({
        world: setup.world,
        holderId: setup.characterId,
        slot: "torso",
        channel: "default",
      });
      expect(afterDrop.used).toBe(0);
      expect(afterDrop.wouldOverfill(0)).toBe(false);
    });

    it("loose:<n> entries don't count toward body-slot capacity", async () => {
      // A "loose" item is staged on the character without a body
      // placement — it should not eat torso/handR/etc. capacity.
      const filler = setup.world.spawn([TbItemSlotOptions({ options: { torso: 1 } })]);
      setup.world.set(setup.characterId, TbCarries, {
        entries: [
          {
            slot: "loose:1",
            slotIndex: 0,
            channel: "default",
            slotsConsumed: 1,
            itemId: filler,
            quantity: 1,
          },
        ],
      });
      const cap = summarizeCapacity({
        world: setup.world,
        holderId: setup.characterId,
        slot: "torso",
        channel: "default",
      });
      expect(cap.used).toBe(0);
    });

    it("accepts overfill in a container; capacity summary surfaces the overfill", async () => {
      await setup.pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: setup.characterId,
          itemId: setup.backpackId,
          slot: "torso",
          slotIndex: 0,
          channel: "default",
          slotsConsumed: 2,
        }),
      });
      const carries = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ itemId: string }> };
      };
      const forkedBackpackId = carries.TbCarries.entries[0]!.itemId;

      // Manually pack 6 mock items.
      const fillerEntries = [];
      for (let i = 0; i < 6; i++) {
        const filler = setup.world.spawn([TbItemSlotOptions({ options: { pack: 1 } })]);
        fillerEntries.push({
          slot: `container:${forkedBackpackId}`,
          slotIndex: i,
          channel: "default",
          slotsConsumed: 1,
          itemId: filler,
          quantity: 1,
        });
      }
      setup.world.set(forkedBackpackId, TbCarries, { entries: fillerEntries });

      const res = await setup.pipeline.dispatch({
        id: "e2",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EquipItem({
          holderId: forkedBackpackId,
          itemId: setup.swordId,
          slot: `container:${forkedBackpackId}`,
          slotIndex: 6,
          channel: "default",
          slotsConsumed: 1,
        }),
      });
      expect(res.result.ok).toBe(true);
      const cap = summarizeCapacity({
        world: setup.world,
        holderId: forkedBackpackId,
        slot: `container:${forkedBackpackId}`,
        channel: "default",
      });
      expect(cap.used).toBe(7);
      expect(cap.limit).toBe(6);
      expect(cap.wouldOverfill(0)).toBe(true);
    });
  });
});
