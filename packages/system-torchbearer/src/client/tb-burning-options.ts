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

// Pick-lists and shared math for the character-burning pickers on the
// Who You Are tab. Each picker writes a single skill rating using the
// `nextSkillRating` rule below; the data here is just the menu options.
//
// Sources: Dungeoneer's Handbook character-burning chapter.
//   - Human Upbringing — DH p.29. Six skills; pick one at rating 3 (or
//     +1 if already known, max 4). Humans only by RAW, but Troll
//     Changelings explicitly reuse the same list (LMM p.9
//     "Changeling Upbringing").
//   - Social Graces — DH p.30. Four skills; pick one at rating 2 (or
//     +1, max 4). Every character does this step.
//   - Specialty — DH p.31. Sixteen skills; pick one at rating 2 (or
//     +1, max 4) and mark it as your specialty (single-select).

/** DH p.29 "Human Upbringing" — printed-order list of choices. */
export const TB_UPBRINGING_SKILLS: ReadonlyArray<string> = [
  "criminal",
  "haggler",
  "laborer",
  "pathfinder",
  "peasant",
  "survivalist",
];

/** DH p.30 "What Are Your Social Graces?" — printed-order list of choices. */
export const TB_SOCIAL_GRACES_SKILLS: ReadonlyArray<string> = [
  "haggler",
  "manipulator",
  "orator",
  "persuader",
];

/**
 * DH p.31 "What's Your Specialty?" — printed-order list of choices.
 * Two columns on the page; we flatten left-column then right-column
 * to preserve the visual scan order players use when picking.
 */
export const TB_SPECIALTY_SKILLS: ReadonlyArray<string> = [
  "cartographer",
  "cook",
  "criminal",
  "dungeoneer",
  "haggler",
  "healer",
  "hunter",
  "manipulator",
  "pathfinder",
  "persuader",
  "orator",
  "rider",
  "sapper",
  "scavenger",
  "scout",
  "survivalist",
];

/**
 * The "set this skill" rule from DH p.29–31:
 *   - If the player doesn't already have the skill (rating 0), set it
 *     to the baseline (2 for Hometown / Social Graces / Specialty, 3
 *     for Human Upbringing).
 *   - Otherwise, increase the rating by one, capped at the printed
 *     "maximum of 4" hard ceiling.
 *
 * Negative ratings can't occur given the trait schema, but the helper
 * clamps them to 0 anyway so a corrupted read can't produce a NaN or
 * negative result.
 */
export function nextSkillRating(current: number, baseline: 2 | 3): number {
  const safe = Math.max(0, current);
  if (safe === 0) return baseline;
  return Math.min(safe + 1, 4);
}
