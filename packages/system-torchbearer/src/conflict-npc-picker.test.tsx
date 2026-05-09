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
  buildCharacterHarness,
} from "@vtt/characters/testing";
import { mountWithClient } from "@vtt/substrate/client-testing";
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
import {
  Formula,
  RequestRoll,
  RolledBy,
  RollActionsSlot,
  RollResult,
} from "@vtt/resolution/shared";
import { systemTorchbearer } from "./manifest.js";
import { ConflictPageProvider } from "./conflict/client/ConflictPage.js";
import { CreateNpcFromCatalog } from "./shared/index.js";

/** Slot/surface infra so the TB plugin's fills register cleanly. */
const sheetSlotsTestInfra = definePlugin({
  name: "@vtt/test-conflict-npc-picker-slots",
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

function harness() {
  return buildCharacterHarness({
    plugins: [sheetSlotsTestInfra, systemTorchbearer],
    asGm: true,
    characterName: "Test PC",
  });
}

const TAB_ID = "tab-conflict";

describe("ConflictPage — inline NPC spawn picker", () => {
  it("the declare form renders an NPC spawn rack alongside the bestiary one", () => {
    const h = harness();
    mountWithClient(
      h,
      () =>
        ConflictPageProvider.render({
          tabId: TAB_ID,
          entityId: null,
        }) as never,
    );
    // Both the bestiary picker and the NPC picker are present in the
    // declare form — quick-spawn parity for monsters and NPCs.
    expect(screen.queryByTestId("declare-bestiary-picker")).not.toBeNull();
    expect(screen.queryByTestId("declare-npc-picker")).not.toBeNull();
    // The NPC rack lists the catalog entries by default (no filter).
    const opts = screen.getByTestId("declare-npc-options");
    expect(
      opts.querySelector(
        '[data-testid="declare-npc-option-tb/npc/bandit"]',
      ),
    ).not.toBeNull();
    expect(
      opts.querySelector(
        '[data-testid="declare-npc-option-tb/npc/soldier"]',
      ),
    ).not.toBeNull();
  });

  it("typing into the NPC search filters the rack via subsequence fuzzy match", () => {
    const h = harness();
    mountWithClient(
      h,
      () =>
        ConflictPageProvider.render({
          tabId: TAB_ID,
          entityId: null,
        }) as never,
    );
    const search = screen.getByTestId(
      "declare-npc-input",
    ) as HTMLInputElement;
    fireEvent.input(search, { target: { value: "soldr" } });
    const opts = screen.getByTestId("declare-npc-options");
    expect(
      opts.querySelector(
        '[data-testid="declare-npc-option-tb/npc/soldier"]',
      ),
    ).not.toBeNull();
    // Bandit gets filtered out by the "soldr" subsequence match.
    expect(
      opts.querySelector(
        '[data-testid="declare-npc-option-tb/npc/bandit"]',
      ),
    ).toBeNull();
  });

  it("clicking an NPC row + Conjure dispatches CreateNpcFromCatalog", () => {
    const h = harness();
    mountWithClient(
      h,
      () =>
        ConflictPageProvider.render({
          tabId: TAB_ID,
          entityId: null,
        }) as never,
    );
    fireEvent.click(
      screen.getByTestId("declare-npc-option-tb/npc/soldier"),
    );
    fireEvent.click(screen.getByTestId("declare-npc-spawn"));
    const dispatched = h.dispatched.find(
      (d) => d.type === CreateNpcFromCatalog.name,
    );
    expect(dispatched).toBeTruthy();
    expect(dispatched!.payload).toMatchObject({
      templateId: "tb/npc/soldier",
    });
  });

  it("the count stepper bumps the requested count, surfaced in the verb-on-target button", () => {
    const h = harness();
    mountWithClient(
      h,
      () =>
        ConflictPageProvider.render({
          tabId: TAB_ID,
          entityId: null,
        }) as never,
    );
    fireEvent.click(
      screen.getByTestId("declare-npc-option-tb/npc/bandit"),
    );
    const countInput = screen.getByTestId(
      "declare-npc-count",
    ) as HTMLInputElement;
    fireEvent.input(countInput, { target: { value: "4" } });
    const spawnBtn = screen.getByTestId("declare-npc-spawn");
    expect(spawnBtn.textContent).toContain("Bandit");
    expect(spawnBtn.textContent).toContain("4");
  });

  it("when the filter trims to zero the empty-state banner replaces the rack", () => {
    const h = harness();
    mountWithClient(
      h,
      () =>
        ConflictPageProvider.render({
          tabId: TAB_ID,
          entityId: null,
        }) as never,
    );
    const search = screen.getByTestId(
      "declare-npc-input",
    ) as HTMLInputElement;
    fireEvent.input(search, { target: { value: "qzx" } });
    expect(screen.getByTestId("declare-npc-empty")).toBeInTheDocument();
  });
});
