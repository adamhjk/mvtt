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

import { describe, expect, it } from "vitest";
import { TB_CLASS_STOCK_OPTIONS } from "./client/class-stock-options.js";
import {
  lookupClassDefaults,
  lookupStockNatureDefaults,
  TB_CLASS_DEFAULTS,
  TB_STOCK_NATURE_DEFAULTS,
  type ClassDefaults,
  type StockNatureDefaults,
} from "./client/tb-class-defaults.js";
import { getSkill } from "./shared/skills.js";

/**
 * Every (stock, class) row this branch covers — six DH rows, three
 * LMM expansion classes, and the six Troll Changeling variants. The
 * full list of canonical rows is `TB_CLASS_STOCK_OPTIONS`; this is
 * the same shape so we can pin each row's presence individually.
 */
const ALL_KEYS: ReadonlyArray<string> = [
  // DH p.26-27
  "halfling/burglar",
  "human/magician",
  "dwarf/outcast",
  "elf/ranger",
  "human/theurge",
  "human/warrior",
  // LMM p.11/13/14
  "human/shaman",
  "human/skald",
  "human/thief",
  // LMM p.9 — Troll Changeling swap-in for every Human-stock class
  "troll-changeling/magician",
  "troll-changeling/theurge",
  "troll-changeling/warrior",
  "troll-changeling/shaman",
  "troll-changeling/skald",
  "troll-changeling/thief",
];

describe("TB_CLASS_DEFAULTS", () => {
  it("covers every (stock, class) combination from class-stock-options", () => {
    for (const key of ALL_KEYS) {
      expect(TB_CLASS_DEFAULTS[key], `missing defaults for ${key}`).toBeDefined();
    }
  });

  it("covers every TB_CLASS_STOCK_OPTIONS row (no orphans either direction)", () => {
    for (const o of TB_CLASS_STOCK_OPTIONS) {
      expect(
        TB_CLASS_DEFAULTS[o.key],
        `class-stock-options has ${o.key} but no defaults row`,
      ).toBeDefined();
    }
  });

  it("uses keys that exist in TB_CLASS_STOCK_OPTIONS", () => {
    for (const key of Object.keys(TB_CLASS_DEFAULTS)) {
      const match = TB_CLASS_STOCK_OPTIONS.find((o) => o.key === key);
      expect(match, `unknown class-stock key ${key}`).toBeDefined();
    }
  });

  it("each row's skill ids resolve via getSkill", () => {
    for (const [key, defaults] of Object.entries(TB_CLASS_DEFAULTS)) {
      for (const s of defaults.skills) {
        expect(getSkill(s.id), `${key}: unknown skill ${s.id}`).toBeDefined();
      }
    }
  });

  it("each row's skill ratings sit in the legal 1-6 range", () => {
    for (const [key, defaults] of Object.entries(TB_CLASS_DEFAULTS)) {
      for (const s of defaults.skills) {
        expect(s.rating, `${key}: ${s.id} rating`).toBeGreaterThanOrEqual(1);
        expect(s.rating, `${key}: ${s.id} rating`).toBeLessThanOrEqual(6);
      }
    }
  });

  it("skill ids are unique within each class row", () => {
    for (const [key, defaults] of Object.entries(TB_CLASS_DEFAULTS)) {
      const ids = defaults.skills.map((s) => s.id);
      expect(new Set(ids).size, `${key} duplicate skill ids`).toBe(ids.length);
    }
  });

  it("fixed ability rows have Will + Health == 8", () => {
    for (const [key, defaults] of Object.entries(TB_CLASS_DEFAULTS)) {
      if (defaults.will.kind === "fixed" && defaults.health.kind === "fixed") {
        expect(
          defaults.will.value + defaults.health.value,
          `${key} fixed sum`,
        ).toBe(8);
      }
    }
  });

  it("budget ability rows declare the canonical 8 / 2-6 constraint", () => {
    for (const [key, defaults] of Object.entries(TB_CLASS_DEFAULTS)) {
      if (defaults.will.kind === "budget") {
        expect(defaults.will, `${key} will budget`).toMatchObject({
          kind: "budget",
          total: 8,
          min: 2,
          max: 6,
        });
        expect(defaults.health, `${key} health must mirror will budget`).toMatchObject({
          kind: "budget",
          total: 8,
          min: 2,
          max: 6,
        });
      }
    }
  });

  it("class trait names are non-empty and trait page refs cite a class chapter", () => {
    for (const [key, defaults] of Object.entries(TB_CLASS_DEFAULTS)) {
      expect(defaults.classTrait.length, `${key} trait`).toBeGreaterThan(0);
      expect(["DH", "LMM"]).toContain(defaults.classTraitPage.book);
    }
  });

  it("Burglar matches the printed DH p.26 row", () => {
    const d = lookupClassDefaults("Halfling", "Burglar") as ClassDefaults;
    expect(d).not.toBeNull();
    expect(d.will).toEqual({ kind: "fixed", value: 5 });
    expect(d.health).toEqual({ kind: "fixed", value: 3 });
    expect(d.skills).toEqual([
      { id: "cook", rating: 3 },
      { id: "criminal", rating: 3 },
      { id: "fighter", rating: 3 },
      { id: "hunter", rating: 2 },
      { id: "scout", rating: 2 },
      { id: "scavenger", rating: 2 },
    ]);
    expect(d.classTrait).toBe("Hidden Depths");
  });

  it("Outcast matches the printed DH p.26 row", () => {
    const d = lookupClassDefaults("Dwarf", "Outcast") as ClassDefaults;
    expect(d.will).toEqual({ kind: "fixed", value: 3 });
    expect(d.health).toEqual({ kind: "fixed", value: 5 });
    expect(d.skills.map((s) => s.id)).toEqual([
      "fighter",
      "dungeoneer",
      "armorer",
      "sapper",
      "orator",
      "scout",
    ]);
    expect(d.classTrait).toBe("Born of Earth and Stone");
  });

  it("Ranger matches the printed DH p.27 row", () => {
    const d = lookupClassDefaults("Elf", "Ranger") as ClassDefaults;
    expect(d.will).toEqual({ kind: "fixed", value: 4 });
    expect(d.health).toEqual({ kind: "fixed", value: 4 });
    expect(d.classTrait).toBe("First Born");
  });

  it("Warrior is a budget-ability class with the warrior skill set", () => {
    const d = lookupClassDefaults("Human", "Warrior") as ClassDefaults;
    expect(d.will.kind).toBe("budget");
    expect(d.health.kind).toBe("budget");
    expect(d.skills).toEqual([
      { id: "fighter", rating: 4 },
      { id: "hunter", rating: 3 },
      { id: "commander", rating: 2 },
      { id: "mentor", rating: 2 },
      { id: "rider", rating: 2 },
    ]);
    expect(d.classTrait).toBe("Heart of Battle");
  });

  it("Magician + Theurge are also budget-ability classes", () => {
    expect(
      (lookupClassDefaults("Human", "Magician") as ClassDefaults).will.kind,
    ).toBe("budget");
    expect(
      (lookupClassDefaults("Human", "Theurge") as ClassDefaults).will.kind,
    ).toBe("budget");
  });

  it("lookupClassDefaults is case- and whitespace-insensitive", () => {
    expect(lookupClassDefaults("  halfling ", "burglar")).not.toBeNull();
    expect(lookupClassDefaults("HUMAN", "Warrior")).not.toBeNull();
  });

  it("lookupClassDefaults returns null for unknown combinations", () => {
    expect(lookupClassDefaults("Halfling", "Warrior")).toBeNull();
    expect(lookupClassDefaults("", "")).toBeNull();
    expect(lookupClassDefaults("Dwarf", "Magician")).toBeNull();
  });

  it("Shaman matches the printed LMM p.11 row", () => {
    const d = lookupClassDefaults("Human", "Shaman") as ClassDefaults;
    expect(d).not.toBeNull();
    expect(d.will.kind).toBe("budget");
    expect(d.skills).toEqual([
      { id: "ritualist", rating: 4 },
      { id: "theologian", rating: 3 },
      { id: "fighter", rating: 2 },
      { id: "healer", rating: 2 },
      { id: "scavenger", rating: 2 },
    ]);
    expect(d.classTrait).toBe("Between Two Worlds");
    expect(d.classTraitPage).toEqual({ book: "LMM", page: 11 });
  });

  it("Skald matches the printed LMM p.13 row", () => {
    const d = lookupClassDefaults("Human", "Skald") as ClassDefaults;
    expect(d.skills).toEqual([
      { id: "orator", rating: 4 },
      { id: "manipulator", rating: 3 },
      { id: "fighter", rating: 2 },
      { id: "loreMaster", rating: 2 },
      { id: "scholar", rating: 2 },
    ]);
    expect(d.classTrait).toBe("Voice of Thunder");
    expect(d.classTraitPage).toEqual({ book: "LMM", page: 13 });
  });

  it("Thief matches the printed LMM p.14 row", () => {
    const d = lookupClassDefaults("Human", "Thief") as ClassDefaults;
    expect(d.skills).toEqual([
      { id: "criminal", rating: 3 },
      { id: "manipulator", rating: 3 },
      { id: "scout", rating: 3 },
      { id: "sapper", rating: 2 },
      { id: "fighter", rating: 2 },
    ]);
    expect(d.classTrait).toBe("Devil May Care");
    expect(d.classTraitPage).toEqual({ book: "LMM", page: 14 });
  });

  it("Troll Changeling variants mirror their Human-stock counterparts (skills + class trait)", () => {
    for (const klass of ["Magician", "Theurge", "Warrior", "Shaman", "Skald", "Thief"]) {
      const human = lookupClassDefaults("Human", klass) as ClassDefaults;
      const tc = lookupClassDefaults("Troll Changeling", klass) as ClassDefaults;
      expect(tc, `${klass} troll-changeling row`).not.toBeNull();
      expect(tc.skills).toEqual(human.skills);
      expect(tc.classTrait).toBe(human.classTrait);
      expect(tc.classTraitPage).toEqual(human.classTraitPage);
      // Ability budget is identical (Troll Changelings use the same
      // 8-point / 2-6 budget as the Human classes — LMM p.9).
      expect(tc.will).toEqual(human.will);
      expect(tc.health).toEqual(human.health);
    }
  });
});

describe("TB_STOCK_NATURE_DEFAULTS", () => {
  it("covers all four base DH stocks plus Troll Changeling", () => {
    expect(TB_STOCK_NATURE_DEFAULTS).toMatchObject({
      Dwarf: expect.any(Object),
      Elf: expect.any(Object),
      Halfling: expect.any(Object),
      Human: expect.any(Object),
      "Troll Changeling": expect.any(Object),
    });
  });

  it("every stock has Nature rating 3 and three descriptors", () => {
    for (const [stock, n] of Object.entries(TB_STOCK_NATURE_DEFAULTS) as ReadonlyArray<
      readonly [string, StockNatureDefaults]
    >) {
      expect(n.rating, `${stock} rating`).toBe(3);
      expect(n.descriptors.length, `${stock} descriptors`).toBe(3);
    }
  });

  it("descriptors match the printed DH p.33 list", () => {
    expect(TB_STOCK_NATURE_DEFAULTS.Dwarf?.descriptors).toEqual([
      "Delving",
      "Crafting",
      "Avenging Grudges",
    ]);
    expect(TB_STOCK_NATURE_DEFAULTS.Elf?.descriptors).toEqual([
      "Singing",
      "Remembering",
      "Hiding",
    ]);
    expect(TB_STOCK_NATURE_DEFAULTS.Halfling?.descriptors).toEqual([
      "Sneaking",
      "Riddling",
      "Merrymaking",
    ]);
    expect(TB_STOCK_NATURE_DEFAULTS.Human?.descriptors).toEqual([
      "Boasting",
      "Demanding",
      "Running",
    ]);
  });

  it("Troll Changeling descriptors match LMM p.9 (Tricking / Boasting / Breaking)", () => {
    expect(TB_STOCK_NATURE_DEFAULTS["Troll Changeling"]?.descriptors).toEqual([
      "Tricking",
      "Boasting",
      "Breaking",
    ]);
  });

  it("Troll Changeling carries Huldrekall as a stock-required second trait", () => {
    const tc = TB_STOCK_NATURE_DEFAULTS["Troll Changeling"]!;
    expect(tc.additionalTrait?.name).toBe("Huldrekall");
    expect(tc.additionalTrait?.page).toEqual({ book: "LMM", page: 9 });
  });

  it("base DH stocks have no additionalTrait", () => {
    for (const stock of ["Dwarf", "Elf", "Halfling", "Human"]) {
      expect(
        TB_STOCK_NATURE_DEFAULTS[stock]?.additionalTrait,
        `${stock} additionalTrait`,
      ).toBeUndefined();
    }
  });

  it("lookupStockNatureDefaults is case- and whitespace-insensitive", () => {
    expect(lookupStockNatureDefaults(" elf ")?.descriptors[0]).toBe("Singing");
    expect(lookupStockNatureDefaults("HUMAN")?.descriptors[0]).toBe("Boasting");
    expect(lookupStockNatureDefaults("troll changeling")?.descriptors[0]).toBe(
      "Tricking",
    );
  });

  it("lookupStockNatureDefaults returns null for unknown stocks", () => {
    expect(lookupStockNatureDefaults("")).toBeNull();
    expect(lookupStockNatureDefaults("Orc")).toBeNull();
  });
});
