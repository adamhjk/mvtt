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

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { definePlugin } from "@vtt/substrate";
import {
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
  SetField,
} from "@vtt/characters/shared";
import {
  buildCharacterHarness,
  mountWithClient,
  type CharacterHarness,
} from "@vtt/characters/testing";
import { ChatTimelineContributorSlot } from "@vtt/comms/shared";
import { ItemDetailSectionsSlot } from "@vtt/items/shared";
import { LinkKindsSlot } from "@vtt/notes/shared";
import {
  PaletteCommandsSlot,
  WorkbenchChatRailSurface,
} from "@vtt/shell-workbench/shared";
import {
  Formula,
  RequestRoll,
  RolledBy,
  RollActionsSlot,
  RollResult,
} from "@vtt/resolution/shared";
import { systemTorchbearer } from "./manifest.js";
import { MonsterSheet } from "./client/monster-sheet.js";
import {
  Conditions,
  Heroic,
  RawAbilities,
  TbMonster,
  TbMonsterSpecialRules,
  TbMonsterWeapons,
  TownAbilities,
} from "./shared/index.js";

/** Slot/surface infra so the TB plugin's fills register cleanly. */
const sheetSlotsTestInfra = definePlugin({
  name: "@vtt/test-monster-sheet-slots",
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
  ],
  surfaces: [WorkbenchChatRailSurface],
  traits: [Formula, RollResult, RolledBy],
  commands: [RequestRoll],
});

beforeEach(() => cleanup());

function harness(): CharacterHarness {
  return buildCharacterHarness({
    plugins: [sheetSlotsTestInfra, systemTorchbearer],
    asGm: true,
    characterName: "Vampire Lord",
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, RawAbilities, {
        will: { rating: 0, advancement: { pass: 0, fail: 0 } },
        health: { rating: 0, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: 7,
          maximum: 7,
          advancement: { pass: 0, fail: 0 },
          descriptors: ["Hunting", "Scheming", "Subjugating"],
        },
      });
      world.set(characterId, TownAbilities, {
        resources: { rating: 0, advancement: { pass: 0, fail: 0 } },
        circles: { rating: 0, advancement: { pass: 0, fail: 0 } },
        precedence: 4,
        might: 5,
      });
      world.set(characterId, Conditions, {
        fresh: false,
        hungryThirsty: false,
        angry: false,
        afraid: false,
        exhausted: false,
        injured: false,
        sick: false,
        dead: false,
      });
      world.set(characterId, Heroic, {
        abilities: [],
        townAbilities: [],
        skills: [],
      });
      world.set(characterId, TbMonster, {
        type: "undead",
        instinct: "Always drink the blood of my prey.",
        armorDescription: "Chain or plate armor (in combat as appropriate)",
        dispositions: [
          { conflictType: "kill", value: 17 },
          { conflictType: "capture", value: 10 },
          { conflictType: "convince", value: 6 },
        ],
        pageRef: { canonicalId: "tb/book/loremasters-manual", page: 261 },
      });
      world.set(characterId, TbMonsterSpecialRules, {
        entries: [
          {
            name: "Dominant mind",
            text: "Cannot be charmed.",
            pageRef: { canonicalId: "tb/book/loremasters-manual", page: 261 },
          },
          {
            name: "Vampirism",
            text: "Bite curses victim.",
            pageRef: { canonicalId: "tb/book/loremasters-manual", page: 261 },
          },
        ],
      });
      world.set(characterId, TbMonsterWeapons, {
        entries: [
          {
            name: "Hideous Bite",
            conflicts: ["kill", "capture", "driveOff"],
            bonuses: {
              attack: { type: "success", value: 1 },
              defend: { type: "dice", value: 0 },
              feint: { type: "dice", value: 0 },
              maneuver: { type: "dice", value: 0 },
            },
          },
        ],
      });
    },
  });
}

describe("MonsterSheet", () => {
  it("renders the monster's stat block (Nature/Might/Precedence)", () => {
    const h = harness();
    mountWithClient(h, () => <MonsterSheet characterId={h.characterId} />);
    expect(screen.getByTestId("monster-nature-value")).toHaveTextContent("7");
    expect(screen.getByTestId("monster-might-value")).toHaveTextContent("5");
    expect(screen.getByTestId("monster-precedence-value")).toHaveTextContent(
      "4",
    );
  });

  it("renders the monster's instinct quote and type pill", () => {
    const h = harness();
    mountWithClient(h, () => <MonsterSheet characterId={h.characterId} />);
    expect(
      screen.getByTestId("monster-instinct-display"),
    ).toHaveTextContent("Always drink the blood of my prey.");
    expect(screen.getByTestId("monster-type-pill")).toHaveTextContent(
      "UNDEAD",
    );
  });

  it("renders the editable name input bound to Character.name", () => {
    const h = harness();
    mountWithClient(h, () => <MonsterSheet characterId={h.characterId} />);
    const nameInput = screen.getByDisplayValue("Vampire Lord") as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    fireEvent.input(nameInput, { target: { value: "Vasilescu" } });
    fireEvent.blur(nameInput);
    const setFieldDispatch = h.dispatched.find(
      (d) =>
        d.type === SetField.name &&
        (d.payload as { trait: string }).trait ===
          "@vtt/characters/Character",
    );
    expect(setFieldDispatch).toBeTruthy();
    expect(setFieldDispatch!.payload).toMatchObject({
      trait: "@vtt/characters/Character",
      path: ["name"],
      value: "Vasilescu",
    });
  });

  it("editing Nature rating dispatches SetField on RawAbilities.nature.rating", () => {
    const h = harness();
    mountWithClient(h, () => <MonsterSheet characterId={h.characterId} />);
    const numberInput = screen.getByDisplayValue("7") as HTMLInputElement;
    fireEvent.input(numberInput, { target: { value: "8" } });
    fireEvent.blur(numberInput);
    const setFieldDispatch = h.dispatched.find(
      (d) =>
        d.type === SetField.name &&
        (d.payload as { trait: string }).trait ===
          "@vtt/system-torchbearer/RawAbilities",
    );
    expect(setFieldDispatch).toBeTruthy();
    expect(setFieldDispatch!.payload).toMatchObject({
      trait: "@vtt/system-torchbearer/RawAbilities",
      path: ["nature", "rating"],
      value: 8,
    });
  });

  it("renders dispositions table with one row per conflict type", () => {
    const h = harness();
    mountWithClient(h, () => <MonsterSheet characterId={h.characterId} />);
    // Three rows; each one has a select bound to the conflict type id
    // and a number input for the value.
    expect(screen.getByTestId("monster-dispo-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("monster-dispo-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("monster-dispo-row-2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("17")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();
    expect(screen.getByDisplayValue("6")).toBeInTheDocument();
  });

  it("renders the special rules with name + body inputs", () => {
    const h = harness();
    mountWithClient(h, () => <MonsterSheet characterId={h.characterId} />);
    expect(screen.getByDisplayValue("Dominant mind")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Cannot be charmed.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Vampirism")).toBeInTheDocument();
  });

  it("renders BookCitation pills for the monster header, instinct, armor, and each special rule", () => {
    const h = harness();
    mountWithClient(h, () => <MonsterSheet characterId={h.characterId} />);
    // Header citation lives next to the type pill — click takes the
    // GM to LMM p.261 in the bound rulebook (when bound; here no
    // Book is bound so the citation renders as plain text).
    const headerCite = screen
      .getByTestId("monster-type-pill")
      .parentElement!.querySelector('[data-canonical-id]');
    expect(headerCite).not.toBeNull();
    expect(headerCite!.getAttribute("data-canonical-id")).toBe(
      "tb/book/loremasters-manual",
    );
    expect(headerCite!.getAttribute("data-canonical-page")).toBe("261");
    expect(headerCite!.textContent).toContain("LMM p.261");

    const armorCite = screen
      .getByTestId("monster-armor-citation")
      .querySelector("[data-canonical-id]");
    expect(armorCite!.getAttribute("data-canonical-page")).toBe("261");
    const instinctCite = screen
      .getByTestId("monster-instinct-citation")
      .querySelector("[data-canonical-id]");
    expect(instinctCite!.getAttribute("data-canonical-page")).toBe("261");

    // One citation per special rule. Both vampire-lord rules in the
    // harness sit on LMM p.261.
    const ruleRows = [
      screen.getByTestId("monster-rule-row-0"),
      screen.getByTestId("monster-rule-row-1"),
    ];
    for (const row of ruleRows) {
      const cite = row.querySelector("[data-canonical-id]");
      expect(cite!.getAttribute("data-canonical-id")).toBe(
        "tb/book/loremasters-manual",
      );
      expect(cite!.getAttribute("data-canonical-page")).toBe("261");
    }
  });

  it("renders the weapon row's name + bonus value inputs", () => {
    const h = harness();
    mountWithClient(h, () => <MonsterSheet characterId={h.characterId} />);
    expect(screen.getByDisplayValue("Hideous Bite")).toBeInTheDocument();
    // The Attack column's value is 1 (a +1s in the printed table).
    const ones = screen.getAllByDisplayValue("1");
    expect(ones.length).toBeGreaterThan(0);
  });

  it("descriptors render as removable chips bound to RawAbilities.nature.descriptors", () => {
    const h = harness();
    mountWithClient(h, () => <MonsterSheet characterId={h.characterId} />);
    expect(screen.getByText("Hunting")).toBeInTheDocument();
    expect(screen.getByText("Scheming")).toBeInTheDocument();
    expect(screen.getByText("Subjugating")).toBeInTheDocument();
  });

  it("conditions section shows monstrous condition chips", () => {
    const h = harness();
    mountWithClient(h, () => <MonsterSheet characterId={h.characterId} />);
    expect(screen.getByTestId("monster-cond-injured")).toHaveAttribute(
      "data-on",
      "false",
    );
    expect(screen.getByTestId("monster-cond-afraid")).toHaveAttribute(
      "data-on",
      "false",
    );
  });

  it("renders 'no special rules' empty state when the rules trait is empty", () => {
    const h = buildCharacterHarness({
      plugins: [sheetSlotsTestInfra, systemTorchbearer],
      asGm: true,
      characterName: "Cinderclaw",
      setupWorld: ({ world, characterId }) => {
        world.set(characterId, RawAbilities, {
          will: { rating: 0, advancement: { pass: 0, fail: 0 } },
          health: { rating: 0, advancement: { pass: 0, fail: 0 } },
          nature: {
            rating: 1,
            maximum: 1,
            advancement: { pass: 0, fail: 0 },
            descriptors: [],
          },
        });
        world.set(characterId, TownAbilities, {
          resources: { rating: 0, advancement: { pass: 0, fail: 0 } },
          circles: { rating: 0, advancement: { pass: 0, fail: 0 } },
          precedence: 0,
          might: 1,
        });
        world.set(characterId, Heroic, {
          abilities: [],
          townAbilities: [],
          skills: [],
        });
        world.set(characterId, TbMonster, {
          type: "beast",
          instinct: "",
          armorDescription: "",
          dispositions: [],
          pageRef: null,
        });
        world.set(characterId, TbMonsterSpecialRules, { entries: [] });
        world.set(characterId, TbMonsterWeapons, { entries: [] });
      },
    });
    mountWithClient(h, () => <MonsterSheet characterId={h.characterId} />);
    expect(screen.getByTestId("monster-weapons-empty")).toBeInTheDocument();
  });
});
