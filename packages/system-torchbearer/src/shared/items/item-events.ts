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

import { defineEvent, EntityId, z } from "@vtt/substrate";
import { TbBodySlotSchema, TbEquipChannel } from "./body-slots.js";

/**
 * Sent when an item lands in a holder's inventory. Both the
 * attached `EquipItem` flow (catalog → holder) and the
 * `PickUpItem` flow (scene-floor → holder) emit this. The
 * placement details (slot/index/channel/slotsConsumed) come
 * pre-validated against the holder's capacity.
 *
 * If the item was auto-forked at equip-time (catalog container →
 * fresh entity per-character), a separate `ItemForked` event
 * (from @vtt/items) precedes this with the original →
 * forked-entity mapping.
 */
export const ItemEquipped = defineEvent({
  name: "@vtt/system-torchbearer/ItemEquipped",
  schema: z.object({
    holderId: EntityId,
    itemId: EntityId,
    slot: TbBodySlotSchema,
    slotIndex: z.number().int().min(0),
    channel: TbEquipChannel,
    slotsConsumed: z.number().int().min(1),
    quantity: z.number().int().min(0).default(1),
  }),
});

/**
 * An entry in a holder's TbCarries has been moved to a different
 * slot. Same TbCarries trait, same itemId — just relocated. Used
 * for shuffling between body slots (move sword from belt to
 * carried), moving items into and out of containers, etc.
 */
export const ItemMoved = defineEvent({
  name: "@vtt/system-torchbearer/ItemMoved",
  schema: z.object({
    holderId: EntityId,
    fromIndex: z.number().int().min(0),
    toSlot: TbBodySlotSchema,
    toSlotIndex: z.number().int().min(0),
    toChannel: TbEquipChannel,
  }),
});

/**
 * Per-entry state flags have changed: damaged / dropped / lit /
 * turnsRemaining / lost / quantity. The receiving system applies
 * the partial onto the entry, leaving unspecified fields alone.
 */
export const EntryStateChanged = defineEvent({
  name: "@vtt/system-torchbearer/EntryStateChanged",
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
});

/**
 * Item dropped onto a scene cell. The receiving system removes
 * the entry from the holder's TbCarries and stamps a Position
 * trait on the item entity (sceneId + x/y). Contents of a
 * container come along automatically because they live on the
 * container's own TbCarries.
 *
 * Carried scene Position is intentionally minimal — sceneId +
 * pixel-coords. Future scene-grid work may extend this.
 */
export const ItemDropped = defineEvent({
  name: "@vtt/system-torchbearer/ItemDropped",
  schema: z.object({
    holderId: EntityId,
    itemId: EntityId,
    sceneId: EntityId,
    x: z.number(),
    y: z.number(),
  }),
});

/**
 * Item picked up off a scene cell into a holder. Inverse of
 * ItemDropped. No auto-fork — the entity already exists; the
 * fork-only-on-catalog-equip rule means picking up a real
 * dropped entity transfers it as-is, contents intact.
 */
export const ItemPickedUp = defineEvent({
  name: "@vtt/system-torchbearer/ItemPickedUp",
  schema: z.object({
    holderId: EntityId,
    itemId: EntityId,
    slot: TbBodySlotSchema,
    slotIndex: z.number().int().min(0),
    channel: TbEquipChannel,
    slotsConsumed: z.number().int().min(1),
    quantity: z.number().int().min(0).default(1),
  }),
});

/**
 * Item un-equipped from a holder without dropping it (it stays
 * on the entity but vanishes from the holder's TbCarries). Used
 * for "give item to another holder" flows where the giver
 * unequips and the receiver equips in two stages without ever
 * placing the item on the floor.
 */
export const ItemUnequipped = defineEvent({
  name: "@vtt/system-torchbearer/ItemUnequipped",
  schema: z.object({
    holderId: EntityId,
    entryIndex: z.number().int().min(0),
  }),
});

