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
import type { ConflictAction } from "./actions.js";

/**
 * The conflict type list, per SG p.62-71. Each row pins which skill
 * the captain rolls for disposition + which ability the successes
 * are added to (SG p.63), plus the per-action skills (SG p.70 /
 * LM p.106).
 *
 * `actionSkill[action]` is always an array: a single-element array
 * for fixed skills (Kill/Attack → Fighter), a multi-element array
 * when the book gives a choice (Flee/Attack → Scout *or* Rider).
 *
 * `other` is the GM-define-it bucket; UI lets the GM type in skills.
 */
export const ConflictTypeEnum = z.enum([
  "kill",
  "driveOff",
  "capture",
  "convince",
  "convinceCrowd",
  "flee",
  "pursue",
  "trick",
  "other",
]);
export type ConflictType = z.infer<typeof ConflictTypeEnum>;

/**
 * Disposition skill. Some conflicts let the captain pick from a pair
 * (Capture: Fighter or Hunter; Flee/Pursue: Scout or Rider). Encoded
 * as `oneOf` so the UI can render a small radio.
 */
export type DispoSkillSpec =
  | { readonly kind: "skill"; readonly id: string }
  | { readonly kind: "oneOf"; readonly ids: ReadonlyArray<string> };

export interface ConflictTypeDef {
  readonly id: ConflictType;
  readonly label: string;
  /** Which skill rolls disposition. */
  readonly dispoSkill: DispoSkillSpec;
  /** Successes are added to this ability rating to form the team's dispo. */
  readonly dispoAddTo: "Will" | "Health";
  /**
   * Per-action skills — rolled on the relevant slot. Always a
   * non-empty array. Length 1 = fixed skill; length > 1 = the book
   * gives the player a choice (flee Attack: "Scout or Rider").
   * Length 0 only on `other` where the GM specifies later.
   */
  readonly actionSkill: Readonly<Record<ConflictAction, ReadonlyArray<string>>>;
  /** Whether physical armor benefits this conflict (kill/capture/driveOff). */
  readonly armorApplies: boolean;
  /** Backpack penalty applies to dispo roll (kill/capture/driveOff). */
  readonly backpackPenalty: boolean;
  /** Shorthand description, surfaced under the type header in TopStripe. */
  readonly summary: string;
}

const KILL: ConflictTypeDef = {
  id: "kill",
  label: "Kill",
  dispoSkill: { kind: "skill", id: "fighter" },
  dispoAddTo: "Health",
  actionSkill: {
    attack: ["fighter"],
    defend: ["health"],
    feint: ["fighter"],
    maneuver: ["health"],
  },
  armorApplies: true,
  backpackPenalty: true,
  summary: "End the conflict in a decisive move.",
};

const DRIVE_OFF: ConflictTypeDef = {
  id: "driveOff",
  label: "Drive Off",
  dispoSkill: { kind: "skill", id: "fighter" },
  dispoAddTo: "Health",
  actionSkill: {
    attack: ["fighter"],
    defend: ["will"],
    feint: ["fighter"],
    maneuver: ["will"],
  },
  armorApplies: true,
  backpackPenalty: true,
  summary: "Make the enemy break and flee.",
};

const CAPTURE: ConflictTypeDef = {
  id: "capture",
  label: "Capture",
  dispoSkill: { kind: "oneOf", ids: ["fighter", "hunter"] },
  dispoAddTo: "Will",
  actionSkill: {
    attack: ["fighter"],
    defend: ["hunter"],
    feint: ["hunter"],
    maneuver: ["fighter"],
  },
  armorApplies: true,
  backpackPenalty: true,
  summary: "Take prisoners alive.",
};

const CONVINCE: ConflictTypeDef = {
  id: "convince",
  label: "Convince",
  dispoSkill: { kind: "skill", id: "persuader" },
  dispoAddTo: "Will",
  actionSkill: {
    attack: ["persuader"],
    defend: ["persuader"],
    feint: ["manipulator"],
    maneuver: ["manipulator"],
  },
  armorApplies: false,
  backpackPenalty: false,
  summary: "Persuade or argue down a single party.",
};

const CONVINCE_CROWD: ConflictTypeDef = {
  id: "convinceCrowd",
  label: "Convince Crowd",
  dispoSkill: { kind: "skill", id: "orator" },
  dispoAddTo: "Will",
  actionSkill: {
    attack: ["orator"],
    defend: ["orator"],
    feint: ["manipulator"],
    maneuver: ["manipulator"],
  },
  armorApplies: false,
  backpackPenalty: false,
  summary: "Sway the mob.",
};

// Per SG p.70: Flee/Pursue Attack & Feint = "Scout or Rider".
const FLEE: ConflictTypeDef = {
  id: "flee",
  label: "Flee",
  dispoSkill: { kind: "oneOf", ids: ["scout", "rider"] },
  dispoAddTo: "Health",
  actionSkill: {
    attack: ["scout", "rider"],
    defend: ["health"],
    feint: ["scout", "rider"],
    maneuver: ["health"],
  },
  armorApplies: false,
  backpackPenalty: false,
  summary: "Get away alive.",
};

const PURSUE: ConflictTypeDef = {
  id: "pursue",
  label: "Pursue",
  dispoSkill: { kind: "oneOf", ids: ["scout", "rider"] },
  dispoAddTo: "Health",
  actionSkill: {
    attack: ["scout", "rider"],
    defend: ["health"],
    feint: ["scout", "rider"],
    maneuver: ["health"],
  },
  armorApplies: false,
  backpackPenalty: false,
  summary: "Run them down before they vanish.",
};

const TRICK: ConflictTypeDef = {
  id: "trick",
  label: "Trick or Riddle",
  dispoSkill: { kind: "skill", id: "manipulator" },
  dispoAddTo: "Will",
  actionSkill: {
    attack: ["manipulator"],
    defend: ["loreMaster"],
    feint: ["manipulator"],
    maneuver: ["loreMaster"],
  },
  armorApplies: false,
  backpackPenalty: false,
  summary: "Outwit them with riddles or stories.",
};

const OTHER: ConflictTypeDef = {
  id: "other",
  label: "Other",
  dispoSkill: { kind: "skill", id: "" },
  dispoAddTo: "Will",
  actionSkill: {
    attack: [],
    defend: [],
    feint: [],
    maneuver: [],
  },
  armorApplies: false,
  backpackPenalty: false,
  summary: "GM-defined; pick the skills before disposition.",
};

export const TB_CONFLICT_TYPES: Readonly<
  Record<ConflictType, ConflictTypeDef>
> = {
  kill: KILL,
  driveOff: DRIVE_OFF,
  capture: CAPTURE,
  convince: CONVINCE,
  convinceCrowd: CONVINCE_CROWD,
  flee: FLEE,
  pursue: PURSUE,
  trick: TRICK,
  other: OTHER,
};

export const ALL_CONFLICT_TYPES: ReadonlyArray<ConflictType> = [
  "kill",
  "driveOff",
  "capture",
  "convince",
  "convinceCrowd",
  "flee",
  "pursue",
  "trick",
  "other",
];

const SKILL_LABELS: Readonly<Record<string, string>> = {
  fighter: "Fighter",
  hunter: "Hunter",
  scout: "Scout",
  rider: "Rider",
  persuader: "Persuader",
  manipulator: "Manipulator",
  orator: "Orator",
  loreMaster: "Lore Master",
  will: "Will",
  health: "Health",
};

/**
 * Display label for a skill id — falls back to the id if unknown.
 * Used by the conflict facilitation panels.
 */
export function skillLabel(id: string): string {
  return SKILL_LABELS[id] ?? id;
}

/**
 * Render an action's skill list as a human string per SG p.70 — single
 * skill verbatim, choices joined by "or", empty list as "—".
 */
export function actionSkillLabel(skills: ReadonlyArray<string>): string {
  if (skills.length === 0) return "—";
  if (skills.length === 1) return skillLabel(skills[0]!);
  return skills.map(skillLabel).join(" or ");
}

/**
 * One-line "what to roll for disposition" prompt, per the conflict
 * type's row in SG p.63-64 / LM p.106. Single-skill conflicts come
 * out like "Roll Fighter and add to Health"; choose-one conflicts
 * (Capture, Flee, Pursue) read "Roll Fighter or Hunter and add to
 * Will". The `other` bucket — GM-defined — returns null since no
 * canonical skill is specified.
 */
export function dispoRollLabel(typeDef: ConflictTypeDef): string | null {
  const skills =
    typeDef.dispoSkill.kind === "skill"
      ? [typeDef.dispoSkill.id]
      : [...typeDef.dispoSkill.ids];
  if (skills.length === 0 || skills.every((s) => s === "")) return null;
  return `Roll ${actionSkillLabel(skills)} and add to ${typeDef.dispoAddTo}`;
}
