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

import type { Contribution } from "@vtt/characters/shared";
import { Team } from "@vtt/characters/shared";
import { z, type World } from "@vtt/substrate";
import { Conditions } from "./traits.js";
import {
  TbRollModifierSchema,
  type TbRollKind,
  type TbRollModifier,
} from "./roll-spec.js";

/**
 * Convention: a TB pending-roll contribution carries the modifier
 * payload under `kind: "tb-modifier"`. The shape is whatever
 * `TbRollModifier` accepts. The contribution's outer `label` is
 * mirrored from the modifier's label so the panel's generic row
 * still reads correctly even if a downstream consumer ignores the
 * modifier shape.
 */
export const TB_MODIFIER_CONTRIB_KIND = "tb-modifier" as const;

/**
 * Convention: a TB pending-roll heroic toggle uses `kind: "tb-heroic"`
 * with payload `{ enabled: boolean }`. Sits alongside `tb-modifier`
 * rather than as a third modifier kind because heroic isn't an
 * additive mod — it switches the success target. Last-wins
 * resolution (the most recently posted toggle takes effect) makes
 * the panel UX honest: if two players toggle it, the later click
 * sticks.
 */
export const TB_HEROIC_CONTRIB_KIND = "tb-heroic" as const;

const HeroicContributionPayloadSchema = z.object({
  enabled: z.boolean(),
});

/**
 * Convention: a panel-driven obstacle pick uses `kind: "tb-obstacle"`
 * with payload `{ value: number | null }`. `null` means "clear the
 * obstacle for this test" (no fixed target — pass on any success).
 * Numeric values are clamped to the rules' canonical 1–10 range
 * (DH p.20 — Ob is always declared by the GM as "Ob N").
 *
 * Last-wins resolution mirrors heroic: a chronologically newer
 * contribution overrides earlier ones, so multiple toggles in the
 * panel collapse to "the last one stuck".
 */
export const TB_OBSTACLE_CONTRIB_KIND = "tb-obstacle" as const;

const ObstacleContributionPayloadSchema = z.object({
  value: z.number().int().min(1).max(10).nullable(),
});

/**
 * Convention: `kind: "tb-disposition"` with payload
 * `{ enabled: boolean }` flips the rollable into **disposition**
 * mode (DH p.254 Conflict Procedures — Generate Disposition).
 * Disposition rolls don't pass/fail; the result is the team's
 * starting hit-point pool, computed as base rating + successes -
 * per-team H&T / Exhausted penalties. Last-wins via
 * `replaces: "tb:disposition"`.
 */
export const TB_DISPOSITION_CONTRIB_KIND = "tb-disposition" as const;

/**
 * `addTo` says which ability rating is added to the rolled successes
 * to form the team's starting disposition. PCs (SG p.63-64 / LM p.106):
 * Kill / Drive Off / Flee / Pursue add Health; Convince / Capture /
 * Trick add Will. Monsters (SG p.172): every conflict adds Nature.
 *
 * `pool` is monster-only and selects the dice pool scaling: `"within"`
 * rolls full Nature (conflict matches Nature descriptors); `"outside"`
 * rolls half Nature rounded up (conflict outside Nature descriptors).
 * Both modes still add the full Nature rating to the successes for
 * the disposition total. PC rolls leave `pool` absent — the dice pool
 * is always the skill or ability rating in those cases.
 *
 * Without `addTo` the chat row falls back to the roll's own base dice
 * — correct for Will-check / Health-check rollables (where `baseDice`
 * IS the ability rating) and wrong for skill rolls. The pending-roll
 * panel surfaces a picker so the captain commits the right value.
 */
const DispositionContributionPayloadSchema = z.object({
  enabled: z.boolean(),
  addTo: z.enum(["will", "health", "nature"]).nullable().optional(),
  pool: z.enum(["within", "outside"]).optional(),
});

export type DispoAddTo = "will" | "health" | "nature";
export type DispoMonsterPool = "within" | "outside";

/**
 * Convention: `kind: "tb-versus"` with payload
 * `{ versusTestId: string | null }` pairs a pending roll with
 * another for a TB versus test (DH p.21). `null` clears the
 * pairing on this side. Last-wins via `replaces: "tb:versus"`.
 *
 * The pairing is bidirectional but expressed as two contributions:
 * the panel that initiates the pairing posts the same versusTestId
 * to BOTH pending rolls so each side sees the link without the
 * other doing anything. Resolution at commit time happens in the
 * chat row — both Roll entities sharing a `versusTestId` discover
 * each other via a query and treat each other's success counts as
 * mutual obstacles.
 */
export const TB_VERSUS_CONTRIB_KIND = "tb-versus" as const;

const VersusContributionPayloadSchema = z.object({
  versusTestId: z.string().min(1).max(80).nullable(),
});

/**
 * Pre-roll persona advantage (DH p.8 sheet, p.250 reference card —
 * "Tally advantages before the test"). The player declares 1–3 persona
 * points to spend; each point grants +1D to the pool, capped at 3
 * cumulative per roll.
 *
 * Each click stamps a separate contribution (no `replaces` key) so
 * the panel renders one per spend; the rollable's compute sums the
 * counts and clamps the resulting `personaDiceSpent` at 3. The
 * fate/persona pool isn't decremented until the roll commits — see
 * `TbCommitSpendsSystem`.
 */
export const TB_PERSONA_SPEND_CONTRIB_KIND = "tb-persona-spend" as const;

const PersonaSpendContributionPayloadSchema = z.object({
  /**
   * Stable id stamped at click-time. The rollable mints a synthesized
   * `+ND Persona` modifier carrying the same id, so the panel's
   * standard modifier-chip × affordance can dispatch
   * `RemoveContribution(modifierId: id)` to clear this single click.
   */
  id: z.string().min(1).max(80),
  count: z.number().int().min(1).max(3),
});

/**
 * Pre-roll channel-nature declaration (DH p.67 — "Channeling Nature").
 * Adds the character's current Nature rating dice to the pool. Player
 * picks scope at declaration time:
 *   - `"within"`  — descriptors cover this test; no Nature tax (DH p.67).
 *   - `"outside"` — Nature is taxed post-resolution (DH p.67–68): -1 on
 *     pass, -margin on fail.
 *
 * Single-value setting per roll — `replaces: "tb:channel-nature"` so
 * a re-toggle supersedes the previous pick. Persona is debited at
 * commit time; the tax fires on `LogAdvancement`.
 */
export const TB_CHANNEL_NATURE_CONTRIB_KIND = "tb-channel-nature" as const;

const ChannelNatureContributionPayloadSchema = z.object({
  /** Stable id — see persona-spend payload. */
  id: z.string().min(1).max(80),
  scope: z.enum(["within", "outside"]),
});

/**
 * Pre-roll synergy declaration (DH p.87 — "Synergy"). The helper
 * spends 1 fate **before the dice are cast** to learn from the
 * experience; on a passed test the helper marks a passed advancement
 * test for whatever skill/ability they helped with.
 *
 * The contribution carries the helper's character id; the rollable
 * notes them on `spec.synergyHelpers[]` so commit-time debit and
 * (post-pass) advancement fan-out have the list. Each helper has
 * their own `replaces: "tb:synergy:<charId>"` so the toggle works
 * per-helper without colliding.
 */
export const TB_SYNERGY_CONTRIB_KIND = "tb-synergy" as const;

const SynergyContributionPayloadSchema = z.object({
  /** Stable id — see persona-spend payload. */
  id: z.string().min(1).max(80),
  helperCharacterId: z.string().min(1).max(80),
});

/**
 * Read the contributions list off a pending-roll opts blob and
 * return them as TbRollModifiers. Anything that isn't shaped like a
 * TB modifier is silently dropped — system-simple-style contributions
 * shouldn't crash a TB roll if they leak in.
 */
export function modifiersFromContributions(
  contributions: ReadonlyArray<Contribution> | undefined,
): TbRollModifier[] {
  if (!contributions || contributions.length === 0) return [];
  const out: TbRollModifier[] = [];
  for (const c of contributions) {
    if (c.kind !== TB_MODIFIER_CONTRIB_KIND) continue;
    const parsed = TbRollModifierSchema.safeParse(c.payload);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Read the most recent `tb-heroic` toggle from a contribution list.
 * Returns `undefined` when no heroic toggle is present (so the
 * caller can fall back to its trait-derived heroic state). Returns
 * `true` / `false` when an explicit toggle was posted; later
 * toggles override earlier ones, so calling with the chronologically
 * ordered contributions list (which is what the PendingRoll trait
 * stores) gives last-wins semantics.
 */
export function heroicFromContributions(
  contributions: ReadonlyArray<Contribution> | undefined,
): boolean | undefined {
  if (!contributions || contributions.length === 0) return undefined;
  let latest: boolean | undefined;
  for (const c of contributions) {
    if (c.kind !== TB_HEROIC_CONTRIB_KIND) continue;
    const parsed = HeroicContributionPayloadSchema.safeParse(c.payload);
    if (parsed.success) latest = parsed.data.enabled;
  }
  return latest;
}

/**
 * Read the most recent `tb-obstacle` pick from a contribution list.
 *
 * Three return states:
 *   - `undefined` — no panel obstacle posted yet; defer to whatever
 *     `opts.obstacle` (or the rollable's default) has set on the spec.
 *   - `null`      — panel explicitly cleared the obstacle for this
 *     test ("just count successes, no fixed target").
 *   - `number`    — panel set the obstacle to this value (1-10).
 *
 * The three states are distinguishable so the rollable can pick the
 * right priority order: explicit numeric > explicit clear > defer.
 */
export function obstacleFromContributions(
  contributions: ReadonlyArray<Contribution> | undefined,
): number | null | undefined {
  if (!contributions || contributions.length === 0) return undefined;
  let latest: number | null | undefined;
  for (const c of contributions) {
    if (c.kind !== TB_OBSTACLE_CONTRIB_KIND) continue;
    const parsed = ObstacleContributionPayloadSchema.safeParse(c.payload);
    if (parsed.success) latest = parsed.data.value;
  }
  return latest;
}

/**
 * Read the most recent `tb-disposition` toggle from a contribution
 * list. Returns `undefined` for "no toggle posted", or the latest
 * `enabled` boolean. Same last-wins shape as heroic.
 */
export function dispositionFromContributions(
  contributions: ReadonlyArray<Contribution> | undefined,
): boolean | undefined {
  if (!contributions || contributions.length === 0) return undefined;
  let latest: boolean | undefined;
  for (const c of contributions) {
    if (c.kind !== TB_DISPOSITION_CONTRIB_KIND) continue;
    const parsed = DispositionContributionPayloadSchema.safeParse(c.payload);
    if (parsed.success) latest = parsed.data.enabled;
  }
  return latest;
}

/**
 * Read the most recent `tb-disposition` `addTo` selection — which
 * ability ("will" / "health" / "nature") is added to successes for
 * the dispo total. Returns `undefined` if the panel never picked one
 * (caller decides the fallback); `null` if explicitly cleared.
 */
export function dispositionAddToFromContributions(
  contributions: ReadonlyArray<Contribution> | undefined,
): DispoAddTo | null | undefined {
  if (!contributions || contributions.length === 0) return undefined;
  let latest: DispoAddTo | null | undefined;
  for (const c of contributions) {
    if (c.kind !== TB_DISPOSITION_CONTRIB_KIND) continue;
    const parsed = DispositionContributionPayloadSchema.safeParse(c.payload);
    if (parsed.success) latest = parsed.data.addTo ?? null;
  }
  return latest;
}

/**
 * Read the most recent `tb-disposition` `pool` selection — used for
 * monster disposition rolls (SG p.172) to pick "within" Nature
 * descriptors (full Nature pool) vs "outside" them (half Nature,
 * rounded up). Returns `undefined` when the panel never selected
 * one — callers default to "within" for monster rolls.
 */
export function dispositionMonsterPoolFromContributions(
  contributions: ReadonlyArray<Contribution> | undefined,
): DispoMonsterPool | undefined {
  if (!contributions || contributions.length === 0) return undefined;
  let latest: DispoMonsterPool | undefined;
  for (const c of contributions) {
    if (c.kind !== TB_DISPOSITION_CONTRIB_KIND) continue;
    const parsed = DispositionContributionPayloadSchema.safeParse(c.payload);
    if (parsed.success && parsed.data.pool) latest = parsed.data.pool;
  }
  return latest;
}

/**
 * Read the most recent `tb-versus` pairing from a contribution list.
 *
 * Three return states (mirror of `obstacleFromContributions`):
 *   - `undefined` — no pairing posted; rollable falls back to no
 *     versus test.
 *   - `null`      — panel explicitly cleared the pairing.
 *   - `string`    — versus pair id (matches the opponent's spec).
 */
export function versusFromContributions(
  contributions: ReadonlyArray<Contribution> | undefined,
): string | null | undefined {
  if (!contributions || contributions.length === 0) return undefined;
  let latest: string | null | undefined;
  for (const c of contributions) {
    if (c.kind !== TB_VERSUS_CONTRIB_KIND) continue;
    const parsed = VersusContributionPayloadSchema.safeParse(c.payload);
    if (parsed.success) latest = parsed.data.versusTestId;
  }
  return latest;
}

/**
 * Per-contribution persona-spend declarations. Each click stamps its
 * own contribution; the rollable synthesizes one `+ND Persona`
 * modifier per entry, carrying the same `id` so the standard chip ×
 * affordance can `RemoveContribution(modifierId: id)` to drop just
 * that one click. Order preserved (chronological).
 *
 * The cap-at-3 rule (DH p.8) is enforced separately in
 * `personaSpendTotalFromContributions` — we surface every entry here
 * so the cap UI ("3/3 reached") can render even when a 4th click
 * would have stacked over the limit.
 */
export interface PersonaSpendDecl {
  readonly id: string;
  readonly count: number;
}

export function personaSpendsFromContributions(
  contributions: ReadonlyArray<Contribution> | undefined,
): PersonaSpendDecl[] {
  if (!contributions || contributions.length === 0) return [];
  const out: PersonaSpendDecl[] = [];
  for (const c of contributions) {
    if (c.kind !== TB_PERSONA_SPEND_CONTRIB_KIND) continue;
    const parsed = PersonaSpendContributionPayloadSchema.safeParse(c.payload);
    if (!parsed.success) continue;
    out.push({ id: parsed.data.id, count: parsed.data.count });
  }
  return out;
}

/**
 * Sum of declared persona dice, clamped at 3 (DH p.8 sheet legend).
 * Used by `buildSpec` to populate `spec.personaDiceSpent` and by the
 * panel UI to show the cumulative tally.
 */
export function personaSpendTotalFromContributions(
  contributions: ReadonlyArray<Contribution> | undefined,
): number {
  let total = 0;
  for (const e of personaSpendsFromContributions(contributions)) {
    total += e.count;
  }
  return Math.min(3, total);
}

/**
 * Latest channel-nature declaration on the contribution list (last-wins
 * via `replaces: "tb:channel-nature"`). Returns `null` when nothing
 * has been declared. Carries the contribution `id` so the synthesized
 * modifier chip can be removed via the standard × affordance.
 */
export interface ChannelNatureDecl {
  readonly id: string;
  readonly scope: "within" | "outside";
}

export function channelNatureFromContributions(
  contributions: ReadonlyArray<Contribution> | undefined,
): ChannelNatureDecl | null {
  if (!contributions || contributions.length === 0) return null;
  let latest: ChannelNatureDecl | null = null;
  for (const c of contributions) {
    if (c.kind !== TB_CHANNEL_NATURE_CONTRIB_KIND) continue;
    const parsed = ChannelNatureContributionPayloadSchema.safeParse(c.payload);
    if (!parsed.success) continue;
    latest = { id: parsed.data.id, scope: parsed.data.scope };
  }
  return latest;
}

/**
 * Per-helper synergy declarations on a pending roll. Each helper has
 * their own `replaces: "tb:synergy:<characterId>"` key, so re-toggling
 * supersedes the prior declaration; we walk chronologically and keep
 * the latest entry per helper. Empty list when nobody has declared
 * synergy.
 */
export interface SynergyDecl {
  readonly id: string;
  readonly helperCharacterId: string;
}

export function synergyDeclsFromContributions(
  contributions: ReadonlyArray<Contribution> | undefined,
): SynergyDecl[] {
  if (!contributions || contributions.length === 0) return [];
  const byHelper = new Map<string, SynergyDecl>();
  for (const c of contributions) {
    if (c.kind !== TB_SYNERGY_CONTRIB_KIND) continue;
    const parsed = SynergyContributionPayloadSchema.safeParse(c.payload);
    if (!parsed.success) continue;
    byHelper.set(parsed.data.helperCharacterId, {
      id: parsed.data.id,
      helperCharacterId: parsed.data.helperCharacterId,
    });
  }
  return [...byHelper.values()];
}

/** Convenience: just the helper character ids. */
export function synergyHelpersFromContributions(
  contributions: ReadonlyArray<Contribution> | undefined,
): string[] {
  return synergyDeclsFromContributions(contributions).map(
    (e) => e.helperCharacterId,
  );
}

/**
 * Skills affected by the Angry condition's "precision and social
 * graces" clause (SG p.47–48). When rolling one of these, an angry
 * character takes -1s in versus tests; the GM may also apply +1 Ob
 * to ordinary tests (the GM-option +1 Ob is left to manual entry —
 * the rules say "at the game master's option," so we don't force
 * it). The -1s in versus is unconditional in the rules, so we
 * auto-apply it.
 */
export const ANGRY_AFFECTED_SKILLS: ReadonlyArray<string> = [
  "alchemist",
  "cartographer",
  "commander",
  "cook",
  "dungeoneer",
  "haggler",
  "healer",
  "mentor",
  "loreMaster",
  "manipulator",
  "orator",
  "pathfinder",
  "persuader",
  "scholar",
  "survivalist",
];

/**
 * Sentinel "wipe the pool" magnitude. Folded into the pool
 * arithmetic where the rules say a character "cannot test" — Dead,
 * Afraid + Beginner's Luck. `foldModifiers` clamps the pool at 0
 * so any sufficiently large negative drives the roll to auto-fail
 * regardless of base. Picked at -20 because no realistic TB pool
 * exceeds that; it shows up clearly in the chip ("-20D Dead: …")
 * which makes the suppression legible to the player rather than
 * surprising.
 */
const NO_TEST_PENALTY = -20;

/**
 * Conditions → auto-modifiers, per the Conditions chapter of the
 * Scholar's Guide (p.46–52) and the Adventure-Phase reference card
 * (DH p.250–251).
 *
 *   - `fresh`        → +1D to all tests except Resources and Circles
 *                      (SG p.46). Cancelled the moment any other
 *                      condition is set; bonus does not apply while
 *                      another condition is also live.
 *   - `injured`      → -1D to Skills, Nature, Will, Health (SG p.49).
 *                      Excluded for Resources/Circles via the kind
 *                      filter. Recovery-test exclusion isn't
 *                      auto-applied (no rollable kind for "recovery"
 *                      yet — left to the player to override).
 *   - `sick`         → same shape as `injured` (SG p.51); stacks.
 *   - `afraid`       → suppresses Beginner's Luck rolls entirely
 *                      (SG p.48). For `kind: "skill-bl"` we emit a
 *                      large dice penalty that drives the pool to 0.
 *   - `dead`         → suppresses every test (SG p.52). Same large
 *                      dice penalty for every kind (including
 *                      Resources/Circles — a dead character can't
 *                      do anything).
 *   - `angry`        → -1s in versus tests of precision/social
 *                      skills (SG p.48). The GM-option +1 Ob is
 *                      left manual; trait/wise restrictions are UI
 *                      concerns, not pool math.
 *   - `exhausted` / `hungryThirsty` → conflict-disposition penalties
 *                      only (SG p.47, p.48–49). No test-pool effect.
 *
 * The `kind` and `sourceId` arguments let the function emit
 * kind/source-specific modifiers (Afraid only on `skill-bl`,
 * Angry only on listed skills' versus tests).
 *
 * The `source` field is `"condition"` and the `providedBy` is
 * `"condition:<id>"` so the panel can group / link back to the
 * Conditions trait without parsing labels.
 */
export function autoModifiersFromConditions(
  conditions: {
    fresh: boolean;
    hungryThirsty: boolean;
    angry: boolean;
    afraid: boolean;
    exhausted: boolean;
    injured: boolean;
    sick: boolean;
    dead: boolean;
  },
  kind: TbRollKind,
  sourceId: string = "",
  versusTestId: string | null = null,
): TbRollModifier[] {
  // Dead trumps every other rule and applies regardless of kind:
  // SG p.52 — "While dead, a character cannot test, help, use traits
  // or use wises in any way." Emit early so we don't stack other
  // mods on a dead character.
  if (conditions.dead) {
    return [
      {
        id: "auto:condition:dead",
        kind: "dice",
        value: NO_TEST_PENALTY,
        label: "Dead: cannot test",
        apply: "always",
        source: "condition",
        providedBy: "condition:dead",
      },
    ];
  }
  if (kind === "town-ability") return [];
  const out: TbRollModifier[] = [];
  // SG p.46: Fresh's +1D applies only when *no other* condition is
  // also set. The trait may still flag fresh: true (a cancellation
  // system clears it asynchronously), but we honour the rule here
  // regardless of the trait's literal state — defence in depth.
  const hasOtherCondition =
    conditions.hungryThirsty ||
    conditions.angry ||
    conditions.afraid ||
    conditions.exhausted ||
    conditions.injured ||
    conditions.sick ||
    conditions.dead;
  // Modifier labels carry just the source name — the value/unit is
  // prepended by `formatModifier` at display time. So "Fresh" + the
  // formatter's "+1D " prefix renders as "+1D Fresh" (not the
  // doubled-up "+1D Fresh +1D" we'd get if the label embedded the
  // value).
  if (conditions.fresh && !hasOtherCondition) {
    out.push({
      id: "auto:condition:fresh",
      kind: "dice",
      value: 1,
      label: "Fresh",
      apply: "always",
      source: "condition",
      providedBy: "condition:fresh",
    });
  }
  if (conditions.injured) {
    out.push({
      id: "auto:condition:injured",
      kind: "dice",
      value: -1,
      label: "Injured",
      apply: "always",
      source: "condition",
      providedBy: "condition:injured",
    });
  }
  if (conditions.sick) {
    out.push({
      id: "auto:condition:sick",
      kind: "dice",
      value: -1,
      label: "Sick",
      apply: "always",
      source: "condition",
      providedBy: "condition:sick",
    });
  }
  // SG p.48 — "While afraid, adventurers can't … use Beginner's
  // Luck." We treat that as a hard suppression on `skill-bl` rolls.
  // Nature-substitution (also in SG p.48) is a player choice, not
  // an auto-mod, so it's not modeled here.
  if (conditions.afraid && kind === "skill-bl") {
    out.push({
      id: "auto:condition:afraid:no-bl",
      kind: "dice",
      value: NO_TEST_PENALTY,
      label: "Afraid: no Beginner's Luck",
      apply: "always",
      source: "condition",
      providedBy: "condition:afraid",
    });
  }
  // SG p.48 — In a versus test of a precision/social skill, an
  // angry character takes -1s. This one is unconditional in the
  // rules and auto-applies. The non-versus +1 Ob is "at the game
  // master's option" — that one is surfaced as a contextual quick
  // button in the panel (see `suggestedQuickModifiersFor`) so the
  // GM/player can apply it deliberately rather than having it
  // forced onto every roll.
  if (
    conditions.angry &&
    versusTestId !== null &&
    (kind === "skill" || kind === "skill-bl") &&
    ANGRY_AFFECTED_SKILLS.includes(sourceId)
  ) {
    out.push({
      id: "auto:condition:angry:versus",
      kind: "success",
      value: -1,
      label: "Angry (versus precision/social)",
      apply: "always",
      source: "condition",
      providedBy: "condition:angry",
    });
  }
  return out;
}

/**
 * "Suggested" quick modifiers — modifiers that the rules describe
 * as GM's option or otherwise discretionary, surfaced in the
 * pending-roll panel as contextual quick buttons rather than
 * folded into the spec automatically. Pattern is generic: any
 * future "the GM may apply X" rule can return a button shape from
 * here.
 *
 * Each entry is shaped like a `TbRollModifier` with an extra
 * `note` so the button title can explain the rule. The contributor
 * renders them as buttons next to the standard +1D / -1D row;
 * clicking emits a regular `tb-modifier` contribution carrying the
 * inner modifier shape — same as any quick button.
 *
 * Currently surfaces:
 *   - Angry + non-versus + precision/social skill → +1 Ob
 *     (SG p.48 — "at the game master's option").
 *
 * Not surfaced (deliberately):
 *   - Angry's traits/wises restriction (UI-level, not pool math).
 *   - Injured/Sick recovery-test exclusion (no rollable kind).
 *   - Sweat-out-the-fever and grit-your-teeth (separate commands).
 */
export interface TbSuggestedQuickModifier {
  /** Stable id for highlighting and dedup. */
  readonly id: string;
  /** Short button label, e.g. "+1 Ob (Angry)". */
  readonly buttonLabel: string;
  /** Tooltip text — citation + explanation. */
  readonly note: string;
  /** The modifier this button posts on click. */
  readonly modifier: Omit<TbRollModifier, "id" | "source"> & {
    source?: TbRollModifier["source"];
  };
}

/**
 * Per-team disposition penalties (DH p.254 Conflict Procedures →
 * Generate Disposition):
 *
 *   - "Subtract -1s if team member is hungry and thirsty"
 *   - "Subtract -1s if team member exhausted"
 *
 * Each penalty fires at most once per disposition roll, regardless
 * of how many team members carry the condition (SG p.47 explicitly:
 * "this penalty counts once, no matter how many in a group are
 * hungry and thirsty"). Returned as `kind: "success"` -1s
 * modifiers so they fold into the success count via the standard
 * pipeline. Minimum-disposition-of-1 enforcement is the chat row's
 * job, not the modifier list's.
 *
 * "Team" is determined by the `@vtt/characters/Team` trait —
 * `kind: "party"` flags a party-side character, `"enemy"` flags the
 * antagonist side. For a player rolling disposition, we sum across
 * every party-tagged character (including themself).
 */
export function teamPenaltiesForDisposition(
  world: World,
): TbRollModifier[] {
  const out: TbRollModifier[] = [];
  let anyHungryThirsty = false;
  let anyExhausted = false;
  for (const row of world.query([Team, Conditions])) {
    const team = row.values.Team as { kind: string };
    if (team.kind !== "party") continue;
    const conds = row.values.Conditions as {
      hungryThirsty: boolean;
      exhausted: boolean;
    };
    if (conds.hungryThirsty) anyHungryThirsty = true;
    if (conds.exhausted) anyExhausted = true;
  }
  if (anyHungryThirsty) {
    out.push({
      id: "auto:disposition:team-hungry-thirsty",
      kind: "success",
      value: -1,
      label: "Team Hungry & Thirsty",
      apply: "always",
      source: "condition",
      providedBy: "team:hungry-thirsty",
    });
  }
  if (anyExhausted) {
    out.push({
      id: "auto:disposition:team-exhausted",
      kind: "success",
      value: -1,
      label: "Team Exhausted",
      apply: "always",
      source: "condition",
      providedBy: "team:exhausted",
    });
  }
  return out;
}

export function suggestedQuickModifiersFor(args: {
  conditions: {
    fresh: boolean;
    hungryThirsty: boolean;
    angry: boolean;
    afraid: boolean;
    exhausted: boolean;
    injured: boolean;
    sick: boolean;
    dead: boolean;
  };
  kind: TbRollKind;
  sourceId: string;
  versusTestId: string | null;
}): TbSuggestedQuickModifier[] {
  const out: TbSuggestedQuickModifier[] = [];
  // Angry's GM-option +1 Ob: precision/social skills, non-versus.
  if (
    args.conditions.angry &&
    args.versusTestId === null &&
    (args.kind === "skill" || args.kind === "skill-bl") &&
    ANGRY_AFFECTED_SKILLS.includes(args.sourceId)
  ) {
    out.push({
      id: "suggest:angry:ob",
      buttonLabel: "+1 Ob (Angry)",
      note: "GM option — Angry adds +1 Ob to precision/social tests (SG p.48). Click to apply.",
      modifier: {
        kind: "obstacle",
        value: 1,
        label: "Angry",
        apply: "always",
        source: "condition",
        providedBy: "condition:angry",
      },
    });
  }
  return out;
}

/**
 * Surface modifiers contributed by items the character is currently
 * carrying. Walks the holder's TbCarries and, for each entry that
 * isn't damaged / dropped / lost, asks two questions:
 *
 *   - Does the item have `TbWeapon` and is the rolled action one of
 *     attack/defend/feint/maneuver with a non-zero conflict bonus?
 *     If so, suggest that bonus.
 *
 *   - Does the item have `TbSkillBonuses` with an entry matching the
 *     rolled skill (or "any")? If so, suggest the bonus, surfacing
 *     the condition string in the tooltip so the player knows when
 *     to actually apply it.
 *
 * Modifiers are emitted as `TbSuggestedQuickModifier` so the existing
 * pending-roll panel renders them with the same UX as condition
 * suggestions — togglable chips with a button label and tooltip.
 *
 * Items can dispatch *forks* of themselves (Ulrik's enchanted sword
 * = its own entity), so this function reads the actual item entity
 * each time — local edits to a forked weapon's bonuses flow into
 * the suggested modifiers automatically.
 */
export function suggestedItemModifiersFor(args: {
  world: World;
  characterId: string;
  kind: TbRollKind;
  sourceId: string;
}): TbSuggestedQuickModifier[] {
  const { world, characterId, kind, sourceId } = args;
  const holderTraits = world.traitsOn(characterId as never);
  const carries = holderTraits.get(
    "@vtt/system-torchbearer/TbCarries" as never,
  ) as
    | {
        entries: Array<{
          slot: string;
          itemId: string;
          slotsConsumed: number;
          state?: { damaged?: boolean; dropped?: boolean; lost?: boolean };
        }>;
      }
    | undefined;
  if (!carries) return [];

  const out: TbSuggestedQuickModifier[] = [];
  for (const entry of carries.entries) {
    const s = entry.state ?? {};
    if (s.damaged || s.dropped || s.lost) continue;

    // Item identity for the chip label.
    const itemTraits = world.traitsOn(entry.itemId as never);
    const ident = itemTraits.get(
      "@vtt/items/ItemIdentity" as never,
    ) as { name?: string } | undefined;
    const itemName = ident?.name ?? "item";

    // Weapon → conflict-action bonus.
    if (kind === "skill" || kind === "skill-bl") {
      const weapon = itemTraits.get(
        "@vtt/system-torchbearer/TbWeapon" as never,
      ) as
        | {
            conflictBonuses: Record<
              string,
              { type: string; value: number }
            >;
          }
        | undefined;
      if (weapon) {
        const action = mapSkillToConflictAction(sourceId);
        if (action) {
          const cb = weapon.conflictBonuses[action];
          if (cb && cb.value !== 0) {
            const sign = cb.value > 0 ? "+" : "";
            out.push({
              id: `item:weapon:${entry.itemId}:${action}`,
              buttonLabel: `${sign}${cb.value}D ${itemName}`,
              note: `${itemName} grants ${sign}${cb.value}D to ${action}`,
              modifier: {
                kind: cb.type === "success" ? "success" : "dice",
                value: cb.value,
                label: itemName,
                apply: "always",
                source: "gear",
                providedBy: `item:${entry.itemId}`,
              },
            });
          }
        }
      }
    }

    // Skill-bonus entries → optional, condition-tagged suggestion.
    const sb = itemTraits.get(
      "@vtt/system-torchbearer/TbSkillBonuses" as never,
    ) as { entries: Array<{ skill: string; value: number; condition: string }> } | undefined;
    if (sb && (kind === "skill" || kind === "skill-bl")) {
      for (const e of sb.entries) {
        if (!skillMatches(e.skill, sourceId)) continue;
        const sign = e.value > 0 ? "+" : "";
        out.push({
          id: `item:skill:${entry.itemId}:${e.skill}`,
          buttonLabel: `${sign}${e.value}D ${itemName}`,
          note: e.condition
            ? `${itemName}: ${sign}${e.value}D ${e.skill} (${e.condition})`
            : `${itemName}: ${sign}${e.value}D ${e.skill}`,
          modifier: {
            kind: "dice",
            value: e.value,
            label: e.condition ? `${itemName} (${e.condition})` : itemName,
            apply: "always",
            source: "gear",
            providedBy: `item:${entry.itemId}:${e.skill}`,
          },
        });
      }
    }
  }
  return out;
}

/**
 * Foundry/TB conflict actions are skill-shaped (Fighter, Hunter, etc.
 * combined with the action type chosen at conflict-start). For now,
 * surface weapon bonuses on Fighter (most common attack-skill) and
 * fall back gracefully — the GM can always toggle the chip off.
 */
function mapSkillToConflictAction(sourceId: string): string | null {
  // The conflict actions are attack / defend / feint / maneuver. The
  // current rollables don't yet expose "which action am I taking" as
  // a skill source — for now we offer the highest of the four
  // bonuses on any Fighter / Hunter / Scout / Pathfinder roll. The
  // panel decides whether to apply.
  const fighterLike = new Set([
    "fighter",
    "hunter",
    "scout",
    "pathfinder",
    "ritualist",
  ]);
  if (fighterLike.has(sourceId)) return "attack";
  return null;
}

function skillMatches(skillName: string, sourceId: string): boolean {
  return (
    skillName.toLowerCase() === sourceId.toLowerCase() ||
    skillName.toLowerCase().replace(/[^a-z]/g, "") ===
      sourceId.toLowerCase().replace(/[^a-z]/g, "")
  );
}

/**
 * Format a TbRollModifier as a human-readable chip — `"+1D Fresh"`,
 * `"-1D Injured"`, `"+1 Ob factors"`, `"+2s on success: Faith"`.
 * The chat row, panel, and tooltip share this so the wording is
 * consistent.
 */
export function formatModifier(m: TbRollModifier): string {
  const sign = m.value >= 0 ? "+" : "";
  let head: string;
  if (m.kind === "obstacle") {
    head = `${sign}${m.value} Ob`;
  } else {
    const unit = m.kind === "dice" ? "D" : "s";
    head = `${sign}${m.value}${unit}`;
  }
  if (m.apply === "on-success") return `${head} on success: ${m.label}`;
  if (m.apply === "on-fail") return `${head} on fail: ${m.label}`;
  return `${head} ${m.label}`;
}
