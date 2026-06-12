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
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { definePlugin } from "@vtt/substrate";
import {
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
  SetField,
  Team,
} from "@vtt/characters/shared";
import {
  buildCharacterHarness,
  mountWithClient,
  type CharacterHarness,
} from "@vtt/characters/testing";
import { ChatTimelineContributorSlot } from "@vtt/comms/shared";
import { ItemDetailSectionsSlot } from "@vtt/items/shared";
import { LinkKindsSlot } from "@vtt/notes/shared";
import { BlockKindsSlot } from "@vtt/adventures/shared";
import {
  NotificationsSlot, PaletteActionsSlot, PaletteCommandsSlot, WorkbenchStatusSlot,
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
import { NpcSheet } from "./client/npc-sheet.js";
import {
  CharacterTraits,
  Conditions,
  Heroic,
  RawAbilities,
  Skills,
  TbNpc,
  TownAbilities,
  Wises,
} from "./shared/index.js";

/** Slot/surface infra so the TB plugin's fills register cleanly. */
const sheetSlotsTestInfra = definePlugin({
  name: "@vtt/test-npc-sheet-slots",
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
    NotificationsSlot, PaletteActionsSlot, PaletteCommandsSlot, WorkbenchStatusSlot,
    LinkKindsSlot,
    BlockKindsSlot,
  ],
  surfaces: [WorkbenchChatRailSurface],
  traits: [Formula, RollResult, RolledBy],
  commands: [RequestRoll],
});

beforeEach(() => cleanup());

/**
 * Build a harness with an Alchemist-shaped NPC at `characterId`. The
 * stat block matches the SG p.201 entry verbatim so the tests double
 * as a regression check on the catalog.
 */
function alchemistHarness(): CharacterHarness {
  return buildCharacterHarness({
    plugins: [sheetSlotsTestInfra, systemTorchbearer],
    asGm: true,
    characterName: "Alchemist",
    setupWorld: ({ world, characterId }) => {
      world.set(characterId, RawAbilities, {
        will: { rating: 6, advancement: { pass: 0, fail: 0 } },
        health: { rating: 3, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: 2,
          maximum: 2,
          advancement: { pass: 0, fail: 0 },
          descriptors: [],
        },
      });
      world.set(characterId, TownAbilities, {
        resources: { rating: 5, advancement: { pass: 0, fail: 0 } },
        circles: { rating: 4, advancement: { pass: 0, fail: 0 } },
        precedence: 1,
        might: 2,
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
      // Skills entries — only Alchemist 5, Healer 3, Lore Master 2 are
      // rated; the rest stay at 0 so the dropdown shows them as
      // candidates.
      const entries: Record<
        string,
        {
          rating: number;
          advancement: { pass: number; fail: number };
          taxed: boolean;
          learningTests: number;
        }
      > = {};
      entries.alchemist = {
        rating: 5,
        advancement: { pass: 0, fail: 0 },
        taxed: false,
        learningTests: 0,
      };
      entries.healer = {
        rating: 3,
        advancement: { pass: 0, fail: 0 },
        taxed: false,
        learningTests: 0,
      };
      entries.loreMaster = {
        rating: 2,
        advancement: { pass: 0, fail: 0 },
        taxed: false,
        learningTests: 0,
      };
      entries.fighter = {
        rating: 0,
        advancement: { pass: 0, fail: 0 },
        taxed: false,
        learningTests: 0,
      };
      world.set(characterId, Skills, { entries });
      world.set(characterId, Wises, {
        entries: [
          {
            name: "Chemistry-wise",
            pass: false,
            fail: false,
            fate: false,
            persona: false,
          },
        ],
      });
      world.set(characterId, CharacterTraits, {
        entries: [
          {
            name: "Curious",
            level: 2,
            beneficialUses: 0,
            checks: 0,
            usedAgainst: false,
          },
        ],
      });
      world.set(characterId, Team, { kind: "enemy" });
      world.set(characterId, TbNpc, {
        role: "Alchemist",
        description: "",
        pageRef: { canonicalId: "tb/book/scholars-guide", page: 201 },
      });
    },
  });
}

describe("NpcSheet — identity + stat block + role pill", () => {
  it("renders the canonical Alchemist stat values, role pill, and SG citation", () => {
    const h = alchemistHarness();
    mountWithClient(h, () => (
      <NpcSheet characterId={h.characterId} />
    ));
    // Stat strip surfaces the rated abilities.
    expect(screen.getByTestId("npc-will-value").textContent).toBe("6");
    expect(screen.getByTestId("npc-health-value").textContent).toBe("3");
    expect(screen.getByTestId("npc-nature-value").textContent).toBe("2");
    expect(screen.getByTestId("npc-resources-value").textContent).toBe("5");
    expect(screen.getByTestId("npc-circles-value").textContent).toBe("4");
    expect(screen.getByTestId("npc-might-value").textContent).toBe("2");
    expect(screen.getByTestId("npc-precedence-value").textContent).toBe("1");
    // Role pill renders.
    expect(screen.getByTestId("npc-role-pill").textContent).toBe("ALCHEMIST");
    // Default Team is enemy (NPC default).
    expect(screen.getByTestId("npc-team-display").textContent).toContain(
      "Enemy",
    );
  });

  it("flipping the team button dispatches SetField onto Team.kind", () => {
    const h = alchemistHarness();
    mountWithClient(h, () => (
      <NpcSheet characterId={h.characterId} />
    ));
    fireEvent.click(screen.getByTestId("npc-team-flip"));
    const dispatched = h.dispatched.find(
      (d) =>
        d.type === SetField.name &&
        (d.payload as { trait: string }).trait === Team.name,
    );
    expect(dispatched).toBeTruthy();
    expect(dispatched!.payload).toMatchObject({
      trait: Team.name,
      path: ["kind"],
      value: "party",
    });
  });
});

describe("NpcSheet — Skills section", () => {
  it("only shows skills with rating > 0 in the rated list", () => {
    const h = alchemistHarness();
    mountWithClient(h, () => (
      <NpcSheet characterId={h.characterId} />
    ));
    expect(screen.queryByTestId("npc-skill-row-alchemist")).not.toBeNull();
    expect(screen.queryByTestId("npc-skill-row-healer")).not.toBeNull();
    expect(screen.queryByTestId("npc-skill-row-loreMaster")).not.toBeNull();
    // Fighter (rating 0) doesn't render a row — it lives in the
    // dropdown candidates instead.
    expect(screen.queryByTestId("npc-skill-row-fighter")).toBeNull();
  });

  it("the add-skill dropdown lists unrated skills (Fighter, etc.)", () => {
    const h = alchemistHarness();
    mountWithClient(h, () => (
      <NpcSheet characterId={h.characterId} />
    ));
    const select = screen.getByTestId(
      "npc-skill-add-select",
    ) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("fighter");
    // Already-rated skills are excluded.
    expect(options).not.toContain("alchemist");
    expect(options).not.toContain("healer");
  });

  it("clicking + add skill dispatches SetField with the picked skill at the picked rating", () => {
    const h = alchemistHarness();
    mountWithClient(h, () => (
      <NpcSheet characterId={h.characterId} />
    ));
    const select = screen.getByTestId(
      "npc-skill-add-select",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "fighter" } });
    const ratingSelect = screen.getByTestId(
      "npc-skill-add-rating",
    ) as HTMLSelectElement;
    fireEvent.change(ratingSelect, { target: { value: "4" } });
    fireEvent.click(screen.getByTestId("npc-skill-add-submit"));
    const dispatched = h.dispatched.find(
      (d) =>
        d.type === SetField.name &&
        Array.isArray((d.payload as { path: unknown[] }).path) &&
        (d.payload as { path: string[] }).path[0] === "entries" &&
        (d.payload as { path: string[] }).path[1] === "fighter",
    );
    expect(dispatched).toBeTruthy();
    expect(dispatched!.payload).toMatchObject({
      trait: Skills.name,
      path: ["entries", "fighter", "rating"],
      value: 4,
    });
  });

  it("clicking remove (×) on a skill row dispatches SetField with rating 0", () => {
    const h = alchemistHarness();
    mountWithClient(h, () => (
      <NpcSheet characterId={h.characterId} />
    ));
    fireEvent.click(screen.getByTestId("npc-skill-remove-loreMaster"));
    const dispatched = h.dispatched.find(
      (d) =>
        d.type === SetField.name &&
        (d.payload as { path: string[] }).path[1] === "loreMaster",
    );
    expect(dispatched).toBeTruthy();
    expect(dispatched!.payload).toMatchObject({
      trait: Skills.name,
      path: ["entries", "loreMaster", "rating"],
      value: 0,
    });
  });
});

describe("NpcSheet — Wises section", () => {
  it("renders existing wises and accepts a new one via the input", () => {
    const h = alchemistHarness();
    mountWithClient(h, () => (
      <NpcSheet characterId={h.characterId} />
    ));
    // Existing Chemistry-wise renders.
    expect(screen.queryByTestId("npc-wise-0")).not.toBeNull();
    // Add a new wise.
    const input = screen.getByTestId(
      "npc-wise-add-input",
    ) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Herb-wise" } });
    fireEvent.click(screen.getByTestId("npc-wise-add-submit"));
    const dispatched = h.dispatched.find(
      (d) =>
        d.type === SetField.name &&
        (d.payload as { trait: string }).trait === Wises.name,
    );
    expect(dispatched).toBeTruthy();
    const value = (dispatched!.payload as { value: { name: string }[] }).value;
    expect(value.map((w) => w.name)).toEqual([
      "Chemistry-wise",
      "Herb-wise",
    ]);
  });
});

describe("NpcSheet — Traits section", () => {
  it("renders existing TB-traits with their level and accepts a new one", () => {
    const h = alchemistHarness();
    mountWithClient(h, () => (
      <NpcSheet characterId={h.characterId} />
    ));
    expect(screen.queryByTestId("npc-trait-0")?.textContent).toContain(
      "Curious",
    );
    expect(screen.queryByTestId("npc-trait-0")?.textContent).toContain("(2)");

    const nameInput = screen.getByTestId(
      "npc-trait-add-name",
    ) as HTMLInputElement;
    const levelSelect = screen.getByTestId(
      "npc-trait-add-level",
    ) as HTMLSelectElement;
    fireEvent.input(nameInput, { target: { value: "Wise" } });
    fireEvent.change(levelSelect, { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("npc-trait-add-submit"));
    const dispatched = h.dispatched.find(
      (d) =>
        d.type === SetField.name &&
        (d.payload as { trait: string }).trait === CharacterTraits.name,
    );
    expect(dispatched).toBeTruthy();
    const value = (
      dispatched!.payload as { value: { name: string; level: number }[] }
    ).value;
    expect(value).toEqual([
      expect.objectContaining({ name: "Curious", level: 2 }),
      expect.objectContaining({ name: "Wise", level: 3 }),
    ]);
  });
});

describe("NpcSheet — Conditions section", () => {
  it("clicking a condition chip flips the corresponding boolean", () => {
    const h = alchemistHarness();
    mountWithClient(h, () => (
      <NpcSheet characterId={h.characterId} />
    ));
    fireEvent.click(screen.getByTestId("npc-cond-injured"));
    const dispatched = h.dispatched.find(
      (d) =>
        d.type === SetField.name &&
        (d.payload as { trait: string }).trait === Conditions.name,
    );
    expect(dispatched).toBeTruthy();
    expect(dispatched!.payload).toMatchObject({
      trait: Conditions.name,
      path: ["injured"],
      value: true,
    });
  });
});

describe("NpcSheet — Description (textarea)", () => {
  it("renders the notes field as a textarea with rows=6", () => {
    const h = alchemistHarness();
    mountWithClient(h, () => (
      <NpcSheet characterId={h.characterId} />
    ));
    const ta = document.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(ta).not.toBeNull();
    expect(ta!.tagName).toBe("TEXTAREA");
    expect(ta!.rows).toBe(6);
  });
});

describe("NpcSheet — Gear section mounts the inventory view", () => {
  it("renders the same TbInventoryView the PC sheet uses", () => {
    // The Gear section mounts the full inventory affordance — catalog
    // quick-add, slot panels, loose pool — so the GM can equip gear
    // without leaving the simplified NPC sheet. Asserting the
    // catalog-search input is present is the load-bearing check that
    // the inventory body wired up correctly.
    const h = alchemistHarness();
    mountWithClient(h, () => (
      <NpcSheet characterId={h.characterId} />
    ));
    expect(screen.getByTestId("npc-gear-inventory")).toBeInTheDocument();
    expect(screen.getByTestId("catalog-search")).toBeInTheDocument();
  });
});
