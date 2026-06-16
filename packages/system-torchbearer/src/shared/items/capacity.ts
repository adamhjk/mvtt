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
import { TB_CHARACTER_SLOT_CAPACITY, type TbBodySlot, type TbEquipChannelT } from "./body-slots.js";
import { TbCarries, TbContainer, TbItemSlotOptions } from "./item-traits.js";

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
 * Schema-level placement check: is the candidate slot one this
 * item is allowed in, and does the cost match the catalog-stated
 * one? Used by `EquipItem.validate` / `MoveItem.validate` to
 * reject ill-formed placements (head-only item slotted to feet,
 * sword equipped at slotsConsumed=2 instead of 1, etc.).
 *
 * Capacity is *NOT* checked here — overfill is a soft constraint.
 * The UI lets a player intentionally overfill a slot while
 * shuffling items around, lighting up the slot in red so they
 * know they need to clear space before they can rest. See
 * `summarizeCapacity()` for the per-slot used/total + over-flag
 * the inventory view consumes.
 *
 * Canonical body slots (`handR` / `handL` + worn/carried channel)
 * map back to the catalog's slotOptions vocabulary
 * (`carried` / `wornHand` / `hands`) before lookup, so an item
 * listed as `carried: 1` validates when placed in either hand.
 * Container targets (`container:<id>`) accept any item that is
 * itself container-eligible; the container's `containerType`
 * gates which catalog category the cost is read from
 * (`pack` / `pouch` / `quiver`).
 */
export function checkPlacementKind(req: PlacementRequest): PlacementCheck {
  const { world, itemId, slot, channel, slotsConsumed } = req;

  const itemSlotOpts = world.get(itemId as never, [TbItemSlotOptions]) as
    | { TbItemSlotOptions: { options: Record<string, number> } }
    | undefined;

  if (slot.startsWith("container:")) {
    if (!itemSlotOpts || Object.keys(itemSlotOpts.TbItemSlotOptions.options).length === 0) {
      return {
        ok: false,
        reason: "item has no slot options; cannot be placed in a container",
      };
    }
    const containerId = slot.slice("container:".length);
    if (!world.has(containerId as never)) {
      return { ok: false, reason: `container ${containerId} does not exist` };
    }
    const cgot = world.get(containerId as never, [TbContainer]);
    if (!cgot) {
      return { ok: false, reason: `entity ${containerId} is not a container` };
    }
    // Container targets accept any item with non-empty slotOptions.
    // Cost is whatever the caller specified — the UI's pill is the
    // contract for "this is a legal way to pack this item." See
    // LMM p.84: "Carried items can be packed away, but might have
    // different inventory requirements." Capacity overfill is
    // surfaced visually, not rejected.
    return { ok: true };
  }

  if (!itemSlotOpts) {
    return { ok: false, reason: "item has no TbItemSlotOptions; cannot be equipped" };
  }
  const candidateCategories = catalogCategoriesFor(slot, channel, slotsConsumed);
  const allowedCost = pickCost(itemSlotOpts.TbItemSlotOptions.options, candidateCategories);
  if (allowedCost === undefined) {
    return {
      ok: false,
      reason: `item not allowed in slot ${slot}${channel === "default" ? "" : `/${channel}`}`,
    };
  }
  if (allowedCost !== slotsConsumed) {
    return {
      ok: false,
      reason: `slot ${slot} requires ${allowedCost} slot(s); equipped with ${slotsConsumed}`,
    };
  }
  return { ok: true };
}

/**
 * Map a canonical body slot + channel + cost to the list of catalog
 * `slotOptions` keys that could legally cover it. Tried in order;
 * the first whose cost matches `slotsConsumed` wins.
 *
 * Hand-shaped placements (`handR` / `handL` + carried / worn) map
 * to the catalog category. A carried item with `slotsConsumed=2`
 * is held two-handed (a longbow, a large sack), which the catalog
 * lists as `hands:1` *or* `carried:2`. We accept either.
 */
function catalogCategoriesFor(
  slot: string,
  channel: TbEquipChannelT,
  slotsConsumed: number,
): string[] {
  if (slot === "handR" || slot === "handL") {
    if (channel === "worn") {
      return slotsConsumed >= 2 ? ["wornHand", "hands"] : ["wornHand"];
    }
    return slotsConsumed >= 2 ? ["carried", "hands"] : ["carried"];
  }
  // Synthetic "hands" slot — two-handed placement that occupies
  // both hand panels. Catalog category depends on channel: gloves
  // list `hands:2`, large sacks list `carried:2`.
  if (slot === "hands") {
    return channel === "worn" ? ["hands", "wornHand"] : ["carried", "hands"];
  }
  return [slot];
}

function pickCost(options: Record<string, number>, categories: string[]): number | undefined {
  for (const c of categories) {
    if (options[c] !== undefined) return options[c];
  }
  return undefined;
}

/**
 * Capacity summary for one slot on one holder: how many slots are
 * already used, what the limit is, and whether placement at the
 * given `slotsConsumed` would tip it overfull. Limit is null when
 * the slot has no hard cap (pocket, etc.).
 *
 * For `container:<id>` slots, capacity comes from the container's
 * `TbContainer.containerSlots`. For body slots it comes from the
 * TB rules table (LMM p.83).
 */
export function summarizeCapacity(args: {
  world: World;
  holderId: string;
  slot: TbBodySlot | string;
  channel: TbEquipChannelT;
  excludeEntryIndex?: number;
}): {
  used: number;
  limit: number | null;
  wouldOverfill: (slotsConsumed: number) => boolean;
} {
  const { world, holderId, slot, channel, excludeEntryIndex } = args;
  let limit: number | null = null;
  let containerHolderId = holderId;
  if (slot.startsWith("container:")) {
    containerHolderId = slot.slice("container:".length);
    const cgot = world.get(containerHolderId as never, [TbContainer]) as
      | { TbContainer: { containerSlots: number } }
      | undefined;
    limit = cgot?.TbContainer.containerSlots ?? null;
  } else {
    const cap = capacityForCharacterSlot(slot, channel);
    limit = cap === undefined ? null : cap;
  }
  const used = computeUsedSlots(
    world,
    containerHolderId,
    slot,
    excludeEntryIndex,
    slot.startsWith("container:") ? undefined : channel,
  );
  return {
    used,
    limit,
    wouldOverfill: (slotsConsumed: number): boolean =>
      limit !== null && used + slotsConsumed > limit,
  };
}

/**
 * Backwards-compatible wrapper: kind-check + capacity-check rolled
 * into one. Useful for tests / pre-flight UI predicates that want
 * a single yes/no. New call sites should prefer
 * `checkPlacementKind` (validator) and `summarizeCapacity` (view)
 * separately.
 */
export function checkPlacement(req: PlacementRequest): PlacementCheck {
  const kind = checkPlacementKind(req);
  if (!kind.ok) return kind;
  const cap = summarizeCapacity({
    world: req.world,
    holderId: req.holderId,
    slot: req.slot,
    channel: req.channel,
    excludeEntryIndex: req.excludeEntryIndex,
  });
  if (cap.wouldOverfill(req.slotsConsumed)) {
    return {
      ok: false,
      reason: `slot ${req.slot} full (${cap.used}/${cap.limit}, item needs ${req.slotsConsumed})`,
    };
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
    | {
        TbCarries: {
          entries: Array<{
            slot: string;
            channel: string;
            slotsConsumed: number;
            state?: { dropped?: boolean; lost?: boolean };
          }>;
        };
      }
    | undefined;
  if (!got) return 0;
  let used = 0;
  got.TbCarries.entries.forEach((e, idx) => {
    if (idx === excludeEntryIndex) return;
    // Dropped or lost entries don't actually occupy a slot — they
    // sit in the On the Ground / Missing zones with no body
    // presence. A backpack that was at torso slot 0 but is now
    // dropped shouldn't keep eating those torso slots.
    if (e.state?.dropped || e.state?.lost) return;
    // "loose:<n>" is a synthetic staging slot for items the
    // character holds without a body placement; it never costs
    // body capacity.
    if (e.slot.startsWith("loose:")) return;
    const channelMatches = channel ? e.channel === channel || e.channel === "default" : true;
    if (!channelMatches) return;
    if (e.slot === slot) {
      used += e.slotsConsumed;
      return;
    }
    // A two-handed entry (slot="hands") consumes one slot on each
    // hand. When summing capacity for handR or handL, count the
    // "hands" entry as +1 — not its full slotsConsumed (the catalog
    // cost of 2 represents both hands together; we split it 1+1).
    if (e.slot === "hands" && (slot === "handR" || slot === "handL")) {
      used += 1;
    }
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
export function nextSlotIndex(world: World, holderId: string, slot: string): number {
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
