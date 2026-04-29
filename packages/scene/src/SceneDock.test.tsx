import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, render } from "@solidjs/testing-library";
import {
  buildTestClient,
} from "@vtt/substrate/client-testing";
import { ClientProvider } from "@vtt/substrate/client";
import { definePlugin, qualifiedName } from "@vtt/substrate";
import { shellWorkbench } from "@vtt/shell-workbench";
import { notes } from "@vtt/notes";
import { characters } from "@vtt/characters";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { scene } from "./manifest.js";
import { SceneOverlayTabsSlot, type SceneOverlayTab } from "./shared/slot.js";
import { SceneDock } from "./client/SceneDock.js";

beforeEach(() => cleanup());

const SCENE_ID = "scene-1";

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
    const setUiState = vi.fn();
    render(() => (
      <ClientProvider value={h.client}>
        <SceneDock sceneId={SCENE_ID} uiState={{}} setUiState={setUiState} />
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

  it("clicking a pill writes the open + active id into uiState", () => {
    const h = harness({ extraTabs: [tab("Custom", "custom body")] });
    const setUiState = vi.fn();
    render(() => (
      <ClientProvider value={h.client}>
        <SceneDock sceneId={SCENE_ID} uiState={{}} setUiState={setUiState} />
      </ClientProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: /Custom/i }));
    expect(setUiState).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneDockOpen: true,
        sceneDockActive: expect.stringContaining("@test/scene/custom"),
      }),
    );
  });

  it("renders the active tab's body when uiState.sceneDockOpen is true", () => {
    const h = harness({ extraTabs: [tab("Custom", "custom body")] });
    const setUiState = vi.fn();
    render(() => (
      <ClientProvider value={h.client}>
        <SceneDock
          sceneId={SCENE_ID}
          uiState={{
            sceneDockOpen: true,
            sceneDockActive: "@test/scene/custom",
          }}
          setUiState={setUiState}
        />
      </ClientProvider>
    ));
    expect(screen.getByTestId("tab-Custom")).toBeInTheDocument();
    expect(screen.getByText("custom body")).toBeInTheDocument();
  });
});
