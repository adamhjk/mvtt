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

// Class + stock combinations recognised by Torchbearer 2e, with deep-
// link page numbers for the class description and the level-benefit
// table. Drives the dropdown on the Who You Are tab — selecting a row
// writes both `Identity.stock` and `Identity.class`, and the
// adjacent chips link straight to the rulebook.
//
// DH p.26-27 — six base class+stock pairs (Halfling/Burglar,
// Human/Magician, Dwarf/Outcast, Elf/Ranger, Human/Theurge,
// Human/Warrior). Class chapter pages match the layout there; level-
// benefit pages from the DH index.
//
// LMM p.8 — Troll Changeling stock that swaps in for Human across
// every Human-stock class.
// LMM p.11/13/14 — Shaman / Skald / Thief class chapters.
// Level benefits via the LMM index (Shaman p.15, Skald p.19, Thief
// p.23).

export interface ClassStockOption {
  /** Stable selector key — `<stock>/<class>`, lowercase, slug form. */
  readonly key: string;
  /** Title-case stock name as written on the sheet. */
  readonly stock: string;
  /** Title-case class name as written on the sheet. */
  readonly class: string;
  /** Display label for the dropdown row. */
  readonly label: string;
  /** Page reference for the class chapter (sheet stat block). */
  readonly classPageRef: { book: "DH" | "LMM"; page: number };
  /** Page reference for the class's level-benefits table. */
  readonly levelPageRef: { book: "DH" | "LMM"; page: number };
  /**
   * Stock chapter / Nature-question page for the chosen stock —
   * Halfling/Dwarf/Elf land on their DH Nature-question sheets,
   * Human on the Upbringing chapter, Troll Changeling on its LMM
   * stock chapter. Absent only for hypothetical future stocks that
   * haven't been catalogued.
   */
  readonly stockPageRef?: { book: "DH" | "LMM"; page: number };
}

/**
 * Per-stock chapter pages in the rulebook. Linked from the Stock
 * dropdown chip so a player can jump straight to their stock's
 * Nature-question sheet (Halfling p.35, Dwarf p.33, Elf p.34) or
 * Upbringing chapter (Human p.29). Troll Changeling has a dedicated
 * stock chapter at LMM p.8.
 */
const STOCK_PAGE_REF: Record<string, { book: "DH" | "LMM"; page: number }> = {
  Halfling: { book: "DH", page: 35 },
  Human: { book: "DH", page: 29 },
  Dwarf: { book: "DH", page: 33 },
  Elf: { book: "DH", page: 34 },
  "Troll Changeling": { book: "LMM", page: 8 },
};

interface BasePair {
  readonly stock: string;
  readonly class: string;
  readonly classPageRef: { book: "DH" | "LMM"; page: number };
  readonly levelPageRef: { book: "DH" | "LMM"; page: number };
}

const DH_BASE: ReadonlyArray<BasePair> = [
  { stock: "Halfling", class: "Burglar", classPageRef: { book: "DH", page: 26 }, levelPageRef: { book: "DH", page: 113 } },
  { stock: "Human", class: "Magician", classPageRef: { book: "DH", page: 26 }, levelPageRef: { book: "DH", page: 115 } },
  { stock: "Dwarf", class: "Outcast", classPageRef: { book: "DH", page: 26 }, levelPageRef: { book: "DH", page: 119 } },
  { stock: "Elf", class: "Ranger", classPageRef: { book: "DH", page: 27 }, levelPageRef: { book: "DH", page: 122 } },
  { stock: "Human", class: "Theurge", classPageRef: { book: "DH", page: 27 }, levelPageRef: { book: "DH", page: 125 } },
  { stock: "Human", class: "Warrior", classPageRef: { book: "DH", page: 27 }, levelPageRef: { book: "DH", page: 129 } },
];

const LMM_HUMAN_CLASSES: ReadonlyArray<BasePair> = [
  { stock: "Human", class: "Shaman", classPageRef: { book: "LMM", page: 11 }, levelPageRef: { book: "LMM", page: 15 } },
  { stock: "Human", class: "Skald", classPageRef: { book: "LMM", page: 13 }, levelPageRef: { book: "LMM", page: 19 } },
  { stock: "Human", class: "Thief", classPageRef: { book: "LMM", page: 14 }, levelPageRef: { book: "LMM", page: 23 } },
];

/**
 * LMM p.8 introduces the Troll Changeling stock — a swap-in for any
 * Human-stock class. Carries the same class + level-benefit pointers
 * as the underlying class (Magician → DH p.26 / p.115, Skald → LMM
 * p.13 / p.19, etc.) and the LMM p.8 stock chip via the shared
 * `STOCK_PAGE_REF` table.
 */
const TROLL_CHANGELING_VARIANTS: ReadonlyArray<BasePair> = [
  ...DH_BASE.filter((o) => o.stock === "Human"),
  ...LMM_HUMAN_CLASSES,
].map((o) => ({ ...o, stock: "Troll Changeling" }));

function slug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "-");
}

function withKeyLabel(o: BasePair): ClassStockOption {
  const stockPageRef = STOCK_PAGE_REF[o.stock];
  return {
    ...o,
    key: `${slug(o.stock)}/${slug(o.class)}`,
    label: `${o.stock} / ${o.class}`,
    ...(stockPageRef ? { stockPageRef } : {}),
  };
}

/**
 * Full ordered list, DH first (matches the printed sheet's order),
 * then LMM expansion classes, then Troll Changeling variants.
 */
export const TB_CLASS_STOCK_OPTIONS: ReadonlyArray<ClassStockOption> = [
  ...DH_BASE.map(withKeyLabel),
  ...LMM_HUMAN_CLASSES.map(withKeyLabel),
  ...TROLL_CHANGELING_VARIANTS.map(withKeyLabel),
];

/**
 * Match a stored `(stock, class)` pair back to its catalog row.
 * Comparison is slug-form so casing variations on the sheet ("human"
 * / "Human" / "HUMAN") still match. Returns null when neither field
 * is set or the combination is one we don't have a chip for.
 */
export function lookupClassStockOption(
  stock: string,
  klass: string,
): ClassStockOption | null {
  const key = `${slug(stock.trim())}/${slug(klass.trim())}`;
  return TB_CLASS_STOCK_OPTIONS.find((o) => o.key === key) ?? null;
}

/* -------------------------------------------------------------------------
 * Cross-filter helpers — the Who You Are tab renders one dropdown per
 * axis and uses these to constrain the other dropdown's options. Both
 * lists are derived from `TB_CLASS_STOCK_OPTIONS` so adding a new
 * combination is a single-file edit.
 * ----------------------------------------------------------------------- */

/** Sorted unique stock names — preserves the catalog's first-seen order. */
export const TB_STOCK_NAMES: ReadonlyArray<string> = (() => {
  const seen: string[] = [];
  for (const o of TB_CLASS_STOCK_OPTIONS) {
    if (!seen.includes(o.stock)) seen.push(o.stock);
  }
  return seen;
})();

/** Sorted unique class names — preserves the catalog's first-seen order. */
export const TB_CLASS_NAMES: ReadonlyArray<string> = (() => {
  const seen: string[] = [];
  for (const o of TB_CLASS_STOCK_OPTIONS) {
    if (!seen.includes(o.class)) seen.push(o.class);
  }
  return seen;
})();

/**
 * Stocks that may pair with the given class. Returns the full list
 * when `klass` is empty so the dropdown shows all options before the
 * user picks anything. Comparison is slug-form (case-insensitive).
 */
export function stocksForClass(klass: string): ReadonlyArray<string> {
  if (klass.trim().length === 0) return TB_STOCK_NAMES;
  const k = slug(klass);
  const out: string[] = [];
  for (const o of TB_CLASS_STOCK_OPTIONS) {
    if (slug(o.class) !== k) continue;
    if (!out.includes(o.stock)) out.push(o.stock);
  }
  return out.length > 0 ? out : TB_STOCK_NAMES;
}

/**
 * Classes that may pair with the given stock. Returns the full list
 * when `stock` is empty. Comparison is slug-form (case-insensitive).
 */
export function classesForStock(stock: string): ReadonlyArray<string> {
  if (stock.trim().length === 0) return TB_CLASS_NAMES;
  const s = slug(stock);
  const out: string[] = [];
  for (const o of TB_CLASS_STOCK_OPTIONS) {
    if (slug(o.stock) !== s) continue;
    if (!out.includes(o.class)) out.push(o.class);
  }
  return out.length > 0 ? out : TB_CLASS_NAMES;
}

/**
 * Slug-compare two names. Exposed so the tab UI can decide whether
 * the currently-stored value belongs to the cross-filtered list
 * without reaching for a string library.
 */
export function namesMatch(a: string, b: string): boolean {
  return slug(a.trim()) === slug(b.trim());
}
