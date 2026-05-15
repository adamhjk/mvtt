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

// Hometown ("Where Is Your Home?") defaults from DH p.30. Each
// settlement contributes three skills at rating 2 and offers a choice
// of two traits to start at level 1. Elfhome is restricted to elves
// by RAW; the other six are open to any stock.
//
// The picker writes the hometown's canonical label into `Identity.home`
// (so the existing free-text Home field reflects the choice), bumps
// each skill via the shared `nextSkillRating` rule, and appends the
// chosen trait to `CharacterTraits.entries`.

export interface HometownDefaults {
  /** Stable slug key — kebab-case of the printed label. */
  readonly key: string;
  /** Title-case label as printed in the rulebook + displayed on the sheet. */
  readonly label: string;
  /** Three skill ids contributed by this hometown (rating 2 each). */
  readonly skills: ReadonlyArray<string>;
  /**
   * Two trait options listed in the rulebook. The picker offers both;
   * the player picks one and it starts at level 1. The unpicked option
   * stays available as a future Nature-question swap target.
   */
  readonly traits: ReadonlyArray<string>;
  /**
   * Stock gate — only present for Elfhome (DH p.30: "Elfhome (elves
   * only)"). Absent for the other six settlements which any stock can
   * claim as home.
   */
  readonly stockRestriction?: string;
  /** Page ref for the rule chip beside the picker. */
  readonly page: { readonly book: "DH" | "LMM"; readonly page: number };
}

/**
 * Printed-order map (DH p.30 lists Elfhome first as the stock-restricted
 * variant, then six common settlements). The map keys are slugs so
 * lookup by `Identity.home` canonical label round-trips cleanly through
 * `lookupHometownDefaults`.
 */
export const TB_HOMETOWN_DEFAULTS: Readonly<Record<string, HometownDefaults>> = {
  elfhome: {
    key: "elfhome",
    label: "Elfhome",
    skills: ["healer", "mentor", "pathfinder"],
    traits: ["Calm", "Quiet"],
    stockRestriction: "Elf",
    page: { book: "DH", page: 30 },
  },
  "dwarven-halls": {
    key: "dwarven-halls",
    label: "Dwarven Halls",
    skills: ["armorer", "laborer", "stonemason"],
    traits: ["Cunning", "Fiery"],
    page: { book: "DH", page: 30 },
  },
  "religious-bastion": {
    key: "religious-bastion",
    label: "Religious Bastion",
    skills: ["cartographer", "scholar", "theologian"],
    traits: ["Defender", "Scarred"],
    page: { book: "DH", page: 30 },
  },
  "bustling-metropolis": {
    key: "bustling-metropolis",
    label: "Bustling Metropolis",
    skills: ["haggler", "sailor", "steward"],
    traits: ["Extravagant", "Jaded"],
    page: { book: "DH", page: 30 },
  },
  "wizards-tower": {
    key: "wizards-tower",
    label: "Wizard's Tower",
    skills: ["alchemist", "loreMaster", "scholar"],
    traits: ["Skeptical", "Thoughtful"],
    page: { book: "DH", page: 30 },
  },
  "remote-village": {
    key: "remote-village",
    label: "Remote Village",
    skills: ["carpenter", "peasant", "weaver"],
    traits: ["Early Riser", "Rough Hands"],
    page: { book: "DH", page: 30 },
  },
  "busy-crossroads": {
    key: "busy-crossroads",
    label: "Busy Crossroads",
    skills: ["cook", "haggler", "rider"],
    traits: ["Foolhardy", "Quick-Witted"],
    page: { book: "DH", page: 30 },
  },
};

/** Ordered list of hometown keys for dropdown rendering. */
export const TB_HOMETOWN_KEYS: ReadonlyArray<string> = Object.keys(
  TB_HOMETOWN_DEFAULTS,
);

function slug(s: string): string {
  // Strip possessive apostrophes (curly and straight) before the
  // non-alphanumeric replacement so labels like "Wizard's Tower"
  // produce "wizards-tower" rather than "wizard-s-tower". Without
  // this step, picking that hometown leaves Identity.home set to
  // "Wizard's Tower" but every subsequent lookup of that label
  // returns null, breaking the trait sub-picker for that settlement.
  return s
    .trim()
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Resolve a hometown by either its slug key (`dwarven-halls`) or its
 * canonical label (`Dwarven Halls`, case- and whitespace-insensitive).
 * Returns null for unknown / custom hometown names — the picker uses
 * that to fall back to its empty placeholder rather than guessing.
 */
export function lookupHometownDefaults(name: string): HometownDefaults | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  // Direct slug hit.
  const direct = TB_HOMETOWN_DEFAULTS[trimmed];
  if (direct) return direct;
  const asSlug = slug(trimmed);
  return TB_HOMETOWN_DEFAULTS[asSlug] ?? null;
}

/**
 * Subset of the catalog visible to a given stock. Elfhome only shows
 * for elves; the rest are unconditional. Empty stock string returns
 * the unrestricted six (no Elfhome) — the picker uses that as its
 * default option set before the player picks a stock.
 */
export function hometownsForStock(stock: string): ReadonlyArray<HometownDefaults> {
  const trimmed = stock.trim();
  const target = trimmed.toLowerCase();
  const out: HometownDefaults[] = [];
  for (const key of TB_HOMETOWN_KEYS) {
    const h = TB_HOMETOWN_DEFAULTS[key]!;
    if (h.stockRestriction && h.stockRestriction.toLowerCase() !== target) continue;
    out.push(h);
  }
  return out;
}
