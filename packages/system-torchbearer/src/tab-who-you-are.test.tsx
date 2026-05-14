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
import { definePlugin } from "@vtt/substrate";
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
import { PaletteCommandsSlot } from "@vtt/shell-workbench/shared";
import { WorkbenchChatRailSurface } from "@vtt/shell-workbench/shared";
import { systemTorchbearer } from "./manifest.js";
import { Identity, LevelBenefits, Pools, WhoYouAreNotes } from "./shared/index.js";
import { TbWhoYouAreTabFill } from "./client/tab-who-you-are.js";

const sheetSlotsTestInfra = definePlugin({
  name: "@vtt/test-tab-who-you-are-slots",
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

function harness(
  opts: {
    stock?: string;
    class?: string;
    level?: number;
    fateSpent?: number;
    personaSpent?: number;
  } = {},
): CharacterHarness {
  return buildCharacterHarness({
    plugins: [sheetSlotsTestInfra, systemTorchbearer],
    asGm: true,
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, Identity, {
        name: "Bryn",
        stock: opts.stock ?? "",
        class: opts.class ?? "",
        level: opts.level ?? 1,
        age: 23,
        home: "",
        raiment: "",
        parents: "",
        mentor: "",
        friend: "",
        enemy: "",
      });
      if (opts.fateSpent !== undefined || opts.personaSpent !== undefined) {
        world.set(characterId, Pools, {
          fate: { current: 0, totalSpent: opts.fateSpent ?? 0 },
          persona: { current: 0, totalSpent: opts.personaSpent ?? 0 },
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

describe("Who You Are tab", () => {
  beforeEach(() => {
    cleanup();
  });

  describe("Stock + Class dropdowns", () => {
    function selectFor(testid: string): HTMLSelectElement {
      return screen.getByTestId(testid) as HTMLSelectElement;
    }
    function optionValues(s: HTMLSelectElement): string[] {
      return Array.from(s.options).map((o) => o.value);
    }

    it("renders empty placeholders when stock/class are unset", () => {
      const h = harness();
      mount(h);
      expect(selectFor("stock-select").value).toBe("");
      expect(selectFor("class-select").value).toBe("");
      // No class-set means no class-levels chip in the section header.
      expect(screen.queryByTestId("class-levels-chip")).toBeNull();
    });

    it("matches a stored Human/Theurge identity and surfaces the class chip inline", () => {
      const h = harness({ stock: "Human", class: "Theurge" });
      mount(h);
      expect(selectFor("stock-select").value).toBe("Human");
      expect(selectFor("class-select").value).toBe("Theurge");
      // The class chip (DH p.27) is inline next to the Class
      // dropdown; the level-benefits chip (DH p.125) is in the
      // Levels & Benefits section header.
      expect(screen.getByText("DH p.27")).toBeInTheDocument();
      expect(screen.getByText("DH p.125")).toBeInTheDocument();
      // The "class levels:" chip lives in the section header.
      expect(screen.getByTestId("class-levels-chip")).toBeInTheDocument();
    });

    it("class dropdown is filtered to the chosen stock", () => {
      const h = harness({ stock: "Halfling" });
      mount(h);
      // Halfling can only pair with Burglar.
      expect(optionValues(selectFor("class-select"))).toEqual([
        "",
        "Burglar",
      ]);
    });

    it("stock dropdown is filtered to the chosen class", () => {
      const h = harness({ class: "Theurge" });
      mount(h);
      // Theurge pairs with Human or Troll Changeling.
      expect(optionValues(selectFor("stock-select"))).toEqual([
        "",
        "Human",
        "Troll Changeling",
      ]);
    });

    it("changing stock dispatches a SetField on Identity.stock", () => {
      const h = harness({ stock: "Human", class: "Theurge" });
      mount(h);
      const before = h.dispatched.length;
      fireEvent.change(selectFor("stock-select"), {
        target: { value: "Troll Changeling" },
      });
      const writes = h.dispatched.slice(before).filter(
        (c) =>
          c.type === SetField.name &&
          (c.payload as { path: string[] }).path[0] === "stock",
      );
      expect(writes.length).toBe(1);
      expect((writes[0]!.payload as { value: string }).value).toBe(
        "Troll Changeling",
      );
    });

    it("clearing one axis unlocks the other dropdown's full option list", async () => {
      const h = harness({ stock: "Halfling", class: "Burglar" });
      mount(h);
      // While Halfling/Burglar is locked in, the class dropdown is
      // narrowed to just Burglar.
      expect(optionValues(selectFor("class-select"))).toEqual(["", "Burglar"]);
      // Clear the stock by picking the placeholder. After the trait
      // write applies on the microtask queue, the class dropdown
      // opens up to every class in the catalog.
      fireEvent.change(selectFor("stock-select"), { target: { value: "" } });
      // Wait for the trait-write to round-trip through the pipeline
      // and re-render the dropdown.
      await new Promise((r) => setTimeout(r, 0));
      expect(optionValues(selectFor("class-select")).length).toBeGreaterThan(2);
    });

    it("Troll Changeling variants surface the LMM stock chip", () => {
      const h = harness({ stock: "Troll Changeling", class: "Magician" });
      mount(h);
      // Class chapter is DH (the Magician class itself), level
      // benefits track the same DH page, but the stock chip points
      // at the Troll Changeling intro on LMM p.8.
      expect(screen.getByText("DH p.26")).toBeInTheDocument();
      expect(screen.getByText("DH p.115")).toBeInTheDocument();
      expect(screen.getByText("LMM p.8")).toBeInTheDocument();
    });

    it("canonical DH stocks each surface their own Nature-question page chip", () => {
      // Each base stock has its own DH Nature-question / Upbringing
      // page; the chip beside the Stock dropdown deep-links there.
      const cases: ReadonlyArray<{ stock: string; klass: string; page: number }> = [
        { stock: "Halfling", klass: "Burglar", page: 35 },
        { stock: "Human", klass: "Theurge", page: 29 },
        { stock: "Dwarf", klass: "Outcast", page: 33 },
        { stock: "Elf", klass: "Ranger", page: 34 },
      ];
      for (const c of cases) {
        cleanup();
        const h = harness({ stock: c.stock, class: c.klass });
        mount(h);
        expect(screen.getByText(`DH p.${c.page}`)).toBeInTheDocument();
      }
    });
  });

  describe("Levels & Benefits table", () => {
    it("renders all 10 rows with the correct fate / persona spend totals", () => {
      const h = harness();
      mount(h);
      const table = screen.getByTestId("level-benefits-table");
      expect(table).toBeInTheDocument();
      // 1 header row + 10 body rows = 11 rows total
      expect(table.querySelectorAll("tr").length).toBe(11);
      // Spot-check a few canonical totals from DH p.112.
      // L3 row: fate 7, persona 6, "Earn creed; +1D to Circles…"
      const cells = Array.from(table.querySelectorAll("td"));
      expect(cells.some((c) => c.textContent?.includes("Earn creed"))).toBe(
        true,
      );
      // L10 row: fate 78, persona 98
      expect(cells.some((c) => c.textContent?.trim() === "78")).toBe(true);
      expect(cells.some((c) => c.textContent?.trim() === "98")).toBe(true);
    });

    it("hides the level-up arrow when the next-level spend thresholds aren't met", () => {
      const h = harness({ level: 1, fateSpent: 2, personaSpent: 2 });
      mount(h);
      // L2 needs fate 3 + persona 3; we're short on both.
      expect(screen.queryByTestId("level-up-arrow-2")).toBeNull();
    });

    it("triggers the arrow when spend exactly equals the threshold (boundary)", () => {
      // RAW DH p.112: level up when you've "spent the required
      // amounts" — a `>=` comparison, so equality is enough. The
      // arrow appears at fate=3/persona=3 for L2, not only past
      // the threshold.
      const h = harness({ level: 1, fateSpent: 3, personaSpent: 3 });
      mount(h);
      expect(screen.getByTestId("level-up-arrow-2")).toBeInTheDocument();
    });

    it("requires both thresholds — one short on either axis suppresses the arrow", () => {
      // Fate met (3 ≥ 3) but persona one short (2 < 3) → no arrow.
      const fateMet = harness({ level: 1, fateSpent: 3, personaSpent: 2 });
      mount(fateMet);
      expect(screen.queryByTestId("level-up-arrow-2")).toBeNull();
      cleanup();
      // And vice versa.
      const personaMet = harness({ level: 1, fateSpent: 2, personaSpent: 3 });
      mount(personaMet);
      expect(screen.queryByTestId("level-up-arrow-2")).toBeNull();
    });

    it("shows the arrow when the spend exceeds the threshold", () => {
      const h = harness({ level: 1, fateSpent: 5, personaSpent: 4 });
      mount(h);
      // L2 thresholds (3, 3) handily exceeded.
      expect(screen.getByTestId("level-up-arrow-2")).toBeInTheDocument();
      expect(screen.queryByTestId("level-up-arrow-3")).toBeNull();
    });

    it("only the next-level row gets the arrow, even when over-spent across multiple levels", () => {
      // Hard-grinding character: still level 1 but spent enough to
      // qualify for L4 (fate 14 + persona 12). Per RAW p.112 the
      // character only advances one level per town visit, so the
      // arrow points at L2 specifically.
      const h = harness({ level: 1, fateSpent: 20, personaSpent: 20 });
      mount(h);
      expect(screen.getByTestId("level-up-arrow-2")).toBeInTheDocument();
      expect(screen.queryByTestId("level-up-arrow-3")).toBeNull();
      expect(screen.queryByTestId("level-up-arrow-4")).toBeNull();
    });

    it("does not surface the arrow past level 10", () => {
      const h = harness({ level: 10, fateSpent: 999, personaSpent: 999 });
      mount(h);
      // L10 is the cap — no arrow anywhere.
      for (let lv = 1; lv <= 10; lv += 1) {
        expect(screen.queryByTestId(`level-up-arrow-${lv}`)).toBeNull();
      }
    });

    it("typing into a benefit cell dispatches a SetField on LevelBenefits.benefits[i]", async () => {
      const h = harness();
      mount(h);
      const inputs = screen
        .getByTestId("level-benefits-table")
        .querySelectorAll("input[type='text']");
      expect(inputs.length).toBe(10);
      const l4Input = inputs[3] as HTMLInputElement;
      // Focus, type, blur — TextField commits on blur (or Enter).
      fireEvent.focus(l4Input);
      fireEvent.input(l4Input, { target: { value: "Plucky" } });
      fireEvent.blur(l4Input);
      const write = h.dispatched.find(
        (c) =>
          c.type === SetField.name &&
          (c.payload as { trait: string }).trait === LevelBenefits.name,
      );
      expect(write).toBeDefined();
      const payload = write!.payload as {
        path: ReadonlyArray<string | number>;
        value: string;
      };
      expect(payload.path).toEqual(["benefits", 3]);
      expect(payload.value).toBe("Plucky");
    });
  });

  it("shows the levels chapter deep-link (DH p.112) in the section header", () => {
    const h = harness();
    mount(h);
    expect(screen.getByText("DH p.112")).toBeInTheDocument();
  });

  describe("Notes section", () => {
    it("renders a free-form textarea below the Allies & Enemies section", () => {
      const h = harness();
      mount(h);
      const ta = screen.getByPlaceholderText(
        /Backstory scraps, GM hooks/i,
      ) as HTMLTextAreaElement;
      expect(ta).toBeInTheDocument();
      expect(ta.tagName).toBe("TEXTAREA");
    });

    it("typing into the notes textarea dispatches a SetField on WhoYouAreNotes.notes", () => {
      const h = harness();
      mount(h);
      const ta = screen.getByPlaceholderText(
        /Backstory scraps, GM hooks/i,
      ) as HTMLTextAreaElement;
      fireEvent.focus(ta);
      fireEvent.input(ta, {
        target: { value: "Met a strange tinker at the crossroads." },
      });
      fireEvent.blur(ta);
      const write = h.dispatched.find(
        (c) =>
          c.type === SetField.name &&
          (c.payload as { trait: string }).trait === WhoYouAreNotes.name,
      );
      expect(write).toBeDefined();
      const payload = write!.payload as {
        path: ReadonlyArray<string | number>;
        value: string;
      };
      expect(payload.path).toEqual(["notes"]);
      expect(payload.value).toBe("Met a strange tinker at the crossroads.");
    });
  });
});
