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
import { setdesignParser } from "./client/setdesign-lezer.js";

/** Tiny helper: count nodes of a given type-name in the tree. */
function countByType(tree: ReturnType<typeof setdesignParser.parse>, name: string): number {
  let n = 0;
  tree.iterate({
    enter(node) {
      if (node.type.name === name) n++;
    },
  });
  return n;
}

function nodeRanges(
  tree: ReturnType<typeof setdesignParser.parse>,
  name: string,
): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  tree.iterate({
    enter(node) {
      if (node.type.name === name) out.push({ from: node.from, to: node.to });
    },
  });
  return out;
}

describe("setdesignParser", () => {
  it("returns a SetdesignDoc top node spanning the input", () => {
    const src = "**Door** -> locked";
    const tree = setdesignParser.parse(src);
    expect(tree.type.name).toBe("SetdesignDoc");
    expect(tree.length).toBe(src.length);
  });

  it("recognises a header (first line + `---`)", () => {
    const src = "Old Library 7)\n---\n**Door** -> locked";
    const tree = setdesignParser.parse(src);
    expect(countByType(tree, "SetdesignHeader")).toBe(1);
    expect(countByType(tree, "SetdesignHeaderRule")).toBe(1);
  });

  it("emits one SetdesignLine per non-blank body line", () => {
    const src = "**A**\n**B**\n**C**";
    const tree = setdesignParser.parse(src);
    expect(countByType(tree, "SetdesignLine")).toBe(3);
  });

  it("creates a SetdesignBranch tree from indentation", () => {
    const src = ["**Oak**", "  -> drawer", "    -> contents"].join("\n");
    const tree = setdesignParser.parse(src);
    // Three branches: Oak, drawer (nested in Oak), contents (nested in drawer)
    expect(countByType(tree, "SetdesignBranch")).toBe(3);
  });

  it("emits SetdesignArrow nodes for internal `->` separators", () => {
    const src = "A -> B -> C";
    const tree = setdesignParser.parse(src);
    expect(countByType(tree, "SetdesignArrow")).toBe(2);
    expect(countByType(tree, "SetdesignSegment")).toBe(3);
  });

  it("supports `→` as well as `->` for arrows", () => {
    const src = "A → B → C";
    const tree = setdesignParser.parse(src);
    expect(countByType(tree, "SetdesignArrow")).toBe(2);
    expect(countByType(tree, "SetdesignSegment")).toBe(3);
  });

  it("classifies a leading `->` as SetdesignLinePrefix (not Arrow)", () => {
    const src = "**Foo**\n  -> child";
    const tree = setdesignParser.parse(src);
    // Two lines, two segments total (one per line).
    expect(countByType(tree, "SetdesignSegment")).toBe(2);
    expect(countByType(tree, "SetdesignLinePrefix")).toBe(1);
    // No internal arrows since each line has exactly one segment.
    expect(countByType(tree, "SetdesignArrow")).toBe(0);
  });

  it("classifies `|->` the same as `->` as a line prefix", () => {
    const src = "**Foo**\n  |-> branch";
    const tree = setdesignParser.parse(src);
    expect(countByType(tree, "SetdesignLinePrefix")).toBe(1);
  });

  it("recognises inline bold via SetdesignBold + SetdesignBoldMark", () => {
    const src = "**Door** is locked";
    const tree = setdesignParser.parse(src);
    expect(countByType(tree, "SetdesignBold")).toBe(1);
    expect(countByType(tree, "SetdesignBoldMark")).toBe(2);
  });

  it("recognises inline italic via _..._ and *...*", () => {
    const src = "_a_ and *b*";
    const tree = setdesignParser.parse(src);
    expect(countByType(tree, "SetdesignItalic")).toBe(2);
  });

  it("recognises inline code via backticks", () => {
    const src = "Use `foo` here";
    const tree = setdesignParser.parse(src);
    expect(countByType(tree, "SetdesignCode")).toBe(1);
  });

  it("recognises wiki-links via [[…]] including the embed prefix", () => {
    const src = "**Innkeeper** [[character:Marta]] -> 5sp\nMap: ![[asset:e42]]";
    const tree = setdesignParser.parse(src);
    expect(countByType(tree, "SetdesignWikiLink")).toBe(2);
    expect(countByType(tree, "SetdesignWikiLinkBody")).toBe(2);
    // Two marks per link (open + close).
    expect(countByType(tree, "SetdesignWikiLinkMark")).toBe(4);
  });

  it("emits node ranges within the input bounds", () => {
    const src = "**Door** -> [[character:Marta]] -> locked";
    const tree = setdesignParser.parse(src);
    for (const r of nodeRanges(tree, "SetdesignWikiLink")) {
      expect(r.from).toBeGreaterThanOrEqual(0);
      expect(r.to).toBeLessThanOrEqual(src.length);
      expect(src.slice(r.from, r.to)).toBe("[[character:Marta]]");
    }
  });

  it("Branch covers parent + descendants for fold-range computation", () => {
    const src = ["**Oak**", "  -> drawer", "    -> contents"].join("\n");
    const tree = setdesignParser.parse(src);
    // The outermost branch should start at "**Oak**" and end at "contents".
    let outermost: { from: number; to: number } | null = null;
    tree.iterate({
      enter(node) {
        if (node.type.name === "SetdesignBranch") {
          if (!outermost || node.from < outermost.from) {
            outermost = { from: node.from, to: node.to };
          }
        }
      },
    });
    expect(outermost).not.toBeNull();
    expect(src.slice(outermost!.from, outermost!.to)).toContain("**Oak**");
    expect(src.slice(outermost!.from, outermost!.to)).toContain("contents");
  });
});
