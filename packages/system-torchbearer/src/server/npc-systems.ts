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

import { defineSystem, type TraitName } from "@vtt/substrate";
import { Active, Character, Team } from "@vtt/characters/shared";
import { gmOnly, Permissions } from "@vtt/permissions/shared";
import { NpcCreated, NpcRemoved } from "../shared/npc-events.js";
import { TbNpc, TbNpcDerivedFrom } from "../shared/npc-traits.js";
import {
  CharacterTraits,
  Conditions,
  Heroic,
  Identity,
  Pools,
  RawAbilities,
  Skills,
  TownAbilities,
  WhatYouFightFor,
  Wises,
} from "../shared/traits.js";
import { TbCarries } from "../shared/items/item-traits.js";
import { ALL_SKILLS, isKnownSkillId } from "../shared/skills.js";

/**
 * Build the default `Skills.entries` record (every catalog skill at
 * rating 0) and overlay the seed entries from the spawn event. Unknown
 * skill ids are silently dropped so a re-import that shifts ids
 * doesn't crash the spawn — the GM sees the missing skill in the sheet
 * and can re-add it manually.
 *
 * Mirrors `defaultSkillsRecord()` in traits.ts; copied here rather than
 * imported because the seed step is unique to NPC spawning. Future
 * "migrate seed-skill-ids" tooling lands as a script that rewrites the
 * generated catalog.
 */
function buildSkillsRecord(
  seed: ReadonlyArray<{ skillId: string; rating: number }>,
): Record<
  string,
  {
    rating: number;
    advancement: { pass: number; fail: number };
    taxed: boolean;
    learningTests: number;
  }
> {
  const out: Record<
    string,
    {
      rating: number;
      advancement: { pass: number; fail: number };
      taxed: boolean;
      learningTests: number;
    }
  > = {};
  for (const s of ALL_SKILLS) {
    out[s.id] = {
      rating: 0,
      advancement: { pass: 0, fail: 0 },
      taxed: false,
      learningTests: 0,
    };
  }
  for (const seedEntry of seed) {
    if (!isKnownSkillId(seedEntry.skillId)) continue;
    const entry = out[seedEntry.skillId];
    if (!entry) continue;
    entry.rating = seedEntry.rating;
  }
  return out;
}

/**
 * Universal-mirror spawn system for NPC entities. Spawns at the
 * server-allocated id from the event so every recipient (server +
 * each client) ends up with the same entity id — no per-side counter
 * prediction.
 *
 * The trait set is deliberately a subset of "PC + the bits an NPC
 * actually uses":
 *   - Character: name. Reused so the chat composer's "speak as", the
 *     sheet route, and any existing character-aware code work.
 *   - Identity: stock / class / level / etc — defaults so the kit's
 *     RollableLabel doesn't crash when reading. Most fields stay
 *     empty for simplified NPCs; the GM can fill in stock for "make
 *     this denizen a dwarf".
 *   - Team{enemy}: NPCs default to enemy because the most common use
 *     in conflict declares is antagonist. The GM flips to "party"
 *     via SetField for friendly NPCs (escorts, allies). Same flow
 *     PC stat blocks have used since day one.
 *   - Permissions: GM-only write — players can't edit denizens. Read
 *     remains gmOnly to start (until a GM reveals the NPC); the GM
 *     adjusts via SetPermissions per-entity.
 *   - RawAbilities + TownAbilities: WillCheck, HealthCheck,
 *     NatureCheck, ResourcesCheck, CirclesCheck, SkillCheck just
 *     work — the existing rolling machinery doesn't need a parallel
 *     "NPC ability" rollable.
 *   - Conditions: NPCs can suffer the same condition ladder PCs do.
 *     Defaults to fresh: false (NPCs don't earn the Adventure-Phase
 *     fresh bonus the way PCs do); the GM can flip per-encounter.
 *   - Skills + Wises + CharacterTraits: NPC catalog data flows in via
 *     these existing PC-shaped traits. SkillCheck rolls these
 *     verbatim.
 *   - Heroic / Pools / WhatYouFightFor / LevelBenefits not seeded
 *     here; the trait defaults apply (empty / zero) and the simplified
 *     sheet doesn't surface them. WhatYouFightFor is included in the
 *     universal trait set anyway because some PC-aware UI reads it.
 *   - TbNpc + TbNpcDerivedFrom: NPC-specific stat block + origin.
 */
export const NpcSpawningSystem = defineSystem({
  name: "NpcSpawning",
  on: NpcCreated,
  reads: [],
  writes: [
    Character,
    Identity,
    Permissions,
    Team,
    Active,
    RawAbilities,
    TownAbilities,
    Conditions,
    Heroic,
    Pools,
    WhatYouFightFor,
    Skills,
    Wises,
    CharacterTraits,
    TbCarries,
    TbNpc,
    TbNpcDerivedFrom,
  ],
  run: ({ event, world }) => {
    const traitFactories: Array<{ name: TraitName; value: unknown }> = [
      Character({ name: event.name }),
      Identity({
        name: event.name,
        stock: "",
        class: "",
        level: 1,
        age: 20,
        home: "",
        raiment: "",
        parents: "",
        mentor: "",
        friend: "",
        enemy: "",
      }),
      Permissions({ read: gmOnly(), write: gmOnly() }),
      // Default to enemy — the most common case for NPCs in conflicts
      // is antagonists. Friendly NPCs (escorts, allies) flip to
      // "party" via SetField on the Team trait once the GM places
      // them.
      Team({ kind: "enemy" }),
      // Newly-spawned NPCs default to inactive; the GM flips them in
      // when bringing the denizen into play. Conflict-declare's
      // inline NPC-spawn auto-activates after creation so the chip
      // surfaces immediately for that explicit flow.
      Active({ active: false }),
      RawAbilities({
        will: { rating: event.will, advancement: { pass: 0, fail: 0 } },
        health: { rating: event.health, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: event.nature.rating,
          maximum: event.nature.rating,
          advancement: { pass: 0, fail: 0 },
          descriptors: [...event.nature.descriptors],
        },
      }),
      TownAbilities({
        resources: {
          rating: event.resources,
          advancement: { pass: 0, fail: 0 },
        },
        circles: {
          rating: event.circles,
          advancement: { pass: 0, fail: 0 },
        },
        precedence: event.precedence,
        might: event.might,
      }),
      // NPCs are not "fresh" — the Fresh bonus is a per-PC
      // adventure-phase mechanic (DH p.250). Clearing fresh up front
      // matches monsters and avoids surprise +1D bonuses on NPC rolls.
      Conditions({
        fresh: false,
        hungryThirsty: false,
        angry: false,
        afraid: false,
        exhausted: false,
        injured: false,
        sick: false,
        dead: false,
      }),
      // Empty Heroic — required by the NatureCheck rollable's input
      // list so clicking "Roll Nature" on the NPC sheet resolves.
      // GMs can flip individual abilities/skills heroic per NPC via
      // SetField, same as monsters.
      Heroic({ abilities: [], townAbilities: [], skills: [] }),
      Pools({
        fate: { current: 0, totalSpent: 0 },
        persona: { current: 0, totalSpent: 0 },
      }),
      WhatYouFightFor({ belief: "", creed: "", goal: "", instinct: "" }),
      Skills({ entries: buildSkillsRecord(event.skills) }),
      Wises({
        entries: event.wises.map((name) => ({
          name,
          pass: false,
          fail: false,
          fate: false,
          persona: false,
        })),
      }),
      CharacterTraits({
        entries: event.traits.map((t) => ({
          name: t.name,
          level: t.level,
          beneficialUses: 0,
          checks: 0,
          usedAgainst: false,
        })),
      }),
      TbNpc({
        role: event.role,
        description: event.description,
        pageRef: event.pageRef
          ? { canonicalId: event.pageRef.canonicalId, page: event.pageRef.page }
          : null,
      }),
    ];
    if (event.templateId) {
      traitFactories.push(
        TbNpcDerivedFrom({
          templateId: event.templateId,
          overrides: [],
        }),
      );
    }
    // Equip the resolved catalog gear onto TbCarries. Each entry
    // pairs `gearItemIds[i]` with `gearSlots[i]` (lockstep arrays —
    // see `NpcCreated`'s schema). The item entities themselves were
    // seeded by the items catalog at world boot (or earlier in this
    // command pipeline run); we're just declaring "this NPC carries
    // them", same shape as the monster spawn pipeline.
    const carryEntries: Array<{
      slot: string;
      slotIndex: number;
      channel: "default" | "carried" | "worn";
      slotsConsumed: number;
      itemId: string;
      quantity: number;
    }> = [];
    for (let i = 0; i < event.gearItemIds.length; i += 1) {
      const itemId = event.gearItemIds[i];
      const slot = event.gearSlots[i];
      if (!itemId || !slot) continue;
      // Hand slots distinguish worn (rings, gauntlets) vs carried
      // (weapons, shields). NPC catalog gear is always weapons or
      // shields when on a hand, so route hands through the
      // "carried" channel; all other slots use "default".
      const channel: "default" | "carried" =
        slot === "handR" || slot === "handL" ? "carried" : "default";
      carryEntries.push({
        slot,
        slotIndex: 0,
        channel,
        slotsConsumed: 1,
        itemId,
        quantity: 1,
      });
    }
    if (carryEntries.length > 0) {
      traitFactories.push(TbCarries({ entries: carryEntries }));
    }
    world.spawnAt(event.npcId, traitFactories);
    return [];
  },
});

/**
 * Universal mirror: despawn an NPC on NpcRemoved. Every trait on the
 * entity goes away in lockstep. Conflict-participant entities
 * referencing the NPC aren't auto-cleaned — the conflict subsystem
 * surfaces "participant references a missing entity" gracefully (the
 * conflict UI hides them) and the GM can clear stale rows by ending
 * the conflict.
 */
export const NpcRemovalSystem = defineSystem({
  name: "NpcRemoval",
  on: NpcRemoved,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.npcId)) {
      world.despawn(event.npcId);
    }
    return [];
  },
});
