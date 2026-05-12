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

import type { EntityId, World } from "@vtt/substrate";
import { ItemIdentity } from "@vtt/items/shared";
import { TbItemSlotOptions } from "../items/item-traits.js";

/**
 * Peel an authored wiki-link string (`"[[item:e485|Mace]]"`,
 * `"[[item:Sword]]"`, `"item:Sword"`, or even just `"Sword"`) down to
 * the resolvable body. The wiki-link grammar lives in `@vtt/notes` —
 * we re-implement the small subset we need here so this stays
 * dependency-light. Returns the body string suitable for
 * `resolveItemId`.
 */
export function peelWikiLink(raw: string): string {
  let body = raw.trim();
  // Strip leading `!` (embed marker — irrelevant for carries).
  if (body.startsWith("!")) body = body.slice(1);
  // Strip surrounding `[[…]]`.
  if (body.startsWith("[[") && body.endsWith("]]")) {
    body = body.slice(2, -2).trim();
  }
  // Strip `|alias` — alias is display-only.
  const pipeIdx = body.indexOf("|");
  if (pipeIdx >= 0) body = body.slice(0, pipeIdx).trim();
  // Strip `#anchor` — anchor is sub-target within the entity, not
  // relevant for an item reference.
  const hashIdx = body.indexOf("#");
  if (hashIdx >= 0) body = body.slice(0, hashIdx).trim();
  // Strip `item:` kind prefix (only "item" is meaningful here).
  if (body.toLowerCase().startsWith("item:")) {
    body = body.slice("item:".length).trim();
  }
  return body;
}

/**
 * Resolve an item reference body to a live `ItemIdentity`-bearing
 * entity id. Matches the resolution policy of `itemLinkKind`:
 *   1. If body looks like an entity id and the world has it as an
 *      item, use it.
 *   2. Else fall back to case-insensitive name match against
 *      `ItemIdentity.name`. First match wins.
 *
 * Returns null when nothing matches. Callers either log + skip the
 * entry or surface the error to the GM.
 */
export function resolveItemId(body: string, world: World): EntityId | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return null;
  if (world.has(trimmed as EntityId)) {
    const got = world.get(trimmed as EntityId, [ItemIdentity]);
    if (got) return trimmed as EntityId;
  }
  const needle = trimmed.toLowerCase();
  for (const row of world.query([ItemIdentity])) {
    const v = row.values.ItemIdentity as { name: string };
    if (v.name.toLowerCase() === needle) return row.id;
  }
  return null;
}

/**
 * Pick a body slot for an item when the author didn't specify one.
 * Walks `TbItemSlotOptions.options` (the placements the catalog item
 * allows) and returns the first preference, expanding the `hand`
 * shorthand into `handR`.
 *
 * Returns null when the item carries no slot options — caller can
 * then default to `loose:0` (the inventory "Loose" pile).
 */
export function defaultSlotForItem(itemId: EntityId, world: World): string | null {
  const opts = world.get(itemId, [TbItemSlotOptions]) as
    | { TbItemSlotOptions: { options: Record<string, number> } }
    | undefined;
  if (!opts) return null;
  const keys = Object.keys(opts.TbItemSlotOptions.options);
  if (keys.length === 0) return null;
  // Stable preference order: head, neck, handR, handL, torso, belt,
  // feet, pocket — picks the most "important" worn location first.
  // For an item that fits in multiple slots the author can always
  // override.
  const preference = [
    "handR",
    "handL",
    "torso",
    "head",
    "neck",
    "belt",
    "feet",
    "pocket",
  ];
  for (const slot of preference) {
    if (slot in opts.TbItemSlotOptions.options) return slot;
  }
  return keys[0] ?? null;
}

/**
 * Resolve the `slotsConsumed` cost for an item placed in `slot`.
 * Reads from the item's `TbItemSlotOptions.options[slot]`. Falls back
 * to 1 (the dominant default) when the slot isn't enumerated — e.g.
 * the GM put a sword in a slot the catalog didn't list, which we
 * permit; the equip UI would have asked.
 */
export function slotsConsumedFor(
  itemId: EntityId,
  slot: string,
  world: World,
): number {
  const opts = world.get(itemId, [TbItemSlotOptions]) as
    | { TbItemSlotOptions: { options: Record<string, number> } }
    | undefined;
  if (!opts) return 1;
  const cost = opts.TbItemSlotOptions.options[slot];
  return typeof cost === "number" && cost > 0 ? cost : 1;
}

/**
 * Equip channel for a slot. Hand slots distinguish worn (rings,
 * gauntlets) vs carried (weapons, shields). Everything else uses
 * "default". Mirrors the policy in `NpcSpawningSystem` so a
 * block-authored character ends up in TbCarries the same way as a
 * GM-spawned NPC from the catalog UI.
 */
export function channelFor(slot: string): "default" | "carried" | "worn" {
  if (slot === "handR" || slot === "handL") return "carried";
  return "default";
}
