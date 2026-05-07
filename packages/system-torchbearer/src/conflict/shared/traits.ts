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

import { defineTrait, EntityId, z } from "@vtt/substrate";
import { ConflictActionEnum } from "./actions.js";
import { ConflictTypeEnum } from "./conflict-types.js";
import { ConflictSideEnum } from "./sides.js";
import { ScriptSlotSchema } from "./resolution.js";

/**
 * Revealed slot payload — what each side picked, mirrored onto the
 * conflict sentinel so it's readable by everyone (the per-side
 * `TbConflictScript` is permission-restricted, but reveals are
 * public). `null` until that slot is revealed.
 */
const RevealedSlotEntrySchema = z
  .object({
    partyAction: ConflictActionEnum,
    partyPerformerCharacterId: EntityId,
    partyWeaponItemId: EntityId.nullable(),
    enemyAction: ConflictActionEnum,
    enemyPerformerCharacterId: EntityId,
    enemyWeaponItemId: EntityId.nullable(),
  })
  .nullable();

export type RevealedSlotEntry = z.infer<typeof RevealedSlotEntrySchema>;

/**
 * The conflict sentinel itself — one entity per active conflict,
 * holding the type, captain, round counter, reveal index, and the
 * dispo scoreboard. No phase state machine: the table can do
 * anything at any time. `winner` flips non-null when a side's dispo
 * hits 0; the compromise UI surfaces from there. `endedAt` flips
 * non-null when the GM ends the conflict — that's the only
 * read-only sentinel.
 *
 * `revealedSlots` is a length-3 tuple mirroring this round's reveals.
 * The script entities themselves are permission-scoped (party-side
 * actors can read the party script + GM; only the GM reads the
 * enemy script), so revealed contents are mirrored here, on the
 * publicly-readable conflict sentinel, so every client sees them.
 */
export const TbConflict = defineTrait({
  name: "@vtt/system-torchbearer/TbConflict",
  schema: z.object({
    type: ConflictTypeEnum,
    locationLabel: z.string().max(120).default(""),
    captainCharacterId: EntityId,
    gmUserId: z.string(),
    round: z.number().int().min(1).default(1),
    revealIndex: z.number().int().min(0).max(3).default(0),
    /**
     * Public mirror of each side's script-locked status. The script
     * entities themselves are read-restricted (a player can't read
     * the enemy script), so this is how non-GM viewers know "enemy
     * has locked their script". Updated by ScriptLocked/Unlocked
     * systems.
     */
    partyLocked: z.boolean().default(false),
    enemyLocked: z.boolean().default(false),
    revealedSlots: z
      .tuple([
        RevealedSlotEntrySchema,
        RevealedSlotEntrySchema,
        RevealedSlotEntrySchema,
      ])
      .default([null, null, null]),
    dispoParty: z.object({
      current: z.number().int().min(0),
      max: z.number().int().min(0),
    }),
    dispoEnemy: z.object({
      current: z.number().int().min(0),
      max: z.number().int().min(0),
    }),
    /** Set when a side's dispo hits 0. Non-null = compromise time. */
    winner: z.enum(["party", "enemy", "tied"]).nullable().default(null),
    /** Wall-clock ms when the GM called `EndConflict`. Read-only after. */
    endedAt: z.number().int().nullable().default(null),
  }),
});

/**
 * One per PC or NPC in a conflict. Only conflict-local state lives
 * here — HP this round, knocked-out flag. Everything else (name,
 * conditions, equipped items, abilities, skills) is read **live**
 * from the bound `characterId`'s own traits, so the conflict panel
 * reacts when the underlying character changes.
 */
export const TbConflictParticipant = defineTrait({
  name: "@vtt/system-torchbearer/TbConflictParticipant",
  schema: z.object({
    conflictId: EntityId,
    side: ConflictSideEnum,
    characterId: EntityId,
    hp: z.number().int().min(0),
    hpMax: z.number().int().min(0),
    knockedOut: z.boolean().default(false),
  }),
});

/**
 * Which weapon a participant is wielding this round. `chosenAction`
 * is set when a weapon-with-choose-an-action (Sword, some convince
 * weapons) first locks its bonus to a specific action — sticky for
 * the rest of the conflict.
 */
export const TbConflictWeapon = defineTrait({
  name: "@vtt/system-torchbearer/TbConflictWeapon",
  schema: z.object({
    conflictId: EntityId,
    characterId: EntityId,
    weaponItemId: EntityId.nullable(),
    chosenAction: ConflictActionEnum.nullable().default(null),
  }),
});

/**
 * Per-participant armor degradation for this conflict. Pure state:
 * intact / damaged / destroyed counters per piece. Which armor item
 * is currently equipped is **not** stored here — it's read live
 * from the character's `TbCarries` trait so the panel reflects
 * picks-up and equips that happen during the fight.
 *
 * One row per (conflictId, characterId).
 */
/**
 * The locked script for one side of a round. Server-only writes
 * before lock; the substrate's per-recipient event filter scrubs
 * unrevealed slots for out-of-side recipients.
 *
 * `slots` is always length 3.
 */
export const TbConflictScript = defineTrait({
  name: "@vtt/system-torchbearer/TbConflictScript",
  schema: z.object({
    conflictId: EntityId,
    side: ConflictSideEnum,
    locked: z.boolean().default(false),
    slots: z.tuple([
      ScriptSlotSchema,
      ScriptSlotSchema,
      ScriptSlotSchema,
    ]),
  }),
});

/** All conflict traits, exported as a list for plugin manifest registration. */
export const ALL_CONFLICT_TRAITS = [
  TbConflict,
  TbConflictParticipant,
  TbConflictWeapon,
  TbConflictScript,
] as const;
