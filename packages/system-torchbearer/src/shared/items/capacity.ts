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

import type { World } from "@vtt/substrate";
import {
  TB_CHARACTER_SLOT_CAPACITY,
  type TbBodySlot,
  type TbEquipChannelT,
} from "./body-slots.js";
import {
  TbCarries,
  TbContainer,
  TbItemSlotOptions,
} from "./item-traits.js";

export interface PlacementCheck {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface PlacementRequest {
  readonly world: World;
  readonly holderId: string;
  readonly itemId: string;
  readonly slot: TbBodySlot | string; // string covers `container:<id>` form
  readonly channel: TbEquipChannelT;
  readonly slotsConsumed: number;
  /**
   * If non-null, treat this index of the holder's TbCarries as
   * "the entry being moved" and exclude it from used-capacity math
   * (a self-move shouldn't count itself as already-occupied).
   */
  readonly excludeEntryIndex?: number;
}

/**
 * Run the TB placement rules against a candidate slot/channel/cost.
 * Confirms:
 *   1. The item has TbItemSlotOptions and the chosen slot is in
 *      its allowed map (or is `container:<id>` and the container
 *      exists with a TbContainer trait).
 *   2. The slotsConsumed matches the item's stated cost for the
 *      chosen slot (so a "torso 2" backpack can't sneak in as
 *      torso 1).
 *   3. Adding the cost wouldn't exceed the slot's capacity, given
 *      what the holder already carries.
 */
export function checkPlacement(req: PlacementRequest): PlacementCheck {
  const { world, holderId, itemId, slot, channel, slotsConsumed } = req;

  // Item-side: must have slotOptions, and the chosen slot must be
  // in the allowed map (with the right cost).
  const itemSlotOpts = world.get(itemId as never, [TbItemSlotOptions]) as
    | { TbItemSlotOptions: { options: Record<string, number> } }
    | undefined;

  if (slot.startsWith("container:")) {
    // Container target: the item itself doesn't need to allow
    // "container:<id>" — that's a meta-slot. But the source item
    // must allow being packed at all, which we infer from "pack"
    // / "carried" / "wornHand" being in the slotOptions, OR by
    // the catalog explicitly listing the *containerType* (e.g.
    // a small sack inside a backpack uses `pack: 1`). For
    // simplicity we accept any non-empty slotOptions when the
    // target is a container; the container's capacity is the
    // only hard check.
    if (itemSlotOpts && Object.keys(itemSlotOpts.TbItemSlotOptions.options).length === 0) {
      return { ok: false, reason: "item has no slot options; cannot be placed in a container" };
    }
    const containerId = slot.slice("container:".length);
    if (!world.has(containerId as never)) {
      return { ok: false, reason: `container ${containerId} does not exist` };
    }
    const cgot = world.get(containerId as never, [TbContainer]) as
      | { TbContainer: { containerSlots: number } }
      | undefined;
    if (!cgot) {
      return { ok: false, reason: `entity ${containerId} is not a container` };
    }
    const containerHolderUsed = computeUsedSlots(world, containerId, slot, req.excludeEntryIndex);
    if (containerHolderUsed + slotsConsumed > cgot.TbContainer.containerSlots) {
      return {
        ok: false,
        reason: `container ${containerId} full (${containerHolderUsed}/${cgot.TbContainer.containerSlots}, item needs ${slotsConsumed})`,
      };
    }
    return { ok: true };
  }

  if (!itemSlotOpts) {
    return { ok: false, reason: "item has no TbItemSlotOptions; cannot be equipped" };
  }
  const allowedCost = itemSlotOpts.TbItemSlotOptions.options[slot];
  if (allowedCost === undefined) {
    return { ok: false, reason: `item not allowed in slot ${slot}` };
  }
  if (allowedCost !== slotsConsumed) {
    return {
      ok: false,
      reason: `slot ${slot} requires ${allowedCost} slot(s); equipped with ${slotsConsumed}`,
    };
  }

  const cap = capacityForCharacterSlot(slot, channel);
  if (cap !== undefined) {
    const used = computeUsedSlots(world, holderId, slot, req.excludeEntryIndex, channel);
    if (used + slotsConsumed > cap) {
      return {
        ok: false,
        reason: `slot ${slot}/${channel} full (${used}/${cap}, item needs ${slotsConsumed})`,
      };
    }
  }

  return { ok: true };
}

/**
 * How many slots a Character's body location offers, accounting for
 * the worn/carried channel split on hands. Returns undefined when
 * the slot is descriptive-only (pocket) or part of the catalog
 * vocabulary that maps to a different canonical slot.
 */
export function capacityForCharacterSlot(
  slot: string,
  channel: TbEquipChannelT,
): number | undefined {
  if (slot === "handR" || slot === "handL") {
    return 1; // 1 worn OR 1 carried, channel-scoped.
  }
  const key = slot as keyof typeof TB_CHARACTER_SLOT_CAPACITY;
  if (key in TB_CHARACTER_SLOT_CAPACITY) {
    return TB_CHARACTER_SLOT_CAPACITY[key];
  }
  // Pocket and pack/carried/wornHand/hands/pouch/quiver are not
  // hard-capped at the body level — pack lives inside containers,
  // pocket is descriptive, etc.
  return undefined;
}

function computeUsedSlots(
  world: World,
  holderId: string,
  slot: string,
  excludeEntryIndex: number | undefined,
  channel?: TbEquipChannelT,
): number {
  const got = world.get(holderId as never, [TbCarries]) as
    | { TbCarries: { entries: Array<{ slot: string; channel: string; slotsConsumed: number }> } }
    | undefined;
  if (!got) return 0;
  let used = 0;
  got.TbCarries.entries.forEach((e, idx) => {
    if (idx === excludeEntryIndex) return;
    if (e.slot !== slot) return;
    if (channel && e.channel !== channel && e.channel !== "default") return;
    used += e.slotsConsumed;
  });
  return used;
}

/**
 * Choose the next free slotIndex in the holder's TbCarries for
 * `slot`. Returns 0 if nothing is in that slot yet, otherwise
 * max(slotIndex)+1 of the existing entries. Doesn't gap-fill —
 * if entries 0/1/3 are present it returns 4 — gap-filling can
 * come if we ever need to compact slot indices.
 */
export function nextSlotIndex(
  world: World,
  holderId: string,
  slot: string,
): number {
  const got = world.get(holderId as never, [TbCarries]) as
    | { TbCarries: { entries: Array<{ slot: string; slotIndex: number }> } }
    | undefined;
  if (!got) return 0;
  let max = -1;
  for (const e of got.TbCarries.entries) {
    if (e.slot !== slot) continue;
    if (e.slotIndex > max) max = e.slotIndex;
  }
  return max + 1;
}
