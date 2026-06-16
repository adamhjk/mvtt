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
 * Conflict actions. The four-action vocabulary is universal across
 * every conflict type — only the per-action *skill* changes (see
 * conflict-types.ts).
 *
 * Citations: SG p.66-70.
 */
export const ConflictActionEnum = z.enum(["attack", "defend", "feint", "maneuver"]);
export type ConflictAction = z.infer<typeof ConflictActionEnum>;

export const ALL_ACTIONS: ReadonlyArray<ConflictAction> = ["attack", "defend", "feint", "maneuver"];

/**
 * What ONE side does for a single matchup, per Scholar's Guide p.70:
 *
 *   `versus`      — V — make a versus test against the indicated skill.
 *   `independent` — I — roll independent at your action's obstacle.
 *   `noTest`      — — — your action forfeits; you do not roll.
 *
 * The book table is row-perspective: "find your action on the left
 * and your opponent's action along the top row." So the cell at
 * `TB_ACTION_MATRIX[myAction][opponentAction]` tells *me* what to do.
 * For a party-vs-enemy display, each side reads its own row:
 *
 *     party reads `TB_ACTION_MATRIX[partyAction][enemyAction]`
 *     enemy reads `TB_ACTION_MATRIX[enemyAction][partyAction]`
 *
 * The cells are NOT symmetric — `[defend][feint] = noTest` but
 * `[feint][defend] = independent` (Feint vs Defend: defender
 * forfeits, feinter rolls independent at Ob 0).
 */
export type MatchupCell = "versus" | "independent" | "noTest";
/** Legacy alias kept for existing imports; identical to `MatchupCell`. */
export type MatchupType = MatchupCell;

/**
 * Action-vs-action interaction matrix — Scholar's Guide p.70 verbatim.
 *
 * Cells encode YOUR test for the matchup `(myAction, opponentAction)`:
 *
 *                Attack    Defend    Feint     Maneuver
 *     Attack       I         V         I          V
 *     Defend       V         I         —          V
 *     Feint        —         I         V          I
 *     Maneuver     V         V         I          I
 *
 * The asymmetric Feint cells are the load-bearing ones (SG p.68):
 *   - Defend (you) vs Feint (them) → `noTest` — you forfeit.
 *   - Feint  (you) vs Defend (them) → `independent` — they forfeit, you
 *     still roll Ob 0 against their HP.
 *   - Feint  (you) vs Attack (them) → `noTest` — you're drawn out.
 *   - Attack (you) vs Feint (them) → `independent` — they're drawn out,
 *     you roll Ob 0.
 */
export const TB_ACTION_MATRIX: Readonly<
  Record<ConflictAction, Readonly<Record<ConflictAction, MatchupCell>>>
> = {
  attack: {
    attack: "independent",
    defend: "versus",
    feint: "independent",
    maneuver: "versus",
  },
  defend: {
    attack: "versus",
    defend: "independent",
    feint: "noTest",
    maneuver: "versus",
  },
  feint: {
    attack: "noTest",
    defend: "independent",
    feint: "versus",
    maneuver: "independent",
  },
  maneuver: {
    attack: "versus",
    defend: "versus",
    feint: "independent",
    maneuver: "independent",
  },
};

/**
 * Look up a single side's test for a matchup. Per the book, "always
 * look up your action on the left."
 */
export function testForAction(
  myAction: ConflictAction,
  opponentAction: ConflictAction,
): MatchupCell {
  return TB_ACTION_MATRIX[myAction][opponentAction];
}

/**
 * Per-action independent obstacle when the matchup is `independent`.
 * Defend is the only one with a non-zero Ob (SG p.67-69).
 */
export const TB_ACTION_INDEP_OB: Readonly<Record<ConflictAction, number>> = {
  attack: 0,
  defend: 3,
  feint: 0,
  maneuver: 0,
};

/**
 * Compact one-line summary, rendered at the top of each row in the
 * always-visible matrix card.
 */
export const TB_ACTION_SUMMARIES: Readonly<Record<ConflictAction, string>> = {
  attack: "dmg = MoS",
  defend: "heal = MoS+1 (indep) or MoS (versus); self first, whole-by-whole",
  feint: "dmg = MoS; vs Defend the defender forfeits and does not test",
  maneuver: "spend MoS on impede / position / disarm / rearm",
};

/**
 * Full rule text per action, surfaced inline by the Reference Board's
 * resolution panel and by the ActionMatrix expansion.
 *
 * Cited: SG p.67 (Attack, Defend), p.68 (Feint), p.69 (Maneuver).
 */
export interface ActionRules {
  readonly id: ConflictAction;
  readonly label: string;
  readonly summary: string;
  readonly description: string;
  readonly independentObstacle: number;
}

export const TB_ACTION_RULES: Readonly<Record<ConflictAction, ActionRules>> = {
  attack: {
    id: "attack",
    label: "Attack",
    summary: TB_ACTION_SUMMARIES.attack,
    description:
      "An Attack is an attempt to end this conflict in a decisive move. Reduces opponent's HP by margin of success. Versus vs Defend or Maneuver. Independent vs Attack or Feint at Ob 0.",
    independentObstacle: 0,
  },
  defend: {
    id: "defend",
    label: "Defend",
    summary: TB_ACTION_SUMMARIES.defend,
    description:
      "Defend protects and strengthens your position; blocks Attacks and Maneuvers and restores HP via Regroup. Versus vs Attack or Maneuver. Independent vs Defend at Ob 3. Vs Feint: defender does not test.",
    independentObstacle: 3,
  },
  feint: {
    id: "feint",
    label: "Feint",
    summary: TB_ACTION_SUMMARIES.feint,
    description:
      "Feint is a deceptive attack — risky but effective. Reduces opponent's HP by margin of success. Vs Defend: defender forfeits and does not test; feinter rolls independent Ob 0. Vs Attack: the feinter is drawn out of position and does not test; the Attack rolls as independent Ob 0. Vs Feint: versus test. Vs Maneuver: feinter rolls independent Ob 0; maneuver tests as normal.",
    independentObstacle: 0,
  },
  maneuver: {
    id: "maneuver",
    label: "Maneuver",
    summary: TB_ACTION_SUMMARIES.maneuver,
    description:
      "Maneuver gains an advantage over your opponent. Versus vs Attack or Defend. Independent vs Feint or Maneuver at Ob 0. Spend MoS on Impede (1: −1D next opp), Gain Position (2: +2D next us), Disarm (3), Rearm (4); each effect type once per action.",
    independentObstacle: 0,
  },
};

/**
 * Maneuver MoS spend menu. The captain (or GM) picks one or more
 * effects after the roll resolves; the engine validates that each
 * effect type appears at most once per action.
 *
 * Cited: SG p.69.
 */
export interface ManeuverEffectDef {
  readonly kind: "impede" | "gainPosition" | "disarm" | "rearm";
  readonly cost: number;
  readonly label: string;
  readonly summary: string;
}

export const TB_MANEUVER_EFFECTS: ReadonlyArray<ManeuverEffectDef> = [
  {
    kind: "impede",
    cost: 1,
    label: "Impede",
    summary:
      "−1D disadvantage to opponent's next action's test. Wasted if next action has no test.",
  },
  {
    kind: "gainPosition",
    cost: 2,
    label: "Gain Position",
    summary: "+2D advantage to your team's next action's test. Wasted if next action has no test.",
  },
  {
    kind: "disarm",
    cost: 3,
    label: "Disarm",
    summary:
      "Remove one of opponent's weapons or pieces of gear (or disable a trait) for the rest of the conflict.",
  },
  {
    kind: "rearm",
    cost: 4,
    label: "Rearm",
    summary:
      "You or a teammate may grab a dropped weapon or equip a carried/belt weapon mid-round.",
  },
];

/**
 * Maneuver MoS 3 may also be spent as "impede + gain position" (1+2);
 * MoS 4 may be spent as "impede + disarm" (1+3) or "impede + gain
 * position" (1+2 = 3, discarding 1). The engine permits any
 * non-repeating combination whose total cost ≤ MoS spent. Helper
 * exposes that decision space; UI lists the canonical combinations.
 */
export const TB_MANEUVER_COMBINATIONS: ReadonlyArray<{
  readonly mos: number;
  readonly effects: ReadonlyArray<ManeuverEffectDef["kind"]>;
  readonly label: string;
}> = [
  { mos: 1, effects: ["impede"], label: "Impede" },
  { mos: 2, effects: ["gainPosition"], label: "Gain Position" },
  { mos: 3, effects: ["disarm"], label: "Disarm" },
  {
    mos: 3,
    effects: ["impede", "gainPosition"],
    label: "Impede + Gain Position",
  },
  { mos: 4, effects: ["rearm"], label: "Rearm" },
  { mos: 4, effects: ["impede", "disarm"], label: "Impede + Disarm" },
  {
    mos: 4,
    effects: ["impede", "gainPosition"],
    label: "Impede + Gain Position (1 wasted)",
  },
];
