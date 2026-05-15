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

import { describe, it, expect } from "vitest";
import type { DieOutcome } from "@vtt/resolution/shared";
import { specForOutcome, specCacheKey, type DieSpec } from "./spec.js";

const die = (
  sides: DieOutcome["sides"],
  value: number,
): DieOutcome => ({ sides, value });

describe("specForOutcome (Platonic dice)", () => {
  it.each([
    [4, "platonic", 4],
    [6, "platonic", 6],
    [8, "platonic", 8],
    [12, "platonic", 12],
    [20, "platonic", 20],
  ] as const)("d%i → platonic spec sides=%i", (sides, kind, expectedSides) => {
    const out = specForOutcome(die(sides, 1));
    expect(out).toHaveLength(1);
    expect(out[0]!.spec.kind).toBe(kind);
    if (out[0]!.spec.kind === "platonic") {
      expect(out[0]!.spec.sides).toBe(expectedSides);
    }
    expect(out[0]!.value).toBe(1);
  });
});

describe("specForOutcome (d10 / d100)", () => {
  it("d10 → standard trapezohedron, sides=10", () => {
    const out = specForOutcome(die(10, 7));
    expect(out).toHaveLength(1);
    expect(out[0]!.spec).toEqual({
      kind: "trapezohedron",
      sides: 10,
      labelSet: "standard",
    });
    expect(out[0]!.value).toBe(7);
  });

  it("d100 → tens + units, both at value 0 for face value 100", () => {
    const out = specForOutcome(die(100, 100));
    expect(out).toHaveLength(2);
    expect(out[0]!.spec).toEqual({
      kind: "trapezohedron",
      sides: 10,
      labelSet: "tens",
    });
    expect(out[0]!.value).toBe(0);
    expect(out[1]!.spec).toEqual({ kind: "unitsD10" });
    expect(out[1]!.value).toBe(0);
  });

  it.each([
    [42, 40, 2],
    [1, 0, 1],
    [10, 10, 0],
    [99, 90, 9],
  ])("d100 value %i → tens=%i, units=%i", (v, expectedTens, expectedUnits) => {
    const out = specForOutcome(die(100, v));
    expect(out).toHaveLength(2);
    expect(out[0]!.value).toBe(expectedTens);
    expect(out[1]!.value).toBe(expectedUnits);
  });

  it("d100 tens vs units use DIFFERENT cache keys (k=5 collision guard)", () => {
    const out = specForOutcome(die(100, 50));
    const tensKey = specCacheKey(out[0]!.spec);
    const unitsKey = specCacheKey(out[1]!.spec);
    const standardD10Key = specCacheKey({
      kind: "trapezohedron",
      sides: 10,
      labelSet: "standard",
    });
    expect(tensKey).not.toBe(unitsKey);
    expect(tensKey).not.toBe(standardD10Key);
    expect(unitsKey).not.toBe(standardD10Key);
  });
});

describe("specForOutcome (exotic dice — the bug fix)", () => {
  it("d2 → lens", () => {
    const out = specForOutcome(die(2, 1));
    expect(out).toHaveLength(1);
    expect(out[0]!.spec.kind).toBe("lens");
    expect(out[0]!.value).toBe(1);
  });

  it.each([3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 25, 33])(
    "d%i (odd) → prism at the correct N",
    (n) => {
      const out = specForOutcome(die(n, 1));
      expect(out).toHaveLength(1);
      expect(out[0]!.spec.kind).toBe("prism");
      if (out[0]!.spec.kind === "prism") {
        expect(out[0]!.spec.sides).toBe(n);
      }
    },
  );

  it.each([14, 16, 18, 22, 24, 30, 50])(
    "d%i (even ≥14) → trapezohedron at sides=%i",
    (n) => {
      const out = specForOutcome(die(n, 1));
      expect(out).toHaveLength(1);
      expect(out[0]!.spec.kind).toBe("trapezohedron");
      if (out[0]!.spec.kind === "trapezohedron") {
        expect(out[0]!.spec.sides).toBe(n);
        expect(out[0]!.spec.labelSet).toBe("standard");
      }
    },
  );

  it("d30 does NOT collapse to d20 (the bug we're fixing)", () => {
    const out = specForOutcome(die(30, 17));
    expect(out[0]!.spec.kind).toBe("trapezohedron");
    if (out[0]!.spec.kind === "trapezohedron") {
      expect(out[0]!.spec.sides).toBe(30);
    }
  });

  it("d2 does NOT collapse to d20 (the bug we're fixing)", () => {
    const out = specForOutcome(die(2, 1));
    expect(out[0]!.spec.kind).toBe("lens");
  });

  it("d3 does NOT collapse to d20 (the bug we're fixing)", () => {
    const out = specForOutcome(die(3, 2));
    expect(out[0]!.spec.kind).toBe("prism");
    if (out[0]!.spec.kind === "prism") {
      expect(out[0]!.spec.sides).toBe(3);
    }
  });
});

describe("specForOutcome (Fudge)", () => {
  it("Fudge → fudge spec, value passes through", () => {
    const out = specForOutcome(die("F", -1));
    expect(out).toHaveLength(1);
    expect(out[0]!.spec).toEqual({ kind: "fudge" });
    expect(out[0]!.value).toBe(-1);
  });
});

describe("specForOutcome (d1 edge case)", () => {
  it("d1 (parser-legal but degenerate) → lens at value 1", () => {
    const out = specForOutcome(die(1, 1));
    expect(out).toHaveLength(1);
    expect(out[0]!.spec.kind).toBe("lens");
  });
});

describe("specCacheKey", () => {
  const cases: { spec: DieSpec; key: string }[] = [
    { spec: { kind: "platonic", sides: 6 }, key: "platonic:6" },
    { spec: { kind: "platonic", sides: 20 }, key: "platonic:20" },
    {
      spec: { kind: "trapezohedron", sides: 10, labelSet: "standard" },
      key: "trap:10:standard",
    },
    {
      spec: { kind: "trapezohedron", sides: 10, labelSet: "tens" },
      key: "trap:10:tens",
    },
    {
      spec: { kind: "trapezohedron", sides: 30, labelSet: "standard" },
      key: "trap:30:standard",
    },
    { spec: { kind: "prism", sides: 7 }, key: "prism:7" },
    { spec: { kind: "lens" }, key: "lens" },
    { spec: { kind: "unitsD10" }, key: "unitsD10" },
    { spec: { kind: "fudge" }, key: "fudge" },
  ];
  it.each(cases)("$key", ({ spec, key }) => {
    expect(specCacheKey(spec)).toBe(key);
  });
});
