// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import { extractHeadings } from "./shared/headings.js";

describe("extractHeadings", () => {
  it("returns levels 1–6 with matching text", () => {
    const text = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6";
    const items = extractHeadings(text);
    expect(items.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(items.map((h) => h.text)).toEqual(["H1", "H2", "H3", "H4", "H5", "H6"]);
  });

  it("strips trailing # closure", () => {
    expect(extractHeadings("## Heading ##")).toEqual([
      expect.objectContaining({ level: 2, text: "Heading" }),
    ]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const text = "```\n# Not a heading\n```\n# Real heading";
    const items = extractHeadings(text);
    expect(items.map((h) => h.text)).toEqual(["Real heading"]);
  });

  it("assigns stable ids derived from text + occurrence", () => {
    const a = extractHeadings("# Tactics");
    const b = extractHeadings("# Tactics");
    expect(a[0]!.id).toBe(b[0]!.id);
  });

  it("disambiguates duplicate text by occurrence", () => {
    const items = extractHeadings("# Tactics\n# Tactics");
    expect(items[0]!.id).not.toBe(items[1]!.id);
  });

  it("ids are stable across rephrases of OTHER headings", () => {
    // Insert a new heading before "Tactics" and confirm Tactics' id
    // is unchanged. (Both have occurrence #1 by their own text, so
    // the per-text occurrence counter keeps the id stable.)
    const before = extractHeadings("# Tactics");
    const after = extractHeadings("# Inhabitants\n# Tactics");
    const tBefore = before.find((h) => h.text === "Tactics")!;
    const tAfter = after.find((h) => h.text === "Tactics")!;
    expect(tBefore.id).toBe(tAfter.id);
  });

  it("ignores 7+ leading hashes (not a heading)", () => {
    expect(extractHeadings("####### too deep")).toEqual([]);
  });

  it("ignores hash without a following space", () => {
    expect(extractHeadings("#nopage")).toEqual([]);
  });

  it("returns [] for plain prose", () => {
    expect(extractHeadings("just words")).toEqual([]);
  });
});
