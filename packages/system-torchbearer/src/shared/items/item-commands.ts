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

import {
  defineCommand,
  EntityId,
  fail,
  ok,
  z,
  type EventInstance,
} from "@vtt/substrate";
import { ItemCatalogIndex, ItemForked } from "@vtt/items/shared";
import { TbBodySlotSchema, TbEquipChannel } from "./body-slots.js";
import {
  ItemDropped,
  ItemEquipped,
  ItemMoved,
  ItemPickedUp,
  ItemUnequipped,
  EntryStateChanged,
} from "./item-events.js";
import {
  ItemPosition,
  TbCarries,
  TbContainer,
} from "./item-traits.js";
import { checkPlacement } from "./capacity.js";

/**
 * EquipItem — place an item entity into a holder's TbCarries.
 *
 * Fork-on-catalog-equip rule: if `itemId` is the canonical catalog
 * entity for a container (TbContainer trait + has an entry in any
 * ItemCatalogIndex sentinel), `apply` allocates a fresh entity id
 * and emits ItemForked first; the holder ends up with the FORK in
 * its TbCarries, leaving the catalog entity untouched. Non-container
 * catalog items can be referenced from many holders without
 * forking — that's the whole point of "items are shared by
 * reference."
 *
 * Picking up off the floor (PickUpItem) intentionally never auto-
 * forks: dropped entities are already real / unique. EquipItem is
 * for adding from the catalog or from already-customized inventory.
 */
export const EquipItem = defineCommand({
  name: "@vtt/system-torchbearer/EquipItem",
  schema: z.object({
    holderId: EntityId,
    itemId: EntityId,
    slot: TbBodySlotSchema,
    slotIndex: z.number().int().min(0).default(0),
    channel: TbEquipChannel,
    slotsConsumed: z.number().int().min(1).default(1),
    quantity: z.number().int().min(0).default(1),
  }),
  validate: ({ cmd, world }) => {
    if (!world.has(cmd.holderId)) {
      return fail(`unknown holder ${cmd.holderId}`);
    }
    if (!world.has(cmd.itemId)) {
      return fail(`unknown item ${cmd.itemId}`);
    }
    const placement = checkPlacement({
      world,
      holderId: cmd.holderId,
      itemId: cmd.itemId,
      slot: cmd.slot,
      channel: cmd.channel,
      slotsConsumed: cmd.slotsConsumed,
    });
    if (!placement.ok) return fail(placement.reason ?? "placement rejected");
    return ok();
  },
  apply: ({ cmd, world }) => {
    const events: EventInstance[] = [];
    let finalItemId = cmd.itemId;
    const isContainer = world.get(cmd.itemId, [TbContainer]) !== undefined;
    if (isContainer && isCatalogEntity(world, cmd.itemId)) {
      finalItemId = world.allocateId();
      events.push(
        ItemForked({
          sourceItemId: cmd.itemId,
          newItemId: finalItemId,
        }),
      );
    }
    events.push(
      ItemEquipped({
        holderId: cmd.holderId,
        itemId: finalItemId,
        slot: cmd.slot,
        slotIndex: cmd.slotIndex,
        channel: cmd.channel,
        slotsConsumed: cmd.slotsConsumed,
        quantity: cmd.quantity,
      }),
    );
    return events;
  },
});

/**
 * MoveItem — relocate an existing entry within a holder's TbCarries.
 * The validator runs the same placement check as EquipItem against
 * the destination (with the source entry index excluded so a self-
 * move doesn't double-count).
 */
export const MoveItem = defineCommand({
  name: "@vtt/system-torchbearer/MoveItem",
  schema: z.object({
    holderId: EntityId,
    fromIndex: z.number().int().min(0),
    toSlot: TbBodySlotSchema,
    toSlotIndex: z.number().int().min(0).default(0),
    toChannel: TbEquipChannel,
  }),
  validate: ({ cmd, world }) => {
    const got = world.get(cmd.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<{ itemId: string; slotsConsumed: number }> } }
      | undefined;
    if (!got) return fail(`holder ${cmd.holderId} has no TbCarries`);
    const entry = got.TbCarries.entries[cmd.fromIndex];
    if (!entry) return fail(`no carry entry at index ${cmd.fromIndex}`);
    const placement = checkPlacement({
      world,
      holderId: cmd.holderId,
      itemId: entry.itemId,
      slot: cmd.toSlot,
      channel: cmd.toChannel,
      slotsConsumed: entry.slotsConsumed,
      excludeEntryIndex: cmd.fromIndex,
    });
    if (!placement.ok) return fail(placement.reason ?? "placement rejected");
    return ok();
  },
  apply: ({ cmd }) => [
    ItemMoved({
      holderId: cmd.holderId,
      fromIndex: cmd.fromIndex,
      toSlot: cmd.toSlot,
      toSlotIndex: cmd.toSlotIndex,
      toChannel: cmd.toChannel,
    }),
  ],
});

/**
 * SetEntryState — patch the per-entry state object (damaged /
 * dropped / lit / lost / turnsRemaining / quantity). Unspecified
 * fields are left alone.
 */
export const SetEntryState = defineCommand({
  name: "@vtt/system-torchbearer/SetEntryState",
  schema: z.object({
    holderId: EntityId,
    entryIndex: z.number().int().min(0),
    state: z.object({
      damaged: z.boolean().optional(),
      dropped: z.boolean().optional(),
      lit: z.boolean().optional(),
      turnsRemaining: z.number().int().min(0).optional(),
      lost: z.boolean().optional(),
      quantity: z.number().int().min(0).optional(),
    }),
  }),
  validate: ({ cmd, world }) => {
    const got = world.get(cmd.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<unknown> } }
      | undefined;
    if (!got) return fail(`holder ${cmd.holderId} has no TbCarries`);
    if (!got.TbCarries.entries[cmd.entryIndex]) {
      return fail(`no carry entry at index ${cmd.entryIndex}`);
    }
    return ok();
  },
  apply: ({ cmd }) => [
    EntryStateChanged({
      holderId: cmd.holderId,
      entryIndex: cmd.entryIndex,
      state: cmd.state,
    }),
  ],
});

/**
 * DropItem — remove an entry from the holder and stamp the item
 * with a scene Position. Contents of the dropped item (if it's a
 * container) come along automatically because they live on the
 * item's own TbCarries.
 */
export const DropItem = defineCommand({
  name: "@vtt/system-torchbearer/DropItem",
  schema: z.object({
    holderId: EntityId,
    entryIndex: z.number().int().min(0),
    sceneId: EntityId,
    x: z.number(),
    y: z.number(),
  }),
  validate: ({ cmd, world }) => {
    const got = world.get(cmd.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<{ itemId: string }> } }
      | undefined;
    if (!got) return fail(`holder ${cmd.holderId} has no TbCarries`);
    if (!got.TbCarries.entries[cmd.entryIndex]) {
      return fail(`no carry entry at index ${cmd.entryIndex}`);
    }
    return ok();
  },
  apply: ({ cmd, world }) => {
    const got = world.get(cmd.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<{ itemId: string }> } }
      | undefined;
    const entry = got!.TbCarries.entries[cmd.entryIndex]!;
    return [
      ItemDropped({
        holderId: cmd.holderId,
        itemId: entry.itemId,
        sceneId: cmd.sceneId,
        x: cmd.x,
        y: cmd.y,
      }),
    ];
  },
});

/**
 * PickUpItem — inverse of DropItem. The item must currently have
 * an ItemPosition trait (i.e. it's on a scene floor). No auto-fork.
 */
export const PickUpItem = defineCommand({
  name: "@vtt/system-torchbearer/PickUpItem",
  schema: z.object({
    holderId: EntityId,
    itemId: EntityId,
    slot: TbBodySlotSchema,
    slotIndex: z.number().int().min(0).default(0),
    channel: TbEquipChannel,
    slotsConsumed: z.number().int().min(1).default(1),
    quantity: z.number().int().min(0).default(1),
  }),
  validate: ({ cmd, world }) => {
    if (!world.has(cmd.holderId)) {
      return fail(`unknown holder ${cmd.holderId}`);
    }
    if (!world.has(cmd.itemId)) {
      return fail(`unknown item ${cmd.itemId}`);
    }
    if (!world.get(cmd.itemId, [ItemPosition])) {
      return fail(`item ${cmd.itemId} is not on a scene (no ItemPosition)`);
    }
    const placement = checkPlacement({
      world,
      holderId: cmd.holderId,
      itemId: cmd.itemId,
      slot: cmd.slot,
      channel: cmd.channel,
      slotsConsumed: cmd.slotsConsumed,
    });
    if (!placement.ok) return fail(placement.reason ?? "placement rejected");
    return ok();
  },
  apply: ({ cmd }) => [
    ItemPickedUp({
      holderId: cmd.holderId,
      itemId: cmd.itemId,
      slot: cmd.slot,
      slotIndex: cmd.slotIndex,
      channel: cmd.channel,
      slotsConsumed: cmd.slotsConsumed,
      quantity: cmd.quantity,
    }),
  ],
});

/**
 * UnequipItem — remove an entry from a holder without dropping it.
 * Useful for "give to another player" flows. Doesn't destroy the
 * item entity.
 */
export const UnequipItem = defineCommand({
  name: "@vtt/system-torchbearer/UnequipItem",
  schema: z.object({
    holderId: EntityId,
    entryIndex: z.number().int().min(0),
  }),
  validate: ({ cmd, world }) => {
    const got = world.get(cmd.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<unknown> } }
      | undefined;
    if (!got) return fail(`holder ${cmd.holderId} has no TbCarries`);
    if (!got.TbCarries.entries[cmd.entryIndex]) {
      return fail(`no carry entry at index ${cmd.entryIndex}`);
    }
    return ok();
  },
  apply: ({ cmd }) => [
    ItemUnequipped({
      holderId: cmd.holderId,
      entryIndex: cmd.entryIndex,
    }),
  ],
});

/**
 * Determine whether an item entity is a "canonical" catalog
 * entity by looking it up in any registered ItemCatalogIndex.
 * Used by the auto-fork rule on EquipItem (catalog containers
 * fork; non-catalog containers don't).
 */
function isCatalogEntity(
  world: import("@vtt/substrate").World,
  itemId: string,
): boolean {
  for (const row of world.query([ItemCatalogIndex])) {
    const v = row.values.ItemCatalogIndex as { entries: Record<string, string> };
    for (const id of Object.values(v.entries)) {
      if (id === itemId) return true;
    }
  }
  return false;
}
