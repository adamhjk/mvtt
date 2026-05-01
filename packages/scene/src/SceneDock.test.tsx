// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup, fireEvent, render } from "@solidjs/testing-library";
import {
  buildTestClient,
} from "@vtt/substrate/client-testing";
import { ClientProvider } from "@vtt/substrate/client";
import {
  definePlugin,
  qualifiedName,
  type World,
} from "@vtt/substrate";
import { EntityVisibility, OwnedBy, everyone } from "@vtt/permissions/shared";
import { shellWorkbench } from "@vtt/shell-workbench";
import { TabSentinel, tabSentinelEntityId } from "@vtt/shell-workbench/shared";
import { notes } from "@vtt/notes";
import { characters } from "@vtt/characters";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { scene } from "./manifest.js";
import { SceneUiState, SetSceneUiState } from "./shared/index.js";
import { SceneOverlayTabsSlot, type SceneOverlayTab } from "./shared/slot.js";
import { SceneDock } from "./client/SceneDock.js";

beforeEach(() => cleanup());

const SCENE_ID = "scene-1";
const TAB_ID = "tab-1";
const ME = "alice";

/**
 * Spawn the per-tab sentinel a `SceneDock` looks up via `useTabSentinel`.
 * In production the workbench's `WorkspaceStateApply` system spawns this
 * on tab open; tests skip workbench commands and seed it directly.
 */
function seedSentinel(
  world: World,
  initial: { dockOpen: boolean; dockActiveId: string | null } = {
    dockOpen: false,
    dockActiveId: null,
  },
): void {
  world.spawnAt(tabSentinelEntityId(TAB_ID), [
    TabSentinel({ tabId: TAB_ID }),
    OwnedBy({ userId: ME }),
    EntityVisibility({ visibility: everyone() }),
    SceneUiState(initial),
  ]);
}

function harness(opts?: { extraTabs?: SceneOverlayTab[] }) {
  const extraTabsPlugin = definePlugin({
    name: "@vtt/test-scene-tabs",
    version: "0.0.0",
    fills: {
      [SceneOverlayTabsSlot.name]: opts?.extraTabs ?? [],
    },
  });
  return buildTestClient({
    plugins: [shellWorkbench, notes, identity, permissions, characters, scene, extraTabsPlugin],
  });
}

function tab(label: string, body: string, priority = 0): SceneOverlayTab {
  return {
    id: qualifiedName(`@test/scene/${label.toLowerCase()}`) as SceneOverlayTab["id"],
    label,
    priority,
    render: () => <div data-testid={`tab-${label}`}>{body}</div>,
  };
}

describe("scene SceneDock", () => {
  it("renders the closed dock with one pill per registered tab", () => {
    const h = harness({ extraTabs: [tab("Custom", "custom body")] });
    seedSentinel(h.world);
    render(() => (
      <ClientProvider value={h.client}>
        <SceneDock sceneId={SCENE_ID} tabId={TAB_ID} />
      </ClientProvider>
    ));
    // Built-in Config + Tokens tabs from the scene plugin should appear
    // alongside the test-injected Custom one.
    expect(screen.getByRole("button", { name: /Config/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tokens/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Custom/i })).toBeInTheDocument();
    // Closed: no tab body shown.
    expect(screen.queryByTestId("tab-Custom")).toBeNull();
  });

  it("clicking a pill dispatches SetSceneUiState with the activated tab", () => {
    const h = harness({ extraTabs: [tab("Custom", "custom body")] });
    seedSentinel(h.world);
    render(() => (
      <ClientProvider value={h.client}>
        <SceneDock sceneId={SCENE_ID} tabId={TAB_ID} />
      </ClientProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: /Custom/i }));

    const dispatched = h.dispatched.find(
      (cmd) => cmd.type === SetSceneUiState.name,
    );
    expect(dispatched).toBeDefined();
    expect(
      (dispatched!.payload as { value: { dockOpen: boolean; dockActiveId: string } }).value,
    ).toEqual({
      dockOpen: true,
      dockActiveId: expect.stringContaining("@test/scene/custom"),
    });
  });

  it("renders the active tab's body when the trait is open with a matching id", () => {
    const h = harness({ extraTabs: [tab("Custom", "custom body")] });
    seedSentinel(h.world, {
      dockOpen: true,
      dockActiveId: "@test/scene/custom",
    });
    render(() => (
      <ClientProvider value={h.client}>
        <SceneDock sceneId={SCENE_ID} tabId={TAB_ID} />
      </ClientProvider>
    ));
    expect(screen.getByTestId("tab-Custom")).toBeInTheDocument();
    expect(screen.getByText("custom body")).toBeInTheDocument();
  });
});
