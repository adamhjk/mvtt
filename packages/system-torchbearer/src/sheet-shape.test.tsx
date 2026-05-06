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
import { For, type Accessor } from "solid-js";
import type { ChatTimelineEntry } from "@vtt/comms/shared";
import {
  buildCharacterHarness,
  mountWithClient,
  type CharacterHarness,
} from "@vtt/characters/testing";
import { SheetShell } from "@vtt/characters/client";
import {
  Character,
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
  PendingRoll,
  SetField,
} from "@vtt/characters/shared";
import { Permissions, everyone } from "@vtt/permissions/shared";
import { definePlugin, type EntityId } from "@vtt/substrate";
import { RequestRoll, RollActionsSlot } from "@vtt/resolution/shared";
import { ItemDetailSectionsSlot } from "@vtt/items/shared";
import { ChatTimelineContributorSlot } from "@vtt/comms/shared";
import { type JSX } from "solid-js";
import { systemTorchbearer } from "./manifest.js";
import {
  AlliesEnemies,
  CharacterTraits,
  Conditions,
  Identity,
  Pools,
  RawAbilities,
  SkillCheck,
  SkillImprovementOpportunity,
  Skills,
  Wises,
} from "./shared/index.js";
import {
  TbAbilitiesSkillsTabFill,
  TbActionsFill,
  TbArcaneTabFill,
  TbChatTimelineContributor,
  TbInventoryTabFill,
  TbPendingRollContributor,
  TbRollChatTimelineContributor,
  TbRollRow,
  TbTraitsWisesTabFill,
  TbVitalsFill,
  TbWhatYouFightForTabFill,
  TbWhoYouAreTabFill,
} from "./client/index.js";
import {
  Formula,
  RolledBy,
  RollResult,
} from "@vtt/resolution/shared";
import { WorkbenchChatRailSurface } from "@vtt/shell-workbench/shared";
import {
  AdvancementLoggedTrait,
  LogAdvancement,
  TB_DISPOSITION_CONTRIB_KIND,
  TB_MODIFIER_CONTRIB_KIND,
  TB_OBSTACLE_CONTRIB_KIND,
  TB_ROLL_META_SYSTEM,
  TB_VERSUS_CONTRIB_KIND,
  type TbRollSpec,
} from "./shared/index.js";

/**
 * The character harness in `@vtt/characters/testing` doesn't ship the
 * sheet slot definitions (the system-simple tests never mount the full
 * SheetShell). This sidecar test plugin registers the five slots so
 * the TB plugin's fills can target them when both plugins are loaded
 * into the harness.
 */
const sheetSlotsTestInfra = definePlugin({
  name: "@vtt/test-sheet-slots",
  version: "0.0.0",
  slots: [
    CharacterSheetIdentitySlot,
    CharacterSheetVitalsSlot,
    CharacterSheetStatusSlot,
    CharacterSheetTabsSlot,
    CharacterSheetActionsSlot,
    // Comms slot torchbearer fills with its skill-improvement chat
    // contributor. Declared in this sidecar so the TB plugin's fill
    // resolves when both plugins are loaded into the harness without
    // pulling all of @vtt/comms in.
    ChatTimelineContributorSlot,
    // Resolution-side slot torchbearer fills with its post-roll
    // action panel (log buttons + future fate/persona spends).
    RollActionsSlot,
    // Items-side slot torchbearer fills with its per-subtype
    // workbench-page sections (TbWeapon stats, TbArmor stats, etc.).
    ItemDetailSectionsSlot,
  ],
  // The grind tracker view targets the workbench's chat-rail
  // surface. The harness doesn't load shell-workbench; declare the
  // surface here so the TB plugin's view registers cleanly.
  surfaces: [WorkbenchChatRailSurface],
  // Resolution-side traits are registered by the real `@vtt/resolution`
  // plugin. The character harness doesn't load it, so the TB roll-row
  // jsdom tests register them here so spawned Roll entities decode
  // cleanly when the test mounts the row directly.
  traits: [Formula, RollResult, RolledBy],
  // RequestRoll is the command that every TB rollable's dispatcher
  // targets. The real `@vtt/resolution` plugin registers it; we mirror
  // that here so the rollable validator passes when the harness loads.
  commands: [RequestRoll],
});

beforeEach(() => {
  cleanup();
});

function harness(
  setup?: (args: {
    world: CharacterHarness["world"];
    characterId: CharacterHarness["characterId"];
  }) => void,
): CharacterHarness {
  return buildCharacterHarness({
    plugins: [sheetSlotsTestInfra, systemTorchbearer],
    asGm: true,
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, Identity, {
        name: "Bryn",
        stock: "Human",
        class: "Theologian",
        level: 3,
        age: 23,
        home: "Highvale",
        raiment: "Brown robe",
        parents: "Tanners of Highvale",
        mentor: "Old Hertha",
        friend: "Wren",
        enemy: "Brother Olin",
      });
      world.set(characterId, RawAbilities, {
        will: { rating: 4, advancement: { pass: 0, fail: 0 } },
        health: { rating: 5, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: 4,
          maximum: 4,
          advancement: { pass: 0, fail: 0 },
          descriptors: ["Boasting", "Demanding", "Running"],
        },
      });
      setup?.({ world, characterId });
    },
  });
}

function mountFillBody(
  h: CharacterHarness,
  render: (args: { characterId: EntityId }) => unknown,
): void {
  mountWithClient(h, () => render({ characterId: h.characterId }) as JSX.Element);
}

/* -------------------------------------------------------------------------
 * SheetShell — every region mounts; full-shell sanity check
 * ----------------------------------------------------------------------- */

describe("Torchbearer sheet shell", () => {
  it("mounts every region/tab of the sheet via the manifest fills", () => {
    const h = harness();
    mountWithClient(h, () => <SheetShell characterId={h.characterId} />);

    // Identity sub-line is read-only "Stock · Class · Lvl N".
    expect(screen.getByText("Human · Theologian · Lvl 3")).toBeInTheDocument();
    // The Who You Are tab body is mounted by default (highest priority);
    // its inputs surface the same trait values.
    expect(screen.getByDisplayValue("Human")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Theologian")).toBeInTheDocument();

    // Vitals — conditions ladder header + the 8 condition labels in order.
    expect(screen.getByText("Conditions")).toBeInTheDocument();
    for (const label of [
      "Fresh",
      "Hungry and Thirsty",
      "Angry",
      "Afraid",
      "Exhausted",
      "Injured",
      "Sick",
      "Dead",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Tab bar — six tabs, in printed-sheet order.
    const tabs = screen.getAllByRole("tab").map((b) => b.textContent);
    expect(tabs).toEqual([
      "Who You Are",
      "What You Fight For",
      "Abilities & Skills",
      "Traits & Wises",
      "Arcane",
      "Inventory",
    ]);

    // Action bar — the four sticky-bottom roll buttons.
    expect(screen.getByRole("button", { name: /Roll Will/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Roll Health/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Roll Nature/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tap Nature/i })).toBeInTheDocument();
  });

  it("clicking a tab switches the body to that tab's content", () => {
    // Regression: SheetShell used to render the body via `<Show when=>`
    // without `keyed`, so swapping between truthy active tabs left the
    // first-mounted tab in place. The kit.Tabs primitive now uses
    // keyed Show — verify by clicking through every tab.
    const h = harness();
    mountWithClient(h, () => <SheetShell characterId={h.characterId} />);

    // Default: Who You Are body shows "Highvale" and "Brother Olin".
    expect(screen.getByDisplayValue("Highvale")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "What You Fight For" }));
    expect(screen.getByText("Belief")).toBeInTheDocument();
    expect(screen.getByText("Creed")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Highvale")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Abilities & Skills" }));
    // The Skills section title is shown; the actual skill list is one
    // alphabetical run with no source-book sub-headers.
    expect(screen.getByText(/^Skills$/)).toBeInTheDocument();
    expect(screen.queryByText("Belief")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Inventory" }));
    // The slot-roof layout opens on the body slots — `Head` is the
    // first body-slot panel.
    expect(screen.getByText(/^Head$/)).toBeInTheDocument();
    expect(screen.queryByText("Adventuring")).toBeNull();

    // And back — the Who You Are body re-mounts cleanly.
    fireEvent.click(screen.getByRole("tab", { name: "Who You Are" }));
    expect(screen.getByDisplayValue("Highvale")).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------
 * Conditions ladder (Vitals region) — toggling propagates to Status
 * ----------------------------------------------------------------------- */

describe("Conditions ladder", () => {
  it("renders the 8 conditions in canonical severity order", () => {
    const h = harness();
    mountFillBody(h, TbVitalsFill.render);

    const ladderRoot = screen.getByRole("group", {
      name: /Condition ladder, in severity order/,
    });
    const labels = Array.from(ladderRoot.querySelectorAll("label > span")).map(
      (n) => n.textContent,
    );
    expect(labels).toEqual([
      "Fresh",
      "Hungry and Thirsty",
      "Angry",
      "Afraid",
      "Exhausted",
      "Injured",
      "Sick",
      "Dead",
    ]);
  });

  it("flipping a condition checkbox dispatches SetField with the right path", () => {
    const h = harness();
    mountFillBody(h, TbVitalsFill.render);

    const ladder = screen.getByRole("group", {
      name: /Condition ladder, in severity order/,
    });
    const sickLabel = Array.from(ladder.querySelectorAll("label")).find((l) =>
      /Sick$/.test(l.textContent ?? ""),
    );
    expect(sickLabel).toBeDefined();
    const sickCheckbox = sickLabel!.querySelector("input[type=checkbox]") as HTMLInputElement;
    fireEvent.click(sickCheckbox);

    const dispatched = h.dispatched as Array<{ type: string; payload: unknown }>;
    const setFields = dispatched.filter((d) => d.type === SetField.name);
    expect(setFields.length).toBeGreaterThanOrEqual(1);
    const last = setFields[setFields.length - 1]!.payload as {
      trait: string;
      path: Array<string>;
      value: unknown;
    };
    expect(last.trait).toBe(Conditions.name);
    expect(last.path).toEqual(["sick"]);
    expect(last.value).toBe(true);
  });

});

/* -------------------------------------------------------------------------
 * Tab bodies — render each tab fill directly so we don't depend on
 * SheetShell's tab-switching mechanics
 * ----------------------------------------------------------------------- */

describe("Tab body — Who You Are", () => {
  it("renders the printed-sheet identity fields and Allies & Enemies sub-section", () => {
    const h = harness();
    mountFillBody(h, TbWhoYouAreTabFill.render);

    // The h3 heading "Who You Are" is the section title, and "Allies &
    // Enemies" is a labeled sub-section folded into the same tab.
    expect(screen.getByText("Who You Are")).toBeInTheDocument();
    expect(screen.getByText("Allies & Enemies")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Highvale")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Old Hertha")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Brother Olin")).toBeInTheDocument();
  });
});

describe("Tab body — Allies & Enemies editor", () => {
  function rowsRoot(): HTMLElement {
    const r = document.querySelector(".vk-rows") as HTMLElement | null;
    if (!r) throw new Error("expected .vk-rows region");
    return r;
  }

  it("shows the empty-state hint when no entries are recorded", () => {
    const h = harness();
    mountFillBody(h, TbWhoYouAreTabFill.render);
    expect(
      screen.getByText(/no allies or enemies yet/i),
    ).toBeInTheDocument();
  });

  it("renders the three column headers", () => {
    const h = harness();
    mountFillBody(h, TbWhoYouAreTabFill.render);
    const heads = Array.from(rowsRoot().querySelectorAll(".vk-rows__head"))
      .map((n) => n.textContent?.trim() ?? "")
      .filter((t) => t.length > 0);
    expect(heads).toEqual(["Name", "Location", "Status"]);
  });

  it("renders existing Allies & Enemies entries as rows", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, AlliesEnemies, {
        entries: [
          { name: "Wren", location: "Highvale", status: "ally" },
          { name: "Brother Olin", location: "Cathedral", status: "enemy" },
        ],
      });
    });
    mountFillBody(h, TbWhoYouAreTabFill.render);

    const rows = rowsRoot().querySelectorAll(".vk-rows__row");
    expect(rows).toHaveLength(2);
    expect((rows[0]!.querySelectorAll("input")[0] as HTMLInputElement).value).toBe(
      "Wren",
    );
    expect((rows[1]!.querySelectorAll("input")[2] as HTMLInputElement).value).toBe(
      "enemy",
    );
  });

  it("typing a name + Enter in the add row dispatches SetField with seeded entry", () => {
    const h = harness();
    mountFillBody(h, TbWhoYouAreTabFill.render);

    const input = rowsRoot().querySelector(".vk-rows__add-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Captain Halma" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect(cmd).toBeDefined();
    expect((cmd!.payload as { value: unknown[] }).value).toEqual([
      { name: "Captain Halma", location: "", status: "" },
    ]);
  });

  it("clicking × on a row dispatches SetField without that row", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, AlliesEnemies, {
        entries: [
          { name: "Wren", location: "", status: "" },
          { name: "Olin", location: "", status: "" },
        ],
      });
    });
    mountFillBody(h, TbWhoYouAreTabFill.render);

    fireEvent.click(screen.getByLabelText("remove row 1"));
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect(
      (cmd!.payload as { value: { name: string }[] }).value.map((e) => e.name),
    ).toEqual(["Olin"]);
  });
});

describe("Tab body — What You Fight For", () => {
  it("renders the four BICG section titles", () => {
    const h = harness();
    mountFillBody(h, TbWhatYouFightForTabFill.render);

    for (const label of ["Belief", "Creed", "Goal", "Instinct"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe("Tab body — Abilities & Skills", () => {
  it("renders skills as one flat alphabetical list — no source-book headers", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);

    // The three former sub-headers are gone; the user wanted a single
    // alphabetical list.
    expect(screen.queryByText("Adventuring")).toBeNull();
    expect(screen.queryByText("Town & Laborer")).toBeNull();
    expect(screen.queryByText("Lore Master's Manual")).toBeNull();

    // Representative skills from every source still render. Each
    // row's textContent is "<Name>(W|H)" with no whitespace in between.
    expect(
      screen.getAllByText((_, el) => /^Alchemist\(/.test(el?.textContent ?? "")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText((_, el) => /^Sapper\(/.test(el?.textContent ?? "")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText((_, el) => /^Strategist\(/.test(el?.textContent ?? "")).length,
    ).toBeGreaterThanOrEqual(1);

    // Levels & Benefits is folded in as a labeled sub-section.
    expect(screen.getByText("Levels & Benefits")).toBeInTheDocument();
  });

  it("orders skills alphabetically by display name", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);

    // Pull every "<Name>(W|H)" label by textContent and verify the
    // sequence is sorted alphabetically.
    const labels = Array.from(document.querySelectorAll("span"))
      .map((n) => n.textContent ?? "")
      .filter((t) => /^[A-Z][A-Za-z' ]+\([WH]\)$/.test(t))
      .map((t) => t.replace(/\([WH]\)$/, ""));
    expect(labels[0]).toBe("Alchemist");
    // First skill alphabetically out of 41 — Alchemist precedes
    // every other skill.
    const sorted = [...labels].sort((a, b) => a.localeCompare(b));
    expect(labels).toEqual(sorted);
  });

  it("renders all 41 skill labels (DH 33 + LMM 8)", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);

    // Each skill row renders "<Name>(W|H)" with no whitespace between
    // the name and the BL hint (siblings inside an inline-flex gap).
    const skillSpans = Array.from(document.querySelectorAll("span"))
      .map((n) => n.textContent ?? "")
      .filter((t) => /^[A-Z][A-Za-z' ]+\([WH]\)$/.test(t));
    const distinct = new Set(skillSpans.map((t) => t.replace(/\([WH]\)$/, "")));
    expect(distinct.size).toBeGreaterThanOrEqual(41);
  });
});

describe("Tab body — Nature Descriptors", () => {
  function descriptorsRoot(): HTMLElement {
    // The "Nature Descriptors" row contains a single .vk-tags region —
    // the only one rendered by this tab body. Look it up by class.
    const region = document.querySelector(".vk-tags") as HTMLElement | null;
    if (!region) throw new Error("expected .vk-tags region in tab body");
    return region;
  }
  function descriptorsInput(): HTMLInputElement {
    const input = descriptorsRoot().querySelector(
      "input.vk-tags__input",
    ) as HTMLInputElement | null;
    if (!input) throw new Error("expected .vk-tags__input inside .vk-tags");
    return input;
  }

  it("renders existing descriptors as pills under a 'Nature Descriptors' label", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);

    expect(screen.getByText("Nature Descriptors")).toBeInTheDocument();
    const pillTexts = Array.from(
      descriptorsRoot().querySelectorAll(".vk-tag__text"),
    ).map((n) => n.textContent);
    expect(pillTexts).toEqual(["Boasting", "Demanding", "Running"]);
  });

  it("clicking a pill's × dispatches SetField with that descriptor removed", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);

    fireEvent.click(screen.getByLabelText("remove Demanding"));
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect(cmd).toBeDefined();
    expect(cmd!.payload).toMatchObject({
      characterId: h.characterId,
      path: ["nature", "descriptors"],
      value: ["Boasting", "Running"],
    });
  });

  it("typing a descriptor and pressing Enter dispatches SetField with it appended", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);

    const input = descriptorsInput();
    fireEvent.input(input, { target: { value: "Wandering" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect(cmd).toBeDefined();
    expect(cmd!.payload).toMatchObject({
      path: ["nature", "descriptors"],
      value: ["Boasting", "Demanding", "Running", "Wandering"],
    });
  });

  it("comma key also commits the descriptor (no comma in stored value)", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);

    const input = descriptorsInput();
    fireEvent.input(input, { target: { value: "Watchful" } });
    fireEvent.keyDown(input, { key: "," });
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect(cmd).toBeDefined();
    expect((cmd!.payload as { value: string[] }).value).toEqual([
      "Boasting",
      "Demanding",
      "Running",
      "Watchful",
    ]);
  });

  it("backspace on an empty input removes the trailing pill", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);

    const input = descriptorsInput();
    expect(input.value).toBe("");
    fireEvent.keyDown(input, { key: "Backspace" });
    const cmd = h.dispatched.find((c) => c.type === SetField.name);
    expect(cmd).toBeDefined();
    expect((cmd!.payload as { value: string[] }).value).toEqual([
      "Boasting",
      "Demanding",
    ]);
  });

  it("blank or whitespace-only input does not dispatch on Enter", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);

    const input = descriptorsInput();
    fireEvent.input(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.dispatched.find((c) => c.type === SetField.name)).toBeUndefined();
  });

  it("duplicate descriptor (same trimmed text already present) does not dispatch", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);

    const input = descriptorsInput();
    fireEvent.input(input, { target: { value: "  Boasting  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.dispatched.find((c) => c.type === SetField.name)).toBeUndefined();
  });
});

describe("Tab body — Traits & Wises", () => {
  function rowsRoots(): HTMLElement[] {
    return Array.from(document.querySelectorAll(".vk-rows")) as HTMLElement[];
  }

  it("shows empty-state hints when traits and wises are empty", () => {
    const h = harness();
    mountFillBody(h, TbTraitsWisesTabFill.render);

    expect(screen.getByText("Traits")).toBeInTheDocument();
    expect(screen.getByText("Wises")).toBeInTheDocument();
    expect(screen.getAllByText(/no (traits|wises) yet/i).length).toBe(2);
  });

  it("renders entries as editable rows with their column values", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, CharacterTraits, {
        entries: [
          { name: "Stubborn", level: 2, beneficialUses: 1, checks: 0 },
        ],
      });
      world.set(characterId, Wises, {
        entries: [
          { name: "Field Dressing-wise", pass: true, fail: false, fate: false, persona: false },
        ],
      });
    });
    mountFillBody(h, TbTraitsWisesTabFill.render);

    expect(screen.getByDisplayValue("Stubborn")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Field Dressing-wise")).toBeInTheDocument();
    // Level (Lv) and Checks are number inputs; Beneficial Uses is a dots track.
    const traitRoot = rowsRoots()[0]!;
    const numInputs = traitRoot.querySelectorAll(".vk-rows__row input.vk-input--number");
    expect(numInputs).toHaveLength(2);
    expect((numInputs[0] as HTMLInputElement).value).toBe("2"); // level
    expect((numInputs[1] as HTMLInputElement).value).toBe("0"); // checks
    // Beneficial-uses dots: the trait is level 2, so two dots, one filled.
    const dots = traitRoot.querySelectorAll(".vk-rows__row .vk-dot");
    expect(dots).toHaveLength(2);
    expect(dots[0]!.classList.contains("vk-dot--filled")).toBe(true);
    expect(dots[1]!.classList.contains("vk-dot--filled")).toBe(false);
  });

  it("beneficial-uses dot count tracks the trait's level; level 3 shows 'all'", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, CharacterTraits, {
        entries: [
          { name: "Stubborn", level: 1, beneficialUses: 0, checks: 0 },
          { name: "Bold", level: 3, beneficialUses: 0, checks: 0 },
        ],
      });
    });
    mountFillBody(h, TbTraitsWisesTabFill.render);

    const traitRoot = rowsRoots()[0]!;
    const rows = traitRoot.querySelectorAll(".vk-rows__row");
    // Level 1 → 1 dot.
    expect(rows[0]!.querySelectorAll(".vk-dot")).toHaveLength(1);
    expect(rows[0]!.querySelector(".vk-dots__placeholder")).toBeNull();
    // Level 3 → no dots, "all" placeholder text.
    expect(rows[1]!.querySelectorAll(".vk-dot")).toHaveLength(0);
    expect(rows[1]!.querySelector(".vk-dots__placeholder")?.textContent).toBe("all");
  });

  it("clicking a beneficial-uses dot dispatches SetField with the new spend count", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, CharacterTraits, {
        entries: [
          { name: "Stubborn", level: 2, beneficialUses: 0, checks: 0 },
        ],
      });
    });
    mountFillBody(h, TbTraitsWisesTabFill.render);

    const traitRoot = rowsRoots()[0]!;
    const dots = traitRoot.querySelectorAll(".vk-rows__row .vk-dot");
    fireEvent.click(dots[1]!); // click second dot → set to 2
    const cmd = h.dispatched.find(
      (c) =>
        c.type === SetField.name &&
        (c.payload as { trait: string }).trait === CharacterTraits.name,
    );
    expect(cmd).toBeDefined();
    expect(
      (cmd!.payload as { value: { beneficialUses: number }[] }).value[0]!.beneficialUses,
    ).toBe(2);
  });

  it("renders a 'vs Self' checkbox per trait reflecting usedAgainst", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, CharacterTraits, {
        entries: [
          { name: "Stubborn", level: 1, beneficialUses: 0, checks: 0, usedAgainst: false },
          { name: "Reckless", level: 1, beneficialUses: 0, checks: 1, usedAgainst: true },
        ],
      });
    });
    mountFillBody(h, TbTraitsWisesTabFill.render);

    const traitRoot = rowsRoots()[0]!;
    const rows = traitRoot.querySelectorAll(".vk-rows__row");
    const stubbornChecks = rows[0]!.querySelectorAll("input[type='checkbox']");
    const recklessChecks = rows[1]!.querySelectorAll("input[type='checkbox']");
    // Each trait row has exactly one checkbox column (vs Self).
    expect(stubbornChecks).toHaveLength(1);
    expect((stubbornChecks[0] as HTMLInputElement).checked).toBe(false);
    expect((recklessChecks[0] as HTMLInputElement).checked).toBe(true);
  });

  it("clicking a trait's 'vs Self' checkbox dispatches SetField with the flag flipped", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, CharacterTraits, {
        entries: [
          { name: "Reckless", level: 1, beneficialUses: 0, checks: 1, usedAgainst: true },
        ],
      });
    });
    mountFillBody(h, TbTraitsWisesTabFill.render);

    const traitRoot = rowsRoots()[0]!;
    const checkbox = traitRoot.querySelector(
      ".vk-rows__row input[type='checkbox']",
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    const cmd = h.dispatched.find(
      (c) =>
        c.type === SetField.name &&
        (c.payload as { trait: string }).trait === CharacterTraits.name,
    );
    expect(cmd).toBeDefined();
    expect(
      (cmd!.payload as { value: { usedAgainst: boolean }[] }).value[0]!.usedAgainst,
    ).toBe(false);
  });

  it("renders the four wise checkboxes with the right initial state", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Wises, {
        entries: [
          { name: "Field Dressing-wise", pass: true, fail: false, fate: true, persona: false },
        ],
      });
    });
    mountFillBody(h, TbTraitsWisesTabFill.render);

    const wiseRoot = rowsRoots()[1]!;
    const checks = Array.from(
      wiseRoot.querySelectorAll(".vk-rows__row input[type='checkbox']"),
    ) as HTMLInputElement[];
    expect(checks).toHaveLength(4);
    // Order in the columns array: pass, fail, fate, persona.
    expect(checks.map((c) => c.checked)).toEqual([true, false, true, false]);
  });

  it("typing a name + Enter in the Traits add-row dispatches SetField with a seeded trait", () => {
    const h = harness();
    mountFillBody(h, TbTraitsWisesTabFill.render);

    const traitAddInput = rowsRoots()[0]!.querySelector(
      ".vk-rows__add-input",
    ) as HTMLInputElement;
    fireEvent.input(traitAddInput, { target: { value: "Stubborn" } });
    fireEvent.keyDown(traitAddInput, { key: "Enter" });
    const cmd = h.dispatched.find(
      (c) =>
        c.type === SetField.name &&
        (c.payload as { trait: string }).trait === CharacterTraits.name,
    );
    expect(cmd).toBeDefined();
    expect((cmd!.payload as { value: unknown[] }).value).toEqual([
      { name: "Stubborn", level: 1, beneficialUses: 0, checks: 0, usedAgainst: false },
    ]);
  });

  it("typing a name + Enter in the Wises add-row dispatches SetField with a seeded wise", () => {
    const h = harness();
    mountFillBody(h, TbTraitsWisesTabFill.render);

    const wiseAddInput = rowsRoots()[1]!.querySelector(
      ".vk-rows__add-input",
    ) as HTMLInputElement;
    fireEvent.input(wiseAddInput, { target: { value: "Mushroom-wise" } });
    fireEvent.keyDown(wiseAddInput, { key: "Enter" });
    const cmd = h.dispatched.find(
      (c) =>
        c.type === SetField.name &&
        (c.payload as { trait: string }).trait === Wises.name,
    );
    expect(cmd).toBeDefined();
    expect((cmd!.payload as { value: unknown[] }).value).toEqual([
      { name: "Mushroom-wise", pass: false, fail: false, fate: false, persona: false },
    ]);
  });

  it("toggling a wise's Pass checkbox dispatches SetField with that flag flipped", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Wises, {
        entries: [
          { name: "Field Dressing-wise", pass: false, fail: false, fate: false, persona: false },
        ],
      });
    });
    mountFillBody(h, TbTraitsWisesTabFill.render);

    const wiseRoot = rowsRoots()[1]!;
    const passCheck = wiseRoot.querySelector(
      ".vk-rows__row input[type='checkbox']",
    ) as HTMLInputElement;
    fireEvent.click(passCheck);
    const cmd = h.dispatched.find(
      (c) =>
        c.type === SetField.name &&
        (c.payload as { trait: string }).trait === Wises.name,
    );
    expect((cmd!.payload as { value: { pass: boolean }[] }).value[0]!.pass).toBe(true);
  });

  it("editing a trait's level clamps to the 1–3 range", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, CharacterTraits, {
        entries: [
          { name: "Stubborn", level: 2, beneficialUses: 0, checks: 0 },
        ],
      });
    });
    mountFillBody(h, TbTraitsWisesTabFill.render);

    const traitRoot = rowsRoots()[0]!;
    const levelInput = traitRoot.querySelector(
      ".vk-rows__row input.vk-input--number",
    ) as HTMLInputElement;
    fireEvent.focus(levelInput);
    fireEvent.input(levelInput, { target: { value: "9" } });
    fireEvent.blur(levelInput);
    const cmd = h.dispatched.find(
      (c) =>
        c.type === SetField.name &&
        (c.payload as { trait: string }).trait === CharacterTraits.name,
    );
    expect((cmd!.payload as { value: { level: number }[] }).value[0]!.level).toBe(3);
  });

  it("clicking × on a trait row removes that entry", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, CharacterTraits, {
        entries: [
          { name: "Stubborn", level: 1, beneficialUses: 0, checks: 0 },
          { name: "Quiet", level: 1, beneficialUses: 0, checks: 0 },
        ],
      });
    });
    mountFillBody(h, TbTraitsWisesTabFill.render);

    fireEvent.click(screen.getAllByLabelText("remove row 1")[0]!);
    const cmd = h.dispatched.find(
      (c) =>
        c.type === SetField.name &&
        (c.payload as { trait: string }).trait === CharacterTraits.name,
    );
    expect(
      (cmd!.payload as { value: { name: string }[] }).value.map((e) => e.name),
    ).toEqual(["Quiet"]);
  });
});

describe("Tab body — Arcane", () => {
  it("mounts both Spells and Relics sub-sections with their tracks", () => {
    const h = harness();
    mountFillBody(h, TbArcaneTabFill.render);

    expect(screen.getByText("Arcane Spells")).toBeInTheDocument();
    expect(screen.getByText("Relics")).toBeInTheDocument();
    expect(screen.getByText(/Memory Palace/i)).toBeInTheDocument();
    expect(screen.getByText(/Urðr/i)).toBeInTheDocument();
    expect(screen.getByText(/Burden/i)).toBeInTheDocument();
  });
});

describe("Tab body — Inventory", () => {
  it("renders the slot-roof body-slot panels + dropped/missing zones", () => {
    const h = harness();
    mountFillBody(h, TbInventoryTabFill.render);

    expect(screen.getByText(/^Head$/)).toBeInTheDocument();
    expect(screen.getByText(/^Neck$/)).toBeInTheDocument();
    expect(screen.getByText(/^Torso$/)).toBeInTheDocument();
    expect(screen.getByText(/^Belt$/)).toBeInTheDocument();
    expect(screen.getByText(/^Feet$/)).toBeInTheDocument();
    expect(screen.getByText(/On the Ground/)).toBeInTheDocument();
    expect(screen.getByText(/Missing/)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------
 * Pools — Fate / Persona / Checks editing dispatches SetField
 * ----------------------------------------------------------------------- */

describe("Pools editor", () => {
  it("dispatches SetField on Pools.fate.current commit", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Pools, {
        fate: { current: 1, totalSpent: 0 },
        persona: { current: 0, totalSpent: 0 },
      });
    });
    mountFillBody(h, TbVitalsFill.render);

    const fateInput = screen.getByDisplayValue("1") as HTMLInputElement;
    fireEvent.focus(fateInput);
    fireEvent.input(fateInput, { target: { value: "3" } });
    fireEvent.blur(fateInput);

    const dispatched = h.dispatched as Array<{ type: string; payload: unknown }>;
    const setFields = dispatched.filter((d) => d.type === SetField.name);
    const last = setFields.find((d) => {
      const p = d.payload as { trait: string; path: Array<string> };
      return p.trait === Pools.name && p.path.join(",") === "fate,current";
    });
    expect(last).toBeDefined();
    expect((last!.payload as { value: number }).value).toBe(3);
  });

  it("Checks total is derived from sum of trait checks; not directly editable", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, CharacterTraits, {
        entries: [
          { name: "Reckless", level: 1, beneficialUses: 0, checks: 2 },
          { name: "Bold", level: 2, beneficialUses: 0, checks: 3 },
        ],
      });
    });
    mountFillBody(h, TbVitalsFill.render);

    const readout = screen.getByTestId("tb-pools-checks-total");
    expect(readout.textContent).toBe("5");
    // No editable input for the checks pool — it's read-only.
    expect(readout.tagName.toLowerCase()).toBe("span");
  });

  it("Checks total updates when a trait's checks count changes", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, CharacterTraits, {
        entries: [{ name: "Reckless", level: 1, beneficialUses: 0, checks: 1 }],
      });
    });
    mountFillBody(h, TbVitalsFill.render);
    expect(screen.getByTestId("tb-pools-checks-total").textContent).toBe("1");

    h.world.set(h.characterId, CharacterTraits, {
      entries: [{ name: "Reckless", level: 1, beneficialUses: 0, checks: 4 }],
    });
    expect(screen.getByTestId("tb-pools-checks-total").textContent).toBe("4");
  });
});

/* -------------------------------------------------------------------------
 * Skill row — Beginner's Luck learning state (DH p.75)
 * ----------------------------------------------------------------------- */

describe("Skill row — Beginner's Luck learning display", () => {
  it("shows the standard rating field + P/F track when no learning tests are logged", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Skills, {
        entries: Object.fromEntries([
          [
            "rider",
            {
              rating: 0,
              advancement: { pass: 0, fail: 0 },
              taxed: false,
              learningTests: 0,
            },
          ],
        ]),
      });
    });
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);
    expect(
      screen.queryByTestId("tb-skill-learning-rating-rider"),
    ).toBeNull();
    expect(
      screen.queryByTestId("tb-skill-learning-track-rider"),
    ).toBeNull();
  });

  it("shows X + L track once a Beginner's Luck test has been logged", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Skills, {
        entries: Object.fromEntries([
          [
            "rider",
            {
              rating: 0,
              advancement: { pass: 0, fail: 0 },
              taxed: false,
              learningTests: 1,
            },
          ],
        ]),
      });
    });
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);
    const x = screen.getByTestId("tb-skill-learning-rating-rider");
    expect(x.textContent).toBe("X");
    expect(
      screen.getByTestId("tb-skill-learning-track-rider"),
    ).toBeInTheDocument();
  });

  it("hides the L track again once the skill has been learned (rating > 0)", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Skills, {
        entries: Object.fromEntries([
          [
            "rider",
            {
              rating: 2,
              advancement: { pass: 0, fail: 0 },
              taxed: false,
              learningTests: 0,
            },
          ],
        ]),
      });
    });
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);
    expect(
      screen.queryByTestId("tb-skill-learning-rating-rider"),
    ).toBeNull();
    expect(
      screen.queryByTestId("tb-skill-learning-track-rider"),
    ).toBeNull();
  });

  it("sizes the L track to the character's max Nature rating", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Skills, {
        entries: Object.fromEntries([
          [
            "rider",
            {
              rating: 0,
              advancement: { pass: 0, fail: 0 },
              taxed: false,
              learningTests: 1,
            },
          ],
        ]),
      });
    });
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);
    const track = screen.getByTestId("tb-skill-learning-track-rider");
    // The harness sets nature.maximum = 4 by default, so the L track
    // should render four bubbles.
    const dots = track.querySelectorAll(".vk-dot");
    expect(dots.length).toBe(4);
  });

  it("dispatches OpenSkillLearning when the L track fills", async () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Skills, {
        entries: Object.fromEntries([
          [
            "rider",
            {
              rating: 0,
              advancement: { pass: 0, fail: 0 },
              taxed: false,
              // Below threshold (max Nature = 4 in the harness).
              learningTests: 3,
            },
          ],
        ]),
      });
    });
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);
    // Bump learningTests to 4 — this should trigger the
    // tab-abilities-skills `createEffect` that dispatches
    // OpenSkillLearning for the freshly-filled L track.
    h.world.set(h.characterId, Skills, {
      entries: Object.fromEntries([
        [
          "rider",
          {
            rating: 0,
            advancement: { pass: 0, fail: 0 },
            taxed: false,
            learningTests: 4,
          },
        ],
      ]),
    });
    // Solid effects flush synchronously during world writes inside
    // the harness, but await a microtask anyway to keep the test
    // robust to future scheduling changes.
    await Promise.resolve();
    const opens = h.dispatched.filter(
      (c) => c.type === "@vtt/system-torchbearer/OpenSkillLearning",
    );
    expect(opens.length).toBeGreaterThanOrEqual(1);
    expect(opens[opens.length - 1]!.payload).toEqual({
      characterId: h.characterId,
      skillId: "rider",
    });
  });

  it("renders an up-arrow when the L track is full", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Skills, {
        entries: Object.fromEntries([
          [
            "rider",
            {
              rating: 0,
              advancement: { pass: 0, fail: 0 },
              taxed: false,
              learningTests: 4,
            },
          ],
        ]),
      });
    });
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);
    expect(
      screen.getByTestId("tb-skill-learn-arrow-rider"),
    ).toBeInTheDocument();
  });

  it("does not render the up-arrow while the L track is below max Nature", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Skills, {
        entries: Object.fromEntries([
          [
            "rider",
            {
              rating: 0,
              advancement: { pass: 0, fail: 0 },
              taxed: false,
              learningTests: 2,
            },
          ],
        ]),
      });
    });
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);
    expect(
      screen.queryByTestId("tb-skill-learn-arrow-rider"),
    ).toBeNull();
  });

  it("dispatches LearnSkill when the up-arrow is clicked", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Skills, {
        entries: Object.fromEntries([
          [
            "rider",
            {
              rating: 0,
              advancement: { pass: 0, fail: 0 },
              taxed: false,
              learningTests: 4,
            },
          ],
        ]),
      });
    });
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);
    fireEvent.click(screen.getByTestId("tb-skill-learn-arrow-rider"));
    const learns = h.dispatched.filter(
      (c) => c.type === "@vtt/system-torchbearer/LearnSkill",
    );
    expect(learns.length).toBeGreaterThanOrEqual(1);
    expect(learns[learns.length - 1]!.payload).toEqual({
      characterId: h.characterId,
      skillId: "rider",
    });
  });
});

/* -------------------------------------------------------------------------
 * Skill rolling — clicking a skill label dispatches OpenPendingRoll
 * ----------------------------------------------------------------------- */

describe("Skill rolling", () => {
  it("clicking a skill label opens a pending roll for that skill", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Skills, {
        entries: Object.fromEntries([
          [
            "fighter",
            {
              rating: 3,
              advancement: { pass: 0, fail: 0 },
              taxed: false,
              learningTests: 0,
            },
          ],
        ]),
      });
    });
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);

    // Find the Fighter row's label and click it. Each row renders the
    // skill name + BL hint as siblings inside an inline-flex span;
    // textContent reads "Fighter(H)" with no whitespace.
    const rowSpans = Array.from(document.querySelectorAll("span")).filter((n) =>
      /^Fighter\(/.test(n.textContent ?? ""),
    );
    expect(rowSpans.length).toBeGreaterThanOrEqual(1);
    // The RollableLabel wraps the span in a span with role="button".
    let clickTarget: HTMLElement = rowSpans[0]!;
    while (clickTarget.parentElement) {
      if (clickTarget.getAttribute("role") === "button") break;
      clickTarget = clickTarget.parentElement;
    }
    fireEvent.click(clickTarget);

    const dispatched = h.dispatched as Array<{ type: string; payload: unknown }>;
    const opens = dispatched.filter(
      (d) => d.type === "@vtt/characters/OpenPendingRoll",
    );
    expect(opens.length).toBeGreaterThanOrEqual(1);
    const last = opens[opens.length - 1]!.payload as {
      rollableName: string;
      opts: { skillId: string };
    };
    expect(last.rollableName).toBe("@vtt/system-torchbearer/skill-check");
    expect(last.opts.skillId).toBe("fighter");
  });

  /**
   * Same click-the-name-to-roll pattern for the five non-skill
   * rollables. Renamed shared helper to keep the test bodies short.
   */
  function clickRowLabel(textExact: string): void {
    const candidates = Array.from(document.querySelectorAll("span")).filter(
      (n) => (n.textContent ?? "").trim() === textExact,
    );
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    let target: HTMLElement = candidates[0]!;
    while (target.parentElement) {
      if (target.getAttribute("role") === "button") break;
      target = target.parentElement;
    }
    fireEvent.click(target);
  }

  function assertOpened(
    h: CharacterHarness,
    rollableName: string,
  ): void {
    const opens = h.dispatched.filter(
      (d) => d.type === "@vtt/characters/OpenPendingRoll",
    );
    expect(opens.length).toBeGreaterThanOrEqual(1);
    expect(
      (opens[opens.length - 1]!.payload as { rollableName: string }).rollableName,
    ).toBe(rollableName);
  }

  it("clicking the Will label opens a pending roll for Will", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);
    clickRowLabel("Will");
    assertOpened(h, "@vtt/system-torchbearer/will-check");
  });

  it("clicking the Health label opens a pending roll for Health", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);
    clickRowLabel("Health");
    assertOpened(h, "@vtt/system-torchbearer/health-check");
  });

  it("clicking the Nature label opens a pending roll for Nature", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);
    clickRowLabel("Nature");
    assertOpened(h, "@vtt/system-torchbearer/nature-check");
  });

  it("clicking the Resources label opens a pending roll for Resources", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);
    clickRowLabel("Resources");
    assertOpened(h, "@vtt/system-torchbearer/resources-check");
  });

  it("clicking the Circles label opens a pending roll for Circles", () => {
    const h = harness();
    mountFillBody(h, TbAbilitiesSkillsTabFill.render);
    clickRowLabel("Circles");
    assertOpened(h, "@vtt/system-torchbearer/circles-check");
  });
});

/* -------------------------------------------------------------------------
 * Identity sub-line + Actions bar
 * ----------------------------------------------------------------------- */

describe("Identity sub-line", () => {
  it("renders a read-only 'Stock · Class · Lvl N' summary", () => {
    const h = harness();
    mountFillBody(h, ({ characterId }) => {
      void characterId;
      return mountTbIdentityFill(h);
    });
    // Expected text: "Human · Theologian · Lvl 3" — single text node,
    // not editable inputs (those live on the Who You Are tab now).
    expect(screen.getByText("Human · Theologian · Lvl 3")).toBeInTheDocument();
  });

  it("falls back to just 'Lvl N' when stock and class are unset", () => {
    const h = buildCharacterHarness({
      plugins: [sheetSlotsTestInfra, systemTorchbearer],
      asGm: true,
      setupWorld: ({ world, characterId }) => {
        world.set(characterId, Identity, {
          name: "",
          stock: "",
          class: "",
          level: 5,
          age: 20,
          home: "",
          raiment: "",
          parents: "",
          mentor: "",
          friend: "",
          enemy: "",
        });
      },
    });
    mountFillBody(h, ({ characterId }) => {
      void characterId;
      return mountTbIdentityFill(h);
    });
    expect(screen.getByText("Lvl 5")).toBeInTheDocument();
  });
});

function mountTbIdentityFill(h: CharacterHarness): JSX.Element {
  // Tiny shim — the Identity fill is also mounted by SheetShell, but
  // for an isolated test we just call its render directly.
  const fill = systemTorchbearer.fills["@vtt/characters/sheet-identity"]?.[0] as
    | { render: (args: { characterId: EntityId }) => unknown }
    | undefined;
  return fill!.render({ characterId: h.characterId }) as JSX.Element;
}

describe("Actions bar", () => {
  it("renders the four sticky roll buttons", () => {
    const h = harness();
    mountFillBody(h, TbActionsFill.render);
    expect(screen.getByRole("button", { name: "Roll Will" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Roll Health" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Roll Nature" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tap Nature" })).toBeInTheDocument();
  });

  it("clicking Roll Will dispatches OpenPendingRoll for the WillCheck rollable", () => {
    const h = harness();
    mountFillBody(h, TbActionsFill.render);

    fireEvent.click(screen.getByRole("button", { name: "Roll Will" }));

    const dispatched = h.dispatched as Array<{ type: string; payload: unknown }>;
    const opens = dispatched.filter(
      (d) => d.type === "@vtt/characters/OpenPendingRoll",
    );
    expect(opens.length).toBeGreaterThanOrEqual(1);
    expect((opens[0]!.payload as { rollableName: string }).rollableName).toBe(
      "@vtt/system-torchbearer/will-check",
    );
  });

  it("Tap Nature passes opts.tap=true to the rollable", () => {
    const h = harness();
    mountFillBody(h, TbActionsFill.render);

    fireEvent.click(screen.getByRole("button", { name: "Tap Nature" }));

    const dispatched = h.dispatched as Array<{ type: string; payload: unknown }>;
    const opens = dispatched.filter(
      (d) => d.type === "@vtt/characters/OpenPendingRoll",
    );
    const tap = opens.find((d) => {
      const p = d.payload as { rollableName: string; opts: { tap?: boolean } };
      return (
        p.rollableName === "@vtt/system-torchbearer/nature-check" && p.opts.tap === true
      );
    });
    expect(tap).toBeDefined();
  });
});

/* -------------------------------------------------------------------------
 * Chat-timeline contributor: SkillImprovementOpportunity rows
 * ----------------------------------------------------------------------- */

describe("Skill-improvement chat row", () => {
  it("renders one row per opportunity entity with the [Improve] button", () => {
    const h = harness(({ world, characterId }) => {
      world.spawn([
        SkillImprovementOpportunity({
          characterId,
          characterName: "Bryn",
          skillId: "alchemist",
          skillName: "Alchemist",
          rating: 2,
          sentAt: 100,
        }),
      ]);
    });
    mountWithClient(h, () => {
      const entries = (
        TbChatTimelineContributor.useEntries() as unknown as Accessor<
          ChatTimelineEntry[]
        >
      );
      return <For each={entries()}>{(e) => e.render() as never}</For>;
    });

    expect(screen.getByText(/Bryn improved at Alchemist!/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /improve/i })).toBeInTheDocument();
  });

  it("clicking the [Improve] button dispatches ImproveSkill for the same character + skill", () => {
    const h = harness(({ world, characterId }) => {
      world.spawn([
        SkillImprovementOpportunity({
          characterId,
          characterName: "Bryn",
          skillId: "alchemist",
          skillName: "Alchemist",
          rating: 2,
          sentAt: 100,
        }),
      ]);
    });
    mountWithClient(h, () => {
      const entries = (
        TbChatTimelineContributor.useEntries() as unknown as Accessor<
          ChatTimelineEntry[]
        >
      );
      return <For each={entries()}>{(e) => e.render() as never}</For>;
    });

    fireEvent.click(screen.getByRole("button", { name: /improve/i }));

    const dispatched = h.dispatched as Array<{ type: string; payload: unknown }>;
    const imp = dispatched.find(
      (d) => d.type === "@vtt/system-torchbearer/ImproveSkill",
    );
    expect(imp).toBeDefined();
    expect(imp!.payload).toEqual({
      characterId: h.characterId,
      skillId: "alchemist",
    });
  });

  it("yields zero entries when no opportunity entities exist", () => {
    const h = harness();
    let captured: ChatTimelineEntry[] = [];
    mountWithClient(h, () => {
      const entries = (
        TbChatTimelineContributor.useEntries() as unknown as Accessor<
          ChatTimelineEntry[]
        >
      )();
      captured = entries;
      return <div />;
    });
    expect(captured).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * Pending-roll panel — TB modifier contributor
 * ----------------------------------------------------------------------- */

describe("TbPendingRollContributor", () => {
  const args = {
    pendingRollId: "pr-1" as EntityId,
    rollableName: "@vtt/system-torchbearer/will-check",
    initiatorCharacterId: "char-1" as EntityId,
    initiatorUserId: "u1",
  };

  it("only renders for TB rollables (rollablePrefix gates the slot)", () => {
    expect(TbPendingRollContributor.rollablePrefix).toBe(
      "@vtt/system-torchbearer/",
    );
  });

  it("renders the quick-mod buttons (+/-D, +/-s, on-success / on-fail)", () => {
    const h = harness();
    mountWithClient(h, () => {
      const contribute = (): void => undefined;
      return (
        TbPendingRollContributor.render({
          ...args,
          contribute,
        }) as never
      );
    });
    for (const label of ["+1D", "-1D", "+1s", "-1s"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(
      screen.getByRole("button", { name: /on succ\./ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /on fail/ }),
    ).toBeInTheDocument();
  });

  it("clicking +1D produces a TB-shaped contribution with a dice modifier", () => {
    const h = harness();
    const captured: Array<unknown> = [];
    mountWithClient(h, () =>
      TbPendingRollContributor.render({
        ...args,
        contribute: (c) => captured.push(c),
      }) as never,
    );
    fireEvent.click(screen.getByRole("button", { name: "+1D" }));
    expect(captured).toHaveLength(1);
    const c = captured[0] as {
      kind: string;
      label: string;
      payload: { kind: string; value: number; apply: string };
    };
    expect(c.kind).toBe(TB_MODIFIER_CONTRIB_KIND);
    expect(c.label).toBe("+1D +1D");
    expect(c.payload.kind).toBe("dice");
    expect(c.payload.value).toBe(1);
    expect(c.payload.apply).toBe("always");
  });

  it("clicking +1s on success produces an on-success success modifier", () => {
    const h = harness();
    const captured: Array<unknown> = [];
    mountWithClient(h, () =>
      TbPendingRollContributor.render({
        ...args,
        contribute: (c) => captured.push(c),
      }) as never,
    );
    fireEvent.click(screen.getByRole("button", { name: /on succ\./ }));
    const c = captured[0] as { payload: { apply: string; kind: string } };
    expect(c.payload.apply).toBe("on-success");
    expect(c.payload.kind).toBe("success");
  });

  it("the labelled-modifier form submits a contribution with the typed label + value", () => {
    const h = harness();
    const captured: Array<unknown> = [];
    mountWithClient(h, () =>
      TbPendingRollContributor.render({
        ...args,
        contribute: (c) => captured.push(c),
      }) as never,
    );

    const valueInput = screen.getByLabelText("modifier value") as HTMLInputElement;
    const labelInput = screen.getByLabelText("modifier label") as HTMLInputElement;
    fireEvent.input(valueInput, { target: { value: "2" } });
    fireEvent.input(labelInput, { target: { value: "wise: tunnel" } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));

    expect(captured).toHaveLength(1);
    const c = captured[0] as {
      payload: { value: number; label: string; kind: string };
    };
    expect(c.payload.value).toBe(2);
    expect(c.payload.label).toBe("wise: tunnel");
    expect(c.payload.kind).toBe("dice");
  });

  it("rejects the labelled-modifier submission when label is empty", () => {
    const h = harness();
    const captured: Array<unknown> = [];
    mountWithClient(h, () =>
      TbPendingRollContributor.render({
        ...args,
        contribute: (c) => captured.push(c),
      }) as never,
    );
    const button = screen.getByRole("button", { name: /add/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(captured).toHaveLength(0);
  });

  it("renders the disposition toggle button", () => {
    const h = harness();
    mountWithClient(h, () => {
      const contribute = (): void => undefined;
      return TbPendingRollContributor.render({
        ...args,
        contribute,
      }) as never;
    });
    expect(
      screen.getByTestId("tb-pending-roll-disposition-toggle"),
    ).toBeInTheDocument();
  });

  it("clicking the disposition toggle posts a tb-disposition contribution", () => {
    const h = harness();
    const captured: Array<unknown> = [];
    mountWithClient(h, () =>
      TbPendingRollContributor.render({
        ...args,
        contribute: (c) => captured.push(c),
      }) as never,
    );
    fireEvent.click(screen.getByTestId("tb-pending-roll-disposition-toggle"));
    expect(captured).toHaveLength(1);
    const c = captured[0] as {
      kind: string;
      payload: { enabled: boolean };
      replaces?: string;
    };
    expect(c.kind).toBe(TB_DISPOSITION_CONTRIB_KIND);
    expect(c.payload.enabled).toBe(true);
    expect(c.replaces).toBe("tb:disposition");
  });

  /* -------- Help section (DH p.37) -------- */

  /**
   * Spin up a harness with two characters: the initiator (Bryn,
   * pre-spawned by the standard harness) and a peer helper (Tarn).
   * `helperSetup` configures the helper's Skills / RawAbilities so
   * each test can dial in eligibility.
   */
  function helpHarness(
    helperSetup: (args: {
      world: CharacterHarness["world"];
      helperId: EntityId;
    }) => void,
  ): {
    h: CharacterHarness;
    helperId: EntityId;
    pendingRollId: EntityId;
  } {
    let helperId: EntityId = "" as EntityId;
    let pendingRollId: EntityId = "" as EntityId;
    const h = buildCharacterHarness({
      plugins: [sheetSlotsTestInfra, systemTorchbearer],
      asGm: true,
      setupWorld: ({ world, characterId }) => {
        // Initiator (Bryn): Fighter 4, Health 5.
        world.set(characterId, Identity, {
          name: "Bryn",
          stock: "Human",
          class: "Fighter",
          level: 3,
          age: 23,
          home: "Highvale",
          raiment: "",
          parents: "",
          mentor: "",
          friend: "",
          enemy: "",
        });
        world.set(characterId, RawAbilities, {
          will: { rating: 4, advancement: { pass: 0, fail: 0 } },
          health: { rating: 5, advancement: { pass: 0, fail: 0 } },
          nature: {
            rating: 4,
            maximum: 4,
            advancement: { pass: 0, fail: 0 },
            descriptors: [],
          },
        });
        // Peer helper (Tarn): permissions writable by everyone so the
        // GM-tagged test session passes canWrite() for the helper row.
        helperId = world.allocateId();
        world.spawnAt(helperId, [
          Character({ name: "Tarn" }),
          Permissions({ read: everyone(), write: everyone() }),
        ]);
        helperSetup({ world, helperId });
        // PendingRoll: a Fighter skill check by Bryn.
        pendingRollId = world.allocateId();
        world.spawnAt(pendingRollId, [
          PendingRoll({
            initiatorUserId: "u1",
            initiatorCharacterId: characterId,
            rollableName: SkillCheck.name,
            opts: { skillId: "fighter" },
            contributions: [],
            openedAt: 0,
          }),
        ]);
      },
    });
    return { h, helperId, pendingRollId };
  }

  it("renders the Helping header with the suggested-help citation for skill rolls", () => {
    const { h, pendingRollId } = helpHarness(({ world, helperId }) => {
      world.set(helperId, Skills, {
        entries: { hunter: { rating: 3, advancement: { pass: 0, fail: 0 }, taxed: false, learningTests: 0 } },
      });
      world.set(helperId, RawAbilities, {
        will: { rating: 3, advancement: { pass: 0, fail: 0 } },
        health: { rating: 3, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: 3,
          maximum: 3,
          advancement: { pass: 0, fail: 0 },
          descriptors: [],
        },
      });
    });
    mountWithClient(h, () =>
      TbPendingRollContributor.render({
        pendingRollId,
        rollableName: SkillCheck.name,
        initiatorCharacterId: h.characterId,
        initiatorUserId: "u1",
        contribute: () => undefined,
      }) as never,
    );
    expect(screen.getByTestId("tb-pending-roll-help")).toBeInTheDocument();
    // Fighter's printed Help: line is just "Hunter" (DH p.249).
    const help = screen.getByTestId("tb-pending-roll-help");
    expect(help.textContent).toContain("suggested help: Hunter");
    expect(help.textContent).toContain("DH p.37");
  });

  it("a peer with the suggested help skill shows a +1D help button", () => {
    const { h, helperId, pendingRollId } = helpHarness(
      ({ world, helperId: hid }) => {
        world.set(hid, Skills, {
          entries: { hunter: { rating: 3, advancement: { pass: 0, fail: 0 }, taxed: false, learningTests: 0 } },
        });
        world.set(hid, RawAbilities, {
          will: { rating: 3, advancement: { pass: 0, fail: 0 } },
          health: { rating: 3, advancement: { pass: 0, fail: 0 } },
          nature: {
            rating: 3,
            maximum: 3,
            advancement: { pass: 0, fail: 0 },
            descriptors: [],
          },
        });
      },
    );
    const captured: Array<unknown> = [];
    mountWithClient(h, () =>
      TbPendingRollContributor.render({
        pendingRollId,
        rollableName: SkillCheck.name,
        initiatorCharacterId: h.characterId,
        initiatorUserId: "u1",
        contribute: (c) => captured.push(c),
      }) as never,
    );
    const row = screen.getByTestId(`tb-pending-roll-help-row-${helperId}`);
    expect(row.textContent).toContain("Tarn");
    const btn = screen.getByTestId(`tb-pending-roll-help-btn-${helperId}`);
    fireEvent.click(btn);
    expect(captured).toHaveLength(1);
    const c = captured[0] as {
      kind: string;
      replaces?: string;
      payload: { source: string; kind: string; value: number; providedBy: string; label: string };
    };
    expect(c.kind).toBe(TB_MODIFIER_CONTRIB_KIND);
    expect(c.replaces).toBe(`tb:help:${helperId}`);
    expect(c.payload.source).toBe("help");
    expect(c.payload.kind).toBe("dice");
    expect(c.payload.value).toBe(1);
    expect(c.payload.providedBy).toBe(`help:${helperId}:skill:hunter`);
    expect(c.payload.label).toContain("Tarn helps with Hunter 3");
  });

  it("a peer without an eligible skill still gets a 'per GM' button for negotiated help", () => {
    const { h, helperId, pendingRollId } = helpHarness(
      ({ world, helperId: hid }) => {
        // Tarn has Cook 4 — not Fighter and not in Fighter's
        // suggestedHelp ([hunter]). The automatic eligibility list is
        // empty; Cook surfaces under "per GM".
        world.set(hid, Skills, {
          entries: { cook: { rating: 4, advancement: { pass: 0, fail: 0 }, taxed: false, learningTests: 0 } },
        });
        world.set(hid, RawAbilities, {
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
    );
    const captured: Array<unknown> = [];
    mountWithClient(h, () =>
      TbPendingRollContributor.render({
        pendingRollId,
        rollableName: SkillCheck.name,
        initiatorCharacterId: h.characterId,
        initiatorUserId: "u1",
        contribute: (c) => captured.push(c),
      }) as never,
    );
    expect(
      screen.queryByTestId(`tb-pending-roll-help-btn-${helperId}`),
    ).toBeNull();
    const gmBtn = screen.getByTestId(`tb-pending-roll-help-gm-btn-${helperId}`);
    fireEvent.click(gmBtn);
    expect(captured).toHaveLength(1);
    const c = captured[0] as {
      payload: { providedBy: string; label: string; source: string };
    };
    expect(c.payload.source).toBe("help");
    expect(c.payload.providedBy).toBe(`help:${helperId}:skill:cook`);
    expect(c.payload.label).toContain("(per GM)");
  });

  it("filters peers with no usable skill or ability rating (DH p.37 'Rating 0 Help')", () => {
    const { h, helperId, pendingRollId } = helpHarness(({ world, helperId: hid }) => {
      // Empty everything — every rating is 0.
      world.set(hid, Skills, { entries: {} });
      world.set(hid, RawAbilities, {
        will: { rating: 0, advancement: { pass: 0, fail: 0 } },
        health: { rating: 0, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: 0,
          maximum: 0,
          advancement: { pass: 0, fail: 0 },
          descriptors: [],
        },
      });
    });
    mountWithClient(h, () =>
      TbPendingRollContributor.render({
        pendingRollId,
        rollableName: SkillCheck.name,
        initiatorCharacterId: h.characterId,
        initiatorUserId: "u1",
        contribute: () => undefined,
      }) as never,
    );
    expect(
      screen.queryByTestId(`tb-pending-roll-help-row-${helperId}`),
    ).toBeNull();
    expect(screen.getByTestId("tb-pending-roll-help").textContent).toContain(
      "none of your characters can help",
    );
  });
});

/* -------------------------------------------------------------------------
 * TB roll chat row — Formula.meta decoding, success rendering
 * ----------------------------------------------------------------------- */

function spawnTbRoll(
  h: CharacterHarness,
  args: {
    spec: TbRollSpec;
    dice: Array<{ sides: number | "F"; value: number }>;
    rolledByName?: string;
    /**
     * When set, denormalised onto `RolledBy.speakingAsCharacterId` so
     * the Log Advancement button can resolve the character. Tests that
     * don't exercise the post-roll action zone can omit it.
     */
    speakingAsCharacterId?: EntityId;
  },
): EntityId {
  const id = h.world.allocateId();
  h.world.spawnAt(id, [
    Formula({
      notation: "test",
      reason: args.spec.caption,
      meta: { system: TB_ROLL_META_SYSTEM, spec: args.spec },
    }),
    RollResult({
      total: 0,
      output: "test",
      rolledAt: 100,
      dice: args.dice,
    }),
    RolledBy({
      userId: "u1",
      displayName: args.rolledByName ?? "Bryn",
      speakingAsCharacterId: args.speakingAsCharacterId,
    }),
  ]);
  return id;
}

describe("TbRollRow", () => {
  it("renders a successful Will roll with success count and pass label", () => {
    const h = harness();
    let entity: EntityId = "" as EntityId;
    mountWithClient(h, () => {
      entity = spawnTbRoll(h, {
        spec: {
          kind: "ability",
          source: "Will",
          sourceId: "will",
          baseDice: 4,
          pool: 4,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 2,
          obstacle: 2,
          modifiers: [],
          caption: "Bryn — Will vs Ob 2",
        },
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 6 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    expect(
      screen.getByTestId("tb-roll-row-success-count").textContent,
    ).toBe("2");
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText(/vs Ob 2/)).toBeInTheDocument();
  });

  it("shows the margin of success on a passing roll (final - obstacle)", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: {
          kind: "ability",
          source: "Will",
          sourceId: "will",
          baseDice: 5,
          pool: 5,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 2,
          obstacle: 2,
          modifiers: [],
          caption: "Bryn — Will vs Ob 2",
        },
        dice: [
          { sides: 6, value: 6 },
          { sides: 6, value: 5 },
          { sides: 6, value: 4 },
          { sides: 6, value: 4 },
          { sides: 6, value: 1 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    // 4 successes vs Ob 2 → margin of success = 2.
    const margin = screen.getByTestId("tb-roll-row-margin-of-success");
    expect(margin.textContent).toContain("margin of success: 2");
    expect(screen.queryByTestId("tb-roll-row-margin-of-failure")).toBeNull();
  });

  it("shows margin of success: 0 when meeting the obstacle exactly", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: {
          kind: "ability",
          source: "Will",
          sourceId: "will",
          baseDice: 4,
          pool: 4,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 2,
          obstacle: 2,
          modifiers: [],
          caption: "Bryn — Will vs Ob 2",
        },
        dice: [
          { sides: 6, value: 6 },
          { sides: 6, value: 4 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    const margin = screen.getByTestId("tb-roll-row-margin-of-success");
    expect(margin.textContent).toContain("margin of success: 0");
  });

  it("shows the margin of failure on a failing roll (obstacle - final)", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: {
          kind: "ability",
          source: "Health",
          sourceId: "health",
          baseDice: 4,
          pool: 4,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 4,
          obstacle: 4,
          modifiers: [],
          caption: "Bryn — Health vs Ob 4",
        },
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
          { sides: 6, value: 3 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    // 1 success vs Ob 4 → margin of failure = 3.
    const margin = screen.getByTestId("tb-roll-row-margin-of-failure");
    expect(margin.textContent).toContain("margin of failure: 3");
    expect(screen.queryByTestId("tb-roll-row-margin-of-success")).toBeNull();
  });

  it("hides the margin lines entirely when no obstacle is declared", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: {
          kind: "ability",
          source: "Will",
          sourceId: "will",
          baseDice: 3,
          pool: 3,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: null,
          obstacle: null,
          modifiers: [],
          caption: "Bryn — Will",
        },
        dice: [
          { sides: 6, value: 6 },
          { sides: 6, value: 4 },
          { sides: 6, value: 1 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    expect(screen.queryByTestId("tb-roll-row-resolution")).toBeNull();
    expect(screen.queryByTestId("tb-roll-row-margin-of-success")).toBeNull();
    expect(screen.queryByTestId("tb-roll-row-margin-of-failure")).toBeNull();
  });

  it("renders a failure with the failure label when successes < obstacle", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: {
          kind: "ability",
          source: "Health",
          sourceId: "health",
          baseDice: 3,
          pool: 3,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 3,
          obstacle: 3,
          modifiers: [],
          caption: "Bryn — Health vs Ob 3",
        },
        dice: [
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
          { sides: 6, value: 3 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    expect(
      screen.getByTestId("tb-roll-row-success-count").textContent,
    ).toBe("0");
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("folds an on-success conditional modifier into the final count when passing", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: {
          kind: "ability",
          source: "Will",
          sourceId: "will",
          baseDice: 4,
          pool: 4,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 2,
          obstacle: 2,
          modifiers: [
            {
              id: "f",
              kind: "success",
              value: 1,
              label: "Faith",
              apply: "on-success",
              source: "fate",
            },
          ],
          caption: "Bryn — Will vs Ob 2",
        },
        dice: [
          { sides: 6, value: 4 },
          { sides: 6, value: 5 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    // 2 raw successes + 1 conditional (fired since pass) = 3.
    expect(
      screen.getByTestId("tb-roll-row-success-count").textContent,
    ).toBe("3");
    const breakdown = screen.getByTestId("tb-roll-row-success-breakdown");
    expect(breakdown.textContent).toContain("(conditional)");
  });

  it("shows an auto-fail message when the pool collapsed to zero", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: {
          kind: "skill",
          source: "Fighter",
          sourceId: "fighter",
          baseDice: 1,
          pool: 0,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 2,
          obstacle: 2,
          modifiers: [
            {
              id: "auto:condition:sick",
              kind: "dice",
              value: -1,
              label: "Sick -1D",
              apply: "always",
              source: "condition",
              providedBy: "condition:sick",
            },
          ],
          caption: "Bryn — Fighter vs Ob 2",
        },
        dice: [{ sides: 6, value: 5 }],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    expect(screen.getByText(/auto-fail/i)).toBeInTheDocument();
    expect(
      screen.getByTestId("tb-roll-row-success-count").textContent,
    ).toBe("0");
  });

  it("renders every modifier in the spec as a chip", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: {
          kind: "ability",
          source: "Will",
          sourceId: "will",
          baseDice: 3,
          pool: 4,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 2,
          obstacle: 2,
          modifiers: [
            {
              id: "auto:condition:fresh",
              kind: "dice",
              value: 1,
              label: "Fresh",
              apply: "always",
              source: "condition",
            },
            {
              id: "help-1",
              kind: "dice",
              value: 1,
              label: "Help (Tarn)",
              apply: "always",
              source: "help",
            },
          ],
          caption: "Bryn — Will vs Ob 2",
        },
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 4 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    const mods = screen.getByTestId("tb-roll-row-modifiers");
    expect(mods.textContent).toContain("+1D Fresh");
    expect(mods.textContent).toContain("+1D Help (Tarn)");
  });
});

/* -------------------------------------------------------------------------
 * TB roll chat row — versus tests
 * ----------------------------------------------------------------------- */

describe("TbRollRow — disposition", () => {
  function dispositionSpec(overrides: Partial<TbRollSpec> = {}): TbRollSpec {
    return {
      kind: "skill",
      source: "Fighter",
      sourceId: "fighter",
      baseDice: 4,
      pool: 4,
      bonusSuccesses: 0,
      heroic: false,
      successTarget: 4,
      baseObstacle: null,
      obstacle: null,
      modifiers: [],
      caption: "Bryn — Fighter (disposition)",
      dispositionMode: true,
      ...overrides,
    };
  }

  it("renders the 'disposition' header badge when spec.dispositionMode is on", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: dispositionSpec(),
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 4 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    expect(
      screen.getByTestId("tb-roll-row-disposition-badge"),
    ).toBeInTheDocument();
  });

  it("shows base + successes = disposition value (no obstacle line)", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: dispositionSpec(),
        // 2 successes (5, 4 hit; 1, 2 miss). Base 4 + 2 = 6.
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 4 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    expect(
      screen.getByTestId("tb-roll-row-disposition-value").textContent,
    ).toBe("6");
    expect(
      screen.getByTestId("tb-roll-row-disposition-breakdown"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("tb-roll-row-resolution"),
    ).toBeNull();
  });

  it("folds team penalties into the disposition (base 4 + 2 successes - 1 H&T = 5)", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: dispositionSpec({
          // Team Hungry & Thirsty -1s appears in modifiers and folds
          // into bonusSuccesses via foldModifiers (always-applied).
          bonusSuccesses: -1,
          modifiers: [
            {
              id: "auto:disposition:team-hungry-thirsty",
              kind: "success",
              value: -1,
              label: "Team Hungry & Thirsty",
              apply: "always",
              source: "condition",
              providedBy: "team:hungry-thirsty",
            },
          ],
        }),
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 4 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    // Disposition = 4 (base) + 2 (raw) + (-1) (always) = 5.
    expect(
      screen.getByTestId("tb-roll-row-disposition-value").textContent,
    ).toBe("5");
  });

  it("floors disposition at 1 even when penalties drive it negative (SG p.47)", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: dispositionSpec({
          baseDice: 1,
          // Massive negative bonus to force the floor.
          bonusSuccesses: -10,
          modifiers: [],
        }),
        // 0 successes.
        dice: [
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    expect(
      screen.getByTestId("tb-roll-row-disposition-value").textContent,
    ).toBe("1");
  });
});

describe("TbRollRow — versus", () => {
  function specWithVersus(overrides: Partial<TbRollSpec> = {}): TbRollSpec {
    return {
      kind: "skill",
      source: "Fighter",
      sourceId: "fighter",
      baseDice: 4,
      pool: 4,
      bonusSuccesses: 0,
      heroic: false,
      successTarget: 4,
      baseObstacle: null,
      obstacle: null,
      modifiers: [],
      caption: "Bryn — Fighter (versus)",
      versusTestId: "versus:abc",
      ...overrides,
    };
  }

  it("renders a 'versus' header badge when spec.versusTestId is set", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: specWithVersus(),
        dice: [
          { sides: 6, value: 6 },
          { sides: 6, value: 5 },
          { sides: 6, value: 4 },
          { sides: 6, value: 1 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    expect(screen.getByTestId("tb-roll-row-versus-badge")).toBeInTheDocument();
  });

  it("shows 'awaiting opponent's roll' when no peer Roll entity carries the same versusTestId", () => {
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: specWithVersus(),
        dice: [
          { sides: 6, value: 6 },
          { sides: 6, value: 5 },
          { sides: 6, value: 4 },
          { sides: 6, value: 1 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    expect(
      screen.getByTestId("tb-roll-row-versus-awaiting"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("tb-roll-row-versus-resolution"),
    ).toBeNull();
  });

  it("renders 'won by N' when own successes exceed opponent's", () => {
    const h = harness(({ world }) => {
      // Opponent's roll already exists in the world with the same key.
      // 2 successes from their dice (4* + 5* + 1 + 2).
      const oppId = world.allocateId();
      world.spawnAt(oppId, [
        Formula({
          notation: "4d6>=4",
          reason: "Tarn — Fighter",
          meta: {
            system: TB_ROLL_META_SYSTEM,
            spec: specWithVersus({
              source: "Fighter",
              caption: "Tarn — Fighter (versus)",
            }),
          },
        }),
        RollResult({ total: 2, output: "x", rolledAt: 50, dice: [] }),
        RolledBy({ userId: "u-tarn", displayName: "Tarn" }),
      ]);
    });
    let myId: EntityId = "" as EntityId;
    mountWithClient(h, () => {
      myId = spawnTbRoll(h, {
        spec: specWithVersus(),
        // 3 successes (6, 5, 4, 1) vs opponent 2 → won by 1.
        dice: [
          { sides: 6, value: 6 },
          { sides: 6, value: 5 },
          { sides: 6, value: 4 },
          { sides: 6, value: 1 },
        ],
      });
      return TbRollRow({ entityId: myId }) as JSX.Element;
    });
    const resolution = screen.getByTestId("tb-roll-row-versus-resolution");
    expect(resolution.textContent).toContain("won");
    const margin = screen.getByTestId("tb-roll-row-versus-margin");
    expect(margin.textContent).toContain("margin of success: 1");
  });

  it("renders 'lost by N' when opponent's successes exceed own", () => {
    const h = harness(({ world }) => {
      const oppId = world.allocateId();
      world.spawnAt(oppId, [
        Formula({
          notation: "4d6>=4",
          reason: "Tarn — Fighter",
          meta: {
            system: TB_ROLL_META_SYSTEM,
            spec: specWithVersus({ caption: "Tarn — Fighter (versus)" }),
          },
        }),
        // Opponent 4 successes.
        RollResult({ total: 4, output: "x", rolledAt: 50, dice: [] }),
        RolledBy({ userId: "u-tarn", displayName: "Tarn" }),
      ]);
    });
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: specWithVersus(),
        // 1 success only.
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
          { sides: 6, value: 3 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    expect(screen.getByTestId("tb-roll-row-versus-resolution").textContent)
      .toContain("lost");
    expect(screen.getByTestId("tb-roll-row-versus-margin").textContent)
      .toContain("margin of failure: 3");
  });

  it("renders 'tied' when opponent and own success counts match", () => {
    const h = harness(({ world }) => {
      const oppId = world.allocateId();
      world.spawnAt(oppId, [
        Formula({
          notation: "4d6>=4",
          reason: "Tarn",
          meta: {
            system: TB_ROLL_META_SYSTEM,
            spec: specWithVersus({ caption: "Tarn (versus)" }),
          },
        }),
        RollResult({ total: 2, output: "x", rolledAt: 50, dice: [] }),
        RolledBy({ userId: "u-tarn", displayName: "Tarn" }),
      ]);
    });
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: specWithVersus(),
        // 2 successes (4, 5, 1, 2) → tied with opponent's 2.
        dice: [
          { sides: 6, value: 4 },
          { sides: 6, value: 5 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    const resolution = screen.getByTestId("tb-roll-row-versus-resolution");
    expect(resolution.textContent).toContain("tied");
  });

  it("hides the standard Ob resolution line when the row is part of a versus test", () => {
    // Even with a baseObstacle declared, the versus block takes
    // precedence — the player isn't rolling vs that Ob, they're
    // rolling vs the opponent.
    const h = harness();
    mountWithClient(h, () => {
      const entity = spawnTbRoll(h, {
        spec: specWithVersus({ baseObstacle: 3, obstacle: 3 }),
        dice: [
          { sides: 6, value: 6 },
          { sides: 6, value: 5 },
          { sides: 6, value: 4 },
          { sides: 6, value: 4 },
        ],
      });
      return TbRollRow({ entityId: entity }) as JSX.Element;
    });
    expect(screen.queryByTestId("tb-roll-row-resolution")).toBeNull();
    expect(
      screen.getByTestId("tb-roll-row-versus-awaiting"),
    ).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------
 * TB roll chat row — Log Advancement post-roll action
 * ----------------------------------------------------------------------- */

describe("TbRollRow — log advancement", () => {
  it("renders a Log Pass button after a passing skill roll", () => {
    const h = harness();
    let rollId: EntityId = "" as EntityId;
    mountWithClient(h, () => {
      rollId = spawnTbRoll(h, {
        speakingAsCharacterId: h.characterId,
        spec: {
          kind: "skill",
          source: "Fighter",
          sourceId: "fighter",
          baseDice: 3,
          pool: 3,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 1,
          obstacle: 1,
          modifiers: [],
          caption: "Bryn — Fighter vs Ob 1",
        },
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      return TbRollRow({ entityId: rollId }) as JSX.Element;
    });
    const btn = screen.getByTestId("tb-roll-row-log-advancement");
    expect(btn).toBeInTheDocument();
    expect(btn.getAttribute("data-outcome")).toBe("pass");
    expect(btn.textContent).toContain("Log Pass");
  });

  it("renders a Log Fail button after a failing skill roll", () => {
    const h = harness();
    mountWithClient(h, () => {
      const id = spawnTbRoll(h, {
        speakingAsCharacterId: h.characterId,
        spec: {
          kind: "skill",
          source: "Scholar",
          sourceId: "scholar",
          baseDice: 2,
          pool: 2,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 3,
          obstacle: 3,
          modifiers: [],
          caption: "Bryn — Scholar vs Ob 3",
        },
        dice: [
          { sides: 6, value: 1 },
          { sides: 6, value: 3 },
        ],
      });
      return TbRollRow({ entityId: id }) as JSX.Element;
    });
    const btn = screen.getByTestId("tb-roll-row-log-advancement");
    expect(btn.getAttribute("data-outcome")).toBe("fail");
    expect(btn.textContent).toContain("Log Fail");
  });

  it("dispatches LogAdvancement with the roll id and outcome on click", () => {
    const h = harness();
    let rollId: EntityId = "" as EntityId;
    mountWithClient(h, () => {
      rollId = spawnTbRoll(h, {
        speakingAsCharacterId: h.characterId,
        spec: {
          kind: "skill",
          source: "Fighter",
          sourceId: "fighter",
          baseDice: 3,
          pool: 3,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 1,
          obstacle: 1,
          modifiers: [],
          caption: "Bryn — Fighter vs Ob 1",
        },
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      return TbRollRow({ entityId: rollId }) as JSX.Element;
    });
    fireEvent.click(screen.getByTestId("tb-roll-row-log-advancement"));
    const dispatched = h.dispatched.find(
      (c) => c.type === LogAdvancement.name,
    );
    expect(dispatched).toBeDefined();
    expect(dispatched!.payload).toEqual({
      rollId,
      outcome: "pass",
    });
  });

  it("hides the button on disposition rolls (no advancement under TB rules)", () => {
    const h = harness();
    mountWithClient(h, () => {
      const id = spawnTbRoll(h, {
        speakingAsCharacterId: h.characterId,
        spec: {
          kind: "ability",
          source: "Will",
          sourceId: "will",
          baseDice: 4,
          pool: 4,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: null,
          obstacle: null,
          modifiers: [],
          dispositionMode: true,
          caption: "Bryn — Will (disposition)",
        },
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
          { sides: 6, value: 3 },
        ],
      });
      return TbRollRow({ entityId: id }) as JSX.Element;
    });
    expect(
      screen.queryByTestId("tb-roll-row-log-advancement"),
    ).toBeNull();
  });

  it("hides the button when the AdvancementLogged trait is already attached", () => {
    const h = harness();
    let rollId: EntityId = "" as EntityId;
    mountWithClient(h, () => {
      rollId = spawnTbRoll(h, {
        speakingAsCharacterId: h.characterId,
        spec: {
          kind: "skill",
          source: "Fighter",
          sourceId: "fighter",
          baseDice: 3,
          pool: 3,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 1,
          obstacle: 1,
          modifiers: [],
          caption: "Bryn — Fighter vs Ob 1",
        },
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      h.world.set(rollId, AdvancementLoggedTrait, {
        characterId: h.characterId,
        target: { kind: "skill", id: "fighter", label: "Fighter" },
        outcome: "pass",
        loggedAt: 1,
      });
      return TbRollRow({ entityId: rollId }) as JSX.Element;
    });
    expect(
      screen.queryByTestId("tb-roll-row-log-advancement"),
    ).toBeNull();
    expect(
      screen.getByTestId("tb-roll-row-advancement-confirmation").textContent,
    ).toContain("Pass logged for Fighter");
  });

  it("hides the Log Pass button when the pass column is already at threshold (DH p.108)", () => {
    // Skill rating 2 needs 2 passes / 1 fail to advance. Pre-load pass=2;
    // a passing roll's Log Pass button should hide because the column is full.
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Skills, {
        entries: {
          fighter: {
            rating: 2,
            advancement: { pass: 2, fail: 0 },
            taxed: false,
            learningTests: 0,
          },
        },
      });
    });
    mountWithClient(h, () => {
      const rollId = spawnTbRoll(h, {
        speakingAsCharacterId: h.characterId,
        spec: {
          kind: "skill",
          source: "Fighter",
          sourceId: "fighter",
          baseDice: 2,
          pool: 2,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 1,
          obstacle: 1,
          modifiers: [],
          caption: "Bryn — Fighter vs Ob 1",
        },
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 1 },
        ],
      });
      return TbRollRow({ entityId: rollId }) as JSX.Element;
    });
    expect(screen.queryByTestId("tb-roll-row-log-advancement")).toBeNull();
  });

  it("still shows Log Fail when only the pass column is full (the fail column would advance)", () => {
    // Same rating-2 fighter with pass=2 / fail=0 — a failing roll's
    // Log Fail still helps fill the gate.
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Skills, {
        entries: {
          fighter: {
            rating: 2,
            advancement: { pass: 2, fail: 0 },
            taxed: false,
            learningTests: 0,
          },
        },
      });
    });
    mountWithClient(h, () => {
      const rollId = spawnTbRoll(h, {
        speakingAsCharacterId: h.characterId,
        spec: {
          kind: "skill",
          source: "Fighter",
          sourceId: "fighter",
          baseDice: 2,
          pool: 2,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 5,
          obstacle: 5,
          modifiers: [],
          caption: "Bryn — Fighter vs Ob 5",
        },
        dice: [
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      return TbRollRow({ entityId: rollId }) as JSX.Element;
    });
    const btn = screen.getByTestId("tb-roll-row-log-advancement");
    expect(btn.getAttribute("data-outcome")).toBe("fail");
  });

  it("hides the Log Test button when BL learning track is already at maxNature (DH p.75)", () => {
    const h = harness(({ world, characterId }) => {
      world.set(characterId, Skills, {
        entries: {
          fighter: {
            rating: 0,
            advancement: { pass: 0, fail: 0 },
            taxed: false,
            // Bryn's nature.maximum is 4 (set in harness); learningTests at 4 = ready to learn.
            learningTests: 4,
          },
        },
      });
    });
    mountWithClient(h, () => {
      const rollId = spawnTbRoll(h, {
        speakingAsCharacterId: h.characterId,
        spec: {
          kind: "skill-bl",
          source: "Fighter (Beginner's Luck, health)",
          sourceId: "fighter",
          baseDice: 5,
          pool: 3,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: null,
          obstacle: null,
          modifiers: [],
          caption: "Bryn — Fighter (BL)",
        },
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 4 },
          { sides: 6, value: 1 },
        ],
      });
      return TbRollRow({ entityId: rollId }) as JSX.Element;
    });
    expect(screen.queryByTestId("tb-roll-row-log-advancement")).toBeNull();
  });

  it("renders a Log Test button (not Pass/Fail) for a Beginner's Luck roll", () => {
    const h = harness();
    mountWithClient(h, () => {
      const id = spawnTbRoll(h, {
        speakingAsCharacterId: h.characterId,
        spec: {
          kind: "skill-bl",
          source: "Rider (Beginner's Luck, health)",
          sourceId: "rider",
          baseDice: 2,
          pool: 2,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 3,
          obstacle: 3,
          modifiers: [],
          caption: "Bryn — Rider (Beginner's Luck, health) vs Ob 3",
        },
        // Outcome doesn't matter for BL learning, but make this a fail
        // so the test also confirms BL doesn't pick up the danger styling.
        dice: [
          { sides: 6, value: 2 },
          { sides: 6, value: 3 },
        ],
      });
      return TbRollRow({ entityId: id }) as JSX.Element;
    });
    const btn = screen.getByTestId("tb-roll-row-log-advancement");
    expect(btn.textContent).toContain("Log Test");
    expect(btn.getAttribute("data-outcome")).toBe("test");
  });

  it("dispatches LogAdvancement with outcome=pass for a Beginner's Luck click", () => {
    const h = harness();
    let rollId: EntityId = "" as EntityId;
    mountWithClient(h, () => {
      rollId = spawnTbRoll(h, {
        speakingAsCharacterId: h.characterId,
        spec: {
          kind: "skill-bl",
          source: "Rider (Beginner's Luck, health)",
          sourceId: "rider",
          baseDice: 2,
          pool: 2,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 3,
          obstacle: 3,
          modifiers: [],
          caption: "Bryn — Rider (BL) vs Ob 3",
        },
        dice: [
          { sides: 6, value: 2 },
          { sides: 6, value: 3 },
        ],
      });
      return TbRollRow({ entityId: rollId }) as JSX.Element;
    });
    fireEvent.click(screen.getByTestId("tb-roll-row-log-advancement"));
    const dispatched = h.dispatched.find(
      (c) => c.type === LogAdvancement.name,
    );
    expect(dispatched).toBeDefined();
    expect(dispatched!.payload).toEqual({ rollId, outcome: "pass" });
  });

  it("shows a learning-test confirmation footer once a BL roll has been logged", () => {
    const h = harness();
    let rollId: EntityId = "" as EntityId;
    mountWithClient(h, () => {
      rollId = spawnTbRoll(h, {
        speakingAsCharacterId: h.characterId,
        spec: {
          kind: "skill-bl",
          source: "Rider (Beginner's Luck, health)",
          sourceId: "rider",
          baseDice: 2,
          pool: 2,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: 3,
          obstacle: 3,
          modifiers: [],
          caption: "Bryn — Rider (BL) vs Ob 3",
        },
        dice: [
          { sides: 6, value: 2 },
          { sides: 6, value: 3 },
        ],
      });
      h.world.set(rollId, AdvancementLoggedTrait, {
        characterId: h.characterId,
        target: { kind: "skill-bl", id: "rider", label: "Rider" },
        outcome: "pass",
        loggedAt: 1,
      });
      return TbRollRow({ entityId: rollId }) as JSX.Element;
    });
    expect(
      screen.queryByTestId("tb-roll-row-log-advancement"),
    ).toBeNull();
    expect(
      screen.getByTestId("tb-roll-row-advancement-confirmation").textContent,
    ).toContain("Learning test logged for Rider");
  });

  it("hides the button while a versus test is awaiting an opponent", () => {
    const h = harness();
    mountWithClient(h, () => {
      const id = spawnTbRoll(h, {
        speakingAsCharacterId: h.characterId,
        spec: {
          kind: "skill",
          source: "Fighter",
          sourceId: "fighter",
          baseDice: 3,
          pool: 3,
          bonusSuccesses: 0,
          heroic: false,
          successTarget: 4,
          baseObstacle: null,
          obstacle: null,
          modifiers: [],
          versusTestId: "versus:test-pending",
          caption: "Bryn — Fighter (versus)",
        },
        dice: [
          { sides: 6, value: 5 },
          { sides: 6, value: 1 },
          { sides: 6, value: 2 },
        ],
      });
      return TbRollRow({ entityId: id }) as JSX.Element;
    });
    expect(
      screen.queryByTestId("tb-roll-row-log-advancement"),
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * TB roll chat-timeline contributor — filter + sort
 * ----------------------------------------------------------------------- */

describe("TbRollChatTimelineContributor", () => {
  it("emits one entry per TB-tagged Roll entity", () => {
    const h = harness(({ world }) => {
      const id1 = world.allocateId();
      world.spawnAt(id1, [
        Formula({
          notation: "4d6",
          reason: "Will",
          meta: {
            system: TB_ROLL_META_SYSTEM,
            spec: {
              kind: "ability",
              source: "Will",
              sourceId: "will",
              baseDice: 4,
              pool: 4,
              bonusSuccesses: 0,
              heroic: false,
              successTarget: 4,
              baseObstacle: null,
              obstacle: null,
              modifiers: [],
              caption: "Bryn — Will",
            },
          },
        }),
        RollResult({ total: 0, output: "x", rolledAt: 100, dice: [] }),
        RolledBy({ userId: "u1", displayName: "Bryn" }),
      ]);
    });
    let entries: ChatTimelineEntry[] = [];
    mountWithClient(h, () => {
      entries = (
        TbRollChatTimelineContributor.useEntries() as unknown as Accessor<
          ChatTimelineEntry[]
        >
      )();
      return <div />;
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.sortKey).toBe(100);
  });

  it("ignores Roll entities without TB meta tag", () => {
    const h = harness(({ world }) => {
      const id1 = world.allocateId();
      world.spawnAt(id1, [
        Formula({ notation: "1d20+5", reason: "no system" }),
        RollResult({ total: 12, output: "x", rolledAt: 10, dice: [] }),
        RolledBy({ userId: "u1", displayName: "Bryn" }),
      ]);
      const id2 = world.allocateId();
      world.spawnAt(id2, [
        Formula({
          notation: "1d6",
          reason: "other-system",
          meta: { system: "@vtt/system-other", spec: {} },
        }),
        RollResult({ total: 3, output: "y", rolledAt: 11, dice: [] }),
        RolledBy({ userId: "u1", displayName: "Bryn" }),
      ]);
    });
    let entries: ChatTimelineEntry[] = [];
    mountWithClient(h, () => {
      entries = (
        TbRollChatTimelineContributor.useEntries() as unknown as Accessor<
          ChatTimelineEntry[]
        >
      )();
      return <div />;
    });
    expect(entries).toEqual([]);
  });
});
