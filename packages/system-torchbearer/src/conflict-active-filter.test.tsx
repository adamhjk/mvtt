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
import { cleanup, screen } from "@solidjs/testing-library";
import { definePlugin } from "@vtt/substrate";
import { buildCharacterHarness } from "@vtt/characters/testing";
import { mountWithClient } from "@vtt/substrate/client-testing";
import {
  Active,
  Character,
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
  Team,
} from "@vtt/characters/shared";
import { Permissions, everyone } from "@vtt/permissions/shared";
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
import { ConflictPageProvider } from "./conflict/client/ConflictPage.js";

const sheetSlotsTestInfra = definePlugin({
  name: "@vtt/test-conflict-active-filter-slots",
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

const TAB_ID = "tab-conflict-active";

describe("ConflictPage — inactive characters hidden from declare picker", () => {
  it("a character marked active: false does not appear as a party/enemy chip or in the switch-team list", () => {
    const h = buildCharacterHarness({
      plugins: [sheetSlotsTestInfra, systemTorchbearer],
      asGm: true,
      characterName: "Test PC",
      setupWorld: ({ world }) => {
        // An active extra and an inactive extra. Both have Team
        // affiliations and write-everyone permissions so canEdit and
        // the team filter aren't the gating factor.
        world.spawn([
          Character({ name: "Active Helper" }),
          Permissions({ read: everyone(), write: everyone() }),
          Team({ kind: "party" }),
        ]);
        world.spawn([
          Character({ name: "Library Goblin" }),
          Permissions({ read: everyone(), write: everyone() }),
          Team({ kind: "enemy" }),
          Active({ active: false }),
        ]);
      },
    });
    mountWithClient(
      h,
      () =>
        ConflictPageProvider.render({
          tabId: TAB_ID,
          entityId: null,
        }) as never,
    );

    // The active extra is visible. We check for at least one
    // occurrence by literal name; the chip layout has shifted before
    // and this assertion stays robust through it. The character
    // appears in multiple places (party chip + switch-team row), so
    // we use queryAllByText.
    expect(screen.queryAllByText("Active Helper").length).toBeGreaterThan(0);
    // The inactive extra is hidden everywhere on the declare form —
    // chip lists, switch-team picker, etc. — so no DOM node carries
    // its name at all.
    expect(screen.queryAllByText("Library Goblin")).toHaveLength(0);
  });
});
