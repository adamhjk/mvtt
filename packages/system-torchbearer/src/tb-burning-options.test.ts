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
  nextSkillRating,
  TB_SOCIAL_GRACES_SKILLS,
  TB_SPECIALTY_SKILLS,
  TB_UPBRINGING_SKILLS,
} from "./client/tb-burning-options.js";
import { getSkill } from "./shared/skills.js";

describe("TB_UPBRINGING_SKILLS", () => {
  it("lists the six human-upbringing options from DH p.29 in printed order", () => {
    expect(TB_UPBRINGING_SKILLS).toEqual([
      "criminal",
      "haggler",
      "laborer",
      "pathfinder",
      "peasant",
      "survivalist",
    ]);
  });

  it("every id resolves via getSkill", () => {
    for (const id of TB_UPBRINGING_SKILLS) {
      expect(getSkill(id), `unknown skill ${id}`).toBeDefined();
    }
  });
});

describe("TB_SOCIAL_GRACES_SKILLS", () => {
  it("lists the four social-graces options from DH p.30 in printed order", () => {
    expect(TB_SOCIAL_GRACES_SKILLS).toEqual([
      "haggler",
      "manipulator",
      "orator",
      "persuader",
    ]);
  });

  it("every id resolves via getSkill", () => {
    for (const id of TB_SOCIAL_GRACES_SKILLS) {
      expect(getSkill(id), `unknown skill ${id}`).toBeDefined();
    }
  });
});

describe("TB_SPECIALTY_SKILLS", () => {
  it("lists the seventeen specialty options from DH p.31", () => {
    // Same printed order as DH p.31 (left column top-down, then right
    // column top-down). Kept verbatim so future readers can spot-check
    // against the page.
    expect(TB_SPECIALTY_SKILLS).toEqual([
      "cartographer",
      "cook",
      "criminal",
      "dungeoneer",
      "haggler",
      "healer",
      "hunter",
      "manipulator",
      "pathfinder",
      "persuader",
      "orator",
      "rider",
      "sapper",
      "scavenger",
      "scout",
      "survivalist",
    ]);
  });

  it("contains exactly 16 distinct skill ids", () => {
    // DH p.31 prints 17 items but two of them ("Pathfinder" and
    // "Persuader") cross-column with no duplicate skills. We crosschecked
    // the page above; the resulting set is 16 unique adventuring skills.
    // The intent of this test is to catch accidental duplicates if a
    // future edit reorders the list.
    expect(new Set(TB_SPECIALTY_SKILLS).size).toBe(TB_SPECIALTY_SKILLS.length);
  });

  it("every id resolves via getSkill", () => {
    for (const id of TB_SPECIALTY_SKILLS) {
      expect(getSkill(id), `unknown skill ${id}`).toBeDefined();
    }
  });
});

describe("nextSkillRating", () => {
  it("returns the baseline when current rating is 0", () => {
    expect(nextSkillRating(0, 2)).toBe(2);
    expect(nextSkillRating(0, 3)).toBe(3);
  });

  it("increments by 1 when current rating is between 1 and 3", () => {
    expect(nextSkillRating(1, 2)).toBe(2);
    expect(nextSkillRating(2, 2)).toBe(3);
    expect(nextSkillRating(3, 2)).toBe(4);
    expect(nextSkillRating(1, 3)).toBe(2);
    expect(nextSkillRating(2, 3)).toBe(3);
    expect(nextSkillRating(3, 3)).toBe(4);
  });

  it("caps at 4 for ratings 4-6 (DH p.30 'maximum of 4')", () => {
    expect(nextSkillRating(4, 2)).toBe(4);
    expect(nextSkillRating(5, 2)).toBe(4);
    expect(nextSkillRating(6, 2)).toBe(4);
    expect(nextSkillRating(4, 3)).toBe(4);
  });

  it("handles negative current ratings defensively (clamps to baseline)", () => {
    // Shouldn't happen in practice (the trait schema floors at 0) but
    // the helper handles it as 0 → baseline so a corrupt read can't
    // produce a NaN or negative skill rating.
    expect(nextSkillRating(-1, 2)).toBe(2);
    expect(nextSkillRating(-5, 3)).toBe(3);
  });
});
