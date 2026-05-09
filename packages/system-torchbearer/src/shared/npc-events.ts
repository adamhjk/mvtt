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

const BookPageRef = z.object({
  canonicalId: z.string().min(1).max(120),
  page: z.number().int().min(1).max(2000),
});

/**
 * One skill seed carried by `NpcCreated`. The spawning system writes
 * these into the entity's `Skills` trait at the matching skill ids;
 * unknown ids are silently dropped (the catalog should be the source
 * of truth, but we tolerate drift across re-imports).
 */
const NpcSkillSeed = z.object({
  skillId: z.string().min(1).max(60),
  rating: z.number().int().min(0).max(6),
});

/** One CharacterTraits entry seed (TB-trait, not substrate-trait). */
const NpcTraitSeed = z.object({
  name: z.string().min(1).max(60),
  level: z.number().int().min(1).max(3),
});

/**
 * An NPC entity was created from a catalog template (or ad-hoc by the
 * GM). `npcId` is server-allocated in the command's `apply` and
 * embedded here so every recipient spawns the entity at the same id
 * without per-side counter prediction.
 *
 * Carries every NPC-trait field inline so the spawning system can
 * populate the entity in one step. Future "edit an NPC field" flows
 * go through SetField + CharacterFieldSet, same as PCs and monsters.
 */
export const NpcCreated = defineEvent({
  name: "@vtt/system-torchbearer/NpcCreated",
  schema: z.object({
    npcId: EntityId,
    /** Catalog templateId, or null for ad-hoc GM-created NPCs. */
    templateId: z.string().min(1).max(240).nullable(),
    /** Display name. For canon templates this is the proper-noun role. */
    name: z.string().min(1).max(120),
    /** Denizen role label ("Alchemist", "Bandit Chief"). */
    role: z.string().min(1).max(120),
    /** GM-facing free-text description (empty for canon templates). */
    description: z.string().max(2000),
    /**
     * Catalog item entity ids for the NPC's printed gear, resolved at
     * command-apply time against the world's `ItemCatalogIndex`. Each
     * pairs with the same-index entry in `gearSlots`. Empty when the
     * catalog template doesn't list gear, when the items catalog
     * hasn't been seeded yet (the GM can equip later via the
     * inventory UI), or when a referenced template can't be resolved.
     */
    gearItemIds: z.array(EntityId).max(20),
    /**
     * `TbCarries` slot keys for each entry in `gearItemIds`, in
     * lockstep. The spawn system uses these to populate `TbCarries`.
     */
    gearSlots: z.array(z.string().min(1).max(40)).max(20),
    /**
     * Canonical-book deep-link. Null for homebrew / ad-hoc NPCs.
     */
    pageRef: BookPageRef.nullable(),
    nature: z.object({
      rating: z.number().int().min(0).max(20),
      descriptors: z.array(z.string().min(1).max(40)).max(8),
    }),
    will: z.number().int().min(0).max(10),
    health: z.number().int().min(0).max(10),
    resources: z.number().int().min(0).max(20),
    circles: z.number().int().min(0).max(20),
    might: z.number().int().min(0).max(8),
    precedence: z.number().int().min(0).max(10),
    skills: z.array(NpcSkillSeed).max(40),
    wises: z.array(z.string().min(1).max(80)).max(20),
    traits: z.array(NpcTraitSeed).max(20),
    createdByUserId: z.string().min(1),
  }),
});

/** An NPC was removed (despawned). Mirrors MonsterRemoved. */
export const NpcRemoved = defineEvent({
  name: "@vtt/system-torchbearer/NpcRemoved",
  schema: z.object({
    npcId: EntityId,
  }),
});
