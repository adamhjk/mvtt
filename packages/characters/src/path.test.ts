// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import { getAtPath, setAtPath } from "./shared/path.js";

describe("getAtPath", () => {
  it("returns the root for an empty path", () => {
    expect(getAtPath({ a: 1 }, [])).toEqual({ a: 1 });
  });

  it("walks string keys into objects", () => {
    expect(getAtPath({ scores: { str: 16 } }, ["scores", "str"])).toBe(16);
  });

  it("walks numeric indices into arrays", () => {
    expect(getAtPath({ items: ["a", "b"] }, ["items", 1])).toBe("b");
  });

  it("returns undefined when an intermediate is missing", () => {
    expect(getAtPath({ a: 1 }, ["b", "c"])).toBeUndefined();
  });

  it("returns undefined when types mismatch", () => {
    expect(getAtPath({ a: 1 }, ["a", "b"])).toBeUndefined();
    expect(getAtPath([1, 2, 3], ["x"])).toBeUndefined();
  });
});

describe("setAtPath", () => {
  it("returns the value when path is empty", () => {
    expect(setAtPath({ a: 1 }, [], { b: 2 })).toEqual({ b: 2 });
  });

  it("sets a top-level string key without mutating the input", () => {
    const before = { str: 10, dex: 12 };
    const after = setAtPath(before, ["str"], 16);
    expect(after).toEqual({ str: 16, dex: 12 });
    expect(before).toEqual({ str: 10, dex: 12 });
  });

  it("sets a deep path inside nested objects", () => {
    const before = { scores: { str: 10, dex: 12 } };
    const after = setAtPath(before, ["scores", "str"], 16);
    expect(after).toEqual({ scores: { str: 16, dex: 12 } });
    // Verify a fresh container at every level (no shared subtree)
    const beforeWithSubtree = before as { scores: { str: number; dex: number } };
    const afterWithSubtree = after as { scores: { str: number; dex: number } };
    expect(afterWithSubtree.scores).not.toBe(beforeWithSubtree.scores);
  });

  it("creates intermediate objects when the path traverses an absent key", () => {
    const after = setAtPath({}, ["scores", "str"], 18);
    expect(after).toEqual({ scores: { str: 18 } });
  });

  it("sets an array element by index without changing length", () => {
    const before = { items: ["a", "b", "c"] };
    const after = setAtPath(before, ["items", 1], "X");
    expect(after).toEqual({ items: ["a", "X", "c"] });
  });

  it("throws on out-of-range numeric segments", () => {
    expect(() => setAtPath({ items: ["a"] }, ["items", 5], "X")).toThrow(/out of range/);
  });

  it("throws when a numeric segment hits a non-array container", () => {
    expect(() => setAtPath({ items: { name: "a" } }, ["items", 0], "X")).toThrow(
      /requires an array container/,
    );
  });
});
