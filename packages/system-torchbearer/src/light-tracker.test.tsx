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
import {
  cleanup,
  fireEvent,
  screen,
  within,
} from "@solidjs/testing-library";
import { definePlugin, type EntityId } from "@vtt/substrate";
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
  Character,
} from "@vtt/characters/shared";
import { ChatTimelineContributorSlot } from "@vtt/comms/shared";
import { ItemDetailSectionsSlot, ItemIdentity } from "@vtt/items/shared";
import { LinkKindsSlot } from "@vtt/notes/shared";
import { BlockKindsSlot } from "@vtt/adventures/shared";
import {
  NotificationsSlot,
  PaletteActionsSlot,
  PaletteCommandsSlot,
  WorkbenchStatusSlot,
  WorkbenchChatRailSurface,
} from "@vtt/shell-workbench/shared";
import { Identity, Online, Name } from "@vtt/identity/shared";
import {
  Formula,
  RequestRoll,
  RolledBy,
  RollActionsSlot,
  RollResult,
} from "@vtt/resolution/shared";
import { systemTorchbearer } from "./manifest.js";
import { LightTrackerStatusItem } from "./client/light-tracker.js";
import { TbCarries, TbMonster, TbNpc } from "./shared/index.js";

/**
 * Slot/surface infra so the TB plugin's chat/sheet fills register
 * cleanly. Mirrors the monsters-page test setup.
 */
const sheetSlotsTestInfra = definePlugin({
  name: "@vtt/test-light-tracker-slots",
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
    NotificationsSlot,
    PaletteActionsSlot,
    PaletteCommandsSlot,
    WorkbenchStatusSlot,
    LinkKindsSlot,
    BlockKindsSlot,
  ],
  surfaces: [WorkbenchChatRailSurface],
  traits: [Formula, RollResult, RolledBy],
  commands: [RequestRoll],
});

beforeEach(() => cleanup());

/**
 * Builds a world with one lit torch carried by the GM-controlled PC
 * "Tarn", a second PC "Alice", plus a monster and an NPC — both of
 * which also carry the `Character` trait. The light tracker must list
 * only the two player characters, never the monster or NPC.
 *
 * `useIsGm` keys off the presence row matching the client id and
 * queries `[Identity, Name, Online]`, so we spawn a fully-named
 * presence entity (the bare harness presence has no `Name`).
 */
function harness() {
  return buildCharacterHarness({
    plugins: [sheetSlotsTestInfra, systemTorchbearer],
    asGm: true,
    characterName: "Tarn",
    setupWorld: ({ world, characterId }) => {
      // Named GM presence so the assign button's GM gate resolves.
      world.spawn([
        Identity({ userId: "test-me", role: "gm" }),
        Name({ value: "GM" }),
        Online({ clientId: "test-client-1", since: 1 }),
      ]);
      // A second player character.
      world.spawn([Character({ name: "Alice" })]);
      // A monster and an NPC — both Characters, both must be excluded.
      world.spawn([Character({ name: "Goblin" }), TbMonster({})]);
      world.spawn([Character({ name: "Barkeep" }), TbNpc({})]);
      // A lit torch carried by Tarn so the tracker renders at all.
      const torchId = world.spawn([ItemIdentity({ name: "Torch" })]);
      world.set(characterId, TbCarries, {
        entries: [
          {
            slot: "handR",
            slotIndex: 0,
            channel: "carried",
            slotsConsumed: 1,
            itemId: torchId as EntityId,
            quantity: 1,
            state: { lit: true, turnsRemaining: 5 },
          },
        ],
      });
    },
  });
}

describe("LightTracker — player-character filtering", () => {
  it("counts only player characters as 'in darkness' (excludes monster + NPC)", () => {
    const h = harness();
    mountWithClient(h, () => LightTrackerStatusItem.render() as never);

    // Two PCs (Tarn + Alice) are uncovered; the goblin and barkeep,
    // despite carrying Character, must not inflate the count.
    const toggle = screen.getByTestId("light-tracker-toggle");
    expect(toggle).toHaveTextContent("2 dark");
    expect(toggle).not.toHaveTextContent("4 dark");
  });

  it("the coverage editor offers player characters only", () => {
    const h = harness();
    mountWithClient(h, () => LightTrackerStatusItem.render() as never);

    // Expand the panel, then enter assign mode on the lit source.
    fireEvent.click(screen.getByTestId("light-tracker-toggle"));
    fireEvent.click(screen.getByTestId("light-edit-coverage"));

    const panel = screen.getByTestId("light-tracker-panel");
    // Both player characters get a toggle button…
    expect(
      within(panel).getByRole("button", { name: /Tarn/ }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: /Alice/ }),
    ).toBeInTheDocument();
    // …the monster and NPC do not.
    expect(
      within(panel).queryByRole("button", { name: /Goblin/ }),
    ).toBeNull();
    expect(
      within(panel).queryByRole("button", { name: /Barkeep/ }),
    ).toBeNull();
  });
});
