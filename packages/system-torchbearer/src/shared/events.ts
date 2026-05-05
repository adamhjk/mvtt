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

/**
 * Emitted by `OpenSkillImprovement` once the validator confirmed the
 * advancement track was full and no opportunity row already exists for
 * this character + skill. Carries a server-allocated `opportunityId`
 * so every replica can spawn the chat-timeline opportunity entity at
 * the same id.
 *
 * The universal-mirror `SkillImprovementOpenedSystem` reads the
 * character + skill at run time to denormalise the names onto the
 * spawned trait — same pattern `MessageRecordingSystem` uses, so the
 * apply doesn't read the world.
 */
export const SkillImprovementOpened = defineEvent({
  name: "@vtt/system-torchbearer/SkillImprovementOpened",
  schema: z.object({
    characterId: EntityId,
    skillId: z.string().min(1).max(60),
    /** Allocated by the command's apply via world.allocateId(). */
    opportunityId: EntityId,
    /** Unix millis stamped by the command's apply. */
    openedAt: z.number(),
  }),
});

/**
 * Emitted by `ImproveSkill` once the validator confirmed the
 * advancement track was full. Triggers the universal-mirror
 * `SkillImprovedSystem` to bump the rating, reset the advancement
 * tracks, and despawn any matching `SkillImprovementOpportunity` rows.
 *
 * `improvedAt` is server-stamped so any downstream timeline ordering
 * (audit logs, future "level history" views) is consistent across
 * server and clients.
 */
export const SkillImproved = defineEvent({
  name: "@vtt/system-torchbearer/SkillImproved",
  schema: z.object({
    characterId: EntityId,
    skillId: z.string().min(1).max(60),
    /** Unix millis at the time the command was applied. */
    improvedAt: z.number(),
  }),
});

/**
 * Emitted by `LogAdvancement` once the validator confirmed the roll
 * was advance-able and the character still owns the targeted trait.
 *
 * Triggers the universal-mirror `AdvancementLoggedSystem` to:
 *   1. Bump the matching `advancement.pass` or `advancement.fail`
 *      counter on `RawAbilities` / `TownAbilities` / `Skills` for
 *      kinds `"ability"` / `"town-ability"` / `"skill"`.
 *   2. Increment `learningTests` on the targeted skill entry for
 *      kind `"skill-bl"` (DH p.75 — Beginner's Luck logs learning
 *      tests, not advancement; pass / fail doesn't matter and the
 *      underlying ability is **not** advanced either).
 *   3. Attach an `AdvancementLogged` trait to the Roll entity so
 *      the chat-row button hides and the same roll can't double-
 *      advance.
 *
 * `loggedAt` is server-stamped so audit ordering is consistent
 * across server and clients.
 */
export const AdvancementLogged = defineEvent({
  name: "@vtt/system-torchbearer/AdvancementLogged",
  schema: z.object({
    /** The Roll entity the advancement is being logged against. */
    rollId: EntityId,
    characterId: EntityId,
    target: z.object({
      kind: z.enum(["ability", "town-ability", "skill", "skill-bl"]),
      id: z.string().min(1).max(80),
      label: z.string().min(1).max(120),
    }),
    outcome: z.enum(["pass", "fail"]),
    /** Unix millis at the time the command was applied. */
    loggedAt: z.number(),
  }),
});

/**
 * Emitted by `OpenSkillLearning` once the validator confirmed the
 * BL learning counter (`learningTests`) is at or above the
 * character's max-Nature threshold (DH p.75 — "Once your character
 * has attempted to use that skill a number of times equal to their
 * maximum Nature rating, they learn the skill at a rating of 2.").
 *
 * Triggers the universal-mirror `SkillLearningOpenedSystem` to spawn
 * a `SkillLearningOpportunity` chat-rail entity carrying a [Learn]
 * button — same pattern as `SkillImprovementOpened`. The actual
 * rating bump only happens when the player commits via `LearnSkill`.
 */
export const SkillLearningOpened = defineEvent({
  name: "@vtt/system-torchbearer/SkillLearningOpened",
  schema: z.object({
    characterId: EntityId,
    skillId: z.string().min(1).max(60),
    /** Allocated by the command's apply via world.allocateId(). */
    opportunityId: EntityId,
    /** Unix millis stamped by the command's apply. */
    openedAt: z.number(),
  }),
});

/**
 * Emitted by `LearnSkill` once the validator confirmed the skill is
 * eligible to be learned (rating 0, learning track full). Triggers
 * the universal-mirror `SkillLearnedSystem` to:
 *
 *   1. Bump the skill's rating from 0 to 2 (DH p.75 — "Erase the X
 *      and all the check marks toward learning it. Write 2 as the
 *      rating.").
 *   2. Reset `learningTests` and the advancement track.
 *   3. Despawn any matching `SkillLearningOpportunity` entities so
 *      the chat-rail prompt disappears once the click has been
 *      honoured.
 *
 * `learnedAt` is server-stamped so audit ordering is consistent.
 */
export const SkillLearned = defineEvent({
  name: "@vtt/system-torchbearer/SkillLearned",
  schema: z.object({
    characterId: EntityId,
    skillId: z.string().min(1).max(60),
    /** Unix millis at the time the command was applied. */
    learnedAt: z.number(),
  }),
});

/* -------------------------------------------------------------------------
 * TraitUsageLogged — emitted by LogTraitUsage on a resolved Roll
 * -------------------------------------------------------------------------
 *
 * The character-sheet side-effect of using a trait is *deferred* until
 * the roll is committed and the player explicitly clicks "Log" on the
 * chat card — same pattern as `AdvancementLogged`. This keeps the
 * sheet clean if the roll is cancelled or redone: nothing on the
 * character changes until the player commits to recording it.
 *
 * Direction:
 *   - `"for"`: a beneficial use (DH p.79). At Lv1/2 this consumes one
 *     of the per-session uses; at Lv3 there is no per-session cap, so
 *     no log is needed (the chat card omits the button).
 *   - `"against"`: using the trait against yourself (DH p.80) — earn
 *     `checks` based on severity:
 *       `"minus-1d"`     — −1D on your own roll, +1 check
 *       `"plus-2d-opp"`  — +2D to opponent in a versus, +2 checks
 *
 * `traitIndex` references the entry's position in the character's
 * `CharacterTraits.entries` array at the time of the log.
 */
export const TraitUsageLogged = defineEvent({
  name: "@vtt/system-torchbearer/TraitUsageLogged",
  schema: z.object({
    rollId: EntityId,
    characterId: EntityId,
    traitIndex: z.number().int().min(0).max(20),
    direction: z.enum(["for", "against"]),
    severity: z.enum(["minus-1d", "plus-2d-opp"]).optional(),
    /** Unix millis. */
    loggedAt: z.number(),
  }),
});

/* -------------------------------------------------------------------------
 * Fate / persona spend events
 * -------------------------------------------------------------------------
 *
 * Each post-roll spend command emits one event whose name encodes the
 * spend kind. A single shared system reacts to all of them — appends
 * a ledger entry to `RollSpends`, decrements the spending pool, and
 * (for dice-affecting spends) mutates `RollResult.dice` with the
 * already-rolled outcomes carried in the event payload.
 *
 * The new dice values live on the **event**, not the command — apply
 * is forbidden from RNG, so the command's apply emits the pre-rolled
 * faces it computed via `world.rng()` and the system reacts by
 * appending or replacing in `RollResult.dice`. This keeps replay
 * deterministic.
 */

const RolledDieSchema = z.object({
  sides: z.union([z.number().int().min(2).max(100), z.literal("F")]),
  value: z.number().int(),
});

export const LuckSpent = defineEvent({
  name: "@vtt/system-torchbearer/LuckSpent",
  schema: z.object({
    rollId: EntityId,
    characterId: EntityId,
    /** Indices in RollResult.dice that triggered the reroll (showed 6). */
    rerolledIndices: z.array(z.number().int().min(0)),
    /** New dice appended to the pool, one per rerolled 6 (cascading). */
    appendedDice: z.array(RolledDieSchema),
    byUserId: z.string(),
    loggedAt: z.number(),
  }),
});

export const DeeperUnderstandingSpent = defineEvent({
  name: "@vtt/system-torchbearer/DeeperUnderstandingSpent",
  schema: z.object({
    rollId: EntityId,
    characterId: EntityId,
    wiseIndex: z.number().int().min(0).max(40),
    /** Index in RollResult.dice of the failed die that's being rerolled. */
    rerolledIndex: z.number().int().min(0),
    /** Replacement value for the rerolled die. */
    newValue: z.number().int().min(1).max(6),
    byUserId: z.string(),
    loggedAt: z.number(),
  }),
});

/**
 * Emitted by `LogSynergyAdvancement` when a helper's player clicks
 * the per-helper "Log Pass" button on a passed test (DH p.87). The
 * universal-mirror `SynergyAdvancementLoggedSystem` reacts by:
 *
 *   - appending the helper to the roll's `SynergyAdvancementLogged`
 *     marker so the button hides
 *   - emitting a fresh `AdvancementLogged` for the helper against
 *     their helped-with target (skill / ability / town-ability),
 *     which the standard `AdvancementLoggedSystem` then bumps.
 */
export const SynergyAdvancementLoggedEvent = defineEvent({
  name: "@vtt/system-torchbearer/SynergyAdvancementLogged",
  schema: z.object({
    rollId: EntityId,
    helperCharacterId: EntityId,
    target: z.object({
      kind: z.enum(["ability", "town-ability", "skill", "skill-bl"]),
      id: z.string().min(1).max(60),
      label: z.string().min(1).max(80),
    }),
    /**
     * Per SG p.87: "If the player rolling the dice passes the test,
     * the helper marks a passed test for advancement … If they fail,
     * they mark a failed test." Synergy mirrors the roller's outcome
     * on the helper's track.
     */
    outcome: z.enum(["pass", "fail"]),
    loggedAt: z.number(),
  }),
});

export const OfCourseSpent = defineEvent({
  name: "@vtt/system-torchbearer/OfCourseSpent",
  schema: z.object({
    rollId: EntityId,
    characterId: EntityId,
    wiseIndex: z.number().int().min(0).max(40),
    /** Indices of failed dice being rerolled. */
    rerolledIndices: z.array(z.number().int().min(0)),
    /** Replacement values, one per rerolledIndex (in order). */
    newValues: z.array(z.number().int().min(1).max(6)),
    byUserId: z.string(),
    loggedAt: z.number(),
  }),
});

