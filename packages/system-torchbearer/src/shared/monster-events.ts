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
import { ConflictTypeEnum } from "../conflict/shared/conflict-types.js";

const MonstrousActionBonus = z.object({
  type: z.enum(["dice", "rerolls", "success"]),
  value: z.number().int(),
});

/**
 * A monster entity was created from a catalog template (or ad-hoc by
 * the GM). `monsterId` is server-allocated in the command's `apply`
 * and embedded here so every recipient spawns the entity at the same
 * id without per-side counter prediction.
 *
 * `armorItemId` is the server-resolved entity id of the catalog armor
 * item the monster equips (e.g. the world's Byrnie entity for a
 * Vampire Lord). `null` ⇒ no armor entry (the spawn system skips
 * adding TbCarries for a monster with no equipped armor).
 *
 * Carries every monster-trait field inline so the spawning system can
 * populate the entity in one step. Future "edit a monster field"
 * flows go through SetField + CharacterFieldSet, same as PCs.
 */
export const MonsterCreated = defineEvent({
  name: "@vtt/system-torchbearer/MonsterCreated",
  schema: z.object({
    monsterId: EntityId,
    /** Catalog templateId, or null for ad-hoc GM-created monsters. */
    templateId: z.string().min(1).max(240).nullable(),
    name: z.string().min(1).max(120),
    type: z.string().min(1).max(40),
    instinct: z.string().max(280),
    armorDescription: z.string().max(240),
    nature: z.object({
      rating: z.number().int().min(0).max(20),
      descriptors: z.array(z.string().min(1).max(40)).max(8),
    }),
    might: z.number().int().min(0).max(8),
    precedence: z.number().int().min(0).max(10),
    dispositions: z
      .array(
        z.object({
          conflictType: ConflictTypeEnum,
          value: z.number().int().min(0).max(60),
        }),
      )
      .max(8),
    weapons: z
      .array(
        z.object({
          name: z.string().min(1).max(60),
          conflicts: z.array(ConflictTypeEnum).max(8),
          bonuses: z.object({
            attack: MonstrousActionBonus,
            defend: MonstrousActionBonus,
            feint: MonstrousActionBonus,
            maneuver: MonstrousActionBonus,
          }),
        }),
      )
      .max(20),
    /**
     * Server-allocated entity ids for the spawned monster-weapon
     * items, in lockstep with `weapons`. The mirror system spawns
     * each at its matching id with `ItemIdentity + TbWeapon +
     * TbConflictResource{kind:"weapon"}` so the conflict weapon
     * picker surfaces them like any other resource.
     */
    weaponItemIds: z.array(EntityId).max(20),
    specialRules: z
      .array(
        z.object({
          name: z.string().min(1).max(80),
          text: z.string().max(2000),
        }),
      )
      .max(20),
    /**
     * Catalog armor entity id resolved at command-apply time, or null
     * for monsters with no equipped armor. The mirror system equips
     * this onto TbCarries.
     */
    armorItemId: EntityId.nullable(),
    createdByUserId: z.string().min(1),
  }),
});

/** A monster was removed (despawned). Mirrors CharacterRemoved. */
export const MonsterRemoved = defineEvent({
  name: "@vtt/system-torchbearer/MonsterRemoved",
  schema: z.object({
    monsterId: EntityId,
  }),
});
