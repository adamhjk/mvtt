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
import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { definePlugin, type EntityId } from "@vtt/substrate";
import { buildCharacterHarness, mountWithClient } from "@vtt/characters/testing";
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
import {
  AssignLightCoverage,
  GRIND_SENTINEL_ID,
  Grind,
  LightCoverage,
  TbCarries,
  TbMonster,
  TbNpc,
} from "./shared/index.js";

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
interface Ids {
  alice: EntityId;
}

function harness(): { h: ReturnType<typeof buildCharacterHarness>; ids: Ids } {
  let alice!: EntityId;
  const h = buildCharacterHarness({
    plugins: [sheetSlotsTestInfra, systemTorchbearer],
    asGm: true,
    characterName: "Tarn",
    setupWorld: ({ world, characterId }) => {
      // The grind sentinel holds the LightCoverage trait the mirror writes to.
      world.spawnAt(GRIND_SENTINEL_ID, [Grind({ turn: 0 }), LightCoverage({ assignments: {} })]);
      // Named GM presence so the assign button's GM gate resolves.
      world.spawn([
        Identity({ userId: "test-me", role: "gm" }),
        Name({ value: "GM" }),
        Online({ clientId: "test-client-1", since: 1 }),
      ]);
      // A second player character.
      alice = world.spawn([Character({ name: "Alice" })]) as EntityId;
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
  return { h, ids: { alice } };
}

describe("LightTracker — player-character filtering", () => {
  it("the holder is always lit, so only uncovered non-bearers are dark", () => {
    const { h } = harness();
    mountWithClient(h, () => LightTrackerStatusItem.render() as never);

    // Tarn holds the torch → always in full light; only Alice is dark.
    // The goblin and barkeep carry Character but must not inflate the count.
    const toggle = screen.getByTestId("light-tracker-toggle");
    expect(toggle).toHaveTextContent("1 dark");
    expect(toggle).not.toHaveTextContent("2 dark");
  });

  it("the holder never appears in the In Darkness list", () => {
    const { h } = harness();
    mountWithClient(h, () => LightTrackerStatusItem.render() as never);
    fireEvent.click(screen.getByTestId("light-tracker-toggle"));

    const panel = screen.getByTestId("light-tracker-panel");
    // Alice is dark; Tarn (the bearer) is not.
    expect(within(panel).getByText("Alice")).toBeInTheDocument();
    const darkBadges = within(panel).queryAllByText("Tarn");
    // "Tarn" only appears as the source's "held by Tarn" label, never as a
    // darkness/dim badge.
    expect(darkBadges.length).toBeLessThanOrEqual(1);
  });

  it("the coverage editor shows the holder as a fixed bearer chip, others as toggles", () => {
    const { h } = harness();
    mountWithClient(h, () => LightTrackerStatusItem.render() as never);

    fireEvent.click(screen.getByTestId("light-tracker-toggle"));
    fireEvent.click(screen.getByTestId("light-edit-coverage"));

    // The holder is a disabled bearer chip, NOT a toggle button.
    const chip = screen.getByTestId("light-holder-chip");
    expect(chip).toHaveTextContent("Tarn");
    expect(chip.tagName).not.toBe("BUTTON");

    // Alice gets a toggle in both the full and dim editors.
    const fullEditor = screen.getByTestId("light-full-editor");
    const dimEditor = screen.getByTestId("light-dim-editor");
    expect(within(fullEditor).getByRole("button", { name: /Alice/ })).toBeInTheDocument();
    expect(within(dimEditor).getByRole("button", { name: /Alice/ })).toBeInTheDocument();
    // Tarn is not a toggle in the full editor (it's the chip).
    expect(within(fullEditor).queryByRole("button", { name: /Tarn/ })).toBeNull();
    // The monster and NPC never appear.
    expect(within(fullEditor).queryByRole("button", { name: /Goblin/ })).toBeNull();
    expect(within(dimEditor).queryByRole("button", { name: /Barkeep/ })).toBeNull();
  });
});

describe("LightTracker — assigning coverage", () => {
  it("dispatches AssignLightCoverage with BOTH arrays when toggling dim", async () => {
    const { h, ids } = harness();
    mountWithClient(h, () => LightTrackerStatusItem.render() as never);

    fireEvent.click(screen.getByTestId("light-tracker-toggle"));
    fireEvent.click(screen.getByTestId("light-edit-coverage"));
    const dimEditor = screen.getByTestId("light-dim-editor");
    fireEvent.click(within(dimEditor).getByRole("button", { name: /Alice/ }));

    const last = h.dispatched.at(-1)!;
    expect(last.type).toBe(AssignLightCoverage.name);
    const payload = last.payload as {
      coveredCharacterIds: EntityId[];
      dimCharacterIds: EntityId[];
    };
    expect(payload.dimCharacterIds).toEqual([ids.alice]);
    // Both arrays are present so the full ring is never clobbered.
    expect(payload.coveredCharacterIds).toEqual([]);

    // The pipeline applied it: Alice now shows in the Dim Light section.
    const dimSection = await screen.findByTestId("light-dim-section");
    expect(within(dimSection).getByText("Alice")).toBeInTheDocument();
  });

  it("moving a character into full light removes them from the dim ring", () => {
    const { h, ids } = harness();
    mountWithClient(h, () => LightTrackerStatusItem.render() as never);

    fireEvent.click(screen.getByTestId("light-tracker-toggle"));
    fireEvent.click(screen.getByTestId("light-edit-coverage"));
    // First put Alice in dim…
    fireEvent.click(
      within(screen.getByTestId("light-dim-editor")).getByRole("button", {
        name: /Alice/,
      }),
    );
    // …then promote her to full light.
    fireEvent.click(
      within(screen.getByTestId("light-full-editor")).getByRole("button", {
        name: /Alice/,
      }),
    );

    const last = h.dispatched.at(-1)!;
    const payload = last.payload as {
      coveredCharacterIds: EntityId[];
      dimCharacterIds: EntityId[];
    };
    expect(payload.coveredCharacterIds).toContain(ids.alice);
    expect(payload.dimCharacterIds).not.toContain(ids.alice);
  });
});

describe("LightTracker — robustness", () => {
  it("uses an opaque surface token for the panel (regression: transparent pop-up)", () => {
    const { h } = harness();
    mountWithClient(h, () => LightTrackerStatusItem.render() as never);
    fireEvent.click(screen.getByTestId("light-tracker-toggle"));

    const panel = screen.getByTestId("light-tracker-panel");
    expect(panel).toHaveClass("bg-surface-elevated");
    expect(panel).not.toHaveClass("bg-surface-raised");
  });

  it("keeps the editor open when an unrelated light source recomputes", () => {
    const { h, ids } = harness();
    mountWithClient(h, () => LightTrackerStatusItem.render() as never);

    fireEvent.click(screen.getByTestId("light-tracker-toggle"));
    fireEvent.click(screen.getByTestId("light-edit-coverage"));
    expect(screen.getByTestId("light-coverage-editor")).toBeInTheDocument();

    // Give Alice her own lit torch — this rebuilds litSources() objects and
    // recreates the <For> rows. The open editor must survive (open state is
    // held in the parent, keyed by src.key).
    const otherTorch = h.world.spawn([ItemIdentity({ name: "Torch" })]);
    h.world.set(ids.alice, TbCarries, {
      entries: [
        {
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: otherTorch as EntityId,
          quantity: 1,
          state: { lit: true, turnsRemaining: 5 },
        },
      ],
    });

    expect(screen.getByTestId("light-coverage-editor")).toBeInTheDocument();
  });
});
