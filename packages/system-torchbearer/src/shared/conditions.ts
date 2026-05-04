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
 * Torchbearer condition track, in canonical severity order
 * (Dungeoneer's Handbook p.50–53).
 *
 * Each condition is its own boolean — they stack — but the order
 * matters in play (lighter conditions are taken before heavier ones,
 * and `fresh` is mutually exclusive with the rest).
 */

export type ConditionId =
  | "fresh"
  | "hungryThirsty"
  | "angry"
  | "afraid"
  | "exhausted"
  | "injured"
  | "sick"
  | "dead";

export interface ConditionDef {
  readonly id: ConditionId;
  /** Display label as printed on the sheet. */
  readonly label: string;
  /** Recovery test required to clear, if any. e.g. "Will Ob 3". */
  readonly recovery: string | null;
  /** Short summary of the in-play effect. */
  readonly effect: string;
  /** Cleared in the camp phase (true) or only in town (false). */
  readonly clearsInCamp: boolean;
}

export const CONDITION_ORDER: ReadonlyArray<ConditionDef> = [
  {
    id: "fresh",
    label: "Fresh",
    recovery: null,
    effect: "+1D all tests until you take another condition",
    clearsInCamp: true,
  },
  {
    id: "hungryThirsty",
    label: "Hungry and Thirsty",
    recovery: null,
    effect: "−1 to disposition in any conflict",
    clearsInCamp: true,
  },
  {
    id: "angry",
    label: "Angry",
    recovery: "Will Ob 2",
    effect: "No wises or beneficial traits",
    clearsInCamp: true,
  },
  {
    id: "afraid",
    label: "Afraid",
    recovery: "Will Ob 3",
    effect: "No help, no Beginner's Luck",
    clearsInCamp: true,
  },
  {
    id: "exhausted",
    label: "Exhausted",
    recovery: "Health Ob 3",
    effect: "−1 disposition in conflict; instinct not free",
    clearsInCamp: true,
  },
  {
    id: "injured",
    label: "Injured",
    recovery: "Health Ob 4",
    effect: "−1D to skills, Nature, Will, Health (not recovery)",
    clearsInCamp: false,
  },
  {
    id: "sick",
    label: "Sick",
    recovery: "Will Ob 3",
    effect: "−1D to skills, Nature, Will, Health; no learning or advancement",
    clearsInCamp: false,
  },
  {
    id: "dead",
    label: "Dead",
    recovery: null,
    effect: "May not test, help, or use wises",
    clearsInCamp: false,
  },
];
