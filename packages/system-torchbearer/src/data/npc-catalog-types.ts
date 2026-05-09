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

import type { TbBookPageRef } from "./monster-catalog-types.js";

/**
 * Shape of one NPC template in the catalog. Mirrors `TbMonsterTemplate`
 * — same id-shape, same source-book metadata, same intent: a typed,
 * stable, hand-curated record that seeds entity-spawning at runtime.
 *
 * Like monsters, NPC instances are unique per spawn (each Bandit is
 * its own entity with its own conditions, position, name). The catalog
 * is therefore a "lookup table" the GM picks from at create time, not
 * a seed-and-share structure. `runCatalogMerge` is not used;
 * `CreateNpcFromCatalog` resolves the template at validate time and
 * emits an `NpcCreated` event with the resolved fields inline.
 *
 * The template carries only the *structural* data the rulebook prints
 * as numbers, tables, and labels — no italic flavor blurb, no
 * paraphrased descriptions, no GM-facing notes. Description prose
 * lives in the rulebook PDF; the sheet deep-links via `pageRef`
 * instead of duplicating the publisher's text.
 */
export interface TbNpcTemplate {
  /** Stable plugin-namespaced id, e.g. "tb/npc/alchemist". */
  readonly id: string;
  /**
   * Display name. For canon "Beasts with Two Legs" entries this is the
   * proper-noun role ("Alchemist", "Bandit"). For named-personality
   * entries (Beronin) this is the proper name; the `role` field carries
   * the descriptor.
   */
  readonly name: string;
  /** Denizen-role label ("Alchemist", "Bandit Chief, Dwarf"). */
  readonly role: string;
  readonly sourceBook: "DH" | "LMM" | "SG" | "Unknown";
  readonly sourcePage: number | null;
  /** Canonical-book deep-link to the printed stat block. */
  readonly pageRef: TbBookPageRef;
  /** Local icon path or "" for none. */
  readonly img: string;
  /** Nature rating + descriptors. */
  readonly nature: {
    readonly rating: number;
    readonly descriptors: ReadonlyArray<string>;
  };
  /** Will rating (printed Raw Abilities table). */
  readonly will: number;
  /** Health rating (printed Raw Abilities table). */
  readonly health: number;
  /** Resources rating (printed Town Abilities table). */
  readonly resources: number;
  /** Circles rating (printed Town Abilities table). */
  readonly circles: number;
  /**
   * Might. Always 2 for the SG "Beasts with Two Legs" denizens
   * (SG p.201 "their Might is always 2"); named personalities may vary.
   */
  readonly might: number;
  /** Precedence rating. */
  readonly precedence: number;
  /** Skills: { skillId, rating } in the printed order. */
  readonly skills: ReadonlyArray<{
    readonly skillId: string;
    readonly rating: number;
  }>;
  /** Free-text wise names ("Forest-wise", "Crossroads-wise"). */
  readonly wises: ReadonlyArray<string>;
  /** TB-traits: { name, level } pairs ("Bitter (1)" → name="Bitter", level=1). */
  readonly traits: ReadonlyArray<{
    readonly name: string;
    readonly level: number;
  }>;
  /**
   * Catalog item-template references — the printed "Gear: leather
   * armor, helmet, sword, dagger" line, mapped to real TB item
   * catalog ids. The spawn pipeline resolves each id against the
   * world's items-catalog index (`ItemCatalogIndex`) at command-apply
   * time and equips the resulting entities onto the NPC's `TbCarries`,
   * so weapons surface in the conflict weapon picker exactly like a
   * PC's gear.
   *
   * `slot` is the `TbCarries` slot key — `"torso"` for body armor,
   * `"head"` for helmets, `"carried:N"` for held weapons, etc. The
   * spawn system uses this verbatim. Empty list for entries whose
   * printed block omits gear (most SG denizens).
   */
  readonly gear: ReadonlyArray<{
    readonly itemTemplateId: string;
    readonly slot: string;
  }>;
}
