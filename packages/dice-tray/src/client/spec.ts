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
 * Map a wire-side `DieOutcome` (which carries `sides: number | "F"`
 * and a numeric `value`) to one or more `DieSpec` + value pairs the
 * scene knows how to render.
 *
 * The translation is mostly 1:1 — but `sides: 100` expands into TWO
 * spawns (a "tens" trapezohedron with labels "10"…"90","00" and a
 * "units" d10 with labels "0"…"9"), and very small N gets routed to
 * the lens / prism families since there's no Platonic solid that
 * fits.
 *
 * Cache-key correctness depends on this file's output:
 * `DieSpec` is the discriminator scene.ts uses to look up the cached
 * mesh + materials. Two callers that share geometry but want
 * different labels (raw d10 1..10 versus units-d10 0..9, or d100
 * tens versus d10) must produce DIFFERENT specs so the cache doesn't
 * collide on label-set.
 */

import type { DieOutcome } from "@vtt/resolution/shared";

/**
 * Discriminated union describing every die the tray can render.
 *
 *   platonic       — Platonic solids hand-rolled at known proportions
 *                    (d4, d6, d8, d12, d20). d10 uses `trapezohedron`
 *                    with k=5.
 *   trapezohedron  — N = 2k kite-faced "spindle" dice with optional
 *                    label override. `labelSet: "standard"` paints
 *                    1..N; `"tens"` paints "10","20",..."90","00".
 *   prism          — rounded N-prism / "long die" for any N ≥ 3.
 *                    Used for odd N (d3, d5, d7, d9, …) since
 *                    trapezohedrons require even N.
 *   lens           — N=2 (a thick disc), labels "1" / "2".
 *   unitsD10       — pentagonal trapezohedron with labels
 *                    "0"…"9"; the *units* half of a d100. Distinct
 *                    from a 1..10 d10 even though both use k=5
 *                    geometry.
 *   fudge          — d6 geometry, +/-/blank labels.
 */
export type DieSpec =
  | { kind: "platonic"; sides: 4 | 6 | 8 | 12 | 20 }
  | { kind: "trapezohedron"; sides: number; labelSet: "standard" | "tens" }
  | { kind: "prism"; sides: number }
  | { kind: "lens" }
  | { kind: "unitsD10" }
  | { kind: "fudge" };

/** Cache key string. The two `trapezohedron` variants of k=5
 *  (standard d10 versus the tens half of d100) get DIFFERENT keys
 *  because their `labelSet` differs — the cache must hold distinct
 *  textures for each. */
export function specCacheKey(spec: DieSpec): string {
  switch (spec.kind) {
    case "platonic":
      return `platonic:${spec.sides}`;
    case "trapezohedron":
      return `trap:${spec.sides}:${spec.labelSet}`;
    case "prism":
      return `prism:${spec.sides}`;
    case "lens":
      return "lens";
    case "unitsD10":
      return "unitsD10";
    case "fudge":
      return "fudge";
  }
}

/** One spawn request: the spec the tray should render plus the
 *  numeric face value to land. */
export interface SpawnRequest {
  spec: DieSpec;
  value: number;
}

/**
 * Translate a single `DieOutcome` into the spawn requests it needs.
 *
 * - Standard Platonic numerics (4, 6, 8, 12, 20) → one Platonic spec
 * - `sides: 10` → one trapezohedron(k=5, standard)
 * - `sides: "F"` → one fudge spec
 * - `sides: 100` → TWO spawns (tens trapezohedron + units d10)
 * - `sides: 2` → one lens
 * - `sides: 3, 5, 7, 9, …` (odd) and unrecognised numerics →
 *   one prism spec at that N
 * - Even `sides` ≥ 14 → one trapezohedron with k = sides/2
 * - `sides: 1` → render as a lens (only ever rolls 1, but the
 *   parser accepts `d1` so we have to draw *something*)
 */
export function specForOutcome(die: DieOutcome): SpawnRequest[] {
  if (die.sides === "F") {
    return [{ spec: { kind: "fudge" }, value: die.value }];
  }
  const sides = die.sides;
  if (sides === 100) {
    const v = die.value;
    const tensValue = v === 100 ? 0 : Math.floor(v / 10) * 10;
    const unitsValue = v % 10;
    return [
      {
        spec: { kind: "trapezohedron", sides: 10, labelSet: "tens" },
        value: tensValue,
      },
      { spec: { kind: "unitsD10" }, value: unitsValue },
    ];
  }
  if (sides === 4 || sides === 6 || sides === 8 || sides === 12 || sides === 20) {
    return [{ spec: { kind: "platonic", sides }, value: die.value }];
  }
  if (sides === 10) {
    return [
      {
        spec: { kind: "trapezohedron", sides: 10, labelSet: "standard" },
        value: die.value,
      },
    ];
  }
  if (sides === 2 || sides === 1) {
    return [{ spec: { kind: "lens" }, value: die.value }];
  }
  // Even N ≥ 14 → trapezohedron with k = sides/2. Odd N → prism.
  // (Even N = 12 already matched Platonic above; even N = 10 already
  // matched the standard d10.)
  if (sides >= 14 && sides % 2 === 0) {
    return [
      {
        spec: { kind: "trapezohedron", sides, labelSet: "standard" },
        value: die.value,
      },
    ];
  }
  // Everything else (odd ≥ 3, or any leftover even count we didn't
  // explicitly handle) → prism.
  return [{ spec: { kind: "prism", sides }, value: die.value }];
}
