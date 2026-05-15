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

// Per-class starting stats from Torchbearer 2e. Drives the "Apply
// starting stats" button on the Who You Are tab: picking a (stock,
// class) pair and clicking the button writes the prescribed Will /
// Health, the class trait at level 1, and every listed skill at its
// printed rating. Player-choice items from the burning flow (the
// 8-point budget for budget classes, hometown skills, social-graces
// pick, Nature questions) stay on the player.
//
// Sources:
//   - DH p.26-27 — base six (Burglar, Magician, Outcast, Ranger,
//     Theurge, Warrior).
//   - LMM p.11/13/14 — three expansion classes (Shaman, Skald,
//     Thief).
//   - LMM p.9 — Troll Changeling, a stock that swaps in for Human
//     across every Human-stock class. Carries a required second
//     trait (Huldrekall) on top of the class trait, and its own
//     Nature descriptors. The class-side data mirrors the Human
//     row exactly — same abilities/skills/class-trait — so the
//     Troll Changeling rows are derived from the Human rows.

/**
 * Will / Health rating spec. DH p.26-27 prints two shapes:
 *   - `fixed`: a single number (Halfling/Burglar = Will 5, Health 3).
 *   - `budget`: a printed instruction "distribute N points between
 *     Will and Health; neither may be lower than `min` or higher than
 *     `max`" (Magician / Theurge / Warrior — all `total: 8, min: 2,
 *     max: 6`).
 *
 * The Apply-starting-stats button resolves budget rows to a legal
 * midpoint (Will 4 / Health 4) so the player can tune from there;
 * the constraint object is preserved so a future allocator widget
 * can validate against it.
 */
export type AbilityDefault =
  | { readonly kind: "fixed"; readonly value: number }
  | { readonly kind: "budget"; readonly total: number; readonly min: number; readonly max: number };

export interface SkillDefault {
  readonly id: string;
  readonly rating: number;
}

export interface ClassDefaults {
  readonly will: AbilityDefault;
  readonly health: AbilityDefault;
  readonly skills: ReadonlyArray<SkillDefault>;
  readonly classTrait: string;
  readonly classTraitPage: { readonly book: "DH" | "LMM"; readonly page: number };
}

export interface StockNatureDefaults {
  readonly rating: number;
  readonly descriptors: ReadonlyArray<string>;
  /**
   * Stock-required second trait. Set for Troll Changeling
   * (Huldrekall, LMM p.9): every changeling must take this on top of
   * their class trait. Absent for base DH stocks.
   */
  readonly additionalTrait?: {
    readonly name: string;
    readonly page: { readonly book: "DH" | "LMM"; readonly page: number };
  };
}

/**
 * Build the canonical map. Defined as a local `const` so we can
 * derive the Troll Changeling rows below without re-typing the
 * Human-stock class data. Exported as `TB_CLASS_DEFAULTS`.
 */
const HUMAN_AND_DH_DEFAULTS: Record<string, ClassDefaults> = {
  "halfling/burglar": {
    will: { kind: "fixed", value: 5 },
    health: { kind: "fixed", value: 3 },
    skills: [
      { id: "cook", rating: 3 },
      { id: "criminal", rating: 3 },
      { id: "fighter", rating: 3 },
      { id: "hunter", rating: 2 },
      { id: "scout", rating: 2 },
      { id: "scavenger", rating: 2 },
    ],
    classTrait: "Hidden Depths",
    classTraitPage: { book: "DH", page: 26 },
  },
  "human/magician": {
    will: { kind: "budget", total: 8, min: 2, max: 6 },
    health: { kind: "budget", total: 8, min: 2, max: 6 },
    skills: [
      { id: "arcanist", rating: 4 },
      { id: "loreMaster", rating: 3 },
      { id: "alchemist", rating: 2 },
      { id: "cartographer", rating: 2 },
      { id: "scholar", rating: 2 },
    ],
    classTrait: "Wizard's Sight",
    classTraitPage: { book: "DH", page: 26 },
  },
  "dwarf/outcast": {
    will: { kind: "fixed", value: 3 },
    health: { kind: "fixed", value: 5 },
    skills: [
      { id: "fighter", rating: 4 },
      { id: "dungeoneer", rating: 3 },
      { id: "armorer", rating: 2 },
      { id: "sapper", rating: 2 },
      { id: "orator", rating: 2 },
      { id: "scout", rating: 2 },
    ],
    classTrait: "Born of Earth and Stone",
    classTraitPage: { book: "DH", page: 26 },
  },
  "elf/ranger": {
    will: { kind: "fixed", value: 4 },
    health: { kind: "fixed", value: 4 },
    skills: [
      { id: "fighter", rating: 3 },
      { id: "pathfinder", rating: 3 },
      { id: "scout", rating: 3 },
      { id: "hunter", rating: 2 },
      { id: "loreMaster", rating: 2 },
      { id: "survivalist", rating: 2 },
    ],
    classTrait: "First Born",
    classTraitPage: { book: "DH", page: 27 },
  },
  "human/theurge": {
    will: { kind: "budget", total: 8, min: 2, max: 6 },
    health: { kind: "budget", total: 8, min: 2, max: 6 },
    skills: [
      { id: "fighter", rating: 3 },
      { id: "ritualist", rating: 3 },
      { id: "orator", rating: 3 },
      { id: "healer", rating: 2 },
      { id: "theologian", rating: 2 },
    ],
    classTrait: "Touched by the Gods",
    classTraitPage: { book: "DH", page: 27 },
  },
  "human/warrior": {
    will: { kind: "budget", total: 8, min: 2, max: 6 },
    health: { kind: "budget", total: 8, min: 2, max: 6 },
    skills: [
      { id: "fighter", rating: 4 },
      { id: "hunter", rating: 3 },
      { id: "commander", rating: 2 },
      { id: "mentor", rating: 2 },
      { id: "rider", rating: 2 },
    ],
    classTrait: "Heart of Battle",
    classTraitPage: { book: "DH", page: 27 },
  },
  "human/shaman": {
    will: { kind: "budget", total: 8, min: 2, max: 6 },
    health: { kind: "budget", total: 8, min: 2, max: 6 },
    skills: [
      { id: "ritualist", rating: 4 },
      { id: "theologian", rating: 3 },
      { id: "fighter", rating: 2 },
      { id: "healer", rating: 2 },
      { id: "scavenger", rating: 2 },
    ],
    classTrait: "Between Two Worlds",
    classTraitPage: { book: "LMM", page: 11 },
  },
  "human/skald": {
    will: { kind: "budget", total: 8, min: 2, max: 6 },
    health: { kind: "budget", total: 8, min: 2, max: 6 },
    skills: [
      { id: "orator", rating: 4 },
      { id: "manipulator", rating: 3 },
      { id: "fighter", rating: 2 },
      { id: "loreMaster", rating: 2 },
      { id: "scholar", rating: 2 },
    ],
    classTrait: "Voice of Thunder",
    classTraitPage: { book: "LMM", page: 13 },
  },
  "human/thief": {
    will: { kind: "budget", total: 8, min: 2, max: 6 },
    health: { kind: "budget", total: 8, min: 2, max: 6 },
    skills: [
      { id: "criminal", rating: 3 },
      { id: "manipulator", rating: 3 },
      { id: "scout", rating: 3 },
      { id: "sapper", rating: 2 },
      { id: "fighter", rating: 2 },
    ],
    classTrait: "Devil May Care",
    classTraitPage: { book: "LMM", page: 14 },
  },
};

/**
 * LMM p.9: "Troll changelings may select from the magician, shaman,
 * skald, theurge, thief and warrior classes." For each of those
 * Human-stock rows, the changeling variant has identical abilities /
 * skills / class trait — the stock-level Huldrekall trait is the
 * only addition, and it lives on the Nature defaults so the
 * derivation here can stay mechanical.
 */
const TROLL_CHANGELING_CLASSES: ReadonlyArray<string> = [
  "magician",
  "theurge",
  "warrior",
  "shaman",
  "skald",
  "thief",
];

function buildTrollChangelingRows(
  base: Record<string, ClassDefaults>,
): Record<string, ClassDefaults> {
  const out: Record<string, ClassDefaults> = {};
  for (const klass of TROLL_CHANGELING_CLASSES) {
    const humanRow = base[`human/${klass}`];
    if (!humanRow) continue;
    out[`troll-changeling/${klass}`] = humanRow;
  }
  return out;
}

/**
 * `<stock>/<class>` slug → printed starting stats. The key mirrors
 * `ClassStockOption.key` from `class-stock-options.ts` exactly, so
 * `TB_CLASS_STOCK_OPTIONS.find(o => o.key === k)` and
 * `TB_CLASS_DEFAULTS[k]` always agree on the same row.
 */
export const TB_CLASS_DEFAULTS: Readonly<Record<string, ClassDefaults>> = {
  ...HUMAN_AND_DH_DEFAULTS,
  ...buildTrollChangelingRows(HUMAN_AND_DH_DEFAULTS),
};

/**
 * Per-stock Nature defaults. Base rating 3 plus the canonical three
 * descriptors per stock; the Nature-question flow modifies those, but
 * the player runs that pass on their own — the button only seeds the
 * printed starting state.
 *
 * Sources: DH p.33 for the four base stocks; LMM p.9 for the Troll
 * Changeling row (descriptors Tricking/Boasting/Breaking, plus the
 * stock-required second trait Huldrekall).
 */
export const TB_STOCK_NATURE_DEFAULTS: Readonly<Record<string, StockNatureDefaults>> = {
  Dwarf: { rating: 3, descriptors: ["Delving", "Crafting", "Avenging Grudges"] },
  Elf: { rating: 3, descriptors: ["Singing", "Remembering", "Hiding"] },
  Halfling: { rating: 3, descriptors: ["Sneaking", "Riddling", "Merrymaking"] },
  Human: { rating: 3, descriptors: ["Boasting", "Demanding", "Running"] },
  "Troll Changeling": {
    rating: 3,
    descriptors: ["Tricking", "Boasting", "Breaking"],
    additionalTrait: { name: "Huldrekall", page: { book: "LMM", page: 9 } },
  },
};

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Resolve `(stock, class)` to a defaults row. Comparison is slug-form,
 * matching `lookupClassStockOption` so casing/whitespace variations
 * round-trip through the same canonicalisation.
 */
export function lookupClassDefaults(stock: string, klass: string): ClassDefaults | null {
  const key = `${slug(stock)}/${slug(klass)}`;
  return TB_CLASS_DEFAULTS[key] ?? null;
}

/**
 * Resolve a stock name to its Nature defaults. Whitespace- and
 * case-insensitive but the lookup table is keyed by the title-case
 * names the rulebook uses on the sheet ("Halfling" / "Human" / ...)
 * so the canonical form is what stays in storage.
 */
export function lookupStockNatureDefaults(stock: string): StockNatureDefaults | null {
  const trimmed = stock.trim();
  if (trimmed.length === 0) return null;
  const target = trimmed.toLowerCase();
  for (const [name, defaults] of Object.entries(TB_STOCK_NATURE_DEFAULTS)) {
    if (name.toLowerCase() === target) return defaults;
  }
  return null;
}

/**
 * Resolve a budget ability row to the concrete starting value used by
 * the Apply-starting-stats button. Picks the legal midpoint (4 for
 * the canonical `total: 8, min: 2, max: 6` rows), so the player can
 * nudge ±2 in either direction without breaking the constraint.
 */
export function abilityStartingValue(spec: AbilityDefault): number {
  if (spec.kind === "fixed") return spec.value;
  return Math.floor(spec.total / 2);
}
