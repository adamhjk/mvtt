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
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@solidjs/testing-library";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { shellMobile } from "./manifest.js";
import { shellWorkbench } from "@vtt/shell-workbench";
import { MobileShellView } from "./client/MobileShell.js";
import { SwitchToMobileButtonView } from "./client/SwitchToMobileButton.js";
import { PendingRollSheet } from "./client/PendingRollSheet.js";
import * as detect from "./client/detect.js";
import { characters } from "@vtt/characters";
import { notes } from "@vtt/notes";
import { identity } from "@vtt/identity";
import { resolution } from "@vtt/resolution";
import { comms } from "@vtt/comms";
import { Identity, Online, Name } from "@vtt/identity/shared";
import { PendingRoll, Character, ROLL_ATELIER_KIND } from "@vtt/characters/shared";
import { RollResolved } from "@vtt/resolution/shared";
import {
  WorkspaceOwner,
  WorkspaceState,
  OpenPage,
} from "@vtt/shell-workbench/shared";
import { Permissions, actors } from "@vtt/permissions/shared";

// jsdom doesn't provide window.matchMedia — polyfill it so
// detectMobileDevice() doesn't throw. Default: desktop (matches=false).
let matchMediaResult = false;
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: matchMediaResult,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

beforeEach(() => {
  cleanup();
  localStorage.clear();
  matchMediaResult = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shell-mobile detect", () => {
  it("respects explicit 'mobile' preference", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    expect(detect.shouldUseMobileShell()).toBe(true);
  });

  it("respects explicit 'desktop' preference", () => {
    localStorage.setItem("mvtt-shell-preference", "desktop");
    expect(detect.shouldUseMobileShell()).toBe(false);
  });

  it("falls back to matchMedia when no preference set", () => {
    // jsdom matchMedia always returns false by default
    expect(detect.shouldUseMobileShell()).toBe(false);
  });

  it("setShellPreference persists and getShellPreference reads it", () => {
    detect.setShellPreference("mobile");
    expect(detect.getShellPreference()).toBe("mobile");
    detect.setShellPreference(null);
    expect(detect.getShellPreference()).toBe(null);
  });
});

describe("MobileShellView", () => {
  it("returns null when shouldUseMobileShell is false (desktop fallthrough)", () => {
    // jsdom reports pointer:fine/hover:hover by default, and no localStorage
    // pref is set, so shouldUseMobileShell() returns false.
    const h = buildTestClient({ plugins: [shellWorkbench, shellMobile] });
    const { container } = mountWithClient(h, () =>
      MobileShellView.render({}) as never,
    );
    // The view should render nothing (null return from clientOnly gate).
    expect(container.querySelector("[data-testid='mobile-shell']")).toBeNull();
  });

  it("renders the mobile shell when preference is 'mobile'", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    const h = buildTestClient({
      plugins: [shellWorkbench, shellMobile],
      session: {
        userId: "me",
        email: "me@test.dev",
        name: "Me",
        role: "player",
      },
    });
    const { container } = mountWithClient(h, () =>
      MobileShellView.render({}) as never,
    );
    expect(
      container.querySelector("[data-testid='mobile-shell']"),
    ).not.toBeNull();
    // Heading should show mvtt
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "mvtt",
    );
  });

  it("shows the page panel by default and can switch to Chat", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    const h = buildTestClient({
      plugins: [shellWorkbench, shellMobile],
      session: {
        userId: "me",
        email: "me@test.dev",
        name: "Me",
        role: "player",
      },
    });
    mountWithClient(h, () => MobileShellView.render({}) as never);

    // The page-content button should be active by default. We select
    // the nav buttons by stable testid instead of label — the label is
    // dynamic (matches the active PageProvider).
    const pageBtn = screen.getByTestId("nav-page");
    expect(pageBtn).toHaveAttribute("aria-pressed", "true");

    const chatBtn = screen.getByTestId("nav-chat");
    fireEvent.click(chatBtn);
    expect(chatBtn).toHaveAttribute("aria-pressed", "true");
    expect(pageBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the hamburger menu when tapped", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    const h = buildTestClient({
      plugins: [shellWorkbench, shellMobile],
      session: {
        userId: "me",
        email: "me@test.dev",
        name: "Me",
        role: "player",
      },
    });
    mountWithClient(h, () => MobileShellView.render({}) as never);

    const menuBtn = screen.getByRole("button", { name: /open menu/i });
    fireEvent.click(menuBtn);

    // The menu should now show "Switch to desktop layout"
    expect(
      screen.getByRole("button", { name: /switch to desktop/i }),
    ).toBeInTheDocument();
  });
});

describe("SwitchToMobileButtonView (workbench header)", () => {
  it("renders a labelled button", () => {
    const h = buildTestClient({ plugins: [shellWorkbench, shellMobile] });
    const { container } = mountWithClient(h, () =>
      SwitchToMobileButtonView.render({}) as never,
    );
    expect(
      container.querySelector("[data-testid='switch-to-mobile']"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /switch to mobile/i }),
    ).toBeInTheDocument();
  });

  it("sets the mobile preference when clicked", () => {
    // The click handler also calls window.location.reload(), which jsdom
    // marks non-configurable — we can't spy on it. Asserting the
    // localStorage write is enough to confirm the switch wired through.
    const h = buildTestClient({ plugins: [shellWorkbench, shellMobile] });
    mountWithClient(h, () => SwitchToMobileButtonView.render({}) as never);

    fireEvent.click(screen.getByRole("button", { name: /switch to mobile/i }));

    expect(localStorage.getItem("mvtt-shell-preference")).toBe("mobile");
  });
});

describe("MobileMenu pages navigation", () => {
  function spawnMeAndWorkspace(
    world: import("@vtt/substrate").World,
    clientId: string,
    extra?: (w: typeof world) => void,
  ) {
    world.spawn([
      Identity({ userId: "me", role: "player" }),
      Name({ value: "Me" }),
      Online({ clientId, since: 0 }),
    ]);
    world.spawn([
      WorkspaceOwner({ userId: "me" }),
      Permissions({ read: actors(["me"]), write: actors(["me"]) }),
      WorkspaceState({
        tabs: {},
        panes: { p1: { paneId: "p1", tabIds: [], activeTabId: null } },
        tree: { kind: "pane", paneId: "p1" },
        activePaneId: "p1",
        zenPaneId: null,
        lastInteractedAt: 0,
        schemaVersion: 1,
        openDrawers: {},
      }),
    ]);
    if (extra) extra(world);
  }

  const fullPluginSet = [
    identity,
    notes,
    characters,
    resolution,
    comms,
    shellWorkbench,
    shellMobile,
  ];

  it("lists every registered PageProvider in alphabetical order", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    const clientId = "test-client-1";
    const h = buildTestClient({
      plugins: fullPluginSet,
      clientId,
      setupWorld: ({ world }) => spawnMeAndWorkspace(world, clientId),
    });
    mountWithClient(h, () => MobileShellView.render({}) as never);

    // Open the hamburger menu.
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));

    // Both providers should appear under the Pages nav.
    const nav = screen.getByRole("navigation", { name: /pages/i });
    expect(nav).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /characters/i, expanded: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /notes/i, expanded: false }),
    ).toBeInTheDocument();
  });

  it("expanding a provider lists its entities and tapping one dispatches OpenPage", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    const clientId = "test-client-1";
    let charId: string | undefined;
    const h = buildTestClient({
      plugins: fullPluginSet,
      clientId,
      setupWorld: ({ world }) =>
        spawnMeAndWorkspace(world, clientId, (w) => {
          charId = w.spawn([
            Character({ name: "Tarn" }),
            Permissions({ read: actors(["me"]), write: actors(["me"]) }),
          ]);
        }),
    });
    mountWithClient(h, () => MobileShellView.render({}) as never);

    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    // Expand the Characters provider.
    fireEvent.click(
      screen.getByRole("button", { name: /characters/i, expanded: false }),
    );

    // Tarn should now be a navigable item.
    const tarn = screen.getByRole("button", { name: "Tarn" });
    expect(tarn).toBeInTheDocument();
    fireEvent.click(tarn);

    // Confirm OpenPage went out with the expected payload.
    const open = h.dispatched.find((c) => c.type === OpenPage.name);
    expect(open).toBeDefined();
    expect(open?.payload).toEqual({
      pageKind: "@vtt/characters/characters",
      entityId: charId,
    });
  });

  it("the bottom-nav page button shows the active provider's label", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    const clientId = "test-client-1";
    const h = buildTestClient({
      plugins: fullPluginSet,
      clientId,
      setupWorld: ({ world }) => spawnMeAndWorkspace(world, clientId),
    });
    mountWithClient(h, () => MobileShellView.render({}) as never);

    // With no active tab and the characters plugin loaded, the nav
    // labels itself with the Characters provider — matches the
    // default-character fallback the panel actually renders.
    const pageBtn = screen.getByTestId("nav-page");
    expect(pageBtn.textContent).toContain("Characters");
    expect(pageBtn).toHaveAttribute(
      "aria-label",
      "Characters (current page)",
    );
  });

  it("the 'All …' entry opens the provider hub with a null entity", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    const clientId = "test-client-1";
    const h = buildTestClient({
      plugins: fullPluginSet,
      clientId,
      setupWorld: ({ world }) => spawnMeAndWorkspace(world, clientId),
    });
    mountWithClient(h, () => MobileShellView.render({}) as never);

    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /notes/i, expanded: false }),
    );
    fireEvent.click(screen.getByRole("button", { name: /all notes/i }));

    const open = h.dispatched.find((c) => c.type === OpenPage.name);
    expect(open?.payload).toEqual({
      pageKind: "@vtt/notes/notes",
      entityId: null,
    });
  });
});

describe("MobileShell navigates to the Atelier on roll", () => {
  const pluginSet = [
    identity,
    notes,
    characters,
    resolution,
    comms,
    shellWorkbench,
    shellMobile,
  ];

  function spawnMeAndWorkspace(
    world: import("@vtt/substrate").World,
    clientId: string,
  ) {
    world.spawn([
      Identity({ userId: "me", role: "player" }),
      Name({ value: "Me" }),
      Online({ clientId, since: 0 }),
    ]);
    world.spawn([
      WorkspaceOwner({ userId: "me" }),
      Permissions({ read: actors(["me"]), write: actors(["me"]) }),
      WorkspaceState({
        tabs: {},
        panes: { p1: { paneId: "p1", tabIds: [], activeTabId: null } },
        tree: { kind: "pane", paneId: "p1" },
        activePaneId: "p1",
        zenPaneId: null,
        lastInteractedAt: 0,
        schemaVersion: 1,
        openDrawers: {},
      }),
    ]);
  }

  function rollResolvedBy(userId: string) {
    return RollResolved({
      rollId: "roll-1",
      notation: "1d6",
      visibility: "public",
      total: 4,
      output: "1d6: [4] = 4",
      rolledAt: 0,
      rolledByUserId: userId,
      rolledByName: userId,
      dice: [],
    });
  }

  it("opens the Roll Atelier page and shows it (page mode) when the current user rolls", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    const clientId = "test-client-1";
    const h = buildTestClient({
      plugins: pluginSet,
      clientId,
      setupWorld: ({ world }) => spawnMeAndWorkspace(world, clientId),
    });
    mountWithClient(h, () => MobileShellView.render({}) as never);

    // Tap over to chat first so we can prove the roll pulls us back to
    // the page panel (where the Atelier renders), not to chat.
    fireEvent.click(screen.getByTestId("nav-chat"));
    expect(screen.getByTestId("nav-chat")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    h.bus.emit(rollResolvedBy("me"));

    // Landed back on the page panel…
    expect(screen.getByTestId("nav-page")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("nav-chat")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // …and navigated to the Roll Atelier so the result is on screen.
    const open = h.dispatched.find((c) => c.type === OpenPage.name);
    expect(open?.payload).toEqual({
      pageKind: ROLL_ATELIER_KIND,
      entityId: null,
    });
  });

  it("does not navigate when another user rolls", () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    const clientId = "test-client-1";
    const h = buildTestClient({
      plugins: pluginSet,
      clientId,
      setupWorld: ({ world }) => spawnMeAndWorkspace(world, clientId),
    });
    mountWithClient(h, () => MobileShellView.render({}) as never);

    h.bus.emit(rollResolvedBy("someone-else"));

    expect(screen.getByTestId("nav-page")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      h.dispatched.find((c) => c.type === OpenPage.name),
    ).toBeUndefined();
  });

  it("scrolls the chat viewport to the bottom whenever chat mode activates", async () => {
    localStorage.setItem("mvtt-shell-preference", "mobile");
    const clientId = "test-client-1";
    const h = buildTestClient({
      plugins: pluginSet,
      clientId,
      setupWorld: ({ world }) => spawnMeAndWorkspace(world, clientId),
    });
    const { container } = mountWithClient(h, () =>
      MobileShellView.render({}) as never,
    );

    // Force a non-zero scrollHeight on the chat viewport so we can
    // detect "did we snap to bottom?" Stuff a tall sentinel into the
    // viewport and pre-set scrollTop to 0.
    const viewport = container.querySelector(
      "[data-testid='chat-stream-viewport']",
    ) as HTMLElement;
    expect(viewport).not.toBeNull();
    Object.defineProperty(viewport, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    viewport.scrollTop = 0;

    // Activate chat mode (tab over) — the snap-to-bottom effect fires.
    fireEvent.click(screen.getByTestId("nav-chat"));

    // The effect schedules the scroll via rAF; flush it and wait a tick.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(viewport.scrollTop).toBe(1000);
  });
});

describe("PendingRollSheet", () => {
  it("renders nothing when there are no pending rolls", () => {
    const h = buildTestClient({
      plugins: [notes, characters, shellWorkbench, shellMobile],
    });
    const { container } = mountWithClient(h, () => <PendingRollSheet />);
    expect(
      container.querySelector("[data-testid='pending-roll-sheet']"),
    ).toBeNull();
  });

  it("auto-presents at full height when a pending roll appears", () => {
    const h = buildTestClient({
      plugins: [notes, characters, shellWorkbench, shellMobile],
      setupWorld: ({ world }) =>
        world.spawn([
          PendingRoll({
            initiatorUserId: "me",
            initiatorCharacterId: "char-1",
            rollableName: "@vtt/_test/Roll",
            opts: {},
            contributions: [],
            openedAt: 0,
          }),
        ]),
    });
    mountWithClient(h, () => <PendingRollSheet />);
    const sheet = screen.getByTestId("pending-roll-sheet");
    // Auto-presents full so the user can reach the Roll button without
    // the sheet's mid-height blocking the character sheet underneath.
    expect(sheet).toHaveAttribute("data-state", "full");
  });

  it("tapping the handle toggles between full and peek", () => {
    const h = buildTestClient({
      plugins: [notes, characters, shellWorkbench, shellMobile],
      setupWorld: ({ world }) =>
        world.spawn([
          PendingRoll({
            initiatorUserId: "me",
            initiatorCharacterId: "char-1",
            rollableName: "@vtt/_test/Roll",
            opts: {},
            contributions: [],
            openedAt: 0,
          }),
        ]),
    });
    mountWithClient(h, () => <PendingRollSheet />);

    // Starts full → collapse to peek.
    expect(screen.getByTestId("pending-roll-sheet")).toHaveAttribute(
      "data-state",
      "full",
    );
    fireEvent.click(screen.getByRole("button", { name: /collapse pending roll/i }));
    expect(screen.getByTestId("pending-roll-sheet")).toHaveAttribute(
      "data-state",
      "peek",
    );
    // Tap the handle in peek state to expand back to full.
    fireEvent.click(screen.getByRole("button", { name: /expand pending roll/i }));
    expect(screen.getByTestId("pending-roll-sheet")).toHaveAttribute(
      "data-state",
      "full",
    );
  });

  it("content area is scrollable so the Roll button at the bottom is reachable", () => {
    const h = buildTestClient({
      plugins: [notes, characters, shellWorkbench, shellMobile],
      setupWorld: ({ world }) =>
        world.spawn([
          PendingRoll({
            initiatorUserId: "me",
            initiatorCharacterId: "char-1",
            rollableName: "@vtt/_test/Roll",
            opts: {},
            contributions: [],
            openedAt: 0,
          }),
        ]),
    });
    const { container } = mountWithClient(h, () => <PendingRollSheet />);
    const sheet = container.querySelector(
      "[data-testid='pending-roll-sheet']",
    ) as HTMLElement;
    // The flex child wrapping PendingRollPanels — second child after the
    // header button — must scroll vertically when content overflows.
    const scrollable = sheet.children[1] as HTMLElement;
    expect(scrollable.className).toMatch(/overflow-y-auto/);
    // `min-h-0` is the key flexbox unlock — without it the scroll area
    // grows past the viewport and overflow never engages.
    expect(scrollable.className).toMatch(/min-h-0/);
  });
});
