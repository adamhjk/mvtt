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

import { z } from "@vtt/substrate";

/**
 * The Torchbearer 2e body-slot vocabulary, modelling the rules in
 * TB2 Lore Master's Manual p.83. Six worn locations + the per-hand
 * carried-vs-worn distinction + pocket. Plus an opaque
 * `container:<itemId>` slot used when an item is held *inside*
 * another item (a backpack, sack, pouch, quiver, chest).
 *
 * Capacity (when the slot is on a Character):
 *   head       1 worn
 *   neck       1 worn
 *   handR-worn / handL-worn   1 each
 *   handR-carried / handL-carried 1 each
 *   torso      3
 *   belt       3
 *   feet       1
 *   pocket     descriptive only — capacity not enforced
 *
 * "Pack" in the rules is *the contents of a backpack worn on the
 * torso* — not a separate body location. The data model captures
 * this with `slot: "container:<backpackId>"` once a backpack has
 * been equipped to torso.
 *
 * Catalog `slotOptions` use the **base** slot names: `head`,
 * `torso`, `belt`, etc. Items that allow either hand use both
 * `handR` and `handL`. The "worn vs carried" axis on hands is
 * resolved at equip time — a worn-only item (signet ring) goes
 * into the worn channel, a carried-only item (sword) into carried,
 * and an item that allows both (cloak listed as "carried 1 or
 * pack 2") picks at equip time.
 */
export const TB_BODY_SLOTS = [
  "head",
  "neck",
  "handR",
  "handL",
  "torso",
  "belt",
  "feet",
  "pocket",
  // Catalog-vocabulary aliases (the foundry data uses these names
  // directly as slotOptions keys; we keep them in the type so
  // schemas accept them, then map to canonical at validation time):
  "carried",
  "wornHand",
  "hands",
  "pouch",
  "quiver",
  "pack",
] as const;

export type TbBodySlot = (typeof TB_BODY_SLOTS)[number];

/**
 * Schema validator for a TB body-slot string. Accepts any base slot
 * vocabulary name OR the dynamic `container:<entityId>` form.
 */
export const TbBodySlotSchema = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (s) => {
      if (s.startsWith("container:")) return s.length > "container:".length;
      return (TB_BODY_SLOTS as ReadonlyArray<string>).includes(s);
    },
    { message: "expected a TB body slot or 'container:<id>'" },
  );

/**
 * Equip-channel: which axis of the body slot a multi-axis location
 * uses. For hands this is "worn" (rings, gauntlets) vs "carried"
 * (swords, sacks). Other slots default to a single channel.
 */
export const TbEquipChannel = z.enum(["worn", "carried", "default"]).default("default");
export type TbEquipChannelT = z.infer<typeof TbEquipChannel>;

/**
 * Capacity table for a Character's body slots, mirroring the rules
 * tables. Pocket is descriptive — the rules don't put a hard limit,
 * so we don't enforce one. Hand capacity is per-channel: 1 worn +
 * 1 carried per hand, totalling 2 worn (the rings) + 2 carried
 * (sword+shield), with `wield: 2` weapons consuming both carried
 * slots.
 *
 * `container:<id>` capacity comes from the container item's
 * TbContainer.containerSlots; that's resolved separately at equip
 * validation time.
 */
export const TB_CHARACTER_SLOT_CAPACITY: Record<
  Exclude<TbBodySlot, "pack" | "carried" | "wornHand" | "hands" | "pouch" | "quiver" | "pocket">,
  number
> = {
  head: 1,
  neck: 1,
  handR: 2, // 1 worn + 1 carried
  handL: 2, // 1 worn + 1 carried
  torso: 3,
  belt: 3,
  feet: 1,
};
