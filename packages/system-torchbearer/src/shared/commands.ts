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

import {
  defineCommand,
  EntityId,
  fail,
  z,
} from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { requireWrite } from "@vtt/permissions/shared";
import {
  Character,
  PendingRoll,
  PendingRollContributed,
  type Contribution,
} from "@vtt/characters/shared";
import { Formula, RolledBy } from "@vtt/resolution/shared";
import { isKnownSkillId, getSkill } from "./skills.js";
import {
  AdvancementLogged as AdvancementLoggedTrait,
  CharacterTraits,
  RawAbilities,
  SkillImprovementOpportunity,
  SkillLearningOpportunity,
  Skills,
  TownAbilities,
  TraitUsageLogged as TraitUsageLoggedTrait,
} from "./traits.js";
import {
  AdvancementLogged,
  SkillImproved,
  SkillImprovementOpened,
  SkillLearned,
  SkillLearningOpened,
  TraitUsageLogged,
} from "./events.js";
import { TbRollMetaSchema, type TbRollModifier, type TbRollSpec } from "./roll-spec.js";
import {
  TB_MODIFIER_CONTRIB_KIND,
  versusFromContributions,
} from "./roll-modifiers.js";

/**
 * Maximum skill rating in Torchbearer. The standard sheet's bubble row
 * caps at 6 (DH p.249); the trait schema enforces the same.
 */
const SKILL_MAX_RATING = 6;

/**
 * Pure helper — duplicated in the kit for the UI's bubble-count
 * derivation. Kept inline here so the command's validator doesn't pull
 * the client kit into the shared bundle. Formula from DH p.108:
 *   - rating ≤ 1 → advance after 1P (and 0F is required).
 *   - rating ≥ 2 → advance after `rating` passes and `rating - 1` fails.
 */
function computeAdvancement(rating: number): { passNeeded: number; failNeeded: number } {
  if (rating <= 1) return { passNeeded: 1, failNeeded: 0 };
  return { passNeeded: rating, failNeeded: rating - 1 };
}

interface SkillEntryShape {
  rating: number;
  advancement: { pass: number; fail: number };
}

/**
 * Read the current skill entry for `(characterId, skillId)` if the
 * character has a Skills trait and the entry exists. Pulled out so
 * both validators share one path-and-cast.
 */
function readSkillEntry(
  world: import("@vtt/substrate").World,
  characterId: string,
  skillId: string,
): SkillEntryShape | undefined {
  const got = world.get(characterId as EntityId, [Skills]) as
    | { Skills: { entries: Record<string, SkillEntryShape> } }
    | undefined;
  if (!got) return undefined;
  return got.Skills.entries[skillId];
}

/**
 * True when `entry`'s pass/fail counts have reached the rule's
 * thresholds for its current rating (DH p.108) and the rating is below
 * the max. Pulled out so OpenSkillImprovement and ImproveSkill share
 * one definition of "ready to advance."
 */
function isTrackFull(entry: SkillEntryShape): boolean {
  if (entry.rating >= SKILL_MAX_RATING) return false;
  const need = computeAdvancement(entry.rating);
  return entry.advancement.pass >= need.passNeeded
    && entry.advancement.fail >= need.failNeeded;
}

/**
 * Editor-gated: post a "ready to improve" chat opportunity for a skill
 * whose advancement track has just filled.
 *
 * Dispatched by the sheet client when an editor's click on a P/F
 * advancement dot brings the track to threshold. The validator
 * re-checks the track on the server (so a malicious client can't open
 * an opportunity for a track that isn't actually full) and dedups
 * against existing opportunity entities for the same character + skill
 * so two editors viewing the same sheet don't both post when one of
 * them flips the last bubble.
 */
export const OpenSkillImprovement = defineCommand({
  name: "@vtt/system-torchbearer/OpenSkillImprovement",
  schema: z.object({
    characterId: EntityId,
    skillId: z.string().min(1).max(60),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`character ${ctx.cmd.characterId} does not exist`);
    }
    if (!ctx.world.get(ctx.cmd.characterId, [Character])) {
      return fail(`entity ${ctx.cmd.characterId} is not a character`);
    }
    if (!isKnownSkillId(ctx.cmd.skillId)) {
      return fail(`unknown skill: ${ctx.cmd.skillId}`);
    }
    const entry = readSkillEntry(ctx.world, ctx.cmd.characterId, ctx.cmd.skillId);
    if (!entry) {
      return fail(`character has no entry for skill ${ctx.cmd.skillId}`);
    }
    if (!isTrackFull(entry)) {
      return fail(`advancement track for ${ctx.cmd.skillId} is not full`);
    }
    // Server-side dedup so two editors viewing the same sheet don't
    // both spawn an opportunity row when one flips the last bubble.
    const open = ctx.world.query([SkillImprovementOpportunity]).find((row) => {
      const v = row.values.SkillImprovementOpportunity as {
        characterId: string;
        skillId: string;
      };
      return v.characterId === ctx.cmd.characterId && v.skillId === ctx.cmd.skillId;
    });
    if (open) {
      return fail(
        `opportunity already open for ${ctx.cmd.characterId}/${ctx.cmd.skillId}`,
      );
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd, world }) => [
    SkillImprovementOpened({
      characterId: cmd.characterId,
      skillId: cmd.skillId,
      opportunityId: world.allocateId(),
      openedAt: Date.now(),
    }),
  ],
});

/**
 * Editor-gated: advance a skill from rating R to R+1.
 *
 * Validates the same DH p.108 thresholds `OpenSkillImprovement` checks,
 * so dispatching `ImproveSkill` directly (e.g. via the sheet's improve
 * arrow) works without going through the chat opportunity flow first.
 *
 * Apply emits `SkillImproved`. The universal-mirror
 * `SkillImprovedSystem` bumps the rating, zeroes the P/F tracks, and
 * despawns any matching opportunity entities so the chat-rail prompt
 * disappears once the click has been honoured.
 */
export const ImproveSkill = defineCommand({
  name: "@vtt/system-torchbearer/ImproveSkill",
  schema: z.object({
    characterId: EntityId,
    skillId: z.string().min(1).max(60),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`character ${ctx.cmd.characterId} does not exist`);
    }
    if (!ctx.world.get(ctx.cmd.characterId, [Character])) {
      return fail(`entity ${ctx.cmd.characterId} is not a character`);
    }
    if (!isKnownSkillId(ctx.cmd.skillId)) {
      return fail(`unknown skill: ${ctx.cmd.skillId}`);
    }
    const entry = readSkillEntry(ctx.world, ctx.cmd.characterId, ctx.cmd.skillId);
    if (!entry) {
      return fail(`character has no entry for skill ${ctx.cmd.skillId}`);
    }
    if (entry.rating >= SKILL_MAX_RATING) {
      return fail(`skill ${ctx.cmd.skillId} is already at the max rating`);
    }
    const need = computeAdvancement(entry.rating);
    if (entry.advancement.pass < need.passNeeded) {
      return fail(
        `pass track not full: ${entry.advancement.pass} of ${need.passNeeded}`,
      );
    }
    if (entry.advancement.fail < need.failNeeded) {
      return fail(
        `fail track not full: ${entry.advancement.fail} of ${need.failNeeded}`,
      );
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [
    SkillImproved({
      characterId: cmd.characterId,
      skillId: cmd.skillId,
      improvedAt: Date.now(),
    }),
  ],
});

/**
 * Editor-gated: post a "ready to learn" chat opportunity for a
 * skill whose Beginner's Luck learning track has just filled to
 * max Nature (DH p.75).
 *
 * Mirrors `OpenSkillImprovement`: the validator re-checks the
 * thresholds on the server (so a malicious client can't open an
 * opportunity for a skill that isn't actually ready), and dedups
 * against existing `SkillLearningOpportunity` entities so two
 * editors viewing the same sheet don't double-post.
 */
export const OpenSkillLearning = defineCommand({
  name: "@vtt/system-torchbearer/OpenSkillLearning",
  schema: z.object({
    characterId: EntityId,
    skillId: z.string().min(1).max(60),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`character ${ctx.cmd.characterId} does not exist`);
    }
    if (!ctx.world.get(ctx.cmd.characterId, [Character])) {
      return fail(`entity ${ctx.cmd.characterId} is not a character`);
    }
    if (!isKnownSkillId(ctx.cmd.skillId)) {
      return fail(`unknown skill: ${ctx.cmd.skillId}`);
    }
    const sk = ctx.world.get(ctx.cmd.characterId, [Skills]) as
      | {
          Skills: {
            entries: Record<
              string,
              { rating: number; learningTests: number }
            >;
          };
        }
      | undefined;
    if (!sk) return fail(`character has no skills`);
    const entry = sk.Skills.entries[ctx.cmd.skillId];
    if (!entry) {
      return fail(`character has no entry for skill ${ctx.cmd.skillId}`);
    }
    if (entry.rating !== 0) {
      return fail(`skill ${ctx.cmd.skillId} is already learned`);
    }
    const ab = ctx.world.get(ctx.cmd.characterId, [RawAbilities]) as
      | { RawAbilities: { nature: { rating: number; maximum: number } } }
      | undefined;
    const threshold = Math.max(
      ab?.RawAbilities.nature.maximum ?? 0,
      ab?.RawAbilities.nature.rating ?? 0,
    );
    if (threshold <= 0) {
      return fail(`character has no Nature rating to learn against`);
    }
    if (entry.learningTests < threshold) {
      return fail(
        `learning track for ${ctx.cmd.skillId} is not full: ${entry.learningTests} of ${threshold}`,
      );
    }
    const open = ctx.world.query([SkillLearningOpportunity]).find((row) => {
      const v = row.values.SkillLearningOpportunity as {
        characterId: string;
        skillId: string;
      };
      return v.characterId === ctx.cmd.characterId && v.skillId === ctx.cmd.skillId;
    });
    if (open) {
      return fail(
        `learning opportunity already open for ${ctx.cmd.characterId}/${ctx.cmd.skillId}`,
      );
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd, world }) => [
    SkillLearningOpened({
      characterId: cmd.characterId,
      skillId: cmd.skillId,
      opportunityId: world.allocateId(),
      openedAt: Date.now(),
    }),
  ],
});

/**
 * Editor-gated: commit the rating bump from rating 0 to rating 2 on
 * a skill whose Beginner's Luck learning track is full (DH p.75).
 *
 * Mirrors `ImproveSkill`. Validates server-side that the track is
 * still full and the rating is still 0; the universal-mirror
 * `SkillLearnedSystem` does the actual rating bump and despawns
 * any matching `SkillLearningOpportunity` rows.
 */
export const LearnSkill = defineCommand({
  name: "@vtt/system-torchbearer/LearnSkill",
  schema: z.object({
    characterId: EntityId,
    skillId: z.string().min(1).max(60),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`character ${ctx.cmd.characterId} does not exist`);
    }
    if (!ctx.world.get(ctx.cmd.characterId, [Character])) {
      return fail(`entity ${ctx.cmd.characterId} is not a character`);
    }
    if (!isKnownSkillId(ctx.cmd.skillId)) {
      return fail(`unknown skill: ${ctx.cmd.skillId}`);
    }
    const sk = ctx.world.get(ctx.cmd.characterId, [Skills]) as
      | {
          Skills: {
            entries: Record<
              string,
              { rating: number; learningTests: number }
            >;
          };
        }
      | undefined;
    if (!sk) return fail(`character has no skills`);
    const entry = sk.Skills.entries[ctx.cmd.skillId];
    if (!entry) {
      return fail(`character has no entry for skill ${ctx.cmd.skillId}`);
    }
    if (entry.rating !== 0) {
      return fail(`skill ${ctx.cmd.skillId} is already learned`);
    }
    const ab = ctx.world.get(ctx.cmd.characterId, [RawAbilities]) as
      | { RawAbilities: { nature: { rating: number; maximum: number } } }
      | undefined;
    const threshold = Math.max(
      ab?.RawAbilities.nature.maximum ?? 0,
      ab?.RawAbilities.nature.rating ?? 0,
    );
    if (threshold <= 0) {
      return fail(`character has no Nature rating to learn against`);
    }
    if (entry.learningTests < threshold) {
      return fail(
        `learning track for ${ctx.cmd.skillId} is not full: ${entry.learningTests} of ${threshold}`,
      );
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [
    SkillLearned({
      characterId: cmd.characterId,
      skillId: cmd.skillId,
      learnedAt: Date.now(),
    }),
  ],
});

/**
 * Player / GM-gated: log a pass or fail against the appropriate
 * advancement track for a TB roll already in the chat timeline.
 *
 * Resolution priority (validate-time):
 *
 *   - The Roll entity's `Formula.meta` must decode to a TB spec —
 *     non-TB rolls have no advance-able semantics here.
 *   - `spec.kind` must be `"ability"`, `"town-ability"`, `"skill"`,
 *     or `"skill-bl"`. Versus rolls fall under their own kind on the
 *     compute side; the spec preserves that. Disposition rolls
 *     (`spec.dispositionMode === true`) don't generate advancement
 *     under TB rules and are rejected.
 *   - The character (`spec.sourceId` resolves against
 *     `RolledBy.speakingAsCharacterId`) must still exist and own
 *     the matching trait.
 *   - The Roll must not already carry an `AdvancementLogged` trait.
 *
 * skill-bl rolls log to the skill (not the underlying ability) for
 * v1 — TB's "BL pass marks the ability, BL fail marks the skill" is
 * a future split.
 */
const ADVANCE_ABILITY_IDS = new Set(["will", "health", "nature"]);
const ADVANCE_TOWN_ABILITY_IDS = new Set(["resources", "circles"]);

interface AdvanceTarget {
  kind: "ability" | "town-ability" | "skill" | "skill-bl";
  id: string;
  label: string;
}

/**
 * Map a TB spec to the advancement target that a log click writes
 * against. Returns `null` when the spec isn't advance-able (e.g.
 * dispositionMode, missing sourceId, unknown ability id).
 *
 * `skill-bl` rolls map to a distinct target kind so the system can
 * route them to the per-skill `learningTests` counter rather than
 * the standard advancement track (DH p.75 — BL doesn't advance
 * Will / Health, and pass / fail doesn't matter for learning).
 */
function targetFromSpec(spec: TbRollSpec): AdvanceTarget | null {
  if (spec.dispositionMode) return null;
  const sid = spec.sourceId;
  if (!sid) return null;
  if (spec.kind === "ability" && ADVANCE_ABILITY_IDS.has(sid)) {
    return { kind: "ability", id: sid, label: spec.source };
  }
  if (spec.kind === "town-ability" && ADVANCE_TOWN_ABILITY_IDS.has(sid)) {
    return { kind: "town-ability", id: sid, label: spec.source };
  }
  if (spec.kind === "skill") {
    if (!isKnownSkillId(sid)) return null;
    const skill = getSkill(sid);
    return { kind: "skill", id: sid, label: skill?.name ?? sid };
  }
  if (spec.kind === "skill-bl") {
    if (!isKnownSkillId(sid)) return null;
    const skill = getSkill(sid);
    return { kind: "skill-bl", id: sid, label: skill?.name ?? sid };
  }
  return null;
}

export const LogAdvancement = defineCommand({
  name: "@vtt/system-torchbearer/LogAdvancement",
  schema: z.object({
    rollId: EntityId,
    outcome: z.enum(["pass", "fail"]),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.rollId)) {
      return fail(`roll ${ctx.cmd.rollId} does not exist`);
    }
    const formula = ctx.world.get(ctx.cmd.rollId, [Formula]) as
      | { Formula: { meta?: unknown } }
      | undefined;
    if (!formula) return fail(`roll ${ctx.cmd.rollId} has no formula`);
    const parsed = TbRollMetaSchema.safeParse(formula.Formula.meta);
    if (!parsed.success) {
      return fail(`roll ${ctx.cmd.rollId} is not a torchbearer roll`);
    }
    const spec = parsed.data.spec;
    const target = targetFromSpec(spec);
    if (!target) {
      return fail(
        `roll ${ctx.cmd.rollId} (kind=${spec.kind}) is not advance-able`,
      );
    }
    const already = ctx.world.get(ctx.cmd.rollId, [AdvancementLoggedTrait]);
    if (already) {
      return fail(`advancement already logged for roll ${ctx.cmd.rollId}`);
    }
    const rolledBy = ctx.world.get(ctx.cmd.rollId, [RolledBy]) as
      | { RolledBy: { speakingAsCharacterId?: string } }
      | undefined;
    const characterId = rolledBy?.RolledBy.speakingAsCharacterId;
    if (!characterId) {
      return fail(`roll ${ctx.cmd.rollId} has no character to advance`);
    }
    if (!ctx.world.has(characterId as EntityId)) {
      return fail(`character ${characterId} does not exist`);
    }
    if (!ctx.world.get(characterId as EntityId, [Character])) {
      return fail(`entity ${characterId} is not a character`);
    }
    if (target.kind === "ability") {
      const got = ctx.world.get(characterId as EntityId, [RawAbilities]);
      if (!got) return fail(`character ${characterId} has no abilities`);
    } else if (target.kind === "town-ability") {
      const got = ctx.world.get(characterId as EntityId, [TownAbilities]);
      if (!got) return fail(`character ${characterId} has no town abilities`);
    } else {
      const got = ctx.world.get(characterId as EntityId, [Skills]) as
        | { Skills: { entries: Record<string, unknown> } }
        | undefined;
      if (!got) return fail(`character ${characterId} has no skills`);
      if (!got.Skills.entries[target.id]) {
        return fail(
          `character ${characterId} has no entry for skill ${target.id}`,
        );
      }
    }
    return requireWrite(ctx, characterId as EntityId);
  },
  apply: ({ cmd, world }) => {
    const formula = world.get(cmd.rollId, [Formula]) as
      | { Formula: { meta?: unknown } }
      | undefined;
    const parsed = TbRollMetaSchema.safeParse(formula?.Formula.meta);
    // validate already confirmed both, but TS doesn't know that.
    if (!parsed.success) return [];
    const target = targetFromSpec(parsed.data.spec);
    if (!target) return [];
    const rb = world.get(cmd.rollId, [RolledBy]) as
      | { RolledBy: { speakingAsCharacterId?: string } }
      | undefined;
    const characterId = rb?.RolledBy.speakingAsCharacterId;
    if (!characterId) return [];
    return [
      AdvancementLogged({
        rollId: cmd.rollId,
        characterId: characterId as EntityId,
        target,
        outcome: cmd.outcome,
        loggedAt: Date.now(),
      }),
    ];
  },
});

/* -------------------------------------------------------------------------
 * UseTraitOnRoll — invoke a Character Trait on a pending roll
 * -------------------------------------------------------------------------
 *
 * Stamps a `tb-modifier` contribution onto the pending roll so the
 * dice / success effect lands at commit time. The character-sheet
 * side-effect (consume a beneficial use, or earn checks) is
 * **deferred** — see `LogTraitUsage` — so cancelling or redoing a
 * roll never strands the player having to un-mark their sheet.
 *
 * Each contribution carries a structured `providedBy` of the form
 * `"trait:<index>:<direction>[:<severity>]"`, so the chat card on
 * the resolved Roll can later parse it to know which trait the player
 * used and surface the matching "Log" button.
 *
 * Severity for "against self" (DH p.80 "Earning Checks"):
 *   - `"minus-1d"`     — −1D on your own roll, +1 check
 *   - `"plus-2d-opp"`  — +2D added to the opponent's pending roll in
 *                        a versus pairing, +2 checks. Requires that
 *                        the pending roll be paired (versus id present
 *                        in opts or contributions) and the opponent's
 *                        pending roll still be open.
 *   - `"break-tie"`    — post-roll mechanic, queued for a follow-up.
 *
 * Per DH p.81 ("once per test, for or against"), only one trait may
 * touch any given pending roll. The validator rejects a second trait
 * use on the same roll. For `plus-2d-opp` we also stamp a zero-value
 * marker contribution onto the *user's own* pending roll so the
 * one-trait check still triggers there — the player can't add +2D
 * to the opponent and then also add +1D to their own roll.
 */
const TraitAgainstSeverity = z.enum(["minus-1d", "plus-2d-opp"]);

export const UseTraitOnRoll = defineCommand({
  name: "@vtt/system-torchbearer/UseTraitOnRoll",
  schema: z.object({
    pendingRollId: EntityId,
    characterId: EntityId,
    traitIndex: z.number().int().min(0).max(20),
    direction: z.enum(["for", "against"]),
    severity: TraitAgainstSeverity.optional(),
  }),
  validate: (ctx) => {
    const auth = requireSession(ctx);
    if (!auth) return fail("not authenticated");

    if (ctx.cmd.direction === "against" && ctx.cmd.severity === undefined) {
      return fail("severity is required when direction === 'against'");
    }

    if (!ctx.world.has(ctx.cmd.pendingRollId)) {
      return fail(`pending roll ${ctx.cmd.pendingRollId} does not exist`);
    }
    const pr = ctx.world.get(ctx.cmd.pendingRollId, [PendingRoll]) as
      | { PendingRoll: { contributions: ReadonlyArray<Contribution> } }
      | undefined;
    if (!pr) {
      return fail(
        `entity ${ctx.cmd.pendingRollId} is not a pending roll`,
      );
    }

    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`character ${ctx.cmd.characterId} does not exist`);
    }
    if (!ctx.world.get(ctx.cmd.characterId, [Character])) {
      return fail(`entity ${ctx.cmd.characterId} is not a character`);
    }
    const ct = ctx.world.get(ctx.cmd.characterId, [CharacterTraits]) as
      | {
          CharacterTraits: {
            entries: ReadonlyArray<{
              name: string;
              level: number;
              beneficialUses: number;
              checks: number;
              usedAgainst?: boolean;
            }>;
          };
        }
      | undefined;
    const entry = ct?.CharacterTraits.entries[ctx.cmd.traitIndex];
    if (!entry) {
      return fail(
        `character ${ctx.cmd.characterId} has no trait at index ${ctx.cmd.traitIndex}`,
      );
    }

    if (ctx.cmd.direction === "for") {
      // Lv3 traits have no per-session cap (DH p.79 "+1s on each
      // tied or passed test"). Lv1/2 are capped at level uses.
      if (entry.level < 3 && entry.beneficialUses >= entry.level) {
        return fail(
          `trait "${entry.name}" has used all ${entry.level} beneficial uses this session`,
        );
      }
    } else {
      // DH p.80: each trait can be used against yourself only once per
      // session. The flag auto-flips when the against-self use is
      // logged on a chat card; the player resets it manually at session
      // boundaries via the traits table checkbox.
      if (entry.usedAgainst === true) {
        return fail(
          `trait "${entry.name}" has already been used against yourself this session (DH p.80)`,
        );
      }
    }

    // DH p.81: one trait per test, for or against. If the pending roll
    // already carries a trait-sourced modifier, reject.
    for (const c of pr.PendingRoll.contributions) {
      if (c.kind !== TB_MODIFIER_CONTRIB_KIND) continue;
      const mod = c.payload as { source?: string } | undefined;
      if (mod?.source === "trait") {
        return fail(
          `pending roll ${ctx.cmd.pendingRollId} already has a trait modifier (DH p.81: one trait per test)`,
        );
      }
    }

    // "+2D opp" requires an open versus pairing; resolve the opponent's
    // pending roll up front and reject if missing. We also need the
    // opponent's roll to not already carry a trait modifier (a
    // separate "one trait per test" check on their side).
    if (ctx.cmd.direction === "against" && ctx.cmd.severity === "plus-2d-opp") {
      const ourVersusId = resolveVersusId(
        pr.PendingRoll.contributions,
        ctx.world.get(ctx.cmd.pendingRollId, [PendingRoll]) as
          | { PendingRoll: { opts: unknown } }
          | undefined,
      );
      if (!ourVersusId) {
        return fail(
          `+2D-to-opponent requires a versus pairing — pair this roll with an opponent first (DH p.80)`,
        );
      }
      const opp = findOpponentPendingRoll(
        ctx.world,
        ctx.cmd.pendingRollId,
        ourVersusId,
      );
      if (!opp) {
        return fail(
          `versus opponent for ${ctx.cmd.pendingRollId} is not open — they may have committed or cancelled`,
        );
      }
      for (const c of opp.contributions) {
        if (c.kind !== TB_MODIFIER_CONTRIB_KIND) continue;
        const mod = c.payload as { source?: string } | undefined;
        if (mod?.source === "trait") {
          return fail(
            `opponent's pending roll already has a trait modifier (DH p.81)`,
          );
        }
      }
    }

    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: (ctx) => {
    const cmd = ctx.cmd;
    const ct = ctx.world.get(cmd.characterId, [CharacterTraits]) as
      | {
          CharacterTraits: {
            entries: ReadonlyArray<{
              name: string;
              level: number;
              beneficialUses: number;
              checks: number;
            }>;
          };
        }
      | undefined;
    const entry = ct?.CharacterTraits.entries[cmd.traitIndex];
    if (!entry) return [];

    const auth = requireSession(ctx);
    const fromUserId = auth?.userId ?? "";

    const events: ReturnType<typeof PendingRollContributed>[] = [];

    if (cmd.direction === "against" && cmd.severity === "plus-2d-opp") {
      // Cross-roll path: the +2D lands on the OPPONENT's pending roll;
      // a marker contribution lands on ours so the one-trait-per-test
      // rule still triggers on subsequent attempts to add another trait
      // to our own roll.
      const ourPr = ctx.world.get(cmd.pendingRollId, [PendingRoll]) as
        | { PendingRoll: { contributions: ReadonlyArray<Contribution>; opts: unknown } }
        | undefined;
      const ourVersusId = resolveVersusId(
        ourPr?.PendingRoll.contributions ?? [],
        ourPr,
      );
      const opp = ourVersusId
        ? findOpponentPendingRoll(ctx.world, cmd.pendingRollId, ourVersusId)
        : null;
      if (!opp) return [];

      const oppMod = buildTraitOppModifier(entry);
      events.push(
        PendingRollContributed({
          pendingRollId: opp.id as Parameters<
            typeof PendingRollContributed
          >[0]["pendingRollId"],
          contribution: {
            kind: TB_MODIFIER_CONTRIB_KIND,
            label: `Trait against (opp): ${entry.name}`,
            fromUserId,
            fromCharacterId: cmd.characterId,
            payload: oppMod,
          },
        }),
      );
      const marker = buildTraitMarker(entry, cmd.traitIndex);
      events.push(
        PendingRollContributed({
          pendingRollId: cmd.pendingRollId,
          contribution: {
            kind: TB_MODIFIER_CONTRIB_KIND,
            label: `Trait against: ${entry.name} (+2D to opponent)`,
            fromUserId,
            fromCharacterId: cmd.characterId,
            payload: marker,
          },
        }),
      );
    } else {
      // "for self" or "against self" with -1D: single contribution on
      // our own pending roll.
      const modifier: TbRollModifier = buildTraitModifier(
        entry,
        cmd.traitIndex,
        cmd.direction,
        cmd.severity,
      );
      events.push(
        PendingRollContributed({
          pendingRollId: cmd.pendingRollId,
          contribution: {
            kind: TB_MODIFIER_CONTRIB_KIND,
            label:
              cmd.direction === "for"
                ? `Trait: ${entry.name}`
                : `Trait against: ${entry.name}`,
            fromUserId,
            fromCharacterId: cmd.characterId,
            payload: modifier,
          },
        }),
      );
    }

    return events;
  },
});

/**
 * Resolve the live versus id for a pending roll. Last-wins on
 * `tb-versus` contributions, falling back to `opts.versusTestId`,
 * matching how the rollable's compute resolves the same priority.
 */
function resolveVersusId(
  contributions: ReadonlyArray<Contribution>,
  pr: { PendingRoll: { opts: unknown } } | undefined,
): string | null {
  const fromContrib = versusFromContributions(contributions);
  if (fromContrib === null) return null;
  if (typeof fromContrib === "string") return fromContrib;
  const optsVersus = (pr?.PendingRoll.opts as { versusTestId?: unknown })
    ?.versusTestId;
  return typeof optsVersus === "string" ? optsVersus : null;
}

/**
 * Find the opponent's pending roll for a versus pairing. Returns
 * `{ id, contributions }` of the matched pending roll (so callers can
 * inspect its contributions without re-reading), or null if no peer
 * is paired with the given versus id.
 */
function findOpponentPendingRoll(
  world: Parameters<typeof requireWrite>[0]["world"],
  ourPendingRollId: string,
  ourVersusId: string,
): { id: string; contributions: ReadonlyArray<Contribution> } | null {
  for (const row of world.query([PendingRoll])) {
    if (row.id === ourPendingRollId) continue;
    const v = row.values.PendingRoll as {
      contributions: ReadonlyArray<Contribution>;
      opts: unknown;
    };
    const peerVersus = resolveVersusId(v.contributions, {
      PendingRoll: { opts: v.opts },
    });
    if (peerVersus === ourVersusId) {
      return { id: row.id, contributions: v.contributions };
    }
  }
  return null;
}

/**
 * Encode the trait usage info into the modifier's `providedBy` so the
 * chat card on the resolved Roll can parse out the trait info to drive
 * the "Log" button. For Lv3 "for self" we *omit* `providedBy` since
 * there's nothing to log (no per-session cap) — this is what gates the
 * chat card's button visibility.
 */
function traitProvidedBy(
  traitIndex: number,
  direction: "for" | "against",
  severity: "minus-1d" | "plus-2d-opp" | undefined,
): string {
  if (direction === "for") return `trait:${traitIndex}:for`;
  return `trait:${traitIndex}:against:${severity}`;
}

function buildTraitModifier(
  entry: { name: string; level: number },
  traitIndex: number,
  direction: "for" | "against",
  severity: "minus-1d" | "plus-2d-opp" | undefined,
): TbRollModifier {
  const id = `trait:${entry.name}:${direction}:${severity ?? "any"}:${Date.now().toString(36)}`;
  if (direction === "for") {
    if (entry.level >= 3) {
      // Lv3: +1s on every appropriate passed/tied test (DH p.79).
      // Modeled as +1 success "on-success"; ties are an approximation
      // until the resolution layer surfaces them as a distinct apply
      // mode. Cosmetic in chat; mechanical at apply-time.
      // No `providedBy` — Lv3 has no per-session cap, nothing to log.
      return {
        id,
        kind: "success",
        value: 1,
        label: `Trait: ${entry.name} (+1s)`,
        apply: "on-success",
        source: "trait",
      };
    }
    return {
      id,
      kind: "dice",
      value: 1,
      label: `Trait: ${entry.name} (+1D)`,
      apply: "always",
      source: "trait",
      providedBy: traitProvidedBy(traitIndex, "for", undefined),
    };
  }
  // direction === "against", severity === "minus-1d"
  return {
    id,
    kind: "dice",
    value: -1,
    label: `Trait against: ${entry.name} (−1D)`,
    apply: "always",
    source: "trait",
    providedBy: traitProvidedBy(traitIndex, "against", "minus-1d"),
  };
}

/**
 * The +2D modifier landing on the **opponent's** pending roll for the
 * `plus-2d-opp` against-self path. Same `source: "trait"` so the
 * opponent's "one trait per test" check sees it. No `providedBy` —
 * the opponent didn't use a trait, so their chat card has no log
 * button for this row.
 */
function buildTraitOppModifier(
  entry: { name: string; level: number },
): TbRollModifier {
  return {
    id: `trait:opp:${entry.name}:${Date.now().toString(36)}`,
    kind: "dice",
    value: 2,
    label: `Trait against: ${entry.name} (+2D from opponent)`,
    apply: "always",
    source: "trait",
  };
}

/**
 * Zero-value marker landing on the user's own pending roll when they
 * use `plus-2d-opp` — the actual +2D affects the opponent, but we
 * still need a `source: "trait"` contribution on this roll so the
 * one-trait-per-test rule blocks them from stacking another trait
 * onto their own roll. The `providedBy` encodes the trait info so the
 * chat card can later show the "Log +2 checks" button.
 */
function buildTraitMarker(
  entry: { name: string; level: number },
  traitIndex: number,
): TbRollModifier {
  return {
    id: `trait:self-marker:${entry.name}:${Date.now().toString(36)}`,
    kind: "dice",
    value: 0,
    label: `Trait against: ${entry.name} (+2D to opponent — applied)`,
    apply: "always",
    source: "trait",
    providedBy: traitProvidedBy(traitIndex, "against", "plus-2d-opp"),
  };
}

/* -------------------------------------------------------------------------
 * LogTraitUsage — apply the trait's sheet side-effect post-roll
 * -------------------------------------------------------------------------
 *
 * Mirrors `LogAdvancement`: the player clicks "Log" on the chat card
 * after a roll resolves; this command bumps `beneficialUses` (Lv1/2
 * "for self") or `checks` (1 for −1D self, 2 for +2D opponent).
 *
 * The roll's `Formula.meta.spec.modifiers` carries a `source: "trait"`
 * modifier with `providedBy = "trait:<index>:<direction>[:<severity>]"`
 * — the validator parses that to recover what to log. If no parsable
 * trait modifier is on the roll, the command rejects.
 *
 * `TraitUsageLogged` trait is attached to the roll on success so the
 * chat-card button hides; re-clicking is a no-op.
 */
export const LogTraitUsage = defineCommand({
  name: "@vtt/system-torchbearer/LogTraitUsage",
  schema: z.object({
    rollId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.rollId)) {
      return fail(`roll ${ctx.cmd.rollId} does not exist`);
    }
    const formula = ctx.world.get(ctx.cmd.rollId, [Formula]) as
      | { Formula: { meta?: unknown } }
      | undefined;
    if (!formula) return fail(`roll ${ctx.cmd.rollId} has no formula`);
    const parsed = TbRollMetaSchema.safeParse(formula.Formula.meta);
    if (!parsed.success) {
      return fail(`roll ${ctx.cmd.rollId} is not a torchbearer roll`);
    }
    const usage = traitUsageFromSpec(parsed.data.spec);
    if (!usage) {
      return fail(
        `roll ${ctx.cmd.rollId} has no trait usage to log`,
      );
    }
    if (ctx.world.get(ctx.cmd.rollId, [TraitUsageLoggedTrait])) {
      return fail(`trait usage already logged for roll ${ctx.cmd.rollId}`);
    }
    const rolledBy = ctx.world.get(ctx.cmd.rollId, [RolledBy]) as
      | { RolledBy: { speakingAsCharacterId?: string } }
      | undefined;
    const characterId = rolledBy?.RolledBy.speakingAsCharacterId;
    if (!characterId) {
      return fail(`roll ${ctx.cmd.rollId} has no character to mark`);
    }
    if (!ctx.world.has(characterId as EntityId)) {
      return fail(`character ${characterId} does not exist`);
    }
    if (!ctx.world.get(characterId as EntityId, [Character])) {
      return fail(`entity ${characterId} is not a character`);
    }
    const ct = ctx.world.get(characterId as EntityId, [CharacterTraits]) as
      | {
          CharacterTraits: {
            entries: ReadonlyArray<{
              name: string;
              level: number;
              beneficialUses: number;
              checks: number;
            }>;
          };
        }
      | undefined;
    const entry = ct?.CharacterTraits.entries[usage.traitIndex];
    if (!entry) {
      return fail(
        `character ${characterId} no longer has a trait at index ${usage.traitIndex}`,
      );
    }
    return requireWrite(ctx, characterId as EntityId);
  },
  apply: ({ cmd, world }) => {
    const formula = world.get(cmd.rollId, [Formula]) as
      | { Formula: { meta?: unknown } }
      | undefined;
    const parsed = TbRollMetaSchema.safeParse(formula?.Formula.meta);
    if (!parsed.success) return [];
    const usage = traitUsageFromSpec(parsed.data.spec);
    if (!usage) return [];
    const rolledBy = world.get(cmd.rollId, [RolledBy]) as
      | { RolledBy: { speakingAsCharacterId?: string } }
      | undefined;
    const characterId = rolledBy?.RolledBy.speakingAsCharacterId;
    if (!characterId) return [];
    return [
      TraitUsageLogged({
        rollId: cmd.rollId,
        characterId: characterId as EntityId,
        traitIndex: usage.traitIndex,
        direction: usage.direction,
        severity: usage.severity,
        loggedAt: Date.now(),
      }),
    ];
  },
});

interface TraitUsageInfo {
  traitIndex: number;
  direction: "for" | "against";
  severity?: "minus-1d" | "plus-2d-opp";
}

/**
 * Locate the structured trait modifier on a resolved spec and parse
 * its `providedBy` payload into `{traitIndex, direction, severity}`.
 * Returns null when no log-eligible trait usage is present (Lv3
 * "for self" intentionally omits `providedBy`, so its rolls don't
 * surface a log button).
 */
export function traitUsageFromSpec(spec: TbRollSpec): TraitUsageInfo | null {
  for (const m of spec.modifiers) {
    if (m.source !== "trait") continue;
    const parsed = parseTraitProvidedBy(m.providedBy);
    if (parsed) return parsed;
  }
  return null;
}

function parseTraitProvidedBy(
  providedBy: string | undefined,
): TraitUsageInfo | null {
  if (!providedBy) return null;
  // `trait:<index>:for`
  // `trait:<index>:against:<severity>`
  const parts = providedBy.split(":");
  if (parts[0] !== "trait" || parts.length < 3) return null;
  const idx = Number.parseInt(parts[1] ?? "", 10);
  if (!Number.isInteger(idx) || idx < 0) return null;
  const dir = parts[2];
  if (dir === "for") return { traitIndex: idx, direction: "for" };
  if (dir === "against") {
    const sev = parts[3];
    if (sev === "minus-1d" || sev === "plus-2d-opp") {
      return { traitIndex: idx, direction: "against", severity: sev };
    }
  }
  return null;
}
