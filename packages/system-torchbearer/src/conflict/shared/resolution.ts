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

import { EntityId, z } from "@vtt/substrate";
import { ConflictActionEnum } from "./actions.js";

/**
 * One slot of a script. The conflict surface is a *facilitation*
 * tool, not a resolution engine — players roll dice on their own
 * character sheets. Reveal flips a slot from `filled` (own-side
 * only) to `revealed` (everyone), with the same payload either way.
 * No resolution, no effects, no auto-applied damage.
 */
export const ScriptSlotSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("empty"),
  }),
  z.object({
    status: z.literal("filled"),
    action: ConflictActionEnum,
    /**
     * The TbConflictParticipant entity performing this slot. Distinct
     * from `performerCharacterId` so the script can disambiguate two
     * copies of the same character — "Goblin 2 attacks" vs
     * "Goblin 3 feints". The UI reads `participant.label` for the
     * display name; chat row attribution stays at the character level
     * (the user's call — see scope notes).
     */
    performerParticipantEntityId: EntityId,
    performerCharacterId: EntityId,
    weaponItemId: EntityId.nullable(),
  }),
  z.object({
    status: z.literal("revealed"),
    action: ConflictActionEnum,
    performerParticipantEntityId: EntityId,
    performerCharacterId: EntityId,
    weaponItemId: EntityId.nullable(),
  }),
]);
export type ScriptSlot = z.infer<typeof ScriptSlotSchema>;

/**
 * Wire-side helper: scrub a `filled` slot to `empty` when sending to
 * an out-of-side recipient. The substrate's per-recipient event
 * filter uses this so the opposing side sees only "the captain has
 * filled three slots, but you can't see what they are".
 */
export function scrubSlot(slot: ScriptSlot): ScriptSlot {
  if (slot.status === "filled") return { status: "empty" };
  return slot;
}
