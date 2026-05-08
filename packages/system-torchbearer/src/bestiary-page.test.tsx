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
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { definePlugin } from "@vtt/substrate";
import {
  buildCharacterHarness,
  mountWithClient,
} from "@vtt/characters/testing";
import {
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
} from "@vtt/characters/shared";
import { ChatTimelineContributorSlot } from "@vtt/comms/shared";
import { ItemDetailSectionsSlot } from "@vtt/items/shared";
import { LinkKindsSlot } from "@vtt/notes/shared";
import {
  PaletteCommandsSlot,
  WorkbenchChatRailSurface,
} from "@vtt/shell-workbench/shared";
import { TB_SPAWN_MONSTER_PALETTE_COMMANDS } from "./client/spawn-monster-palette.js";
import { Character, Team } from "@vtt/characters/shared";
import { TbMonster } from "./shared/index.js";
import {
  Formula,
  RequestRoll,
  RolledBy,
  RollActionsSlot,
  RollResult,
} from "@vtt/resolution/shared";
import { systemTorchbearer } from "./manifest.js";
import { BestiaryPageProvider } from "./client/bestiary-page.js";
import {
  CreateBlankMonster,
  CreateMonsterFromCatalog,
} from "./shared/index.js";

/**
 * Slot/surface infra so the TB plugin's chat/sheet fills register
 * cleanly. Mirrors the monster-sheet test setup; the bestiary page
 * provider doesn't itself fill any of these but the manifest as a
 * whole expects them to exist.
 */
const sheetSlotsTestInfra = definePlugin({
  name: "@vtt/test-bestiary-page-slots",
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
    // Notes-side slot torchbearer fills with `monsterLinkKind`
    // (the `!` wikilink → bestiary route). Declared here so the TB
    // fill resolves without pulling the full @vtt/notes plugin.
    LinkKindsSlot,
  ],
  surfaces: [WorkbenchChatRailSurface],
  traits: [Formula, RollResult, RolledBy],
  commands: [RequestRoll],
});

beforeEach(() => cleanup());

function harness() {
  // We don't need a Character entity for the bestiary hub view (it
  // renders the empty-state hub when no monsters exist), but reusing
  // buildCharacterHarness gives us GM gating + the full TB manifest
  // wiring with one call.
  return buildCharacterHarness({
    plugins: [sheetSlotsTestInfra, systemTorchbearer],
    asGm: true,
    characterName: "Test PC",
  });
}

const TAB_ID = "tab-bestiary";

describe("BestiaryPageProvider — catalog picker (fuzzy search)", () => {
  it("renders the catalog rack with every TB monster template visible by default", () => {
    const h = harness();
    mountWithClient(
      h,
      () => BestiaryPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    const opts = screen.getByTestId("monster-template-options");
    // Every catalog template renders one row; pick a couple of
    // recognizable names to assert without depending on exact count.
    expect(
      opts.querySelector('[data-testid="monster-template-option-tb/monster/vampire-lord"]'),
    ).not.toBeNull();
    expect(
      opts.querySelector('[data-testid="monster-template-option-tb/monster/goblin"]'),
    ).not.toBeNull();
    expect(
      opts.querySelector('[data-testid="monster-template-option-tb/monster/black-dragon"]'),
    ).not.toBeNull();
  });

  it("typing into the search filters the rack via subsequence fuzzy match", () => {
    const h = harness();
    mountWithClient(
      h,
      () => BestiaryPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    const search = screen.getByTestId("monster-template-search") as HTMLInputElement;
    fireEvent.input(search, { target: { value: "vmpr" } });
    // The fuzzy match keeps Vampire Lord; the goblin / black-dragon
    // rows should drop out of the rack.
    const opts = screen.getByTestId("monster-template-options");
    expect(
      opts.querySelector('[data-testid="monster-template-option-tb/monster/vampire-lord"]'),
    ).not.toBeNull();
    expect(
      opts.querySelector('[data-testid="monster-template-option-tb/monster/goblin"]'),
    ).toBeNull();
    expect(
      opts.querySelector('[data-testid="monster-template-option-tb/monster/black-dragon"]'),
    ).toBeNull();
  });

  it("clicking a row selects it — the spawn button label updates to the picked creature", () => {
    const h = harness();
    mountWithClient(
      h,
      () => BestiaryPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    const goblinRow = screen.getByTestId(
      "monster-template-option-tb/monster/goblin",
    );
    fireEvent.click(goblinRow);
    const spawnBtn = screen.getByTestId("monster-spawn-submit");
    expect(spawnBtn.textContent).toContain("Goblin");
  });

  it("clicking Spawn dispatches CreateMonsterFromCatalog with the selected template id", () => {
    const h = harness();
    mountWithClient(
      h,
      () => BestiaryPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    fireEvent.click(
      screen.getByTestId("monster-template-option-tb/monster/vampire-lord"),
    );
    fireEvent.click(screen.getByTestId("monster-spawn-submit"));
    const dispatched = h.dispatched.find(
      (d) => d.type === CreateMonsterFromCatalog.name,
    );
    expect(dispatched).toBeTruthy();
    expect(dispatched!.payload).toMatchObject({
      templateId: "tb/monster/vampire-lord",
    });
  });

  it("an empty filter falls back to the inline empty-state, leaving the spawn button disabled", () => {
    const h = harness();
    mountWithClient(
      h,
      () => BestiaryPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    const search = screen.getByTestId("monster-template-search") as HTMLInputElement;
    // No template name has all of these chars in subsequence order.
    fireEvent.input(search, { target: { value: "qzx" } });
    expect(screen.getByTestId("monster-template-empty")).toBeInTheDocument();
    const spawnBtn = screen.getByTestId(
      "monster-spawn-submit",
    ) as HTMLButtonElement;
    expect(spawnBtn).toBeDisabled();
  });

  it("the homebrew affordance dispatches CreateBlankMonster with the typed name", () => {
    const h = harness();
    mountWithClient(
      h,
      () => BestiaryPageProvider.render({ tabId: TAB_ID, entityId: null }) as never,
    );
    const blankInput = screen.getByTestId(
      "monster-blank-name-input",
    ) as HTMLInputElement;
    fireEvent.input(blankInput, { target: { value: "Cinderclaw" } });
    fireEvent.click(screen.getByTestId("monster-blank-submit"));
    const dispatched = h.dispatched.find(
      (d) => d.type === CreateBlankMonster.name,
    );
    expect(dispatched).toBeTruthy();
    expect(dispatched!.payload).toMatchObject({ name: "Cinderclaw" });
  });
});

describe("Bestiary quick lookup — spawn-monster palette commands", () => {
  it("registers one PaletteCommand per TB monster template", () => {
    // Smoke test against the catalog. The exact count tracks
    // TB_MONSTER_TEMPLATES so this also flags accidental drops.
    expect(TB_SPAWN_MONSTER_PALETTE_COMMANDS.length).toBeGreaterThanOrEqual(
      30,
    );
    const labels = TB_SPAWN_MONSTER_PALETTE_COMMANDS.map((c) => c.label);
    expect(labels).toContain("Spawn Vampire Lord");
    expect(labels).toContain("Spawn Goblin");
    expect(labels).toContain("Spawn Black Dragon");
  });

  it("each verb's hint cites the source book and printed page", () => {
    const vampireLord = TB_SPAWN_MONSTER_PALETTE_COMMANDS.find(
      (c) => c.label === "Spawn Vampire Lord",
    );
    expect(vampireLord!.hint).toBe("Bestiary · LMM p.261");
  });

  it("verbs are hidden from non-GM sessions via visibleTo", () => {
    const h = harness();
    const verb = TB_SPAWN_MONSTER_PALETTE_COMMANDS[0]!;
    expect(
      verb.visibleTo!({ userId: "u", role: "gm", client: h.client }),
    ).toBe(true);
    expect(
      verb.visibleTo!({ userId: "u", role: "player", client: h.client }),
    ).toBe(false);
  });

  it("running a spawn verb dispatches CreateMonsterFromCatalog and (after the spawn lands) OpenPageInNewTab onto the bestiary page with the new monster id", async () => {
    const h = harness();
    const verb = TB_SPAWN_MONSTER_PALETTE_COMMANDS.find(
      (c) => c.label === "Spawn Vampire Lord",
    )!;
    // Subscribe via the verb itself — same control flow as the
    // palette's `choose("open")` for command hits.
    verb.run({ userId: "u", role: "gm", client: h.client });
    // Drain microtasks until the spawn system has run and the
    // follow-up OpenPageInNewTab has been dispatched. The spawn
    // command's apply allocates the monsterId server-side, which is
    // emitted on MonsterCreated; the verb's bus listener then
    // dispatches the OpenPageInNewTab.
    await new Promise((r) => setTimeout(r, 10));

    // 1. The spawn command was dispatched.
    const spawnCmd = h.dispatched.find(
      (d) => d.type === CreateMonsterFromCatalog.name,
    );
    expect(spawnCmd).toBeTruthy();
    expect(spawnCmd!.payload).toMatchObject({
      templateId: "tb/monster/vampire-lord",
    });

    // 2. The spawned monster exists with the right Character + TbMonster.
    const spawned = h.world.query([Character, TbMonster, Team]).find((row) => {
      const c = row.values.Character as { name: string };
      return c.name === "Vampire Lord";
    });
    expect(spawned).toBeTruthy();

    // 3. The follow-up OpenPageInNewTab landed targeting the
    // bestiary page + the new monster id. Crucially: we use
    // OpenPageInNewTab (not OpenPage) so the new tab opens
    // *focused* in the active pane without yanking the GM out of
    // whatever they were looking at when they hit ⌘K.
    const openCmd = h.dispatched.find(
      (d) => d.type === "@vtt/shell-workbench/OpenPageInNewTab",
    );
    expect(openCmd).toBeTruthy();
    expect(openCmd!.payload).toMatchObject({
      pageKind: "@vtt/system-torchbearer/bestiary",
      entityId: spawned!.id,
    });
  });
});
