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
 * Shape of a single template in the TB item catalog. Mirrors the
 * Foundry pack data, normalised to a typed TS structure that the
 * seed hook uses to build the per-world entity bag.
 *
 * `id` is stable across seeds: derived once at import time and never
 * changes for a given item, which lets the merge engine track
 * existing entities back to their templates.
 */
export interface TbItemTemplate {
  /** Stable plugin-namespaced id, e.g. "tb/equipment/bag-of-nails-a3b4c5". */
  readonly id: string;
  readonly name: string;
  /** Foundry pack-dir name (armor / equipment / weapons / …). */
  readonly category: string;
  /** Source book key, used in citations. */
  readonly sourceBook: "DH" | "LMM" | "SG" | "Unknown";
  /** Printed page in the source book. Null for items whose Foundry data didn't include one. */
  readonly sourcePage: number | null;
  /** Free-text description, often a "<book>, p. <n>" citation. */
  readonly description: string;
  /** Local icon path ("/icons/<author>/<name>.svg") or "" for none. */
  readonly img: string;
  /** Purchase cost (TB obstacle die). */
  readonly cost?: number;
  /** Treasure-value-in-town shape. */
  readonly value?: { dice: number; negotiated: boolean };
  /** Allowed slots and how many slots the item consumes in each. */
  readonly slotOptions: Record<string, number>;
  /** Conditional skill bonuses while equipped. */
  readonly skillBonuses: ReadonlyArray<{
    skill: string;
    value: number;
    condition: string;
  }>;
  /** Free-text rules clarification. */
  readonly specialRules: string;
  /**
   * Bundle/stack info for items that come in fixed-size groups
   * AND for consumables-with-uses (rations, oil flasks, holy
   * water vials, draughts in a vessel). When set, the seed
   * materialises an ItemBundle trait with the given count +
   * capacity. The inventory UI renders a pip strip for any
   * entity that carries ItemBundle and lets the player click a
   * pip to set the count directly.
   *
   * Light sources (torches, lantern) stay on TbSupply +
   * state.turnsRemaining for their separate turn-of-fuel
   * mechanic; an outer "pack of N torches" can still be a bundle
   * here while each individual lit torch tracks fuel via
   * TbSupply.
   */
  readonly bundle?: { count: number; capacity: number };
  /**
   * Liquid-vessel info — set on waterskin/wineskin/bottle/jug/
   * canteen templates to declare that the entity is a vessel
   * that holds a liquid. `defaultContents` seeds the entity's
   * TbLiquidVessel trait; the player can change it later.
   * Vessels also carry a `bundle` of `{count: N, capacity: N}`
   * for their max draughts.
   */
  readonly liquid?: {
    readonly defaultContents: "water" | "wine" | "other" | "empty";
  };
  readonly kind:
    | { type: "gear" }
    | { type: "armor"; armorType: string; absorbs: number }
    | {
        type: "weapon";
        wield: 1 | 2;
        conflictBonuses: {
          attack: { type: string; value: number };
          defend: { type: string; value: number };
          feint: { type: string; value: number };
          maneuver: { type: string; value: number };
        };
      }
    | {
        type: "supply";
        supplyType: string;
        turnsRemaining: number;
        lit: boolean;
        nameSingular: string;
      }
    | { type: "container"; containerType: string; containerSlots: number }
    | {
        type: "spellbook";
        /** Folio capacity, canonically 5 (DH p.92). */
        folios: number;
      }
    | {
        type: "scroll";
        /**
         * Plugin-namespaced spell template id this scroll holds, or
         * null for a blank scroll (writable medium). The seed resolves
         * `spellTemplateId` to the actual spell entity id at world
         * boot via SpellCatalogIndex.
         */
        spellTemplateId: string | null;
      };
}
