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
import { scanFencedBlocks, slugifyInfo } from "./shared/parse-blocks.js";

describe("slugifyInfo", () => {
  it("lowercases, hyphenates, and trims", () => {
    expect(slugifyInfo("Greta the Smith")).toBe("greta-the-smith");
    expect(slugifyInfo("  Wild Boar  ")).toBe("wild-boar");
    expect(slugifyInfo("Skarra Wormtongue!")).toBe("skarra-wormtongue");
  });

  it("strips diacritics", () => {
    expect(slugifyInfo("Görm")).toBe("gorm");
    expect(slugifyInfo("Pâté")).toBe("pate");
  });

  it("falls back to 'block' when info is empty after strip", () => {
    expect(slugifyInfo("!!!")).toBe("block");
    expect(slugifyInfo("")).toBe("block");
  });
});

describe("scanFencedBlocks", () => {
  const recognized = new Set(["npc", "monster", "item"]);

  it("returns nothing for an empty body", () => {
    expect(scanFencedBlocks("", recognized)).toEqual([]);
  });

  it("ignores fences whose info string isn't a recognized kind", () => {
    const body = "```ts\nconsole.log('x');\n```\n";
    expect(scanFencedBlocks(body, recognized)).toEqual([]);
  });

  it("extracts a recognized fenced block with kind, info, body, blockKey", () => {
    const body = ["before", "```npc Greta the Smith", "name: Greta", "```", "after"].join("\n");
    const blocks = scanFencedBlocks(body, recognized);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("npc");
    expect(blocks[0]!.info).toBe("Greta the Smith");
    expect(blocks[0]!.blockKey).toBe("greta-the-smith");
    expect(blocks[0]!.body).toContain("name: Greta");
  });

  it("preserves document order across multiple recognized blocks", () => {
    const body = [
      "```item longsword",
      "type: weapon",
      "```",
      "",
      "```monster goblin",
      "might: 2",
      "```",
    ].join("\n");
    const blocks = scanFencedBlocks(body, recognized);
    expect(blocks.map((b) => b.kind)).toEqual(["item", "monster"]);
    expect(blocks.map((b) => b.blockKey)).toEqual(["longsword", "goblin"]);
  });

  it("suffixes duplicate slugs within a body", () => {
    const body = [
      "```npc Greta",
      "x: 1",
      "```",
      "```npc Greta",
      "x: 2",
      "```",
      "```npc Greta",
      "x: 3",
      "```",
    ].join("\n");
    const blocks = scanFencedBlocks(body, recognized);
    expect(blocks.map((b) => b.blockKey)).toEqual(["greta", "greta-2", "greta-3"]);
  });

  it("falls back to the kind name when info is empty", () => {
    const body = ["```npc", "name: ?", "```"].join("\n");
    const blocks = scanFencedBlocks(body, recognized);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.blockKey).toBe("npc");
  });

  it("respects a `# id: <stable>` annotation, overriding the info-slug", () => {
    const body = ["```npc Greta the Strong", "# id: npc-greta", "stock: Human", "```"].join("\n");
    const blocks = scanFencedBlocks(body, recognized);
    expect(blocks[0]!.blockKey).toBe("npc-greta");
  });

  it("two blocks with the same `# id:` keep their explicit ids (no auto-suffixing)", () => {
    const body = [
      "```npc Greta the Strong",
      "# id: npc-greta",
      "x: 1",
      "```",
      "```npc Greta the Bold",
      "# id: npc-greta",
      "x: 2",
      "```",
    ].join("\n");
    const blocks = scanFencedBlocks(body, recognized);
    expect(blocks.map((b) => b.blockKey)).toEqual(["npc-greta", "npc-greta"]);
  });
});
