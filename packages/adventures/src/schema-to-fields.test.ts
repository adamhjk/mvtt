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
import { z } from "@vtt/substrate";
import { schemaToFields, describeType } from "./shared/schema-to-fields.js";
import { wikiLink, dice } from "./shared/brands.js";

describe("schemaToFields", () => {
  it("flattens an object schema to one row per key", () => {
    const s = z.object({
      name: z.string(),
      level: z.number().int(),
    });
    const rows = schemaToFields(s);
    expect(rows.map((r) => r.path)).toEqual(["name", "level"]);
  });

  it("marks optional/default keys as not-required", () => {
    const s = z.object({
      required: z.string(),
      optional: z.string().optional(),
      withDefault: z.number().default(3),
    });
    const rows = schemaToFields(s);
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
    expect(byPath.required!.required).toBe(true);
    expect(byPath.optional!.required).toBe(false);
    expect(byPath.withDefault!.required).toBe(false);
    expect(byPath.withDefault!.default).toBe("3");
  });

  it("describes wikilink branded strings as wikilink:<kind>", () => {
    const s = z.object({
      held: wikiLink("item"),
      target: wikiLink("character"),
    });
    const rows = schemaToFields(s);
    expect(rows[0]!.type).toBe("wikilink:item");
    expect(rows[1]!.type).toBe("wikilink:character");
  });

  it("describes dice branded strings as dice", () => {
    const s = z.object({ damage: dice() });
    const rows = schemaToFields(s);
    expect(rows[0]!.type).toBe("dice");
  });

  it("describes enums with all values when small", () => {
    const s = z.object({ type: z.enum(["weapon", "armor", "supply"]) });
    const rows = schemaToFields(s);
    expect(rows[0]!.type).toBe("enum: weapon | armor | supply");
  });

  it("recurses into nested objects with dotted paths", () => {
    const s = z.object({
      nature: z.object({
        rating: z.number().int(),
        descriptors: z.array(z.string()),
      }),
    });
    const rows = schemaToFields(s);
    expect(rows.map((r) => r.path)).toContain("nature");
    expect(rows.map((r) => r.path)).toContain("nature.rating");
    expect(rows.map((r) => r.path)).toContain("nature.descriptors");
  });

  it("describes arrays of branded wikilinks", () => {
    const s = z.object({
      carries: z.array(wikiLink("item")),
    });
    const rows = schemaToFields(s);
    expect(rows[0]!.type).toBe("array<wikilink:item>");
  });

  it("recurses into array-of-object elements with [] segment", () => {
    const s = z.object({
      skillBonuses: z.array(
        z.object({
          skill: z.string(),
          value: z.number().int(),
        }),
      ),
    });
    const rows = schemaToFields(s);
    expect(rows.map((r) => r.path)).toContain("skillBonuses.[].skill");
    expect(rows.map((r) => r.path)).toContain("skillBonuses.[].value");
  });

  it("does not leak the brand prefix into descriptions", () => {
    const s = z.object({ held: wikiLink("item") });
    const rows = schemaToFields(s);
    expect(rows[0]!.description).toBeUndefined();
  });

  it("surfaces .describe() text as description", () => {
    const s = z.object({
      name: z.string().describe("Display name shown on the chip"),
    });
    const rows = schemaToFields(s);
    expect(rows[0]!.description).toBe("Display name shown on the chip");
  });

  it("captures integer min/max range", () => {
    const s = z.number().int().min(1).max(10);
    expect(describeType(s)).toBe("integer (1–10)");
  });

  it("describes union of literals", () => {
    const s = z.union([z.literal(1), z.literal(2)]);
    expect(describeType(s)).toContain("literal");
  });

  it("expands array-of-union variants into separate rows", () => {
    // Mirror the TB character `carries` schema: array<wikilink:item |
    // { item, slot, quantity }>. Authors need to see both shapes.
    const s = z.object({
      carries: z.array(
        z.union([
          wikiLink("item"),
          z.object({
            item: wikiLink("item"),
            slot: z.string().optional(),
            quantity: z.number().int().default(1),
          }),
        ]),
      ),
    });
    const rows = schemaToFields(s);
    const paths = rows.map((r) => r.path);
    // Top-level carries row.
    expect(paths).toContain("carries");
    // Variant 1: wiki-link form.
    const wiki = rows.find((r) => r.path.includes("(as wikilink:item)"));
    expect(wiki).toBeDefined();
    expect(wiki!.description).toContain('"[[item:hammer]]"');
    // Variant 2: object form — summary + recursed fields.
    expect(paths.some((p) => p.includes("(object form)"))).toBe(true);
    expect(rows.find((r) => r.path === "carries.[].(object form).item")).toBeDefined();
    expect(
      rows.find((r) => r.path === "carries.[].(object form).quantity"),
    ).toBeDefined();
  });
});
