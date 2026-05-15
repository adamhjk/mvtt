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
import {
  lookupHometownDefaults,
  TB_HOMETOWN_DEFAULTS,
  TB_HOMETOWN_KEYS,
  type HometownDefaults,
} from "./client/tb-hometown-defaults.js";
import { getSkill } from "./shared/skills.js";

const ALL_HOMETOWN_KEYS = [
  "elfhome",
  "dwarven-halls",
  "religious-bastion",
  "bustling-metropolis",
  "wizards-tower",
  "remote-village",
  "busy-crossroads",
];

describe("TB_HOMETOWN_DEFAULTS", () => {
  it("covers the seven settlements from DH p.30", () => {
    for (const key of ALL_HOMETOWN_KEYS) {
      expect(TB_HOMETOWN_DEFAULTS[key], `missing hometown ${key}`).toBeDefined();
    }
  });

  it("TB_HOMETOWN_KEYS preserves the printed display order", () => {
    expect(TB_HOMETOWN_KEYS).toEqual(ALL_HOMETOWN_KEYS);
  });

  it("each hometown has exactly 3 skills and 2 trait options", () => {
    for (const [key, h] of Object.entries(TB_HOMETOWN_DEFAULTS)) {
      expect(h.skills.length, `${key} skill count`).toBe(3);
      expect(h.traits.length, `${key} trait option count`).toBe(2);
    }
  });

  it("every skill id resolves via getSkill", () => {
    for (const [key, h] of Object.entries(TB_HOMETOWN_DEFAULTS)) {
      for (const id of h.skills) {
        expect(getSkill(id), `${key}: unknown skill ${id}`).toBeDefined();
      }
    }
  });

  it("Elfhome is the only stock-restricted hometown", () => {
    for (const [key, h] of Object.entries(TB_HOMETOWN_DEFAULTS)) {
      if (key === "elfhome") {
        expect(h.stockRestriction).toBe("Elf");
      } else {
        expect(h.stockRestriction, `${key} restriction`).toBeUndefined();
      }
    }
  });

  it("each hometown carries the printed DH p.30 page ref", () => {
    for (const [key, h] of Object.entries(TB_HOMETOWN_DEFAULTS)) {
      expect(h.page, `${key} page`).toEqual({ book: "DH", page: 30 });
    }
  });

  it("Dwarven Halls matches the printed row", () => {
    const h = lookupHometownDefaults("dwarven-halls") as HometownDefaults;
    expect(h.label).toBe("Dwarven Halls");
    expect(h.skills).toEqual(["armorer", "laborer", "stonemason"]);
    expect(h.traits).toEqual(["Cunning", "Fiery"]);
  });

  it("Elfhome matches the printed row and is restricted to Elf", () => {
    const h = lookupHometownDefaults("elfhome") as HometownDefaults;
    expect(h.label).toBe("Elfhome");
    expect(h.skills).toEqual(["healer", "mentor", "pathfinder"]);
    expect(h.traits).toEqual(["Calm", "Quiet"]);
    expect(h.stockRestriction).toBe("Elf");
  });

  it("Religious Bastion matches the printed row", () => {
    const h = lookupHometownDefaults("religious-bastion") as HometownDefaults;
    expect(h.skills).toEqual(["cartographer", "scholar", "theologian"]);
    expect(h.traits).toEqual(["Defender", "Scarred"]);
  });

  it("Bustling Metropolis matches the printed row", () => {
    const h = lookupHometownDefaults("bustling-metropolis") as HometownDefaults;
    expect(h.skills).toEqual(["haggler", "sailor", "steward"]);
    expect(h.traits).toEqual(["Extravagant", "Jaded"]);
  });

  it("Wizard's Tower matches the printed row", () => {
    const h = lookupHometownDefaults("wizards-tower") as HometownDefaults;
    expect(h.skills).toEqual(["alchemist", "loreMaster", "scholar"]);
    expect(h.traits).toEqual(["Skeptical", "Thoughtful"]);
  });

  it("Remote Village matches the printed row", () => {
    const h = lookupHometownDefaults("remote-village") as HometownDefaults;
    expect(h.skills).toEqual(["carpenter", "peasant", "weaver"]);
    expect(h.traits).toEqual(["Early Riser", "Rough Hands"]);
  });

  it("Busy Crossroads matches the printed row", () => {
    const h = lookupHometownDefaults("busy-crossroads") as HometownDefaults;
    expect(h.skills).toEqual(["cook", "haggler", "rider"]);
    expect(h.traits).toEqual(["Foolhardy", "Quick-Witted"]);
  });

  it("lookupHometownDefaults accepts canonical labels and slug keys", () => {
    expect(lookupHometownDefaults("Dwarven Halls")?.label).toBe("Dwarven Halls");
    expect(lookupHometownDefaults("dwarven-halls")?.label).toBe("Dwarven Halls");
    expect(lookupHometownDefaults("  Bustling Metropolis  ")?.label).toBe(
      "Bustling Metropolis",
    );
  });

  it("lookupHometownDefaults round-trips every canonical label back to its key", () => {
    // Specifically guards Wizard's Tower from regressing to the
    // apostrophe-slug bug ("wizard-s-tower" vs "wizards-tower"). Each
    // settlement label must slug to its declared key, or the picker's
    // currentHometown() memo silently breaks for that row.
    for (const [key, h] of Object.entries(TB_HOMETOWN_DEFAULTS)) {
      const found = lookupHometownDefaults(h.label);
      expect(found, `${h.label} → null lookup`).not.toBeNull();
      expect(found?.key, `${h.label} → wrong key`).toBe(key);
    }
  });

  it("Wizard's Tower label resolves to the wizards-tower key", () => {
    expect(lookupHometownDefaults("Wizard's Tower")?.key).toBe("wizards-tower");
  });

  it("lookupHometownDefaults returns null for unknown names", () => {
    expect(lookupHometownDefaults("")).toBeNull();
    expect(lookupHometownDefaults("Bree")).toBeNull();
    expect(lookupHometownDefaults("custom-village")).toBeNull();
  });
});
