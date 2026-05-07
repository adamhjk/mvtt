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

/**
 * Rules text rendered by the Reference Board panels. Sourced verbatim
 * from the printed pages cited; deliberately *not* generated from the
 * corpus at runtime so the text is stable across PDF re-exports.
 *
 * Citations: DH p.150-151 (armor), p.156-159 (weapons),
 *            SG p.46-51 (conditions), p.74-77 (compromise).
 */

import type { ConflictAction } from "./actions.js";

/**
 * Per-armor display. The actual mechanical pipeline is encoded in
 * `server/armor.ts`; this is the printed reminder for the Armor
 * panel.
 */
export interface ArmorRulesEntry {
  readonly id: "leather" | "chain" | "plate" | "helmet" | "shield";
  readonly label: string;
  readonly absorb: number;
  readonly afterAbsorb: string;
  readonly bypassedBy: string;
  readonly notes: string;
}

export const TB_ARMOR_RULES: ReadonlyArray<ArmorRulesEntry> = [
  {
    id: "leather",
    label: "Leather",
    absorb: 1,
    afterAbsorb:
      "Roll 1d6: 4-6 absorbs, 1-3 fails. Once per fight. Never destroyed by absorbing.",
    bypassedBy: "Spear, bolt, arrow",
    notes: "Worn 1 torso slot.",
  },
  {
    id: "chain",
    label: "Chain",
    absorb: 1,
    afterAbsorb:
      "Auto-absorbs. Then 1d6: 1-3 damaged & useless, 4-6 intact.",
    bypassedBy: "Mace, warhammer (still roll for damage)",
    notes: "Damaged armor may be repaired (Armorer).",
  },
  {
    id: "plate",
    label: "Plate",
    absorb: 1,
    afterAbsorb:
      "Auto-absorbs. Then 1d6: 1-2 damaged, 3-6 intact. Vs mace/warhammer: 1-3 damaged, 4-6 intact.",
    bypassedBy: "(Nothing.)",
    notes: "Worn 2 torso slots; raises exhaustion recovery Ob.",
  },
  {
    id: "helmet",
    label: "Helmet",
    absorb: 1,
    afterAbsorb:
      "Once used: lost / damaged / destroyed at GM discretion. Repairable.",
    bypassedBy: "—",
    notes: "Worn / head.",
  },
  {
    id: "shield",
    label: "Shield",
    absorb: 1,
    afterAbsorb: "Destroyed.",
    bypassedBy: "—",
    notes: "+2D Defend; raises exhaustion recovery Ob.",
  },
];

/**
 * Conditions that affect either disposition or per-action tests.
 * These complement the existing `CONDITION_ORDER` in
 * shared/conditions.ts (which is the broader Recovery/Grind set);
 * here we focus on the *conflict-specific* effects called out by
 * SG p.46-51 and p.63-64.
 */
export interface ConditionRulesEntry {
  readonly id:
    | "fresh"
    | "hungryThirsty"
    | "angry"
    | "afraid"
    | "exhausted"
    | "injured"
    | "sick";
  readonly label: string;
  /** What it does to the disposition roll, if anything. */
  readonly dispoEffect: string;
  /** What it does inside-the-conflict (per-test). */
  readonly inConflictEffect: string;
}

export const TB_CONDITION_RULES: ReadonlyArray<ConditionRulesEntry> = [
  {
    id: "fresh",
    label: "Fresh",
    dispoEffect: "—",
    inConflictEffect: "+1D to all skill / ability tests.",
  },
  {
    id: "hungryThirsty",
    label: "Hungry & Thirsty",
    dispoEffect:
      "−1s, counted once per side regardless of how many are affected. Min dispo 1.",
    inConflictEffect: "—",
  },
  {
    id: "angry",
    label: "Angry",
    dispoEffect: "—",
    inConflictEffect:
      "No beneficial traits or wises. −1s in versus tests requiring precision or social graces.",
  },
  {
    id: "afraid",
    label: "Afraid",
    dispoEffect: "—",
    inConflictEffect:
      "No help, no Beginner's Luck. May still substitute Nature.",
  },
  {
    id: "exhausted",
    label: "Exhausted",
    dispoEffect:
      "−1s, counted once per side. Stacks with hungry & thirsty. Min dispo 1.",
    inConflictEffect: "Instinct not free.",
  },
  {
    id: "injured",
    label: "Injured",
    dispoEffect: "−1D (stacks with sick)",
    inConflictEffect:
      "−1D to skills, Nature, Will, Health (not recovery; not Resources/Circles).",
  },
  {
    id: "sick",
    label: "Sick",
    dispoEffect: "−1D (stacks with injured)",
    inConflictEffect:
      "−1D to skills, Nature, Will, Health (not recovery). No advancement.",
  },
];

/**
 * Side-load extra factor reminders. These are the small "are you
 * sure?" callouts attached to the disposition roll panel.
 */
export interface DispoFactorReminder {
  readonly id: string;
  readonly label: string;
  readonly delta: string;
  readonly applies: string;
}

export const TB_DISPO_FACTOR_REMINDERS: ReadonlyArray<DispoFactorReminder> = [
  {
    id: "backpack",
    label: "Backpack on captain",
    delta: "−1s",
    applies: "kill, capture, drive off",
  },
  {
    id: "darkness",
    label: "Captain in dim light or darkness",
    delta: "−1s",
    applies: "all conflicts except riddling (and only flee/riddle in darkness)",
  },
];

/**
 * Compromise-level reminders for the end-of-conflict panel
 * (SG p.74-77).
 */
export interface CompromiseLevelEntry {
  readonly id: "minor" | "half" | "major";
  readonly label: string;
  readonly trigger: string;
  readonly description: string;
  readonly killSpecific: string;
}

export const TB_COMPROMISE_LEVELS: ReadonlyArray<CompromiseLevelEntry> = [
  {
    id: "minor",
    label: "Minor",
    trigger: "Winner ends with > 1/2 starting disposition",
    description:
      "Loser gets a small piece of their goal. Winner takes a condition appropriate to the conflict.",
    killSpecific:
      "All but 1-2 of the loser's team killed. Conditions Afraid / Angry / Exhausted appropriate.",
  },
  {
    id: "half",
    label: "Half",
    trigger: "Winner ends with ~1/2 starting disposition",
    description:
      "Halfway-to-goal for one side, or the loser introduces a new twist.",
    killSpecific: "Injury appropriate as a half compromise.",
  },
  {
    id: "major",
    label: "Major",
    trigger: "Winner has only a few points left",
    description:
      "Loser nearly thwarted the winner; major twist; painful for both sides.",
    killSpecific:
      "Two of {Afraid, Angry, Exhausted, Injured} appropriate. Death always possible.",
  },
];

/**
 * Helper for the resolution panel's matchup explainer — one short
 * sentence per (partyAction, enemyAction) cell that the matrix renders
 * in tooltip / expansion form. Distinct from the full ActionRules
 * description so we can highlight the *interaction*.
 */
export const TB_MATCHUP_NOTES: Readonly<
  Record<ConflictAction, Readonly<Record<ConflictAction, string>>>
> = {
  attack: {
    attack: "Both roll independent at Ob 0. Either side that passes deals MoS damage.",
    defend:
      "Versus. Only the winner's MoS counts: Attack wins → MoS damage; Defend wins → Regroup heals MoS.",
    feint:
      "Feinter is drawn out of position and does not test. You roll independent Ob 0; MoS damages.",
    maneuver:
      "Versus. Only the winner's MoS counts: Attack wins → MoS damage; Maneuver wins → MoS spent on effects.",
  },
  defend: {
    attack:
      "Versus. Only the winner's MoS counts: Defend wins → Regroup heals MoS; Attack wins → MoS damage.",
    defend: "Both roll independent at Ob 3. Each side that passes Regroups (heal = MoS + 1).",
    feint:
      "Feint surprises you. You forfeit and do not test; the feinter rolls independent Ob 0.",
    maneuver:
      "Versus. Only the winner's MoS counts: Defend wins → Regroup heals MoS; Maneuver wins → MoS spent on effects.",
  },
  feint: {
    attack:
      "You're drawn out of position and do not test. The Attack rolls independent Ob 0; their MoS damages.",
    defend:
      "Defender forfeits and does not test. You roll independent Ob 0; MoS damages.",
    feint: "Versus. Winner's MoS damages the loser.",
    maneuver:
      "Both roll independent at Ob 0. Feint MoS damages; Maneuver MoS spent on effects.",
  },
  maneuver: {
    attack:
      "Versus. Only the winner's MoS counts: Maneuver wins → MoS spent on effects; Attack wins → MoS damage.",
    defend:
      "Versus. Only the winner's MoS counts: Maneuver wins → MoS spent on effects; Defend wins → Regroup heals MoS.",
    feint:
      "Both roll independent at Ob 0. Maneuver MoS spent on effects; Feint MoS damages.",
    maneuver:
      "Both roll independent at Ob 0. Each side that passes spends its own MoS on effects.",
  },
};
