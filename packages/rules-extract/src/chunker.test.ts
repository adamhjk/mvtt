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
import { DEFAULT_RULES_PROFILE } from "@vtt/rules-corpus/shared";
import { buildChunks } from "./chunker.js";
import type { OutlineEntry, PageText, TextItem } from "./types.js";

const BODY = 10;
const HEADING = 16;

function item(str: string, size: number, hasEOL = true): TextItem {
  return {
    str,
    transform: [size, 0, 0, size, 0, 0],
    width: str.length * size * 0.5,
    height: size,
    fontName: size >= HEADING ? "Bold" : "Body",
    hasEOL,
  };
}

function page(pdfPage: number, items: TextItem[]): PageText {
  return { pdfPage, width: 612, height: 792, items };
}

describe("chunker — in-page sub-heading detection", () => {
  it("splits an outline section into sub-chunks at heading-shaped lines", () => {
    // Outline only knows the chapter ("Skills"). The page contains
    // three named skills typeset as headings inline; without sub-
    // heading detection a search for "Weaver" would resolve to the
    // single chapter chunk under headingPath ["Skills"].
    const pages: PageText[] = [
      page(1, [
        item("Skills", HEADING),
        item("These are the trades and lores of every adventurer.", BODY),
        item("Theologian", HEADING),
        item("You commune with gods and read their omens.", BODY),
        item("Weaver", HEADING),
        item("You spin yarn and weave cloth on a loom.", BODY),
        item("Manhunter", HEADING),
        item("You track quarry across wilderness and town alike.", BODY),
      ]),
    ];
    const outline: OutlineEntry[] = [{ pdfPage: 1, headingPath: ["Skills"] }];

    const chunks = buildChunks({
      pages,
      outline,
      profile: DEFAULT_RULES_PROFILE,
      pageMap: new Map(),
      imagesByPage: new Map(),
      corpusKey: "k",
    });

    const paths = chunks.map((c) => c.headingPath.join(" › "));
    // The chapter intro line stays under the outline path; each named
    // skill becomes its own sub-chunk with the skill name appended.
    expect(paths).toContain("Skills");
    expect(paths).toContain("Skills › Theologian");
    expect(paths).toContain("Skills › Weaver");
    expect(paths).toContain("Skills › Manhunter");

    const weaver = chunks.find((c) => c.headingPath.join() === ["Skills", "Weaver"].join());
    expect(weaver?.body).toMatch(/yarn/);
    expect(weaver?.body).not.toMatch(/Theologian|Manhunter/);
  });

  it("eats the outline leaf title so it doesn't double as a sub-heading", () => {
    // The outline already contains "Combat"; when the page text begins
    // with the same string typeset as a heading, the chunker should
    // *not* emit a sub-section "Combat › Combat". The first body of
    // the outline section stays under headingPath ["Combat"].
    const pages: PageText[] = [
      page(5, [
        item("Combat", HEADING),
        item("Initiative is rolled at the start of each round.", BODY),
      ]),
    ];
    const outline: OutlineEntry[] = [{ pdfPage: 5, headingPath: ["Combat"] }];

    const chunks = buildChunks({
      pages,
      outline,
      profile: DEFAULT_RULES_PROFILE,
      pageMap: new Map(),
      imagesByPage: new Map(),
      corpusKey: "k",
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toEqual(["Combat"]);
    expect(chunks[0]!.body).toMatch(/Initiative/);
  });

  it("ignores big page numbers and watermark stubs in heading position", () => {
    const pages: PageText[] = [
      page(2, [
        // Big page number sometimes typeset at top of chapter pages.
        item("84", HEADING),
        // Watermark line in the same large size.
        item("Adam Jacob (Order #12345)", HEADING),
        item("Weaver", HEADING),
        item("You spin yarn and weave cloth on a loom.", BODY),
      ]),
    ];
    const outline: OutlineEntry[] = [{ pdfPage: 2, headingPath: ["Skills"] }];

    const chunks = buildChunks({
      pages,
      outline,
      profile: DEFAULT_RULES_PROFILE,
      pageMap: new Map(),
      imagesByPage: new Map(),
      corpusKey: "k",
    });

    const paths = chunks.map((c) => c.headingPath.join(" › "));
    expect(paths).toContain("Skills › Weaver");
    expect(paths).not.toContain("Skills › 84");
    // Watermark stripping happens later via collapseWhitespace; what
    // we're locking here is that the watermark didn't *become* a
    // heading-path entry.
    expect(paths.find((p) => /Order/.test(p))).toBeUndefined();
  });

  it("disables sub-heading detection when the profile says so", () => {
    const pages: PageText[] = [
      page(1, [
        item("Skills", HEADING),
        item("These are the trades and lores of every adventurer.", BODY),
        item("Theologian", HEADING),
        item("You commune with gods.", BODY),
        item("Weaver", HEADING),
        item("You spin yarn.", BODY),
      ]),
    ];
    const outline: OutlineEntry[] = [{ pdfPage: 1, headingPath: ["Skills"] }];

    const chunks = buildChunks({
      pages,
      outline,
      profile: {
        ...DEFAULT_RULES_PROFILE,
        subHeading: { ...DEFAULT_RULES_PROFILE.subHeading, enabled: false },
      },
      pageMap: new Map(),
      imagesByPage: new Map(),
      corpusKey: "k",
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toEqual(["Skills"]);
    expect(chunks[0]!.body).toMatch(/Theologian/);
    expect(chunks[0]!.body).toMatch(/Weaver/);
  });
});
