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
import { ItemIdentity } from "@vtt/items/shared";
import { MonsterCreated, MonsterRemoved } from "../shared/monster-events.js";
import {
  TbConflictResource,
  TbMonster,
  TbMonsterDerivedFrom,
  TbMonsterSpecialRules,
  TbMonsterWeapons,
} from "../shared/monster-traits.js";
import {
  Conditions,
  Heroic,
  RawAbilities,
  TownAbilities,
} from "../shared/traits.js";
import {
  TbCarries,
  TbItemSlotOptions,
  TbWeapon,
} from "../shared/items/item-traits.js";

/**
 * Universal-mirror spawn system for monster entities. Spawns at the
 * server-allocated id from the event so every recipient (server +
 * each client) ends up with the same entity id — no per-side counter
 * prediction.
 *
 * The trait set is intentionally a superset of "Character + the bits
 * an existing TB character carries":
 *   - Character: name. Reused so the chat composer's "speak as", the
 *     sheet route, and any existing character-aware code work.
 *   - Team{enemy}: monsters are antagonists; the Team trait drives
 *     conflict-side partition + per-team disposition penalties.
 *   - Permissions: GM-only write — players can't edit the monster catalog.
 *     Read remains gmOnly to start (the catalog is GM-private until
 *     a creature is encountered; the GM lifts read restrictions per
 *     instance when revealing). Adjustable via SetPermissions.
 *   - RawAbilities + TownAbilities: NatureCheck and Might tests just
 *     work — the existing rolling machinery doesn't need a parallel
 *     "monster nature" rollable. Will/Health/Resources/Circles are
 *     set to 0 (default) and not surfaced on the monster sheet.
 *   - Conditions: monsters can suffer hungry/thirsty/afraid/exhausted/
 *     injured/sick (SG p.177). The simplified effect rules are
 *     applied by display, not stored.
 *   - TbCarries: equipped armor entry resolved from the items
 *     catalog, when the template specifies one. Future GM customise
 *     flows (drop the armor, swap to plate) reuse the existing
 *     EquipItem / DropItem commands.
 *   - TbMonster + TbMonsterWeapons + TbMonsterSpecialRules: the
 *     monster-specific stat block.
 *   - TbMonsterDerivedFrom: origin tracking for re-import flows.
 */
export const MonsterSpawningSystem = defineSystem({
  name: "MonsterSpawning",
  on: MonsterCreated,
  reads: [],
  writes: [
    Character,
    Permissions,
    Team,
    Active,
    RawAbilities,
    TownAbilities,
    Conditions,
    Heroic,
    TbCarries,
    TbMonster,
    TbMonsterWeapons,
    TbMonsterSpecialRules,
    TbMonsterDerivedFrom,
    ItemIdentity,
    TbWeapon,
    TbItemSlotOptions,
    TbConflictResource,
  ],
  run: ({ event, world }) => {
    const traitFactories: Array<{ name: TraitName; value: unknown }> = [
      Character({ name: event.name }),
      Permissions({ read: gmOnly(), write: gmOnly() }),
      Team({ kind: "enemy" }),
      // Newly-spawned monsters default to inactive — the GM brings
      // them into play with the Active toggle. The conflict-declare
      // inline Spawn button auto-activates after creation so the chip
      // appears immediately for that explicit flow.
      Active({ active: false }),
      RawAbilities({
        will: { rating: 0, advancement: { pass: 0, fail: 0 } },
        health: { rating: 0, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: event.nature.rating,
          maximum: event.nature.rating,
          advancement: { pass: 0, fail: 0 },
          descriptors: [...event.nature.descriptors],
        },
      }),
      TownAbilities({
        resources: { rating: 0, advancement: { pass: 0, fail: 0 } },
        circles: { rating: 0, advancement: { pass: 0, fail: 0 } },
        precedence: event.precedence,
        might: event.might,
      }),
      // Default condition strip is "fresh: true" for PCs; monsters
      // are never fresh (SG p.177 "Monsters are never fresh — that's
      // a townsfolk thing"), so explicitly clear fresh.
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
      // list so clicking "Roll Nature" on the monster sheet resolves.
      // GMs can flip individual abilities/skills heroic per monster
      // via SetField, same as PCs.
      Heroic({ abilities: [], townAbilities: [], skills: [] }),
      TbMonster({
        type: event.type,
        instinct: event.instinct,
        armorDescription: event.armorDescription,
        dispositions: event.dispositions.map((d) => ({ ...d })),
        pageRef: event.pageRef
          ? { canonicalId: event.pageRef.canonicalId, page: event.pageRef.page }
          : null,
      }),
      TbMonsterWeapons({
        entries: event.weapons.map((w) => ({
          name: w.name,
          conflicts: [...w.conflicts],
          bonuses: {
            attack: { ...w.bonuses.attack },
            defend: { ...w.bonuses.defend },
            feint: { ...w.bonuses.feint },
            maneuver: { ...w.bonuses.maneuver },
          },
        })),
      }),
      TbMonsterSpecialRules({
        entries: event.specialRules.map((r) => ({
          name: r.name,
          text: r.text,
          pageRef: r.pageRef
            ? { canonicalId: r.pageRef.canonicalId, page: r.pageRef.page }
            : null,
        })),
      }),
    ];
    if (event.templateId) {
      traitFactories.push(
        TbMonsterDerivedFrom({
          templateId: event.templateId,
          overrides: [],
        }),
      );
    }
    // Spawn one item entity per monstrous weapon (SG p.173). Each
    // gets ItemIdentity + TbWeapon + TbConflictResource so the
    // conflict's weapon picker surfaces them like any other resource
    // — no special-case "read TbMonsterWeapons" branch in the picker.
    // We still keep the inline TbMonsterWeapons trait above so the
    // monster sheet's editor (custom rows + per-action bonus inputs)
    // stays bound to one canonical place; the spawned item entities
    // are a snapshot at create-time.
    const carryEntries: Array<{
      slot: string;
      slotIndex: number;
      channel: "default" | "carried" | "worn";
      slotsConsumed: number;
      itemId: string;
      quantity: number;
    }> = [];
    if (event.armorItemId) {
      carryEntries.push({
        slot: "torso",
        slotIndex: 0,
        channel: "default" as const,
        slotsConsumed: 1,
        itemId: event.armorItemId,
        quantity: 1,
      });
    }
    for (let i = 0; i < event.weapons.length; i += 1) {
      const w = event.weapons[i]!;
      const wid = event.weaponItemIds[i];
      if (!wid) continue;
      world.spawnAt(wid, [
        ItemIdentity({
          name: w.name,
          description: "Monstrous weapon",
          img: "",
        }),
        TbWeapon({
          wield: 1,
          conflictBonuses: {
            attack: { ...w.bonuses.attack },
            defend: { ...w.bonuses.defend },
            feint: { ...w.bonuses.feint },
            maneuver: { ...w.bonuses.maneuver },
          },
        }),
        // Empty slotOptions ⇒ not equippable to a body slot. The
        // picker reads carries; we still attach via "loose:N" so it
        // shows up as the monster's natural arsenal.
        TbItemSlotOptions({ options: {} }),
        TbConflictResource({
          applicableConflicts: [...w.conflicts],
          kind: "weapon",
          // No paraphrased rules text — the conflict UI renders a
          // `<BookCitation>` against `pageRef` instead. Empty string
          // keeps the WeaponRow's specialText fallback a no-op so
          // the cell stays clean.
          note: "",
          // Stamp the lord-of-this-claw publicly so the shared
          // "Conflict Weapons" reference can exclude it without
          // peeking at the monster's GM-only `TbCarries`.
          ownerCharacterId: event.monsterId,
          // Inherit the monster's stat-block pageRef so each weapon
          // deep-links to the same printed page as the parent (the
          // weapon table sits inside the monster's stat block).
          pageRef: event.pageRef
            ? { canonicalId: event.pageRef.canonicalId, page: event.pageRef.page }
            : null,
        }),
      ]);
      carryEntries.push({
        slot: `loose:${i}`,
        slotIndex: 0,
        channel: "default" as const,
        // Minimum slotsConsumed is 1; "loose" slots aren't body-
        // capacity-checked so the value is informational only.
        slotsConsumed: 1,
        itemId: wid,
        quantity: 1,
      });
    }
    if (carryEntries.length > 0) {
      traitFactories.push(TbCarries({ entries: carryEntries }));
    }
    world.spawnAt(event.monsterId, traitFactories);
    return [];
  },
});

/**
 * Universal mirror: despawn a monster on MonsterRemoved. Every trait
 * on the entity goes away in lockstep. Conflict-participant entities
 * referencing the monster aren't auto-cleaned — the conflict subsystem
 * surfaces "participant references a missing entity" gracefully (the
 * conflict UI hides them) and the GM can clear stale rows by ending
 * the conflict.
 */
export const MonsterRemovalSystem = defineSystem({
  name: "MonsterRemoval",
  on: MonsterRemoved,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.monsterId)) {
      world.despawn(event.monsterId);
    }
    return [];
  },
});
