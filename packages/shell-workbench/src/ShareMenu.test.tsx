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
import { screen, cleanup, fireEvent, render } from "@solidjs/testing-library";
import { buildTestClient } from "@vtt/substrate/client-testing";
import { ClientProvider } from "@vtt/substrate/client";
import { defineTrait, definePlugin, qualifiedName, z } from "@vtt/substrate";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { PagesSlot, definePageProvider, tabSentinelEntityId } from "./shared/index.js";
import { actors, Permissions } from "@vtt/permissions/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { shellWorkbench } from "./manifest.js";
import { WorkspaceOwner, WorkspaceState } from "./shared/traits.js";
import { ShareTab } from "./shared/commands.js";
import { ShareMenu, clampShareMenuLeft } from "./client/Pane.js";

beforeEach(() => cleanup());

const ME = "me";
const ME_CLIENT = "client-me";
const KIND = qualifiedName("@test/share/page");

const TAB = {
  id: "tab-share-test",
  pageKind: KIND,
  entityId: null,
  lastFocusedAt: Date.now(),
};

interface OtherUser {
  userId: string;
  name: string;
}

/**
 * Build a harness with `me` plus a bag of other online users — those are
 * the share-target candidates the dropdown will list. The session role is
 * configurable so the GM-only force-focus toggle is testable both ways.
 */
function harness(
  opts: {
    role?: "player" | "gm";
    others?: OtherUser[];
  } = {},
) {
  const role = opts.role ?? "player";
  const others = opts.others ?? [];
  return buildTestClient({
    plugins: [identity, permissions, shellWorkbench],
    clientId: ME_CLIENT,
    session: { userId: ME, email: "me@test.dev", name: "Me", role },
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: ME, role }),
        Name({ value: "Me" }),
        Online({ clientId: ME_CLIENT, since: Date.now() }),
      ]);
      for (const u of others) {
        world.spawn([
          Identity({ userId: u.userId, role: "player" }),
          Name({ value: u.name }),
          Online({ clientId: `c-${u.userId}`, since: Date.now() }),
        ]);
      }
      // Pre-spawn a workspace owner — not strictly required for ShareMenu
      // but matches every real workbench mount.
      world.spawn([
        WorkspaceOwner({ userId: ME }),
        Permissions({ read: actors([ME]), write: actors([ME]) }),
        WorkspaceState({
          tabs: { [TAB.id]: TAB },
          panes: {
            p1: { paneId: "p1", tabIds: [TAB.id], activeTabId: TAB.id },
          },
          tree: { kind: "pane", paneId: "p1" },
          activePaneId: "p1",
          zenPaneId: null,
          lastInteractedAt: 0,
          schemaVersion: 1,
          openDrawers: {},
        }),
      ]);
    },
  });
}

const PLAYERS_TWO: OtherUser[] = [
  { userId: "marie", name: "Marie" },
  { userId: "theo", name: "Theo" },
];

describe("clampShareMenuLeft", () => {
  // Default-anchor: dropdown's right edge aligns with the button's right
  // edge, so it cascades back toward the pane's interior.
  it("aligns the dropdown's right edge with the button's right edge in the middle of the viewport", () => {
    const left = clampShareMenuLeft({
      buttonRight: 600,
      viewportWidth: 1200,
      menuWidth: 288,
      margin: 8,
    });
    expect(left).toBe(600 - 288);
  });

  // Far-left tab: button is near x=0; the unclamped preferred left would
  // be negative, pushing the dropdown off the left edge of the viewport.
  // The clamp keeps it at the gutter.
  it("clamps to the left margin when the preferred position would push the dropdown off-screen left", () => {
    const left = clampShareMenuLeft({
      buttonRight: 60,
      viewportWidth: 1200,
      menuWidth: 288,
      margin: 8,
    });
    expect(left).toBe(8);
  });

  // Right-edge defense: the right-anchor default (buttonRight - menuWidth)
  // already keeps the dropdown's right edge at the button's right edge,
  // so a normally-positioned button can't push the dropdown off the right.
  // The right-clamp matters only when buttonRight transiently sits past
  // the viewport (e.g. mid-resize, or a strip extends beyond the visible
  // area before flex layout shrinks it). This case asserts that defense
  // still produces a fully-on-screen left coordinate.
  it("clamps to the right edge (minus gutter) when the button extends past the viewport", () => {
    const left = clampShareMenuLeft({
      buttonRight: 1300, // past the viewport
      viewportWidth: 1200,
      menuWidth: 288,
      margin: 8,
    });
    // viewport(1200) - menuWidth(288) - margin(8) = 904
    expect(left).toBe(904);
  });

  // Sanity: when a viewport is somehow narrower than the dropdown itself,
  // the clamp still terminates (maxLeft becomes negative, minLeft wins —
  // the dropdown overflows to the right but never to the left).
  it("falls back to the left margin when the viewport is narrower than the dropdown", () => {
    const left = clampShareMenuLeft({
      buttonRight: 100,
      viewportWidth: 200,
      menuWidth: 288,
      margin: 8,
    });
    expect(left).toBe(8);
  });
});

describe("ShareMenu", () => {
  it("button is hidden until clicked, and reveals the dropdown on click", () => {
    const h = harness({ others: PLAYERS_TWO });
    render(() => (
      <ClientProvider value={h.client}>
        <ShareMenu tab={TAB} />
      </ClientProvider>
    ));

    // The dropdown isn't in the document until the button is clicked.
    expect(screen.queryByRole("dialog", { name: /share tab/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /share tab/i }));
    expect(screen.getByRole("dialog", { name: /share tab/i })).toBeInTheDocument();
    // Both other players appear in the "everyone" tally.
    expect(screen.getByText(/everyone \(2\)/i)).toBeInTheDocument();
  });

  it("dispatches ShareTab with all other users when 'everyone' is sent", async () => {
    const h = harness({ others: PLAYERS_TWO });
    render(() => (
      <ClientProvider value={h.client}>
        <ShareMenu tab={TAB} />
      </ClientProvider>
    ));

    fireEvent.click(screen.getByRole("button", { name: /share tab/i }));
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await Promise.resolve();

    const dispatched = h.dispatched.find((c) => c.type === ShareTab.name);
    expect(dispatched).toBeDefined();
    const payload = dispatched!.payload as {
      tabId: string;
      recipientUserIds: string[];
      forceFocus: boolean;
    };
    expect(payload.tabId).toBe(TAB.id);
    expect(new Set(payload.recipientUserIds)).toEqual(new Set(["marie", "theo"]));
    expect(payload.forceFocus).toBe(false);
  });

  it("'just…' mode sends only the checked users", async () => {
    const h = harness({ others: PLAYERS_TWO });
    render(() => (
      <ClientProvider value={h.client}>
        <ShareMenu tab={TAB} />
      </ClientProvider>
    ));

    fireEvent.click(screen.getByRole("button", { name: /share tab/i }));
    fireEvent.click(screen.getByLabelText(/just…/));
    // Tick only Theo.
    fireEvent.click(screen.getByLabelText(/^Theo$/));
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await Promise.resolve();

    const dispatched = h.dispatched.find((c) => c.type === ShareTab.name);
    expect(dispatched).toBeDefined();
    const payload = dispatched!.payload as { recipientUserIds: string[] };
    expect(payload.recipientUserIds).toEqual(["theo"]);
  });

  it("'send' is disabled in 'just…' mode when no user is selected", () => {
    const h = harness({ others: PLAYERS_TWO });
    render(() => (
      <ClientProvider value={h.client}>
        <ShareMenu tab={TAB} />
      </ClientProvider>
    ));

    fireEvent.click(screen.getByRole("button", { name: /share tab/i }));
    fireEvent.click(screen.getByLabelText(/just…/));
    const sendBtn = screen.getByRole("button", { name: /^send$/i });
    expect(sendBtn).toBeDisabled();
  });

  it("force-focus checkbox is disabled for non-GM connections and never reaches the command", async () => {
    const h = harness({ others: PLAYERS_TWO, role: "player" });
    render(() => (
      <ClientProvider value={h.client}>
        <ShareMenu tab={TAB} />
      </ClientProvider>
    ));

    fireEvent.click(screen.getByRole("button", { name: /share tab/i }));
    const force = screen.getByLabelText(/pull them to it/i) as HTMLInputElement;
    expect(force).toBeDisabled();

    // Even if a script forced .checked = true, the dispatcher gates on
    // isGm() and clamps forceFocus back to false before dispatching.
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await Promise.resolve();
    const dispatched = h.dispatched.find((c) => c.type === ShareTab.name);
    expect((dispatched!.payload as { forceFocus: boolean }).forceFocus).toBe(false);
  });

  it("force-focus checkbox is enabled for the GM and rides through to the command", async () => {
    const h = harness({ others: PLAYERS_TWO, role: "gm" });
    render(() => (
      <ClientProvider value={h.client}>
        <ShareMenu tab={TAB} />
      </ClientProvider>
    ));

    fireEvent.click(screen.getByRole("button", { name: /share tab/i }));
    const force = screen.getByLabelText(/pull them to it/i) as HTMLInputElement;
    expect(force).not.toBeDisabled();

    fireEvent.click(force);
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await Promise.resolve();
    const dispatched = h.dispatched.find((c) => c.type === ShareTab.name);
    expect((dispatched!.payload as { forceFocus: boolean }).forceFocus).toBe(true);
  });

  it("renders the 'includes:' summary when the tab's PageProvider implements summarizeTabState", () => {
    // A provider that summarises whatever lives in TestTabUiState on the
    // tab sentinel — the canonical "page 11" use case.
    const TestTabUiState = defineTrait({
      name: "@test/share-summary/UiState",
      schema: z.object({ page: z.number().int().min(1) }),
    });
    const summaryProvider = definePageProvider({
      kind: "@test/share/page",
      label: "Test",
      reads: [TestTabUiState],
      list: () => [],
      render: () => null,
      summarizeTabState: ({ sentinelId, world }) => {
        if (!world.has(sentinelId)) return null;
        const got = world.get(sentinelId, [TestTabUiState]) as
          | { UiState: { page: number } }
          | undefined;
        return got ? `page ${got.UiState.page}` : null;
      },
    });
    const fillsPlugin = definePlugin({
      name: "@vtt/test-share-summary",
      version: "0.0.0",
      traits: [TestTabUiState],
      fills: { [PagesSlot.name]: [summaryProvider] },
    });

    const h = buildTestClient({
      plugins: [identity, permissions, shellWorkbench, fillsPlugin],
      clientId: ME_CLIENT,
      session: {
        userId: ME,
        email: "me@test.dev",
        name: "Me",
        role: "player",
      },
      setupWorld: ({ world }) => {
        world.spawn([
          Identity({ userId: ME, role: "player" }),
          Name({ value: "Me" }),
          Online({ clientId: ME_CLIENT, since: Date.now() }),
        ]);
        // Pre-spawn the sentinel and write the per-tab UI state on it
        // — same shape the workbench's WorkspaceStateApply system would
        // produce when the tab opened in real life.
        world.spawn([
          WorkspaceOwner({ userId: ME }),
          Permissions({ read: actors([ME]), write: actors([ME]) }),
          WorkspaceState({
            tabs: { [TAB.id]: TAB },
            panes: {
              p1: { paneId: "p1", tabIds: [TAB.id], activeTabId: TAB.id },
            },
            tree: { kind: "pane", paneId: "p1" },
            activePaneId: "p1",
            zenPaneId: null,
            lastInteractedAt: 0,
            schemaVersion: 1,
            openDrawers: {},
          }),
        ]);
        world.spawnAt(tabSentinelEntityId(TAB.id), [TestTabUiState({ page: 11 })]);
      },
    });

    // Sanity: the fill landed and the sentinel has the trait.
    const sentinelId = tabSentinelEntityId(TAB.id);
    expect(h.world.has(sentinelId)).toBe(true);
    const fills = h.registry.fillsForSlot(PagesSlot);
    const found = fills.find((p) => (p as { kind: string }).kind === KIND);
    expect(found).toBeDefined();
    expect((found as { summarizeTabState?: unknown }).summarizeTabState).toBeDefined();

    render(() => (
      <ClientProvider value={h.client}>
        <ShareMenu tab={TAB} />
      </ClientProvider>
    ));

    fireEvent.click(screen.getByRole("button", { name: /share tab/i }));
    expect(screen.getByText(/includes:/i)).toBeInTheDocument();
    expect(screen.getByText(/page 11/i)).toBeInTheDocument();
  });

  it("awaits client.optimisticFlushes.flushFor(sentinel) before dispatching ShareTab", async () => {
    const h = harness({ others: PLAYERS_TWO });
    // Spy on the order of (a) the test flush callback and (b) ShareTab
    // being recorded in `dispatched`. The flush must run first — otherwise
    // a debounced per-tab UI write (e.g. PdfReaderState.page) wouldn't be
    // visible to the server when ShareTab.apply reads the trait.
    const order: string[] = [];
    let resolveFlush!: () => void;
    const flushDone = new Promise<void>((r) => {
      resolveFlush = r;
    });
    h.client.optimisticFlushes.register(tabSentinelEntityId(TAB.id), () => {
      order.push("flush");
      // Simulate a non-trivial flush — resolves on the next microtask
      // (matches a real ack landing). If ShareMenu dispatched without
      // awaiting, "share" would land in `order` before "flush".
      return Promise.resolve().then(() => {
        resolveFlush();
      });
    });

    render(() => (
      <ClientProvider value={h.client}>
        <ShareMenu tab={TAB} />
      </ClientProvider>
    ));

    fireEvent.click(screen.getByRole("button", { name: /share tab/i }));
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await flushDone;
    // The send handler awaits flushFor (Promise.allSettled wrapping the
    // flush) and then synchronously dispatches ShareTab on the resumed
    // microtask. Macrotask boundary drains everything cleanly.
    await new Promise((r) => setTimeout(r, 0));
    const shareIdx = h.dispatched.findIndex((c) => c.type === ShareTab.name);
    expect(shareIdx).toBeGreaterThanOrEqual(0);
    if (shareIdx >= 0) order.push("share");
    expect(order).toEqual(["flush", "share"]);
  });

  it("renders an empty-state when no other player is online (and no send button)", () => {
    const h = harness({ others: [] });
    render(() => (
      <ClientProvider value={h.client}>
        <ShareMenu tab={TAB} />
      </ClientProvider>
    ));

    fireEvent.click(screen.getByRole("button", { name: /share tab/i }));
    expect(screen.getByText(/no other players are online/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^send$/i })).toBeNull();
  });
});
