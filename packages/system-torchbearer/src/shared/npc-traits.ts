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

import { defineTrait, z } from "@vtt/substrate";

/**
 * Reference into a canonical TB2 rulebook (`canonicalId` + printed
 * `page`). Drives `<BookCitation>` rendering on the NPC sheet — for
 * canon NPCs the GM clicks through to the actual rulebook page rather
 * than reading prose copied into plugin data.
 */
const BookPageRef = z.object({
  canonicalId: z.string().min(1).max(120),
  page: z.number().int().min(1).max(2000),
});

/**
 * TbNpc — the "regular folk" stat block from SG "Beasts with Two Legs"
 * (pp.201–211) and the named-personality entries scattered through the
 * Loremaster's Manual / scenario chapters (e.g. Beronin SG p.262).
 * Sits alongside the universal `Character` (name) and TB's
 * `RawAbilities` / `TownAbilities` so the existing rolling machinery
 * — WillCheck, HealthCheck, NatureCheck, ResourcesCheck, CirclesCheck,
 * SkillCheck — works without a parallel NPC code path.
 *
 * Presence of this trait is the load-bearing marker for "this entity
 * is an NPC": the NPCs page provider lists by `[Character, TbNpc]`,
 * the Characters page hides anyone carrying this trait via
 * `CharacterListExclusionSlot`, and the simplified NPC sheet renders.
 *
 * NPCs differ from monsters (TbMonster) in three deliberate ways:
 *   - No per-conflict-type predetermined disposition table — NPCs roll
 *     ability + skill versus tests in conflicts like PCs do.
 *   - No Monstrous Weapons table — NPC gear lives in the free-text
 *     `gear` array (typically "leather armor, helmet, sword, dagger").
 *     Mapping every gear blurb to real catalog items would be brittle
 *     and the user-experience goal is "simplified character sheet"
 *     per the design ask.
 *   - Skills, Wises, and CharacterTraits use the existing PC traits.
 *     NPCs share the same SkillCheck rollable and Beginner's Luck
 *     fallback; rolling Fighter on a Soldier Just Works.
 *
 * `role` is the proper-noun denizen label (e.g. "Alchemist",
 * "Bandit Chief"). `description` is free-text for GM notes about
 * personality / motivation / current situation. `gear` is the printed
 * gear list — strings only, because canonical entries don't carry
 * detail beyond "leather armor, helmet, sword, dagger" and the LMM
 * Beronin entry omits even that for most folk-types.
 *
 * Regular Folks always have Might 2 (SG p.201 "their Might is always
 * 2"); the NpcSpawning system seeds Might from the catalog template
 * (which records Might 2 for every Beasts with Two Legs entry) so the
 * GM can override per-instance via the standard SetField path.
 */
export const TbNpc = defineTrait({
  name: "@vtt/system-torchbearer/TbNpc",
  schema: z.object({
    /**
     * Proper-noun denizen role from the printed catalog
     * ("Alchemist", "Bandit Chief, Dwarf"). Free-text so homebrew NPCs
     * can describe their own role.
     */
    role: z.string().min(1).max(120).default("Folk"),
    /**
     * GM-facing free-text description / situation / personality notes.
     * Empty for canon NPCs seeded from the catalog (the sheet renders
     * a `<BookCitation>` against `pageRef` instead of paraphrasing the
     * rulebook prose). Homebrew NPCs and per-game fleshing-out fill
     * this in directly.
     */
    description: z.string().max(2000).default(""),
    /**
     * Canonical-book deep-link to the printed stat block, or null for
     * homebrew NPCs with no rulebook reference. When set, the sheet
     * renders a `<BookCitation>` in the header.
     */
    pageRef: BookPageRef.nullable().default(null),
  }),
});

/**
 * TbNpcDerivedFrom — origin tracking for NPCs spawned from the
 * catalog. Lets a future re-import push upstream rule fixes onto
 * existing instances while honouring local GM edits via `overrides`.
 * Mirrors `TbMonsterDerivedFrom` exactly so the same mental model
 * carries over.
 */
export const TbNpcDerivedFrom = defineTrait({
  name: "@vtt/system-torchbearer/TbNpcDerivedFrom",
  schema: z.object({
    templateId: z.string().min(1).max(240),
    overrides: z.array(z.string().min(1).max(120)).default([]),
    deprecated: z.boolean().optional(),
  }),
});
