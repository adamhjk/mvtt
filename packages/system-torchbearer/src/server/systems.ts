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

import { defineSystem } from "@vtt/substrate";
import { Permissions, everyone, gmOnly } from "@vtt/permissions/shared";
import { Character, CharacterFieldSet } from "@vtt/characters/shared";
import {
  AdvancementLogged,
  PinnedRollToggled,
  SkillImproved,
  SkillImprovementOpened,
  SkillLearned,
  SkillLearningOpened,
  SpecialtySkillSet,
  TraitUsageLogged,
} from "../shared/events.js";
import {
  AdvancementLogged as AdvancementLoggedTrait,
  CharacterTraits,
  Conditions,
  PinnedRolls,
  pinnedRollKey,
  RawAbilities,
  SkillImprovementOpportunity,
  SkillLearningOpportunity,
  Skills,
  TownAbilities,
  TraitUsageLogged as TraitUsageLoggedTrait,
  type PinnedRollEntryT,
} from "../shared/traits.js";
import { getSkill } from "../shared/skills.js";

const SKILL_MAX_RATING = 6;

function computeAdvancement(rating: number): { passNeeded: number; failNeeded: number } {
  if (rating <= 1) return { passNeeded: 1, failNeeded: 0 };
  return { passNeeded: rating, failNeeded: rating - 1 };
}

/**
 * Universal mirror: spawn the chat-timeline opportunity entity at the
 * server-allocated id from the event. Names + rating are denormalised
 * onto the trait at spawn time so the chat row stays legible across
 * later renames or despawns — same pattern `MessageRecordingSystem`
 * uses for `authorName`.
 *
 * `Permissions.read` is `everyone()` so every player sees the prompt
 * (the GM might want to nudge a player who doesn't notice their own
 * track filled). `write` is `gmOnly()` since the row is server-stamped
 * and never mutated except via despawn.
 */
export const SkillImprovementOpenedSystem = defineSystem({
  name: "SkillImprovementOpened",
  on: SkillImprovementOpened,
  reads: [Character, Skills],
  writes: [SkillImprovementOpportunity, Permissions],
  run: ({ event, world }) => {
    if (world.has(event.opportunityId)) return [];
    if (!world.has(event.characterId)) return [];
    const got = world.get(event.characterId, [Skills, Character]) as
      | {
          Skills: { entries: Record<string, { rating: number }> };
          Character: { name: string };
        }
      | undefined;
    if (!got) return [];
    const entry = got.Skills.entries[event.skillId];
    if (!entry) return [];
    const skill = getSkill(event.skillId);
    const skillName = skill?.name ?? event.skillId;
    world.spawnAt(event.opportunityId, [
      SkillImprovementOpportunity({
        characterId: event.characterId,
        characterName: got.Character.name,
        skillId: event.skillId,
        skillName,
        rating: entry.rating,
        sentAt: event.openedAt,
      }),
      Permissions({ read: everyone(), write: gmOnly() }),
    ]);
    return [];
  },
});

/**
 * Universal mirror: react to `SkillImproved` by:
 *
 *   1. Bumping the skill's rating by 1 and resetting both advancement
 *      tracks to zero — the printed rule for advancement (DH p.108).
 *   2. Despawning every `SkillImprovementOpportunity` entity matching
 *      the same character + skill so the chat-rail prompt disappears
 *      now that the click has been honoured.
 *
 * Runs the same on server and client thanks to deterministic inputs:
 * the event payload + the world state both sides already mirror.
 */
export const SkillImprovedSystem = defineSystem({
  name: "SkillImproved",
  on: SkillImproved,
  reads: [Character, Skills, SkillImprovementOpportunity],
  writes: [Skills, SkillImprovementOpportunity, Permissions],
  run: ({ event, world }) => {
    if (!world.has(event.characterId)) return [];
    const got = world.get(event.characterId, [Skills]) as
      | {
          Skills: {
            entries: Record<
              string,
              {
                rating: number;
                advancement: { pass: number; fail: number };
                taxed: boolean;
                learningTests: number;
              }
            >;
          };
        }
      | undefined;
    if (!got) return [];
    const entry = got.Skills.entries[event.skillId];
    if (!entry) return [];

    // Replace the entry — trait values are atomic; build a new object
    // rather than mutating in place. Other entries are copied through
    // unchanged so unrelated skills are unaffected.
    const nextEntries = { ...got.Skills.entries };
    nextEntries[event.skillId] = {
      rating: entry.rating + 1,
      advancement: { pass: 0, fail: 0 },
      taxed: entry.taxed,
      learningTests: entry.learningTests,
    };
    world.set(event.characterId, Skills, { entries: nextEntries });

    // Sweep matching opportunities. There's normally just one, but the
    // dedup is an invariant of the open-command not the spawn system,
    // so be defensive and clear all of them.
    for (const row of world.query([SkillImprovementOpportunity])) {
      const v = row.values.SkillImprovementOpportunity as {
        characterId: string;
        skillId: string;
      };
      if (v.characterId !== event.characterId) continue;
      if (v.skillId !== event.skillId) continue;
      world.despawn(row.id);
    }
    return [];
  },
});

/**
 * Universal mirror: react to writes on `Skills` entries by re-evaluating
 * any open `SkillImprovementOpportunity` for the same character + skill.
 *
 * The chat-rail prompt should disappear if the player un-fills a P/F
 * bubble (mistake correction), bumps the rating manually past the
 * already-achieved threshold, or otherwise leaves the track in a state
 * where `ImproveSkill` would be rejected.
 *
 * Triggers off `CharacterFieldSet` rather than `world.subscribe` so it
 * runs deterministically inside the same fixpoint pass on both server
 * and client. The path filter narrows to writes that touch a skill
 * entry (rating / advancement.pass / advancement.fail / etc.) — anything
 * else is left alone.
 */
export const SkillOpportunitySweepSystem = defineSystem({
  name: "SkillOpportunitySweep",
  on: CharacterFieldSet,
  reads: [Skills, SkillImprovementOpportunity],
  writes: [SkillImprovementOpportunity],
  run: ({ event, world }) => {
    if (event.trait !== Skills.name) return [];
    if (event.path[0] !== "entries") return [];
    const skillId = event.path[1];
    if (typeof skillId !== "string") return [];
    const opp = world.query([SkillImprovementOpportunity]).find((row) => {
      const v = row.values.SkillImprovementOpportunity as {
        characterId: string;
        skillId: string;
      };
      return v.characterId === event.characterId && v.skillId === skillId;
    });
    if (!opp) return [];

    const got = world.get(event.characterId, [Skills]) as
      | {
          Skills: {
            entries: Record<
              string,
              { rating: number; advancement: { pass: number; fail: number } }
            >;
          };
        }
      | undefined;
    if (!got) {
      world.despawn(opp.id);
      return [];
    }
    const entry = got.Skills.entries[skillId];
    if (!entry) {
      world.despawn(opp.id);
      return [];
    }
    if (entry.rating >= SKILL_MAX_RATING) {
      world.despawn(opp.id);
      return [];
    }
    const need = computeAdvancement(entry.rating);
    const stillFull =
      entry.advancement.pass >= need.passNeeded && entry.advancement.fail >= need.failNeeded;
    if (!stillFull) {
      world.despawn(opp.id);
    }
    return [];
  },
});

/**
 * The non-fresh keys on the Conditions trait. When any of these
 * flips to `true`, SG p.46's "If the character suffers any other
 * condition, they are no longer fresh" rule fires.
 */
const NON_FRESH_CONDITION_KEYS = [
  "hungryThirsty",
  "angry",
  "afraid",
  "exhausted",
  "injured",
  "sick",
  "dead",
] as const;

/**
 * Universal mirror: enforce SG p.46's Fresh-cancellation rule. When
 * a CharacterFieldSet sets any non-fresh condition to `true` on a
 * character whose Conditions trait still flags `fresh: true`, emit
 * a follow-up CharacterFieldSet that clears fresh. The same generic
 * `CharacterFieldSetSystem` (registered in the characters plugin)
 * picks up the second event and applies the path edit, so the
 * Conditions trait ends up consistent with the rule without any
 * trait-mutation side-effect happening outside the event log.
 *
 * Cascades only fire on `true` writes — clearing a non-fresh
 * condition (e.g., recovering from Sick) does NOT auto-restore
 * fresh; the rule says restoration requires returning to town,
 * alleviating all conditions, restoring taxed Nature, and passing
 * lifestyle maintenance. That's a town-phase procedure, not a
 * trait-write reaction.
 *
 * Setting `fresh: true` directly is **not** intercepted here — that
 * could cascade either way (clear other conditions? clear fresh?)
 * and isn't what the rule says. The rule is one-directional:
 * "another condition appears → fresh goes away".
 */
export const FreshCancellationSystem = defineSystem({
  name: "FreshCancellation",
  on: CharacterFieldSet,
  reads: [Conditions],
  // No writes from this system directly — the emitted CharacterFieldSet
  // is processed by the characters' generic CharacterFieldSetSystem,
  // which is already declared as a Conditions writer. We only emit.
  writes: [],
  run: ({ event, world }) => {
    if (event.trait !== Conditions.name) return [];
    const key = event.path[0];
    if (typeof key !== "string") return [];
    if (!NON_FRESH_CONDITION_KEYS.includes(key as never)) return [];
    if (event.value !== true) return [];
    if (!world.has(event.characterId)) return [];
    const got = world.get(event.characterId, [Conditions]) as
      | { Conditions: { fresh: boolean } & Record<string, unknown> }
      | undefined;
    if (!got) return [];
    if (!got.Conditions.fresh) return [];
    return [
      CharacterFieldSet({
        characterId: event.characterId,
        trait: Conditions.name,
        path: ["fresh"],
        value: false,
      }),
    ];
  },
});

interface RatedEntry {
  rating: number;
  advancement: { pass: number; fail: number };
}

/**
 * Universal mirror: react to `AdvancementLogged` by:
 *
 *   1. Bumping the matching `advancement.{pass|fail}` counter on the
 *      character's `RawAbilities` / `TownAbilities` / `Skills` trait
 *      for kinds `"ability"` / `"town-ability"` / `"skill"`.
 *   2. Incrementing `learningTests` on the targeted skill entry for
 *      kind `"skill-bl"` (DH p.75 — Beginner's Luck logs learning
 *      tests, not advancement; pass / fail doesn't matter and the
 *      underlying ability is **not** advanced either). The
 *      threshold-crossing detection lives in the separate
 *      `SkillLearningSweepSystem` so the chat-rail "Learn" prompt
 *      opens the same way regardless of how the pip got filled
 *      (Log Test click, manual sheet edit, or a future automation).
 *   3. Attaching an `AdvancementLogged` trait to the Roll entity so
 *      the chat-row "Log" button hides and the same roll can't
 *      double-advance.
 *
 * Runs identically on server and clients — both sides hold the
 * required trait state by the time the event arrives.
 */
export const AdvancementLoggedSystem = defineSystem({
  name: "AdvancementLogged",
  on: AdvancementLogged,
  reads: [Character, RawAbilities, TownAbilities, Skills],
  writes: [RawAbilities, TownAbilities, Skills, AdvancementLoggedTrait, Permissions],
  run: ({ event, world }) => {
    if (!world.has(event.characterId)) return [];
    const which = event.outcome;
    if (event.target.kind === "ability") {
      const got = world.get(event.characterId, [RawAbilities]) as
        | {
            RawAbilities: {
              will: RatedEntry;
              health: RatedEntry;
              nature: RatedEntry & { maximum: number; descriptors: string[] };
            };
          }
        | undefined;
      if (got) {
        const id = event.target.id as "will" | "health" | "nature";
        const cur = got.RawAbilities[id];
        if (cur) {
          const nextAdv = {
            pass: cur.advancement.pass + (which === "pass" ? 1 : 0),
            fail: cur.advancement.fail + (which === "fail" ? 1 : 0),
          };
          if (id === "nature") {
            world.set(event.characterId, RawAbilities, {
              ...got.RawAbilities,
              nature: { ...got.RawAbilities.nature, advancement: nextAdv },
            });
          } else {
            world.set(event.characterId, RawAbilities, {
              ...got.RawAbilities,
              [id]: { ...got.RawAbilities[id], advancement: nextAdv },
            });
          }
        }
      }
    } else if (event.target.kind === "town-ability") {
      const got = world.get(event.characterId, [TownAbilities]) as
        | {
            TownAbilities: {
              resources: RatedEntry;
              circles: RatedEntry;
              precedence: number;
              might: number;
            };
          }
        | undefined;
      if (got) {
        const id = event.target.id as "resources" | "circles";
        const cur = got.TownAbilities[id];
        if (cur) {
          const nextAdv = {
            pass: cur.advancement.pass + (which === "pass" ? 1 : 0),
            fail: cur.advancement.fail + (which === "fail" ? 1 : 0),
          };
          world.set(event.characterId, TownAbilities, {
            ...got.TownAbilities,
            [id]: { ...got.TownAbilities[id], advancement: nextAdv },
          });
        }
      }
    } else if (event.target.kind === "skill-bl") {
      // BL learning: increment `learningTests`, leave advancement
      // untouched. Outcome (pass / fail) is recorded on the Roll
      // entity for audit but is rules-as-written ignored for the
      // learning count. Threshold detection / opportunity opening
      // happens in `SkillLearningSweepSystem` so the same code path
      // also fires when an editor manually clicks a learning pip.
      //
      // `learningTests` is read defensively — legacy snapshots
      // predate the field, and `world.get` returns the raw stored
      // value without re-parsing. Coerce missing / non-numeric
      // values to 0 so the increment can't synthesise a NaN that
      // would fail Zod validation on write.
      const got = world.get(event.characterId, [Skills]) as
        | {
            Skills: {
              entries: Record<string, RatedEntry & { taxed: boolean; learningTests?: number }>;
            };
          }
        | undefined;
      const entry = got?.Skills.entries[event.target.id];
      if (got && entry) {
        // Only count learning tests while the skill is unlearned —
        // a BL roll that completed before the rating bumped (race
        // between two pending logs) shouldn't continue accumulating.
        if (entry.rating === 0) {
          const cur = typeof entry.learningTests === "number" ? entry.learningTests : 0;
          const nextEntries = { ...got.Skills.entries };
          nextEntries[event.target.id] = {
            ...entry,
            learningTests: cur + 1,
          };
          world.set(event.characterId, Skills, { entries: nextEntries });
        }
      }
    } else {
      // Standard skill advancement (rating > 0).
      const got = world.get(event.characterId, [Skills]) as
        | {
            Skills: {
              entries: Record<string, RatedEntry & { taxed: boolean; learningTests: number }>;
            };
          }
        | undefined;
      const entry = got?.Skills.entries[event.target.id];
      if (got && entry) {
        const nextEntries = { ...got.Skills.entries };
        nextEntries[event.target.id] = {
          ...entry,
          advancement: {
            pass: entry.advancement.pass + (which === "pass" ? 1 : 0),
            fail: entry.advancement.fail + (which === "fail" ? 1 : 0),
          },
        };
        world.set(event.characterId, Skills, { entries: nextEntries });
      }
    }

    // Mark the Roll entity as logged. The trait is attached to the
    // existing Roll entity rather than a new spawn, so the chat row
    // re-renders with the button hidden.
    if (world.has(event.rollId)) {
      world.set(event.rollId, AdvancementLoggedTrait, {
        characterId: event.characterId,
        target: event.target,
        outcome: event.outcome,
        loggedAt: event.loggedAt,
      });
    }
    return [];
  },
});

/**
 * Universal mirror: spawn the `SkillLearningOpportunity` chat-rail
 * entity at the server-allocated `opportunityId`. Names + thresholds
 * are denormalised onto the trait at spawn time so the chat row
 * stays legible across renames or skill resets.
 *
 * Read everyone / write GM-only mirrors `SkillImprovementOpened`:
 * any player can see the prompt; only the GM can amend the row
 * directly (the `LearnSkill` flow is the only path that mutates it).
 */
export const SkillLearningOpenedSystem = defineSystem({
  name: "SkillLearningOpened",
  on: SkillLearningOpened,
  reads: [Character, RawAbilities, Skills],
  writes: [SkillLearningOpportunity, Permissions],
  run: ({ event, world }) => {
    if (world.has(event.opportunityId)) return [];
    if (!world.has(event.characterId)) return [];
    const got = world.get(event.characterId, [Skills, Character]) as
      | {
          Skills: {
            entries: Record<string, { rating: number; learningTests: number }>;
          };
          Character: { name: string };
        }
      | undefined;
    if (!got) return [];
    const entry = got.Skills.entries[event.skillId];
    if (!entry) return [];
    const skill = getSkill(event.skillId);
    world.spawnAt(event.opportunityId, [
      SkillLearningOpportunity({
        characterId: event.characterId,
        characterName: got.Character.name,
        skillId: event.skillId,
        skillName: skill?.name ?? event.skillId,
        learningTests: entry.learningTests,
        sentAt: event.openedAt,
      }),
      Permissions({ read: everyone(), write: gmOnly() }),
    ]);
    return [];
  },
});

/**
 * Universal mirror: react to `SkillLearned` (emitted by `LearnSkill`)
 * by:
 *
 *   1. Setting the targeted skill's rating from 0 to 2 (DH p.75 —
 *      "Erase the X and all the check marks toward learning it.
 *      Write 2 as the rating.").
 *   2. Resetting `learningTests` and the advancement track.
 *   3. Despawning every matching `SkillLearningOpportunity` so the
 *      chat-rail prompt disappears once the click has been honoured.
 *
 * Mirrors `SkillImprovedSystem`. Runs identically on server and
 * client thanks to deterministic inputs.
 */
export const SkillLearnedSystem = defineSystem({
  name: "SkillLearned",
  on: SkillLearned,
  reads: [Character, Skills, SkillLearningOpportunity],
  writes: [Skills, SkillLearningOpportunity, Permissions],
  run: ({ event, world }) => {
    if (!world.has(event.characterId)) return [];
    const got = world.get(event.characterId, [Skills]) as
      | {
          Skills: {
            entries: Record<string, RatedEntry & { taxed: boolean; learningTests: number }>;
          };
        }
      | undefined;
    if (got) {
      const entry = got.Skills.entries[event.skillId];
      if (entry && entry.rating === 0) {
        const nextEntries = { ...got.Skills.entries };
        nextEntries[event.skillId] = {
          ...entry,
          rating: 2,
          advancement: { pass: 0, fail: 0 },
          learningTests: 0,
        };
        world.set(event.characterId, Skills, { entries: nextEntries });
      }
    }
    for (const row of world.query([SkillLearningOpportunity])) {
      const v = row.values.SkillLearningOpportunity as {
        characterId: string;
        skillId: string;
      };
      if (v.characterId !== event.characterId) continue;
      if (v.skillId !== event.skillId) continue;
      world.despawn(row.id);
    }
    return [];
  },
});

/**
 * Universal mirror: re-evaluate any open `SkillLearningOpportunity`
 * when the underlying skill's `learningTests` count changes. Mirrors
 * `SkillOpportunitySweepSystem` — if the editor un-fills a learning
 * pip (manual sheet edit) the row should disappear; once they
 * re-fill it the chat-row sweep below re-opens it.
 *
 * Triggers off `CharacterFieldSet` writes targeting Skills entries.
 */
export const SkillLearningSweepSystem = defineSystem({
  name: "SkillLearningSweep",
  on: CharacterFieldSet,
  reads: [Skills, RawAbilities, SkillLearningOpportunity],
  writes: [SkillLearningOpportunity],
  run: ({ event, world }) => {
    if (event.trait !== Skills.name) return [];
    if (event.path[0] !== "entries") return [];
    const skillId = event.path[1];
    if (typeof skillId !== "string") return [];
    if (!world.has(event.characterId)) return [];
    const got = world.get(event.characterId, [Skills]) as
      | {
          Skills: {
            entries: Record<string, { rating: number; learningTests: number }>;
          };
        }
      | undefined;
    const ab = world.get(event.characterId, [RawAbilities]) as
      | { RawAbilities: { nature: { rating: number; maximum: number } } }
      | undefined;
    const entry = got?.Skills.entries[skillId];
    const open = world.query([SkillLearningOpportunity]).find((row) => {
      const v = row.values.SkillLearningOpportunity as {
        characterId: string;
        skillId: string;
      };
      return v.characterId === event.characterId && v.skillId === skillId;
    });
    if (!open) return [];
    if (!got || !entry) {
      world.despawn(open.id);
      return [];
    }
    if (entry.rating > 0) {
      world.despawn(open.id);
      return [];
    }
    const threshold = Math.max(
      ab?.RawAbilities.nature.maximum ?? 0,
      ab?.RawAbilities.nature.rating ?? 0,
    );
    if (threshold <= 0 || entry.learningTests < threshold) {
      world.despawn(open.id);
    }
    return [];
  },
});

/**
 * `TraitUsageLogged` is the deferred sheet-mutation half of trait
 * usage — emitted only when the player presses "Log" on a resolved
 * roll's chat card. Mirrors the `AdvancementLogged` system pattern.
 *
 * Effects (DH p.79–80):
 * - direction: "for" — bump `beneficialUses` by one (capped at the
 *   trait's level; Lv3 has no cap and never reaches this system,
 *   since `LogTraitUsage` only fires for modifiers carrying a
 *   structured `providedBy`, which Lv3 omits).
 * - direction: "against" — increment `checks` by 1 (`minus-1d`) or
 *   2 (`plus-2d-opp`) per DH p.80 "Earning Checks".
 *
 * Also attaches a `TraitUsageLogged` trait to the roll entity so the
 * chat card hides the "Log" button after the click — same dedup
 * pattern as `AdvancementLogged`.
 *
 * Defensive reads for legacy snapshots: `world.get` returns raw
 * stored values without re-parsing, so older snapshots may be missing
 * `checks` or `beneficialUses`. Coerce missing / non-numeric fields
 * to 0 before bumping.
 */
export const TraitUsageLoggedSystem = defineSystem({
  name: "TraitUsageLogged",
  on: TraitUsageLogged,
  run: ({ event, world }) => {
    // Attach the per-roll marker so the chat card hides its log button.
    if (world.has(event.rollId)) {
      world.set(event.rollId, TraitUsageLoggedTrait, {
        characterId: event.characterId,
        traitIndex: event.traitIndex,
        traitNameAtLog: (() => {
          const ct = world.get(event.characterId, [CharacterTraits]) as
            | {
                CharacterTraits: {
                  entries: ReadonlyArray<{ name: string }>;
                };
              }
            | undefined;
          const entry = ct?.CharacterTraits.entries[event.traitIndex];
          return entry?.name ?? "(trait)";
        })(),
        direction: event.direction,
        severity: event.severity,
        loggedAt: event.loggedAt,
      });
    }

    if (!world.has(event.characterId)) return [];
    const got = world.get(event.characterId, [CharacterTraits]) as
      | {
          CharacterTraits: {
            entries: ReadonlyArray<{
              name: string;
              level: number;
              beneficialUses?: number;
              checks?: number;
              usedAgainst?: boolean;
            }>;
          };
        }
      | undefined;
    if (!got) return [];
    const entries = got.CharacterTraits.entries;
    const entry = entries[event.traitIndex];
    if (!entry) return [];

    const curUses = typeof entry.beneficialUses === "number" ? entry.beneficialUses : 0;
    const curChecks = typeof entry.checks === "number" ? entry.checks : 0;
    const curUsedAgainst = entry.usedAgainst === true;

    let nextUses = curUses;
    let nextChecks = curChecks;
    let nextUsedAgainst = curUsedAgainst;
    if (event.direction === "for") {
      if (entry.level < 3) {
        nextUses = Math.min(entry.level, curUses + 1);
      }
    } else {
      const award = event.severity === "plus-2d-opp" ? 2 : 1;
      nextChecks = Math.min(20, curChecks + award);
      // DH p.80: once-per-session per trait. Flag flips on log so a
      // second against-self use is rejected by `UseTraitOnRoll`'s
      // validator; player resets it at session boundary via the
      // traits-table checkbox.
      nextUsedAgainst = true;
    }

    if (nextUses === curUses && nextChecks === curChecks && nextUsedAgainst === curUsedAgainst) {
      return [];
    }

    const nextEntries = entries.map((e, i) =>
      i === event.traitIndex
        ? {
            ...e,
            beneficialUses: nextUses,
            checks: nextChecks,
            usedAgainst: nextUsedAgainst,
          }
        : e,
    );
    world.set(event.characterId, CharacterTraits, { entries: nextEntries });
    return [];
  },
});

/**
 * Universal mirror: write the character's specialty skill onto Skills.
 * Single-select — the new value just replaces the old one. Reads the
 * current Skills trait so other fields (entries, advancement, etc.)
 * survive the update.
 */
export const SpecialtySkillSetSystem = defineSystem({
  name: "SpecialtySkillSet",
  on: SpecialtySkillSet,
  reads: [Character, Skills],
  writes: [Skills],
  run: ({ event, world }) => {
    if (!world.has(event.characterId)) return [];
    const got = world.get(event.characterId, [Skills]) as
      | {
          Skills: {
            entries: Record<
              string,
              {
                rating: number;
                advancement: { pass: number; fail: number };
                taxed: boolean;
                learningTests: number;
              }
            >;
            specialtySkillId: string | null;
          };
        }
      | undefined;
    if (!got) return [];
    if (got.Skills.specialtySkillId === event.skillId) return [];
    world.set(event.characterId, Skills, {
      entries: got.Skills.entries,
      specialtySkillId: event.skillId,
    });
    return [];
  },
});

/**
 * Universal mirror: add or remove a pinned-roll entry from PinnedRolls
 * based on the event's `pinned` flag. The command's apply already
 * resolved which way the toggle should go (against the world it saw),
 * so the system trusts that signal and computes the next array
 * directly: pin → append (after stripping any duplicate), unpin →
 * filter out by key. New characters with no PinnedRolls trait get
 * seeded from the schema default before the toggle is applied.
 */
const DEFAULT_PINNED_FOR_TOGGLE: PinnedRollEntryT[] = [
  { kind: "ability", ability: "will" },
  { kind: "ability", ability: "health" },
];

export const PinnedRollToggledSystem = defineSystem({
  name: "PinnedRollToggled",
  on: PinnedRollToggled,
  reads: [Character, PinnedRolls],
  writes: [PinnedRolls],
  run: ({ event, world }) => {
    if (!world.has(event.characterId)) return [];
    if (!world.get(event.characterId, [Character])) return [];
    const got = world.get(event.characterId, [PinnedRolls]) as
      | { PinnedRolls: { entries: PinnedRollEntryT[] } }
      | undefined;
    const current = got?.PinnedRolls.entries ?? DEFAULT_PINNED_FOR_TOGGLE;
    const targetKey = pinnedRollKey(event.entry);
    const without = current.filter((e) => pinnedRollKey(e) !== targetKey);
    const next = event.pinned ? [...without, event.entry] : without;
    if (
      next.length === current.length &&
      next.every((e, i) => pinnedRollKey(e) === pinnedRollKey(current[i]!))
    ) {
      return [];
    }
    world.set(event.characterId, PinnedRolls, { entries: next });
    return [];
  },
});
