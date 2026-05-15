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

import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { type JSX } from "solid-js";
import {
  buildCharacterHarness,
  mountWithClient,
  type CharacterHarness,
} from "@vtt/characters/testing";
import { definePlugin, type CommandInstance } from "@vtt/substrate";
import {
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
  SetField,
} from "@vtt/characters/shared";
import { ChatTimelineContributorSlot } from "@vtt/comms/shared";
import {
  Formula,
  RequestRoll,
  RollActionsSlot,
  RolledBy,
  RollResult,
} from "@vtt/resolution/shared";
import { ItemDetailSectionsSlot } from "@vtt/items/shared";
import { LinkKindsSlot } from "@vtt/notes/shared";
import { BlockKindsSlot } from "@vtt/adventures/shared";
import { PaletteCommandsSlot, WorkbenchChatRailSurface } from "@vtt/shell-workbench/shared";
import { systemTorchbearer } from "./manifest.js";
import {
  CharacterTraits,
  Identity,
  RawAbilities,
  Skills,
} from "./shared/index.js";
import { TbWhoYouAreTabFill } from "./client/tab-who-you-are.js";

const sheetSlotsTestInfra = definePlugin({
  name: "@vtt/test-tb-class-defaults-apply-slots",
  version: "0.0.0",
  slots: [
    CharacterSheetIdentitySlot,
    CharacterSheetVitalsSlot,
    CharacterSheetStatusSlot,
    CharacterSheetTabsSlot,
    CharacterSheetActionsSlot,
    ChatTimelineContributorSlot,
    RollActionsSlot,
    ItemDetailSectionsSlot,
    PaletteCommandsSlot,
    LinkKindsSlot,
    BlockKindsSlot,
  ],
  surfaces: [WorkbenchChatRailSurface],
  traits: [Formula, RollResult, RolledBy],
  commands: [RequestRoll],
});

interface HarnessOpts {
  stock?: string;
  klass?: string;
  preWill?: number;
  preHealth?: number;
  preSkillRating?: { id: string; rating: number };
  preTraitName?: string;
}

function harness(opts: HarnessOpts = {}): CharacterHarness {
  return buildCharacterHarness({
    plugins: [sheetSlotsTestInfra, systemTorchbearer],
    asGm: true,
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, Identity, {
        name: "Bryn",
        stock: opts.stock ?? "",
        class: opts.klass ?? "",
        level: 1,
        age: 23,
        home: "",
        raiment: "",
        parents: "",
        mentor: "",
        friend: "",
        enemy: "",
      });
      if (opts.preWill !== undefined || opts.preHealth !== undefined) {
        world.set(characterId, RawAbilities, {
          will: {
            rating: opts.preWill ?? 0,
            advancement: { pass: 0, fail: 0 },
          },
          health: {
            rating: opts.preHealth ?? 0,
            advancement: { pass: 0, fail: 0 },
          },
          nature: {
            rating: 0,
            maximum: 0,
            advancement: { pass: 0, fail: 0 },
            descriptors: [],
          },
        });
      }
      if (opts.preSkillRating) {
        world.set(characterId, Skills, {
          entries: {
            [opts.preSkillRating.id]: {
              rating: opts.preSkillRating.rating,
              advancement: { pass: 0, fail: 0 },
              taxed: false,
              learningTests: 0,
            },
          },
          specialtySkillId: null,
        });
      }
      if (opts.preTraitName) {
        world.set(characterId, CharacterTraits, {
          entries: [
            { name: opts.preTraitName, level: 1, beneficialUses: 0, checks: 0, usedAgainst: false },
          ],
        });
      }
    },
  });
}

function mount(h: CharacterHarness): void {
  mountWithClient(h, () =>
    TbWhoYouAreTabFill.render({ characterId: h.characterId }) as JSX.Element,
  );
}

function setFields(h: CharacterHarness, trait: string, since = 0): ReadonlyArray<CommandInstance> {
  return h.dispatched
    .slice(since)
    .filter(
      (c) =>
        c.type === SetField.name &&
        (c.payload as { trait: string }).trait === trait,
    );
}

function setFieldByPath(
  writes: ReadonlyArray<CommandInstance>,
  path: ReadonlyArray<string | number>,
): CommandInstance | undefined {
  return writes.find((w) => {
    const p = (w.payload as { path: ReadonlyArray<string | number> }).path;
    return p.length === path.length && p.every((seg, i) => seg === path[i]);
  });
}

describe("Apply-starting-stats button", () => {
  beforeEach(() => cleanup());

  it("is not rendered until both stock and class are picked", () => {
    const h = harness({ stock: "Halfling" });
    mount(h);
    expect(screen.queryByTestId("apply-class-defaults")).toBeNull();
  });

  it("is not rendered for a (stock, class) without a defaults row", () => {
    // Dwarves can only pair with Outcast.
    const h = harness({ stock: "Dwarf", klass: "Warrior" });
    mount(h);
    expect(screen.queryByTestId("apply-class-defaults")).toBeNull();
  });

  it("renders for a canonical DH pair", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    expect(screen.getByTestId("apply-class-defaults")).toBeInTheDocument();
  });

  it("fixed-ability class (Burglar) writes Will 5 / Health 3", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId("apply-class-defaults"));
    const writes = setFields(h, RawAbilities.name, before);
    const willWrite = setFieldByPath(writes, ["will", "rating"]);
    const healthWrite = setFieldByPath(writes, ["health", "rating"]);
    expect((willWrite?.payload as { value: number }).value).toBe(5);
    expect((healthWrite?.payload as { value: number }).value).toBe(3);
  });

  it("budget-ability class (Warrior) defaults Will 4 / Health 4", () => {
    const h = harness({ stock: "Human", klass: "Warrior" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId("apply-class-defaults"));
    const writes = setFields(h, RawAbilities.name, before);
    expect(
      (setFieldByPath(writes, ["will", "rating"])?.payload as { value: number })
        .value,
    ).toBe(4);
    expect(
      (setFieldByPath(writes, ["health", "rating"])?.payload as { value: number })
        .value,
    ).toBe(4);
  });

  it("writes Nature rating 3, maximum 3 and the stock's three descriptors", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId("apply-class-defaults"));
    const writes = setFields(h, RawAbilities.name, before);
    expect(
      (setFieldByPath(writes, ["nature", "rating"])?.payload as { value: number })
        .value,
    ).toBe(3);
    expect(
      (setFieldByPath(writes, ["nature", "maximum"])?.payload as { value: number })
        .value,
    ).toBe(3);
    expect(
      (
        setFieldByPath(writes, ["nature", "descriptors"])?.payload as {
          value: ReadonlyArray<string>;
        }
      ).value,
    ).toEqual(["Sneaking", "Riddling", "Merrymaking"]);
  });

  it("writes every prescribed skill rating", () => {
    const h = harness({ stock: "Human", klass: "Warrior" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId("apply-class-defaults"));
    const writes = setFields(h, Skills.name, before);
    const ratingFor = (id: string): number | undefined => {
      const w = setFieldByPath(writes, ["entries", id, "rating"]);
      return w ? (w.payload as { value: number }).value : undefined;
    };
    expect(ratingFor("fighter")).toBe(4);
    expect(ratingFor("hunter")).toBe(3);
    expect(ratingFor("commander")).toBe(2);
    expect(ratingFor("mentor")).toBe(2);
    expect(ratingFor("rider")).toBe(2);
  });

  it("appends the class trait at level 1 when no traits exist yet", () => {
    const h = harness({ stock: "Human", klass: "Warrior" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId("apply-class-defaults"));
    const writes = setFields(h, CharacterTraits.name, before);
    expect(writes.length).toBe(1);
    const payload = writes[0]!.payload as {
      path: ReadonlyArray<string | number>;
      value: ReadonlyArray<{ name: string; level: number }>;
    };
    expect(payload.path).toEqual(["entries"]);
    expect(payload.value).toEqual([
      { name: "Heart of Battle", level: 1, beneficialUses: 0, checks: 0, usedAgainst: false },
    ]);
  });

  it("does not duplicate the class trait when it is already present", () => {
    const h = harness({
      stock: "Human",
      klass: "Warrior",
      preTraitName: "Heart of Battle",
    });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId("apply-class-defaults"));
    expect(setFields(h, CharacterTraits.name, before).length).toBe(0);
  });

  it("does not clobber a Will rating the player has already set", () => {
    const h = harness({
      stock: "Halfling",
      klass: "Burglar",
      preWill: 6,
      preHealth: 0,
    });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId("apply-class-defaults"));
    const writes = setFields(h, RawAbilities.name, before);
    expect(setFieldByPath(writes, ["will", "rating"])).toBeUndefined();
    // Health was still 0 and still gets the prescribed 3.
    expect(
      (setFieldByPath(writes, ["health", "rating"])?.payload as { value: number })
        .value,
    ).toBe(3);
  });

  it("does not clobber a skill rating the player has already set", () => {
    const h = harness({
      stock: "Halfling",
      klass: "Burglar",
      preSkillRating: { id: "cook", rating: 4 },
    });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId("apply-class-defaults"));
    const writes = setFields(h, Skills.name, before);
    // Cook should NOT be re-written; the other 5 burglar skills should.
    expect(setFieldByPath(writes, ["entries", "cook", "rating"])).toBeUndefined();
    expect(
      setFieldByPath(writes, ["entries", "criminal", "rating"]),
    ).toBeDefined();
    expect(
      setFieldByPath(writes, ["entries", "fighter", "rating"]),
    ).toBeDefined();
  });

  it("LMM Shaman writes the LMM p.11 skill set", () => {
    const h = harness({ stock: "Human", klass: "Shaman" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId("apply-class-defaults"));
    const writes = setFields(h, Skills.name, before);
    const ratingFor = (id: string): number | undefined => {
      const w = setFieldByPath(writes, ["entries", id, "rating"]);
      return w ? (w.payload as { value: number }).value : undefined;
    };
    expect(ratingFor("ritualist")).toBe(4);
    expect(ratingFor("theologian")).toBe(3);
    expect(ratingFor("fighter")).toBe(2);
    expect(ratingFor("healer")).toBe(2);
    expect(ratingFor("scavenger")).toBe(2);
  });

  it("Troll Changeling Shaman writes Tricking/Boasting/Breaking Nature descriptors", () => {
    const h = harness({ stock: "Troll Changeling", klass: "Shaman" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId("apply-class-defaults"));
    const writes = setFields(h, RawAbilities.name, before);
    expect(
      (
        setFieldByPath(writes, ["nature", "descriptors"])?.payload as {
          value: ReadonlyArray<string>;
        }
      ).value,
    ).toEqual(["Tricking", "Boasting", "Breaking"]);
  });

  it("Troll Changeling appends Huldrekall alongside the class trait", () => {
    const h = harness({ stock: "Troll Changeling", klass: "Shaman" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId("apply-class-defaults"));
    const writes = setFields(h, CharacterTraits.name, before);
    expect(writes.length).toBe(1);
    const value = (
      writes[0]!.payload as { value: ReadonlyArray<{ name: string }> }
    ).value;
    const names = value.map((t) => t.name).sort();
    expect(names).toEqual(["Between Two Worlds", "Huldrekall"]);
  });

  it("Troll Changeling does not duplicate Huldrekall when it is already present", () => {
    const h = harness({
      stock: "Troll Changeling",
      klass: "Shaman",
      preTraitName: "Huldrekall",
    });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId("apply-class-defaults"));
    const writes = setFields(h, CharacterTraits.name, before);
    // Only Between Two Worlds is appended; Huldrekall is preserved.
    expect(writes.length).toBe(1);
    const names = (
      writes[0]!.payload as { value: ReadonlyArray<{ name: string }> }
    ).value
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(["Between Two Worlds", "Huldrekall"]);
  });

  it("base DH stocks do not pull in a stock-level additional trait", () => {
    const h = harness({ stock: "Human", klass: "Warrior" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.click(screen.getByTestId("apply-class-defaults"));
    const writes = setFields(h, CharacterTraits.name, before);
    const names = (
      writes[0]!.payload as { value: ReadonlyArray<{ name: string }> }
    ).value.map((t) => t.name);
    expect(names).toEqual(["Heart of Battle"]);
  });
});
