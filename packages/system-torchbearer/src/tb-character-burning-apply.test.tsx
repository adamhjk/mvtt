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
import {
  PaletteCommandsSlot,
  WorkbenchChatRailSurface,
} from "@vtt/shell-workbench/shared";
import { systemTorchbearer } from "./manifest.js";
import {
  CharacterTraits,
  Identity,
  RawAbilities,
  SetSpecialtySkill,
  Skills,
} from "./shared/index.js";
import { TbWhoYouAreTabFill } from "./client/tab-who-you-are.js";

const sheetSlotsTestInfra = definePlugin({
  name: "@vtt/test-tb-character-burning-slots",
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
  home?: string;
  upbringingSkillId?: string;
  socialGracesSkillId?: string;
  specialtySkillId?: string | null;
  preSkillRatings?: ReadonlyArray<{ id: string; rating: number }>;
  preTraits?: ReadonlyArray<string>;
}

function harness(opts: HarnessOpts = {}): CharacterHarness {
  return buildCharacterHarness({
    plugins: [sheetSlotsTestInfra, systemTorchbearer],
    asGm: true,
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, Identity, {
        name: "Test",
        stock: opts.stock ?? "",
        class: opts.klass ?? "",
        level: 1,
        age: 20,
        home: opts.home ?? "",
        raiment: "",
        parents: "",
        mentor: "",
        friend: "",
        enemy: "",
        upbringingSkillId: opts.upbringingSkillId ?? "",
        socialGracesSkillId: opts.socialGracesSkillId ?? "",
      });
      if (opts.preSkillRatings || opts.specialtySkillId !== undefined) {
        const entries: Record<
          string,
          { rating: number; advancement: { pass: number; fail: number }; taxed: boolean; learningTests: number }
        > = {};
        for (const s of opts.preSkillRatings ?? []) {
          entries[s.id] = {
            rating: s.rating,
            advancement: { pass: 0, fail: 0 },
            taxed: false,
            learningTests: 0,
          };
        }
        world.set(characterId, Skills, {
          entries,
          specialtySkillId: opts.specialtySkillId ?? null,
        });
      }
      if (opts.preTraits && opts.preTraits.length > 0) {
        world.set(characterId, CharacterTraits, {
          entries: opts.preTraits.map((name) => ({
            name,
            level: 1,
            beneficialUses: 0,
            checks: 0,
            usedAgainst: false,
          })),
        });
      }
      // Touch RawAbilities trait so harness reads don't throw on default
      // — not strictly required by the pickers, but consistent with the
      // class-defaults test harness shape.
      world.set(characterId, RawAbilities, {
        will: { rating: 0, advancement: { pass: 0, fail: 0 } },
        health: { rating: 0, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: 0,
          maximum: 0,
          advancement: { pass: 0, fail: 0 },
          descriptors: [],
        },
      });
    },
  });
}

function mount(h: CharacterHarness): void {
  mountWithClient(h, () =>
    TbWhoYouAreTabFill.render({ characterId: h.characterId }) as JSX.Element,
  );
}

function setFields(
  h: CharacterHarness,
  trait: string,
  since = 0,
): ReadonlyArray<CommandInstance> {
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

describe("Human Upbringing picker", () => {
  beforeEach(() => cleanup());

  it("is hidden until stock is Human or Troll Changeling", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    expect(screen.queryByTestId("tb-upbringing-picker")).toBeNull();
  });

  it("renders for Human stock", () => {
    const h = harness({ stock: "Human", klass: "Warrior" });
    mount(h);
    expect(screen.getByTestId("tb-upbringing-picker")).toBeInTheDocument();
  });

  it("renders for Troll Changeling stock (LMM p.9 reuses the human list)", () => {
    const h = harness({ stock: "Troll Changeling", klass: "Warrior" });
    mount(h);
    expect(screen.getByTestId("tb-upbringing-picker")).toBeInTheDocument();
  });

  it("picking a skill writes the skill rating at 3 (DH p.29 baseline)", () => {
    const h = harness({ stock: "Human", klass: "Warrior" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-upbringing-picker"), {
      target: { value: "criminal" },
    });
    const skillWrites = setFields(h, Skills.name, before);
    const ratingWrite = setFieldByPath(skillWrites, [
      "entries",
      "criminal",
      "rating",
    ]);
    expect((ratingWrite?.payload as { value: number }).value).toBe(3);
  });

  it("picking a skill the player already has at 2 bumps it to 3", () => {
    const h = harness({
      stock: "Human",
      klass: "Warrior",
      preSkillRatings: [{ id: "haggler", rating: 2 }],
    });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-upbringing-picker"), {
      target: { value: "haggler" },
    });
    const ratingWrite = setFieldByPath(
      setFields(h, Skills.name, before),
      ["entries", "haggler", "rating"],
    );
    expect((ratingWrite?.payload as { value: number }).value).toBe(3);
  });

  it("caps the rating at 4", () => {
    const h = harness({
      stock: "Human",
      klass: "Warrior",
      preSkillRatings: [{ id: "criminal", rating: 5 }],
    });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-upbringing-picker"), {
      target: { value: "criminal" },
    });
    const ratingWrite = setFieldByPath(
      setFields(h, Skills.name, before),
      ["entries", "criminal", "rating"],
    );
    expect((ratingWrite?.payload as { value: number }).value).toBe(4);
  });

  it("records the picked skill on Identity.upbringingSkillId", () => {
    const h = harness({ stock: "Human", klass: "Warrior" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-upbringing-picker"), {
      target: { value: "pathfinder" },
    });
    const idWrite = setFieldByPath(
      setFields(h, Identity.name, before),
      ["upbringingSkillId"],
    );
    expect((idWrite?.payload as { value: string }).value).toBe("pathfinder");
  });

  it("reflects the stored Identity.upbringingSkillId as the selected option", () => {
    const h = harness({
      stock: "Human",
      klass: "Warrior",
      upbringingSkillId: "laborer",
    });
    mount(h);
    expect(
      (screen.getByTestId("tb-upbringing-picker") as HTMLSelectElement).value,
    ).toBe("laborer");
  });
});

describe("Social Graces picker", () => {
  beforeEach(() => cleanup());

  it("renders for any stock (every character does this step)", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    expect(screen.getByTestId("tb-social-graces-picker")).toBeInTheDocument();
  });

  it("picking a skill writes its rating at 2 (DH p.30 baseline)", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-social-graces-picker"), {
      target: { value: "persuader" },
    });
    const ratingWrite = setFieldByPath(
      setFields(h, Skills.name, before),
      ["entries", "persuader", "rating"],
    );
    expect((ratingWrite?.payload as { value: number }).value).toBe(2);
  });

  it("bumps an existing skill by +1 capped at 4", () => {
    const h = harness({
      stock: "Halfling",
      klass: "Burglar",
      preSkillRatings: [{ id: "manipulator", rating: 3 }],
    });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-social-graces-picker"), {
      target: { value: "manipulator" },
    });
    const ratingWrite = setFieldByPath(
      setFields(h, Skills.name, before),
      ["entries", "manipulator", "rating"],
    );
    expect((ratingWrite?.payload as { value: number }).value).toBe(4);
  });

  it("records the picked skill on Identity.socialGracesSkillId", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-social-graces-picker"), {
      target: { value: "orator" },
    });
    const idWrite = setFieldByPath(
      setFields(h, Identity.name, before),
      ["socialGracesSkillId"],
    );
    expect((idWrite?.payload as { value: string }).value).toBe("orator");
  });
});

describe("Specialty picker", () => {
  beforeEach(() => cleanup());

  it("renders for any stock", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    expect(screen.getByTestId("tb-specialty-picker")).toBeInTheDocument();
  });

  it("picking a skill writes its rating at 2 (DH p.31 baseline)", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-specialty-picker"), {
      target: { value: "scavenger" },
    });
    const ratingWrite = setFieldByPath(
      setFields(h, Skills.name, before),
      ["entries", "scavenger", "rating"],
    );
    expect((ratingWrite?.payload as { value: number }).value).toBe(2);
  });

  it("dispatches SetSpecialtySkill (the existing domain command) — not a raw SetField — to mark the specialty", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-specialty-picker"), {
      target: { value: "scout" },
    });
    const specialtyCmds = h.dispatched
      .slice(before)
      .filter((c) => c.type === SetSpecialtySkill.name);
    expect(specialtyCmds.length).toBe(1);
    expect((specialtyCmds[0]!.payload as { skillId: string }).skillId).toBe(
      "scout",
    );
  });

  it("reflects the stored Skills.specialtySkillId as the selected option", () => {
    const h = harness({
      stock: "Halfling",
      klass: "Burglar",
      specialtySkillId: "criminal",
    });
    mount(h);
    expect(
      (screen.getByTestId("tb-specialty-picker") as HTMLSelectElement).value,
    ).toBe("criminal");
  });
});

describe("Hometown picker", () => {
  beforeEach(() => cleanup());

  it("renders for any stock", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    expect(screen.getByTestId("tb-hometown-picker")).toBeInTheDocument();
  });

  it("Elfhome is in the options only for Elf stock", () => {
    const elfHarness = harness({ stock: "Elf", klass: "Ranger" });
    mount(elfHarness);
    const elfOptions = Array.from(
      (screen.getByTestId("tb-hometown-picker") as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(elfOptions).toContain("elfhome");
    cleanup();
    const dwarfHarness = harness({ stock: "Dwarf", klass: "Outcast" });
    mount(dwarfHarness);
    const dwarfOptions = Array.from(
      (screen.getByTestId("tb-hometown-picker") as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(dwarfOptions).not.toContain("elfhome");
  });

  it("picking a hometown writes Identity.home to the canonical label", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-hometown-picker"), {
      target: { value: "remote-village" },
    });
    const homeWrite = setFieldByPath(
      setFields(h, Identity.name, before),
      ["home"],
    );
    expect((homeWrite?.payload as { value: string }).value).toBe(
      "Remote Village",
    );
  });

  it("picking a hometown writes its 3 prescribed skills at rating 2", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-hometown-picker"), {
      target: { value: "remote-village" },
    });
    const skillWrites = setFields(h, Skills.name, before);
    const ratingFor = (id: string): number | undefined => {
      const w = setFieldByPath(skillWrites, ["entries", id, "rating"]);
      return w ? (w.payload as { value: number }).value : undefined;
    };
    expect(ratingFor("carpenter")).toBe(2);
    expect(ratingFor("peasant")).toBe(2);
    expect(ratingFor("weaver")).toBe(2);
  });

  it("bumps a hometown skill the player already has", () => {
    const h = harness({
      stock: "Halfling",
      klass: "Burglar",
      // Burglar normally has Cook 3 from the class; we simulate Cook 3
      // being already set. Busy Crossroads adds Cook — should bump 3→4.
      preSkillRatings: [{ id: "cook", rating: 3 }],
    });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-hometown-picker"), {
      target: { value: "busy-crossroads" },
    });
    const ratingWrite = setFieldByPath(
      setFields(h, Skills.name, before),
      ["entries", "cook", "rating"],
    );
    expect((ratingWrite?.payload as { value: number }).value).toBe(4);
  });

  it("hometown trait picker is hidden until a hometown is chosen", () => {
    const h = harness({ stock: "Halfling", klass: "Burglar" });
    mount(h);
    expect(screen.queryByTestId("tb-hometown-trait-picker")).toBeNull();
  });

  it("hometown trait picker appears once a hometown is picked and lists both options", () => {
    const h = harness({
      stock: "Halfling",
      klass: "Burglar",
      home: "Remote Village",
    });
    mount(h);
    const trait = screen.getByTestId(
      "tb-hometown-trait-picker",
    ) as HTMLSelectElement;
    const values = Array.from(trait.options).map((o) => o.value);
    expect(values).toContain("Early Riser");
    expect(values).toContain("Rough Hands");
  });

  it("picking a hometown trait appends it at level 1 if not already present", () => {
    const h = harness({
      stock: "Halfling",
      klass: "Burglar",
      home: "Remote Village",
    });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-hometown-trait-picker"), {
      target: { value: "Early Riser" },
    });
    const writes = setFields(h, CharacterTraits.name, before);
    expect(writes.length).toBe(1);
    const value = (
      writes[0]!.payload as { value: ReadonlyArray<{ name: string; level: number }> }
    ).value;
    expect(value).toEqual([
      {
        name: "Early Riser",
        level: 1,
        beneficialUses: 0,
        checks: 0,
        usedAgainst: false,
      },
    ]);
  });

  it("Wizard's Tower (apostrophe in label) survives a full pick → trait flow", () => {
    // Regression: the slug helper used to translate "Wizard's Tower"
    // into "wizard-s-tower" (apostrophe split), which didn't match the
    // map key "wizards-tower". The picker silently broke for this
    // settlement — the trait sub-picker never appeared and the
    // dropdown's selected value reverted to the empty placeholder
    // because `currentHometown()` returned null after the pick.
    const h = harness({ stock: "Human", klass: "Magician" });
    mount(h);
    fireEvent.change(screen.getByTestId("tb-hometown-picker"), {
      target: { value: "wizards-tower" },
    });
    // After the pick, Identity.home is "Wizard's Tower". Re-mount
    // would reflect that via `currentHomeKey` → `selectedHomeKey`
    // mapping back to "wizards-tower". With the bug, the round-trip
    // returned "" and the trait sub-picker disappeared.
    cleanup();
    const h2 = harness({
      stock: "Human",
      klass: "Magician",
      home: "Wizard's Tower",
    });
    mount(h2);
    expect(
      (screen.getByTestId("tb-hometown-picker") as HTMLSelectElement).value,
    ).toBe("wizards-tower");
    expect(screen.getByTestId("tb-hometown-trait-picker")).toBeInTheDocument();
    const traitOptions = Array.from(
      (screen.getByTestId(
        "tb-hometown-trait-picker",
      ) as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(traitOptions).toContain("Skeptical");
    expect(traitOptions).toContain("Thoughtful");
  });

  it("clamps the hometown dropdown to the placeholder when the stored home is filtered out by stock", () => {
    // Start with an Elf who picked Elfhome, then have them switch
    // stock to Dwarf — the picker should not try to display an
    // unselectable "Elfhome" option, it should fall back to "".
    // Identity.home stays "Elfhome" until the player picks a new
    // hometown to overwrite it.
    const h = harness({
      stock: "Dwarf",
      klass: "Outcast",
      home: "Elfhome",
    });
    mount(h);
    expect(
      (screen.getByTestId("tb-hometown-picker") as HTMLSelectElement).value,
    ).toBe("");
  });

  it("hides the trait sub-picker when the stored home is filtered out by stock", () => {
    // Regression: with only `currentHometown() !== null` gating the
    // sub-picker, a Dwarf with home="Elfhome" would still see the
    // Calm / Quiet trait dropdown and could append a stock-restricted
    // trait. The gate should also require the home to be visible for
    // the current stock.
    const h = harness({
      stock: "Dwarf",
      klass: "Outcast",
      home: "Elfhome",
    });
    mount(h);
    expect(screen.queryByTestId("tb-hometown-trait-picker")).toBeNull();
  });

  it("does not duplicate a hometown trait already on the sheet", () => {
    const h = harness({
      stock: "Halfling",
      klass: "Burglar",
      home: "Remote Village",
      preTraits: ["Early Riser"],
    });
    mount(h);
    const before = h.dispatched.length;
    fireEvent.change(screen.getByTestId("tb-hometown-trait-picker"), {
      target: { value: "Early Riser" },
    });
    expect(setFields(h, CharacterTraits.name, before).length).toBe(0);
  });
});
