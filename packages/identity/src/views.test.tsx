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
import { screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { buildTestClient, mountWithClient } from "@vtt/substrate/client-testing";
import { definePlugin, defineSurface, z } from "@vtt/substrate";
import { Identity, Name, Online } from "./shared/traits.js";
import { identity } from "./manifest.js";
import { PlayerListView, PresenceHeaderView, UserMenuView } from "./client/views.js";

beforeEach(() => cleanup());

// identity's view declarations target shell-workbench surfaces by name
// only (no value import — shell-workbench depends on identity, can't go
// the other way). For the test we synthesize a tiny stub plugin that
// declares those surfaces so the registry validates.
const workbenchSurfacesStub = definePlugin({
  name: "@vtt/test-workbench-surfaces",
  version: "0.0.0",
  surfaces: [
    defineSurface({
      name: "@vtt/shell-workbench/header",
      kind: "stacked",
      context: z.object({}),
    }),
    defineSurface({
      name: "@vtt/shell-workbench/chat-rail",
      kind: "stacked",
      context: z.object({}),
    }),
  ],
});

const ME_CLIENT = "client-me";

function harness(opts?: { extraPlayers?: boolean }) {
  return buildTestClient({
    plugins: [workbenchSurfacesStub, identity],
    clientId: ME_CLIENT,
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: "me", role: "gm" }),
        Name({ value: "Me" }),
        Online({ clientId: ME_CLIENT, since: Date.now() }),
      ]);
      if (opts?.extraPlayers) {
        world.spawn([
          Identity({ userId: "alice", role: "player" }),
          Name({ value: "Alice" }),
          Online({ clientId: "c-alice", since: Date.now() }),
        ]);
        world.spawn([
          Identity({ userId: "bob", role: "player" }),
          Name({ value: "Bob" }),
          Online({ clientId: "c-bob", since: Date.now() }),
        ]);
      }
    },
  });
}

describe("identity PlayerListView", () => {
  it("renders the connected player names with role badges", () => {
    const h = harness({ extraPlayers: true });
    mountWithClient(h, () => PlayerListView.render({}) as never);
    expect(screen.getByText("Me")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("gm")).toBeInTheDocument();
  });

  it("groups multiple connections from the same userId into one row", () => {
    const h = harness();
    // Spawn a second connection for "me" — same userId, different clientId.
    h.world.spawn([
      Identity({ userId: "me", role: "gm" }),
      Name({ value: "Me" }),
      Online({ clientId: "c-me-2", since: Date.now() }),
    ]);
    mountWithClient(h, () => PlayerListView.render({}) as never);
    // "Me" appears once (grouped); the tab counter shows · 2 tabs.
    const meItems = screen.getAllByText("Me");
    expect(meItems).toHaveLength(1);
    expect(screen.getByText(/2 tabs/)).toBeInTheDocument();
  });

  it("shows the empty state when no one is connected", () => {
    const h = buildTestClient({
      plugins: [workbenchSurfacesStub, identity],
    });
    mountWithClient(h, () => PlayerListView.render({}) as never);
    expect(screen.getByText(/no one connected/i)).toBeInTheDocument();
  });
});

describe("identity PresenceHeaderView", () => {
  it("shows a chip per connected player in the top bar", () => {
    const h = harness({ extraPlayers: true });
    mountWithClient(h, () => PresenceHeaderView.render({}) as never);
    expect(screen.getByTestId("header-presence")).toBeInTheDocument();
    expect(screen.getByTestId("header-presence-me")).toHaveTextContent("Me");
    expect(screen.getByTestId("header-presence-alice")).toHaveTextContent("Alice");
    expect(screen.getByTestId("header-presence-bob")).toHaveTextContent("Bob");
  });

  it("groups multiple connections from one user into a single chip", () => {
    const h = harness();
    h.world.spawn([
      Identity({ userId: "me", role: "gm" }),
      Name({ value: "Me" }),
      Online({ clientId: "c-me-2", since: Date.now() }),
    ]);
    mountWithClient(h, () => PresenceHeaderView.render({}) as never);
    expect(screen.getAllByTestId("header-presence-me")).toHaveLength(1);
    expect(screen.getByTestId("header-presence-me").title).toMatch(/2 tabs/);
  });

  it("renders nothing when no one is connected", () => {
    const h = buildTestClient({
      plugins: [workbenchSurfacesStub, identity],
    });
    const { container } = mountWithClient(h, () => PresenceHeaderView.render({}) as never);
    expect(container.querySelector("[data-testid='header-presence']")).toBeNull();
  });
});

describe("identity UserMenuView", () => {
  it("shows 'signed in as <name>' for the current connection", () => {
    const h = harness();
    mountWithClient(h, () => UserMenuView.render({}) as never);
    expect(screen.getByText(/signed in as/i)).toBeInTheDocument();
    expect(screen.getByText("Me")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument();
  });

  it("falls back to 'connecting…' when no Online entity matches the clientId yet", () => {
    const h = buildTestClient({
      plugins: [workbenchSurfacesStub, identity],
      clientId: "stranger",
    });
    mountWithClient(h, () => UserMenuView.render({}) as never);
    expect(screen.getByText(/connecting…/i)).toBeInTheDocument();
  });

  it("renders the theme switcher beside the logout button", () => {
    const h = harness();
    mountWithClient(h, () => UserMenuView.render({}) as never);
    // Default mode is "system" since localStorage has no entry yet.
    const btn = screen.getByRole("button", { name: /system theme/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("data-theme-mode", "system");
  });
});

describe("identity theme switcher", () => {
  // Reset DOM/state between cases so theme attributes from one test
  // don't leak into the next.
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.removeItem("vtt-theme");
    } catch {
      // ignore
    }
  });

  it("cycles system → light → dark → system on each click", () => {
    const h = harness();
    mountWithClient(h, () => UserMenuView.render({}) as never);
    const btn = screen.getByRole("button", { name: /system theme/i });

    expect(btn).toHaveAttribute("data-theme-mode", "system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);

    fireEvent.click(btn);
    expect(btn).toHaveAttribute("data-theme-mode", "light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    fireEvent.click(btn);
    expect(btn).toHaveAttribute("data-theme-mode", "dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    fireEvent.click(btn);
    expect(btn).toHaveAttribute("data-theme-mode", "system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("persists the selection to localStorage and clears it on system", () => {
    const h = harness();
    mountWithClient(h, () => UserMenuView.render({}) as never);
    const btn = screen.getByRole("button", { name: /system theme/i });

    fireEvent.click(btn); // → light
    expect(localStorage.getItem("vtt-theme")).toBe("light");

    fireEvent.click(btn); // → dark
    expect(localStorage.getItem("vtt-theme")).toBe("dark");

    fireEvent.click(btn); // → system: localStorage entry cleared
    expect(localStorage.getItem("vtt-theme")).toBeNull();
  });

  it("reads the persisted choice on mount so reload restores the theme", () => {
    localStorage.setItem("vtt-theme", "dark");
    const h = harness();
    mountWithClient(h, () => UserMenuView.render({}) as never);
    const btn = screen.getByRole("button", { name: /dark theme/i });
    expect(btn).toHaveAttribute("data-theme-mode", "dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
