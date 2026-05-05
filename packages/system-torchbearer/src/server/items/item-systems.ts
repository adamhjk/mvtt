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

import { defineSystem } from "@vtt/substrate";
import {
  EntryStateChanged,
  ItemDropped,
  ItemEquipped,
  ItemMoved,
  ItemPickedUp,
  ItemUnequipped,
} from "../../shared/items/item-events.js";
import {
  ItemPosition,
  TbCarries,
} from "../../shared/items/item-traits.js";

/**
 * ItemEquipped → append a TbCarries entry on the holder. Because
 * TbCarries.entries is array-shaped and the trait value is replaced
 * atomically, we read-then-write the whole array.
 */
export const TbItemEquipSystem = defineSystem({
  name: "TbItemEquip",
  on: ItemEquipped,
  reads: [TbCarries],
  writes: [TbCarries],
  run: ({ event, world }) => {
    const got = world.get(event.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<unknown> } }
      | undefined;
    const entries = got
      ? [...((got.TbCarries.entries as Array<Record<string, unknown>>) ?? [])]
      : [];
    entries.push({
      slot: event.slot,
      slotIndex: event.slotIndex,
      channel: event.channel,
      slotsConsumed: event.slotsConsumed,
      itemId: event.itemId,
      quantity: event.quantity,
    });
    if (got) {
      world.set(event.holderId, TbCarries, { entries });
    } else {
      // Holder doesn't have a TbCarries trait yet; bootstrap it.
      world.set(event.holderId, TbCarries, { entries });
    }
    return [];
  },
});

/**
 * ItemMoved → update the entry in place: relocate to the new slot,
 * slotIndex, channel.
 */
export const TbItemMoveSystem = defineSystem({
  name: "TbItemMove",
  on: ItemMoved,
  reads: [TbCarries],
  writes: [TbCarries],
  run: ({ event, world }) => {
    const got = world.get(event.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<Record<string, unknown>> } }
      | undefined;
    if (!got) return [];
    const entries = got.TbCarries.entries.slice();
    const entry = entries[event.fromIndex];
    if (!entry) return [];
    entries[event.fromIndex] = {
      ...entry,
      slot: event.toSlot,
      slotIndex: event.toSlotIndex,
      channel: event.toChannel,
    };
    world.set(event.holderId, TbCarries, { entries });
    return [];
  },
});

/**
 * EntryStateChanged → patch the per-entry state object, leaving
 * unspecified fields alone.
 */
export const TbEntryStateSystem = defineSystem({
  name: "TbEntryState",
  on: EntryStateChanged,
  reads: [TbCarries],
  writes: [TbCarries],
  run: ({ event, world }) => {
    const got = world.get(event.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<Record<string, unknown>> } }
      | undefined;
    if (!got) return [];
    const entries = got.TbCarries.entries.slice();
    const entry = entries[event.entryIndex];
    if (!entry) return [];
    const prevState = (entry.state as Record<string, unknown>) ?? {};
    entries[event.entryIndex] = {
      ...entry,
      state: { ...prevState, ...event.state },
    };
    if (typeof event.state.quantity === "number") {
      // quantity is also a top-level entry field, not just a state flag.
      entries[event.entryIndex] = {
        ...entries[event.entryIndex],
        quantity: event.state.quantity,
      };
    }
    world.set(event.holderId, TbCarries, { entries });
    return [];
  },
});

/**
 * ItemDropped → remove the entry from the holder, stamp
 * ItemPosition on the item entity with the scene coords.
 */
export const TbItemDropSystem = defineSystem({
  name: "TbItemDrop",
  on: ItemDropped,
  reads: [TbCarries],
  writes: [TbCarries, ItemPosition],
  run: ({ event, world }) => {
    const got = world.get(event.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<{ itemId: string }> } }
      | undefined;
    if (got) {
      const entries = got.TbCarries.entries.filter((e) => e.itemId !== event.itemId);
      world.set(event.holderId, TbCarries, { entries });
    }
    if (world.has(event.itemId)) {
      world.set(event.itemId, ItemPosition, {
        sceneId: event.sceneId,
        x: event.x,
        y: event.y,
      });
    }
    return [];
  },
});

/**
 * ItemPickedUp → clear ItemPosition, append a TbCarries entry
 * (same shape as TbItemEquipSystem).
 */
export const TbItemPickUpSystem = defineSystem({
  name: "TbItemPickUp",
  on: ItemPickedUp,
  reads: [TbCarries, ItemPosition],
  writes: [TbCarries],
  run: ({ event, world }) => {
    if (world.has(event.itemId)) {
      world.remove(event.itemId, ItemPosition);
    }
    const got = world.get(event.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<Record<string, unknown>> } }
      | undefined;
    const entries = got ? [...got.TbCarries.entries] : [];
    entries.push({
      slot: event.slot,
      slotIndex: event.slotIndex,
      channel: event.channel,
      slotsConsumed: event.slotsConsumed,
      itemId: event.itemId,
      quantity: event.quantity,
    });
    world.set(event.holderId, TbCarries, { entries });
    return [];
  },
});

/**
 * ItemUnequipped → remove the entry from the holder. Item entity
 * stays put (presumably another command — equip elsewhere — will
 * move it).
 */
export const TbItemUnequipSystem = defineSystem({
  name: "TbItemUnequip",
  on: ItemUnequipped,
  reads: [TbCarries],
  writes: [TbCarries],
  run: ({ event, world }) => {
    const got = world.get(event.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<unknown> } }
      | undefined;
    if (!got) return [];
    const entries = (got.TbCarries.entries as Array<unknown>).filter(
      (_, idx) => idx !== event.entryIndex,
    );
    world.set(event.holderId, TbCarries, { entries });
    return [];
  },
});
