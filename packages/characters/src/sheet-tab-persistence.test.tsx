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
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { definePlugin, qualifiedName, type EntityId } from "@vtt/substrate";
import { buildTestClient, mountWithClient } from "@vtt/substrate/client-testing";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "@vtt/notes";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { ownedBy, Permissions } from "@vtt/permissions/shared";
import { TabSentinel, tabSentinelEntityId } from "@vtt/shell-workbench/shared";
import { characters } from "./manifest.js";
import { CharacterSheet } from "./client/CharacterSheet.js";
import {
  Character,
  CharacterSheetTabsSlot,
  CharacterSheetUiState,
  type CharacterSheetTab,
} from "./shared/index.js";

beforeEach(() => cleanup());

const ME = "alice";
const ME_CLIENT = "client-alice";
const TAB_ID = "tab-1";

/**
 * Tiny test plugin contributing three sub-tabs to the character sheet.
 * Each tab body identifies itself by data-testid so we can assert which
 * one is mounted.
 */
function sheetTabsTestPlugin() {
  const tabA: CharacterSheetTab = {
    id: qualifiedName("@test/sheet/alpha") as CharacterSheetTab["id"],
    label: "Alpha",
    priority: 100,
    render: () => <div data-testid="body">alpha</div>,
  };
  const tabB: CharacterSheetTab = {
    id: qualifiedName("@test/sheet/beta") as CharacterSheetTab["id"],
    label: "Beta",
    priority: 50,
    render: () => <div data-testid="body">beta</div>,
  };
  const tabC: CharacterSheetTab = {
    id: qualifiedName("@test/sheet/gamma") as CharacterSheetTab["id"],
    label: "Gamma",
    priority: 10,
    render: () => <div data-testid="body">gamma</div>,
  };
  return definePlugin({
    name: "@test/sheet-tabs",
    version: "0.0.0",
    fills: {
      [CharacterSheetTabsSlot.name]: [tabA, tabB, tabC],
    },
  });
}

interface Setup {
  characterId: EntityId;
  sentinelId: EntityId;
}

function setupHarness(seedActiveTabId: string | null = null) {
  let setup: Setup | undefined;
  const h = buildTestClient({
    plugins: [shellWorkbench, identity, permissions, notes, characters, sheetTabsTestPlugin()],
    clientId: ME_CLIENT,
    session: {
      userId: ME,
      email: "alice@test.dev",
      name: "Alice",
      role: "player",
    },
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: ME, role: "player" }),
        Name({ value: "Alice" }),
        Online({ clientId: ME_CLIENT, since: 0 }),
      ]);
      const characterId = world.allocateId();
      world.spawnAt(characterId, [Character({ name: "Krell" }), Permissions(ownedBy(ME))]);
      const sentinelId = tabSentinelEntityId(TAB_ID);
      world.spawnAt(sentinelId, [
        TabSentinel({ tabId: TAB_ID }),
        Permissions(ownedBy(ME)),
        CharacterSheetUiState({ activeTabId: seedActiveTabId }),
      ]);
      setup = { characterId, sentinelId };
    },
  });
  return { ...h, setup: setup! };
}

describe("CharacterSheet sub-tab persistence", () => {
  it("falls back to the highest-priority tab when no selection is stored", () => {
    const h = setupHarness(null);
    mountWithClient(h, () => <CharacterSheet characterId={h.setup.characterId} tabId={TAB_ID} />);
    expect(screen.getByTestId("body")).toHaveTextContent("alpha");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
  });

  it("uses the seeded activeTabId on first render", () => {
    const h = setupHarness("@test/sheet/beta");
    mountWithClient(h, () => <CharacterSheet characterId={h.setup.characterId} tabId={TAB_ID} />);
    expect(screen.getByTestId("body")).toHaveTextContent("beta");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
  });

  it("clicking a tab dispatches SetSheetUiState with the new active id", () => {
    const h = setupHarness(null);
    mountWithClient(h, () => <CharacterSheet characterId={h.setup.characterId} tabId={TAB_ID} />);
    fireEvent.click(screen.getByRole("tab", { name: "Gamma" }));

    const cmd = h.dispatched.find((c) => c.type === "@vtt/characters/SetSheetUiState");
    expect(cmd).toBeDefined();
    expect((cmd!.payload as { value: { activeTabId: string } }).value.activeTabId).toBe(
      "@test/sheet/gamma",
    );
    // The body re-renders to the newly selected tab via the optimistic
    // local-store update, before the server round-trip even starts.
    expect(screen.getByTestId("body")).toHaveTextContent("gamma");
  });

  it("survives the sheet remounting (the bug being fixed)", async () => {
    // Regression: in the local-signal world the active sub-tab reset
    // every time SheetShell unmounted (navigate-away-and-back, retarget,
    // or any other parent re-render that swaps the wrapper). With the
    // optimistic trait the server-confirmed value is read back on remount.
    const h = setupHarness(null);
    const [mounted, setMounted] = createSignal(true);
    mountWithClient(h, () => (
      <Show when={mounted()}>
        <CharacterSheet characterId={h.setup.characterId} tabId={TAB_ID} />
      </Show>
    ));
    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(screen.getByTestId("body")).toHaveTextContent("beta");

    // The dispatch is async — wait until the mirror system writes the
    // trait into the world before remounting (otherwise the fresh
    // `createOptimisticTrait` reads the still-default value).
    await waitFor(() => {
      const stored = h.world.get(h.setup.sentinelId, [CharacterSheetUiState]) as
        | { SheetUiState: { activeTabId: string | null } }
        | undefined;
      expect(stored?.SheetUiState.activeTabId).toBe("@test/sheet/beta");
    });

    setMounted(false);
    expect(screen.queryByTestId("body")).toBeNull();
    setMounted(true);

    expect(screen.getByTestId("body")).toHaveTextContent("beta");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
  });

  it("falls back to the first tab if the stored id is unknown", () => {
    // Stale id — e.g. the user previously selected a tab from a
    // game-system plugin that's no longer loaded.
    const h = setupHarness("@test/sheet/long-gone");
    mountWithClient(h, () => <CharacterSheet characterId={h.setup.characterId} tabId={TAB_ID} />);
    expect(screen.getByTestId("body")).toHaveTextContent("alpha");
  });
});
