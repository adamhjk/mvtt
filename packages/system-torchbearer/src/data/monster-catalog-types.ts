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

import type { ConflictType } from "../conflict/shared/conflict-types.js";

/**
 * Reference into a canonical TB2 rulebook. Plugin content carries
 * `{ canonicalId, page }` rather than copying rulebook prose: the
 * sheet renders a `<BookCitation>` that the GM can click to deep-link
 * into the bound Book entity. `canonicalId` matches one of
 * `TB_CANONICAL_BOOKS`; `page` is the printed page number.
 */
export interface TbBookPageRef {
  readonly canonicalId: string;
  readonly page: number;
}

/**
 * Shape of one monster template in the catalog. Mirrors `TbItemTemplate`
 * — same id-shape, same source-book metadata, same intent: a typed,
 * stable, hand-curated record that seeds entity-spawning at runtime.
 *
 * Unlike items (which are deduplicated across holders so the catalog
 * seeds one entity per template at boot), monster instances are unique
 * per spawn — each Vampire Lord is its own entity with its own
 * conditions, position, name. The catalog is therefore a "lookup
 * table" the GM picks from at create time, not a seed-and-share
 * structure. `runCatalogMerge` is not used; `CreateMonsterFromCatalog`
 * resolves the template at validate time and emits a `MonsterCreated`
 * event with the resolved fields inline.
 *
 * The template carries only the *structural* data the rulebook prints
 * as numbers, tables, and labels — no italic flavor blurb, no
 * paraphrased descriptions, no instinct text, no armor prose, no
 * special-rule bodies. Prose lives in the rulebook PDF; the sheet
 * deep-links via `pageRef` instead of duplicating the publisher's
 * text.
 */
export interface TbMonsterTemplate {
  /** Stable plugin-namespaced id, e.g. "tb/monster/vampire-lord". */
  readonly id: string;
  readonly name: string;
  readonly sourceBook: "DH" | "LMM" | "SG" | "Unknown";
  readonly sourcePage: number | null;
  /** Canonical-book deep-link to the printed stat block. */
  readonly pageRef: TbBookPageRef;
  /** Local icon path or "" for none. */
  readonly img: string;
  /** Nature rating + descriptors (SG p.171). */
  readonly nature: {
    readonly rating: number;
    readonly descriptors: ReadonlyArray<string>;
  };
  /** Might rank (SG p.174 — 1 critters … 8 immortals). */
  readonly might: number;
  /** Monstrous Precedence (SG p.176 — 0 villagers … 7 immortals). */
  readonly precedence: number;
  /** Type tag — "undead", "troll", "spirit", "beast", "dragon", "ooze", "automaton", "folk". */
  readonly type: string;
  /**
   * Catalog templateId of the armor item to equip on the monster.
   * Null = no armor entry (natural armor / no listed armor).
   *
   * The CreateMonsterFromCatalog command resolves this at validate
   * time against the items catalog index. If the item catalog hasn't
   * been seeded yet (race during world boot), the spawn proceeds
   * without an equipped armor entry — the GM can equip it later.
   */
  readonly armorItemTemplateId: string | null;
  /** Predetermined dispositions per conflict type. */
  readonly dispositions: ReadonlyArray<{
    readonly conflictType: ConflictType;
    readonly value: number;
  }>;
  /**
   * Named special rules. The body of each rule lives in the rulebook
   * — the sheet deep-links via `pageRef`.
   */
  readonly specialRules: ReadonlyArray<{
    readonly name: string;
    readonly pageRef: TbBookPageRef;
  }>;
  /** Monstrous-weapons table. */
  readonly weapons: ReadonlyArray<TbMonsterWeaponTemplate>;
}

export interface TbMonsterWeaponTemplate {
  readonly name: string;
  readonly conflicts: ReadonlyArray<ConflictType>;
  readonly bonuses: {
    readonly attack: { type: "dice" | "rerolls" | "success"; value: number };
    readonly defend: { type: "dice" | "rerolls" | "success"; value: number };
    readonly feint: { type: "dice" | "rerolls" | "success"; value: number };
    readonly maneuver: { type: "dice" | "rerolls" | "success"; value: number };
  };
}
