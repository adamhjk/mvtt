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
import { parseSetDesign, splitSegments } from "./shared/set-design.js";

describe("parseSetDesign", () => {
  it("returns an empty block for empty input", () => {
    const block = parseSetDesign("");
    expect(block.header).toBeNull();
    expect(block.root).toEqual([]);
  });

  it("detects a header line followed by `---`", () => {
    const block = parseSetDesign(
      "Old Library 7)\n---\n**Bookshelves** -> sagging\n",
    );
    expect(block.header).toBe("Old Library 7)");
    expect(block.root).toHaveLength(1);
    expect(block.root[0]!.text).toBe("**Bookshelves** -> sagging");
  });

  it("treats the first line as body when no header separator follows", () => {
    const block = parseSetDesign("**Door** -> locked\n**Window** -> open\n");
    expect(block.header).toBeNull();
    expect(block.root).toHaveLength(2);
    expect(block.root[0]!.text).toBe("**Door** -> locked");
    expect(block.root[1]!.text).toBe("**Window** -> open");
  });

  it("nests children by indentation", () => {
    const block = parseSetDesign(
      [
        "**Oak Desk** SW -> drawers dumped",
        "  -> locked drawer -> DC 15",
        "    -> scroll case",
        "      -> spell scroll",
      ].join("\n"),
    );
    expect(block.root).toHaveLength(1);
    const desk = block.root[0]!;
    expect(desk.text).toBe("**Oak Desk** SW -> drawers dumped");
    expect(desk.children).toHaveLength(1);
    const locked = desk.children[0]!;
    expect(locked.text).toBe("locked drawer -> DC 15");
    expect(locked.children).toHaveLength(1);
    expect(locked.children[0]!.text).toBe("scroll case");
    expect(locked.children[0]!.children[0]!.text).toBe("spell scroll");
  });

  it("strips both `->` and `|->` line prefixes equivalently", () => {
    const block = parseSetDesign(
      [
        "**Portcullis** -> wooden",
        "  -> blocks tunnel",
        "  |-> can pass under",
        "  |→ Toad-Man Sentries",
      ].join("\n"),
    );
    expect(block.root[0]!.children.map((c) => c.text)).toEqual([
      "blocks tunnel",
      "can pass under",
      "Toad-Man Sentries",
    ]);
  });

  it("marks the next sibling as blankBefore after a blank line", () => {
    const block = parseSetDesign(
      [
        "**Bookshelves** -> sagging",
        "",
        "Giant Rats (3) -> behind shelves",
      ].join("\n"),
    );
    expect(block.root).toHaveLength(2);
    expect(block.root[0]!.blankBefore).toBe(false);
    expect(block.root[1]!.blankBefore).toBe(true);
  });

  it("supports both unicode → and ASCII -> arrows interchangeably in line prefixes", () => {
    const block = parseSetDesign(
      ["**Foo** -> a", "  → b", "  -> c"].join("\n"),
    );
    expect(block.root[0]!.children.map((c) => c.text)).toEqual(["b", "c"]);
  });

  it("preserves wiki-link literals in the line text", () => {
    const block = parseSetDesign(
      "**Innkeeper** [[character:Marta]] -> 5sp/night\n",
    );
    expect(block.root[0]!.text).toBe(
      "**Innkeeper** [[character:Marta]] -> 5sp/night",
    );
  });

  it("treats tabs as two spaces for indent counting", () => {
    const block = parseSetDesign(["A", "\tB", "\t\tC"].join("\n"));
    expect(block.root).toHaveLength(1);
    expect(block.root[0]!.children).toHaveLength(1);
    expect(block.root[0]!.children[0]!.children).toHaveLength(1);
  });
});

describe("splitSegments", () => {
  it("splits on -> and → and trims whitespace", () => {
    expect(splitSegments("a -> b → c")).toEqual(["a", "b", "c"]);
  });

  it("drops empty segments from trailing arrows", () => {
    expect(splitSegments("a -> ")).toEqual(["a"]);
  });

  it("returns a single segment when no arrows present", () => {
    expect(splitSegments("just text")).toEqual(["just text"]);
  });

  it("preserves wiki-link bodies within segments", () => {
    expect(splitSegments("**Guard** [[character:Krell]] -> hostile")).toEqual([
      "**Guard** [[character:Krell]]",
      "hostile",
    ]);
  });
});
