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
import { ConflictActionEnum } from "./actions.js";
import { ConflictTypeEnum } from "./conflict-types.js";
import { ConflictSideEnum } from "./sides.js";

/* -------------------------------------------------------------------------
 * Lifecycle
 * ----------------------------------------------------------------------- */

export const ConflictDeclared = defineEvent({
  name: "@vtt/system-torchbearer/ConflictDeclared",
  schema: z.object({
    conflictId: EntityId,
    partyScriptEntityId: EntityId,
    enemyScriptEntityId: EntityId,
    type: ConflictTypeEnum,
    locationLabel: z.string().max(120).default(""),
    captainCharacterId: EntityId,
    gmUserId: z.string(),
    partyUserIds: z.array(z.string()),
    partyParticipants: z.array(
      z.object({
        participantEntityId: EntityId,
        characterId: EntityId,
        // Server-allocated id for the per-participant
        // TbConflictArmorState entity. Must be pre-allocated so the
        // client mirror's `spawnAt` doesn't collide with the next
        // server-allocated participant id (universal-mirror rule —
        // see CLAUDE.md "Entity ids are server-authoritative").
        armorStateEntityId: EntityId,
      }),
    ),
    enemyParticipants: z.array(
      z.object({
        participantEntityId: EntityId,
        characterId: EntityId,
        armorStateEntityId: EntityId,
      }),
    ),
  }),
});

export const CaptainElected = defineEvent({
  name: "@vtt/system-torchbearer/ConflictCaptainElected",
  schema: z.object({
    conflictId: EntityId,
    captainCharacterId: EntityId,
  }),
});

/**
 * Round counter ticked over after all 3 slots resolved. Listeners
 * use this to clear per-round modifiers, reset the script, etc.
 */
export const RoundAdvanced = defineEvent({
  name: "@vtt/system-torchbearer/ConflictRoundAdvanced",
  schema: z.object({
    conflictId: EntityId,
    round: z.number().int().min(1),
  }),
});

/* -------------------------------------------------------------------------
 * Disposition / HP
 * ----------------------------------------------------------------------- */

export const DispositionRolled = defineEvent({
  name: "@vtt/system-torchbearer/DispositionRolled",
  schema: z.object({
    conflictId: EntityId,
    side: ConflictSideEnum,
    skillId: z.string(),
    poolBefore: z.number().int(),
    diceRoll: z.array(z.number().int().min(1).max(6)),
    successes: z.number().int().min(0),
    addToBase: z.number().int().min(0),
    finalDispo: z.number().int().min(1),
    notes: z.array(z.string().max(120)).default([]),
  }),
});

export const HpAssigned = defineEvent({
  name: "@vtt/system-torchbearer/ConflictHpAssigned",
  schema: z.object({
    conflictId: EntityId,
    side: ConflictSideEnum,
    allocations: z.array(
      z.object({
        participantEntityId: EntityId,
        hp: z.number().int().min(0),
      }),
    ),
  }),
});

/**
 * Direct-edit dispo: GM types in current/max boxes. No roll, no
 * factor application — the GM is the source of truth.
 */
export const TeamDispositionSet = defineEvent({
  name: "@vtt/system-torchbearer/ConflictTeamDispositionSet",
  schema: z.object({
    conflictId: EntityId,
    side: ConflictSideEnum,
    current: z.number().int().min(0),
    max: z.number().int().min(0),
  }),
});

/**
 * Direct-edit HP for one participant. GM types into the row's input.
 */
export const ParticipantHpSet = defineEvent({
  name: "@vtt/system-torchbearer/ConflictParticipantHpSet",
  schema: z.object({
    conflictId: EntityId,
    participantEntityId: EntityId,
    hp: z.number().int().min(0),
    hpMax: z.number().int().min(0),
  }),
});

/* -------------------------------------------------------------------------
 * Weapons
 * ----------------------------------------------------------------------- */

export const ConflictWeaponChosen = defineEvent({
  name: "@vtt/system-torchbearer/ConflictWeaponChosen",
  schema: z.object({
    conflictId: EntityId,
    characterId: EntityId,
    weaponItemId: EntityId.nullable(),
  }),
});

/* -------------------------------------------------------------------------
 * Script (the secret)
 * ----------------------------------------------------------------------- */

/**
 * Side-scoped event: only the side's userIds (and the GM, who
 * bypasses) see the contents. Out-of-side players never receive it
 * and their mirror keeps the slot empty.
 */
export const ScriptSlotSet = defineEvent({
  name: "@vtt/system-torchbearer/ConflictScriptSlotSet",
  schema: z.object({
    conflictId: EntityId,
    scriptEntityId: EntityId,
    side: ConflictSideEnum,
    slotIndex: z.number().int().min(0).max(2),
    action: ConflictActionEnum,
    performerCharacterId: EntityId,
    weaponItemId: EntityId.nullable(),
  }),
});

export const ScriptSlotCleared = defineEvent({
  name: "@vtt/system-torchbearer/ConflictScriptSlotCleared",
  schema: z.object({
    conflictId: EntityId,
    scriptEntityId: EntityId,
    side: ConflictSideEnum,
    slotIndex: z.number().int().min(0).max(2),
  }),
});

/**
 * Public — everyone gets it. Tells out-of-side recipients "the other
 * side has locked their script" so the UI can show LOCKED indicator
 * even though contents are still hidden.
 */
export const ScriptLocked = defineEvent({
  name: "@vtt/system-torchbearer/ConflictScriptLocked",
  schema: z.object({
    conflictId: EntityId,
    scriptEntityId: EntityId,
    side: ConflictSideEnum,
  }),
});

/**
 * Captain (or GM) unlocked their side's script before reveal — back
 * to scripting. If both sides were locked (phase = reveal), the
 * system reverts to scripting on unlock.
 */
export const ScriptUnlocked = defineEvent({
  name: "@vtt/system-torchbearer/ConflictScriptUnlocked",
  schema: z.object({
    conflictId: EntityId,
    scriptEntityId: EntityId,
    side: ConflictSideEnum,
  }),
});

/* -------------------------------------------------------------------------
 * Reveal
 * ----------------------------------------------------------------------- */

/**
 * Public reveal — both sides' slot contents become visible. The
 * mirror system flips both sides' script slot at `slotIndex` from
 * `filled` to `revealed`. No resolution is computed; the table rolls
 * dice on character sheets and types in HP / dispo via the GM-side
 * direct-edit commands.
 */
export const SlotRevealed = defineEvent({
  name: "@vtt/system-torchbearer/ConflictSlotRevealed",
  schema: z.object({
    conflictId: EntityId,
    slotIndex: z.number().int().min(0).max(2),
    partyScriptEntityId: EntityId,
    enemyScriptEntityId: EntityId,
    partySlot: z.object({
      action: ConflictActionEnum,
      performerCharacterId: EntityId,
      weaponItemId: EntityId.nullable(),
    }),
    enemySlot: z.object({
      action: ConflictActionEnum,
      performerCharacterId: EntityId,
      weaponItemId: EntityId.nullable(),
    }),
  }),
});

/* -------------------------------------------------------------------------
 * Conflict end / compromise
 * ----------------------------------------------------------------------- */

export const ConflictEnded = defineEvent({
  name: "@vtt/system-torchbearer/ConflictEnded",
  schema: z.object({
    conflictId: EntityId,
    winner: z.enum(["party", "enemy", "tied"]),
    suggestedCompromiseLevel: z.enum(["minor", "half", "major"]).nullable(),
    endedAt: z.number().int(),
  }),
});

export const CompromiseApplied = defineEvent({
  name: "@vtt/system-torchbearer/ConflictCompromiseApplied",
  schema: z.object({
    conflictId: EntityId,
    description: z.string().max(2000),
    conditions: z.array(
      z.object({
        characterId: EntityId,
        conditionId: z.enum([
          "hungryThirsty",
          "angry",
          "afraid",
          "exhausted",
          "injured",
          "sick",
          "dead",
        ]),
      }),
    ),
  }),
});

export const ALL_CONFLICT_EVENTS = [
  ConflictDeclared,
  CaptainElected,
  RoundAdvanced,
  DispositionRolled,
  HpAssigned,
  ConflictWeaponChosen,
  ParticipantHpSet,
  ScriptSlotSet,
  TeamDispositionSet,
  ScriptSlotCleared,
  ScriptLocked,
  ScriptUnlocked,
  SlotRevealed,
  ConflictEnded,
  CompromiseApplied,
] as const;
