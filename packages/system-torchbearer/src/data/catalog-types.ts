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
   * (e.g. torches: pack 1 for 4 torches; iron spikes: pack 1 for
   * 6 spikes; small sacks: pack 1 for 2 empty sacks). When set,
   * the seed materialises an ItemBundle trait with the given
   * count + capacity. Bottles, jugs, rations etc. are NOT bundles
   * — they hold doses/portions/draughts that are consumed one
   * at a time and refilled, modelled by TbSupply.turnsRemaining.
   */
  readonly bundle?: { count: number; capacity: number };
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
    | { type: "container"; containerType: string; containerSlots: number };
}
