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

import { z } from "@vtt/substrate";

/**
 * Canonical Torchbearer rolling subsystem.
 *
 * TB rolls are pools of d6 vs a target number: by default a die is a
 * "success" if it shows 4–6 (DH p.20 "Act, Test, Result"). When the
 * roll is **heroic**, the target shifts to 3+ — every die showing
 * 3–6 counts. Heroic is a per-roll attribute, sourced either from a
 * trait the character carries (e.g. an ability or skill that has
 * become heroic via level benefits, relics, or the campaign's
 * "heroic mode" toggle), or set explicitly on a single roll via
 * `opts.heroic`. Either source flips the success target — never
 * stacking, never overriding mid-fold.
 *
 * The `pool` is built from the base ability/skill rating plus any
 * dice modifiers (`+1D`/`-1D`); the result count is the number of
 * successes plus any flat success modifiers (`+1s`).
 *
 * Modifiers come from three places:
 *
 *   1. Auto-derived in `compute()` from traits the rollable already
 *      reads (Conditions: `Injured -1D`, `Sick -1D`, `Fresh +1D`).
 *      Always applied; the player can't toggle them off without
 *      mutating the underlying trait.
 *
 *   2. Pending-roll contributions (Help, traits, wises, items, free-form)
 *      added in the panel before commit. Each is encoded as a
 *      `Contribution` with `kind: "tb-modifier"` and a `payload` that
 *      matches `TbRollModifier`.
 *
 *   3. (Future) Ambient providers — anything in the world (an item, a
 *      magic effect, a weather condition) can register a fill into
 *      `TbRollModifierProvidersSlot` so the panel can offer one-click
 *      togglable modifiers without the panel knowing about every
 *      possible source up-front. Stub for now — the slot is declared
 *      but no machinery consumes it yet.
 *
 * Conditional success modifiers (`apply: "on-success" | "on-fail"`)
 * are recorded in the spec but NOT folded into the pool/notation, so
 * they can be applied post-roll once the win/lose state is known.
 * The chat row reads them out of `Formula.meta` and shows the player
 * the adjusted total in addition to the raw success count.
 *
 * The notation is the rules-as-written formula: `Nd6>=T` where `T`
 * is 4 (default) or 3 (heroic). Always-applied success modifiers
 * fold in as arithmetic on the success count: `Nd6>=4+B`. With
 * pool 0 (auto-fail per DH p.20 — you can't make a test you have
 * no dice for) the notation collapses to a bare `0`; the chat row
 * short-circuits resolution to "auto-fail" without consulting any
 * bonus successes (a roll you can't make can't accumulate them).
 *
 * This means `RollResult.total` IS the success count for a TB roll
 * — bonus-success arithmetic and target-success counting both happen
 * inside the rpg-dice-roller stage, so the chat row's success number
 * matches what the dice library reports. Conditional modifiers
 * (`apply: "on-success"`/`"on-fail"`) still apply post-roll because
 * win/lose state isn't known until the dice land.
 *
 * Other TB rules (rerolls, exploding on relics, fate/persona reroll
 * modes) layer on as additional modifier kinds rather than notation
 * gymnastics.
 */

/* -------------------------------------------------------------------------
 * TbRollModifier — the canonical modifier shape
 * ----------------------------------------------------------------------- */

export const TbRollModifierKindSchema = z.enum(["dice", "success", "obstacle"]);
export type TbRollModifierKind = z.infer<typeof TbRollModifierKindSchema>;

export const TbRollModifierApplySchema = z.enum([
  "always",
  "on-success",
  "on-fail",
]);
export type TbRollModifierApply = z.infer<typeof TbRollModifierApplySchema>;

export const TbRollModifierSourceSchema = z.enum([
  "auto",
  "manual",
  "trait",
  "wise",
  "help",
  "fate",
  "persona",
  "gear",
  "spell",
  "condition",
  "level-benefit",
]);
export type TbRollModifierSource = z.infer<typeof TbRollModifierSourceSchema>;

export const TbRollModifierSchema = z.object({
  /**
   * Stable id within the spec. Auto modifiers use a deterministic id
   * (`auto:condition:injured`) so they collapse if computed twice.
   * Manual contributions get a fresh id assigned by the panel
   * (`manual:<random>`) so duplicates are allowed.
   */
  id: z.string().min(1).max(80),

  kind: TbRollModifierKindSchema,

  /**
   * Signed integer. For `kind: "dice"`, units are dice. For
   * `kind: "success"`, units are flat successes.
   */
  value: z.number().int(),

  /** Display label — what the panel and chat row show. */
  label: z.string().min(1).max(120),

  /**
   * When the modifier applies. Defaults to `"always"`. Conditional
   * modifiers (BL faith reroll, on-success aura) flip win/lose
   * thresholds, so we honour them post-roll.
   */
  apply: TbRollModifierApplySchema.default("always"),

  /**
   * Provenance — what surfaced this mod. Used by the panel to colour
   * auto-mods differently from player-added ones, and to render the
   * modifier table in the chat row.
   */
  source: TbRollModifierSourceSchema.default("manual"),

  /**
   * Optional free-form provider key — `condition:injured`, `gear:axe`,
   * `helper:char-tarn:scout`. Lets the chat row link back to the
   * thing that produced the mod and lets the panel deduplicate
   * provider-driven mods. Not interpreted by the resolution layer.
   */
  providedBy: z.string().min(1).max(160).optional(),
});

export type TbRollModifier = z.infer<typeof TbRollModifierSchema>;

/* -------------------------------------------------------------------------
 * TbRollSpec — the structured roll the panel + chat row consume
 * ----------------------------------------------------------------------- */

export const TbRollKindSchema = z.enum([
  "ability",
  "town-ability",
  "skill",
  "skill-bl",
  "versus",
]);
export type TbRollKind = z.infer<typeof TbRollKindSchema>;

export const TbRollSpecSchema = z.object({
  /** What kind of roll this is — drives the chat row's labelling. */
  kind: TbRollKindSchema,

  /**
   * Human-readable source. "Will", "Health", "Scout", "Resources",
   * "Fighter (Beginner's Luck, Will)" — what shows up in the chat
   * row's headline.
   */
  source: z.string().min(1).max(120),

  /**
   * Optional stable id for the roll target — `will`, `health`,
   * `nature`, `resources`, `circles`, `<skill-id>`. Lets panels and
   * downstream automation reason about the source without parsing
   * the human label. Skill BL rolls use the skill's id.
   */
  sourceId: z.string().min(1).max(80).optional(),

  /**
   * The pool BEFORE any modifiers — i.e., the raw ability/skill
   * rating that everything else stacks onto. For BL rolls this is
   * the *full* ability rating; the halving (DH p.59 "Beginners Roll
   * Half") happens inside `foldBlModifiers` together with the
   * pre-half modifier group, not before.
   */
  baseDice: z.number().int().min(0).max(20),

  /**
   * Pool AFTER always-applied dice modifiers. This is what `Nd6` in
   * the notation rolls. Floored at 0; if conditions and penalties
   * push the pool below 0 the roll is `0d6` (auto-fail before
   * tie-breaker rules engage).
   */
  pool: z.number().int().min(0).max(60),

  /**
   * Bonus successes added to the dice-success count whenever the
   * roll resolves — no win/lose dependency. Sum of every
   * `kind: "success", apply: "always"` modifier.
   */
  bonusSuccesses: z.number().int(),

  /**
   * `true` when the roll is heroic — every die showing 3+ counts as
   * a success instead of the default 4+. Heroic-source resolution
   * is per-spec (a trait flag on the character, an `opts.heroic`
   * override, or a panel toggle), but once set it's a binary on the
   * spec; nothing stacks the success target further.
   */
  heroic: z.boolean().default(false),

  /**
   * The face value at which a die counts as a success — 4 for a
   * default TB roll, 3 for a heroic one. Carried explicitly even
   * though it's derivable from `heroic` so the chat row, automation,
   * and replay tooling don't have to re-derive it on every read.
   * The notation builder uses this verbatim (`Nd6>=T`).
   */
  successTarget: z
    .union([z.literal(3), z.literal(4)])
    .default(4),

  /**
   * The **base** obstacle declared for this test — the GM's "this
   * is Ob N" call before any situational modifiers fold in. `null`
   * for an undeclared roll (chat-bound /r commands or quick rolls
   * without a stated target). Modeled separately from the resolved
   * `obstacle` so the chat row can show "Ob 3 +1 (factors) → Ob 4"
   * — the player and GM both see what shifted the target.
   */
  baseObstacle: z.number().int().min(0).max(20).nullable(),

  /**
   * The **resolved** obstacle for pass/fail. `baseObstacle + sum
   * of obstacle modifiers`, clamped to ≥0 (Ob 0 means "any success
   * passes"). Stays `null` when `baseObstacle` is null — modifiers
   * without a base have nothing to modify and are recorded for
   * transparency only. `resolveSuccessCount` reads this field.
   */
  obstacle: z.number().int().min(0).max(40).nullable(),

  /**
   * The full modifier list — auto, manual, applied, and conditional
   * — for transparency. The panel renders this as a table; the chat
   * row shows it under the result line.
   */
  modifiers: z.array(TbRollModifierSchema).default([]),

  /**
   * Optional pairing key for **versus** tests (DH p.21). When two
   * rolls share a `versusTestId`, each one's resolved success count
   * becomes the other's effective obstacle: A wins if A.successes ≥
   * B.successes, B wins if B.successes ≥ A.successes (ties go to
   * the GM under the printed procedure). The chat row navigates from
   * one Roll entity to the other by this key — no centralised
   * "VersusTest" record needed.
   *
   * Generated client-side at pairing time (`crypto.randomUUID()`,
   * prefixed `versus:` for legibility); echoed by both pending rolls'
   * `tb-versus` contributions before commit. Absent for plain
   * Ob-vs-roll tests; the standard `obstacle` resolution still wins
   * when both an obstacle and a versus pairing are set (the obstacle
   * is treated as the floor — the versus comparison happens against
   * the higher of the two thresholds).
   */
  versusTestId: z.string().min(1).max(80).nullable().optional(),

  /**
   * `true` when this roll generates **disposition** for a TB
   * conflict (DH p.254). Disposition rolls have no obstacle and
   * don't pass/fail — the result is the team's hit-point pool,
   * computed as `baseDice + finalSuccesses - perTeamPenalties`
   * (with a floor of 1 per SG p.47's "Minimum starting disposition
   * is 1"). Per-team penalties (Hungry & Thirsty -1s, Exhausted
   * -1s) fire once if any team-tagged character has the condition
   * — they're folded into `modifiers` like any other modifier so
   * the chat row can render the full breakdown.
   *
   * Absent (default) for normal tests.
   */
  dispositionMode: z.boolean().optional(),

  /**
   * Free-text caption that flows into the chat row's reason. Distinct
   * from the rollable's `label` (which becomes `RequestRoll.reason`
   * for the generic fallback path).
   */
  caption: z.string().min(1).max(240),
});

export type TbRollSpec = z.infer<typeof TbRollSpecSchema>;

/**
 * The system tag the resolution chat row checks to decide "this roll
 * is owned by a game-system contributor; skip the generic render."
 */
export const TB_ROLL_META_SYSTEM = "@vtt/system-torchbearer" as const;

export const TbRollMetaSchema = z.object({
  system: z.literal(TB_ROLL_META_SYSTEM),
  spec: TbRollSpecSchema,
});

export type TbRollMeta = z.infer<typeof TbRollMetaSchema>;

/* -------------------------------------------------------------------------
 * Helpers — modifier folding, notation building, success counting
 * ----------------------------------------------------------------------- */

/**
 * Fold a list of modifiers into pool + bonus-successes + obstacle
 * shift. Conditional modifiers (`apply: "on-success"`/`"on-fail"`)
 * are recorded in the spec but not added to pool/notation/obstacle
 * — they're applied post-roll by the chat row.
 *
 * `baseDice` is the rating before any modifier. The result clamps
 * `pool` at 0 — TB doesn't roll negative dice. `obstacleAdjust`
 * isn't clamped here (the caller decides whether to apply it: a
 * roll without a declared base obstacle has nothing to shift).
 */
export function foldModifiers(
  baseDice: number,
  modifiers: ReadonlyArray<TbRollModifier>,
): { pool: number; bonusSuccesses: number; obstacleAdjust: number } {
  let pool = baseDice;
  let bonusSuccesses = 0;
  let obstacleAdjust = 0;
  for (const m of modifiers) {
    if (m.apply !== "always") continue;
    if (m.kind === "dice") pool += m.value;
    else if (m.kind === "success") bonusSuccesses += m.value;
    else if (m.kind === "obstacle") obstacleAdjust += m.value;
  }
  return {
    pool: Math.max(0, pool),
    bonusSuccesses,
    obstacleAdjust,
  };
}

/**
 * Classify a dice modifier for the Beginner's Luck halving rule
 * (DH p.59 "Beginners Roll Half"):
 *
 *   Total up the dice for the ability, wises, help, supplies and
 *   gear, divide that by half and round up. Then add traits, persona
 *   points, channeled Nature, the fresh condition and any other
 *   special or magic bonus dice.
 *
 * `true` means "this dice modifier sums into the ability *before*
 * halving" (pre-half group). `false` means "added after halving"
 * (post-half group).
 *
 * Sources currently emitting dice modifiers:
 *   - `condition:fresh` → post-half (RAW: "the fresh condition")
 *   - `condition:*` (Injured, Sick, taxed-skill, future Dead/Afraid
 *     suppressors) → pre-half. They reduce the effective ability,
 *     and the rules halve the *current* ability.
 *   - `help` → pre-half (RAW)
 *   - `trait` → post-half (RAW: "add traits")
 *   - `persona`, `fate`, `spell`, `level-benefit` → post-half (RAW:
 *     "persona points, channeled Nature, … any other special or
 *     magic bonus dice"). `fate` is grouped with persona since both
 *     are point-spends.
 *   - `manual` → post-half. Free-form labelled mods are typically
 *     special bonuses; the half-then-add ordering biases conservative.
 *   - `auto` → post-half. Generic auto-derivations that aren't
 *     `condition`-tagged default to "special bonus" treatment.
 *
 * Sources reserved but not yet emitting modifiers (TODO):
 *   - `wise`     → pre-half. The wises subsystem doesn't post
 *     `tb-modifier` contributions yet; when it does, the +1D from
 *     "wise applies" should set `source: "wise"` so this classifier
 *     places it pre-half (DH p.59).
 *   - `gear`     → pre-half. Gear bonuses (e.g. an enchanted lockpick
 *     adding +1D to Criminal) will arrive via providers; they should
 *     carry `source: "gear"`.
 *   - **supplies** isn't a source enum yet. When supplies-bonuses land,
 *     either reuse `gear` or add a new `supplies` source — both are
 *     pre-half per RAW.
 */
export function isBlPreHalfModifier(m: TbRollModifier): boolean {
  if (m.kind !== "dice") return false; // only dice mods participate in the halving
  if (m.apply !== "always") return false; // conditional mods land post-roll
  if (m.source === "condition") {
    return m.providedBy !== "condition:fresh";
  }
  return m.source === "help" || m.source === "wise" || m.source === "gear";
}

/**
 * Fold modifiers for a Beginner's Luck pool, applying DH p.59's
 * halve-and-add ordering:
 *
 *   poolBeforeHalf = baseDice + Σ(pre-half dice mods)
 *   pool           = ceil(poolBeforeHalf / 2) + Σ(post-half dice mods)
 *
 * Success and obstacle modifiers don't participate in the halving;
 * they fold normally. Returns the same shape as `foldModifiers` so
 * the caller can swap them for BL rolls without a wider refactor.
 */
export function foldBlModifiers(
  baseDice: number,
  modifiers: ReadonlyArray<TbRollModifier>,
): { pool: number; bonusSuccesses: number; obstacleAdjust: number } {
  let preHalfDice = 0;
  let postHalfDice = 0;
  let bonusSuccesses = 0;
  let obstacleAdjust = 0;
  for (const m of modifiers) {
    if (m.apply !== "always") continue;
    if (m.kind === "success") {
      bonusSuccesses += m.value;
      continue;
    }
    if (m.kind === "obstacle") {
      obstacleAdjust += m.value;
      continue;
    }
    // dice
    if (isBlPreHalfModifier(m)) preHalfDice += m.value;
    else postHalfDice += m.value;
  }
  const halved = Math.ceil(Math.max(0, baseDice + preHalfDice) / 2);
  return {
    pool: Math.max(0, halved + postHalfDice),
    bonusSuccesses,
    obstacleAdjust,
  };
}

/**
 * The notation a TB rollable hands to `RequestRoll`. Encodes the TB
 * success-counting rule directly in rpg-dice-roller's target-success
 * modifier (`>=4` default, `>=3` heroic). Bonus successes are baked
 * in as arithmetic on the success count (`+B` or `-B`). With those
 * two pieces in the notation, `RollResult.total` for a TB roll is
 * the success count after always-applied bonuses — what the player
 * actually wants to see.
 *
 * Pool 0 means auto-fail (no test possible per DH p.20). The
 * notation collapses to a bare `0` so the dice-roller still parses
 * and produces a deterministic total of zero — the chat row's
 * resolution short-circuits anyway, but the wire format stays
 * well-formed.
 */
export function buildTbNotation(
  pool: number,
  bonusSuccesses: number,
  heroic: boolean,
): string {
  const target = heroic ? 3 : 4;
  if (pool <= 0) {
    // Auto-fail. Bonus successes from a non-roll don't apply per
    // resolveSuccessCount, but emit them in notation as a bare
    // numeric constant so `RollResult.total` lines up with whatever
    // a future "let bonuses count even on auto-fail" rule wants to
    // read. Note rpg-dice-roller rejects a leading `+`, so keep the
    // sign on negatives only.
    return `${bonusSuccesses}`;
  }
  const head = `${pool}d6>=${target}`;
  if (bonusSuccesses === 0) return head;
  if (bonusSuccesses > 0) return `${head}+${bonusSuccesses}`;
  return `${head}${bonusSuccesses}`; // negative bonus → "-N" already in the number
}

/**
 * Count successes against the TB target. `target` is 4 (default) or
 * 3 (heroic) — anything else still works as a plain numeric
 * threshold (useful for future "+1 to success target" effects, if
 * any) but in practice the spec carries 3 or 4. Filters to d6
 * outcomes; non-d6 dice mixed in (defensive) don't contribute.
 */
export function countSuccesses(
  dice: ReadonlyArray<{ sides: number | "F"; value: number }>,
  target: number = 4,
): number {
  let n = 0;
  for (const d of dice) {
    if (d.sides !== 6) continue;
    if (d.value >= target) n += 1;
  }
  return n;
}

/**
 * Total success count = dice successes + always-bonus successes +
 * (on-success bonus successes if achieved goal) +
 * (on-fail bonus successes if failed). Returns separate raw + final
 * so the chat row can show "5 (raw) → 6 (after Faith reroll)".
 *
 * `obstacle === null` means "no obstacle declared" — we treat any
 * positive total as success for the purpose of conditional bonuses,
 * which mirrors how players resolve sheet-rolls without a stated Ob.
 */
export function resolveSuccessCount(
  spec: TbRollSpec,
  dice: ReadonlyArray<{ sides: number | "F"; value: number }>,
): {
  rawSuccesses: number;
  always: number;
  conditional: number;
  final: number;
  passed: boolean;
} {
  // Auto-fail short-circuit: a roll the player couldn't make does
  // not accumulate raw or bonus successes regardless of what the
  // notation might have computed.
  if (spec.pool === 0) {
    return {
      rawSuccesses: 0,
      always: 0,
      conditional: 0,
      final: 0,
      passed: false,
    };
  }
  const raw = countSuccesses(dice, spec.successTarget);
  const always = spec.bonusSuccesses;
  const provisionalTotal = raw + always;
  const obstacle = spec.obstacle;
  const passed = obstacle === null ? provisionalTotal > 0 : provisionalTotal >= obstacle;
  let conditional = 0;
  for (const m of spec.modifiers) {
    if (m.kind !== "success") continue;
    if (m.apply === "always") continue;
    if (m.apply === "on-success" && passed) conditional += m.value;
    if (m.apply === "on-fail" && !passed) conditional += m.value;
  }
  // Re-evaluate pass with the conditional successes folded in — a
  // modifier that fires "on success" can push a borderline-pass
  // further, but cannot retroactively turn a fail into a pass since
  // it only fires when already passing. Symmetric for on-fail.
  const final = raw + always + conditional;
  return { rawSuccesses: raw, always, conditional, final, passed };
}
