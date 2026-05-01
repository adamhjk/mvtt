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
import { definePlugin, qualifiedName } from "@vtt/substrate";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { OwnedBy } from "@vtt/permissions/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { shellWorkbench } from "./manifest.js";
import { WorkspaceOwner, WorkspaceState } from "./shared/traits.js";
import {
  WorkbenchDrawersSlot,
  type WorkbenchDrawer,
} from "./shared/slots.js";
import { OpenDrawer, CloseDrawer } from "./shared/commands.js";
import { WorkbenchDrawers } from "./client/Drawers.js";

beforeEach(() => cleanup());

const ME = "test-me";
const ME_CLIENT = "client-me";

function harness(opts?: {
  drawers?: WorkbenchDrawer[];
  openDrawers?: Record<string, { openedAt: number; keepOpen?: boolean }>;
}) {
  const drawerPlugin = definePlugin({
    name: "@vtt/test-drawers",
    version: "0.0.0",
    fills: {
      [WorkbenchDrawersSlot.name]: opts?.drawers ?? [],
    },
  });
  return buildTestClient({
    plugins: [identity, permissions, shellWorkbench, drawerPlugin],
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
      world.spawn([
        WorkspaceOwner({ userId: ME }),
        OwnedBy({ userId: ME }),
        WorkspaceState({
          tabs: {},
          panes: { p1: { paneId: "p1", tabIds: [], activeTabId: null } },
          tree: { kind: "pane", paneId: "p1" },
          activePaneId: "p1",
          zenPaneId: null,
          lastInteractedAt: 0,
          schemaVersion: 1,
          openDrawers: Object.fromEntries(
            Object.entries(opts?.openDrawers ?? {}).map(([id, st]) => [
              id,
              { openedAt: st.openedAt, keepOpen: st.keepOpen ?? false },
            ]),
          ),
        }),
      ]);
    },
  });
}

function drawer(label: string, body: string, opts?: Partial<WorkbenchDrawer>): WorkbenchDrawer {
  return {
    id: qualifiedName(`@test/drawers/${label.toLowerCase()}`) as WorkbenchDrawer["id"],
    label,
    edge: "bottom",
    icon: "▢",
    priority: 50,
    render: () => <div data-testid={`drawer-${label}`}>{body}</div>,
    ...opts,
  };
}

describe("shell-workbench Drawers", () => {
  it("renders nothing when no drawers are registered for the bottom edge", () => {
    const h = harness();
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <WorkbenchDrawers />
      </ClientProvider>
    ));
    // No bottom drawers → no aside.
    expect(container.querySelector("aside")).toBeNull();
  });

  it("renders one tab per registered bottom drawer", () => {
    const h = harness({
      drawers: [
        drawer("Tray", "tray body"),
        drawer("Notes", "notes body"),
      ],
    });
    render(() => (
      <ClientProvider value={h.client}>
        <WorkbenchDrawers />
      </ClientProvider>
    ));
    expect(screen.getByRole("button", { name: /Tray/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Notes/i })).toBeInTheDocument();
  });

  it("clicking an inactive tab dispatches OpenDrawer with keepOpen:true", () => {
    const h = harness({
      drawers: [drawer("Tray", "tray body")],
    });
    render(() => (
      <ClientProvider value={h.client}>
        <WorkbenchDrawers />
      </ClientProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: /Tray/i }));
    const open = h.dispatched.find((c) => c.type === OpenDrawer.name);
    expect(open).toBeDefined();
    expect(open!.payload).toMatchObject({
      id: "@test/drawers/tray",
      keepOpen: true,
    });
  });

  it("renders the active drawer body when its id is in openDrawers", () => {
    const id = "@test/drawers/tray";
    const h = harness({
      drawers: [drawer("Tray", "tray body")],
      openDrawers: { [id]: { openedAt: Date.now(), keepOpen: true } },
    });
    render(() => (
      <ClientProvider value={h.client}>
        <WorkbenchDrawers />
      </ClientProvider>
    ));
    expect(screen.getByTestId("drawer-Tray")).toBeInTheDocument();
    expect(screen.getByText("tray body")).toBeInTheDocument();
  });

  it("clicking a tab while another drawer is open closes the other first", () => {
    const trayId = "@test/drawers/tray";
    const h = harness({
      drawers: [drawer("Tray", "tray body"), drawer("Notes", "notes body")],
      openDrawers: { [trayId]: { openedAt: Date.now(), keepOpen: true } },
    });
    render(() => (
      <ClientProvider value={h.client}>
        <WorkbenchDrawers />
      </ClientProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: /Notes/i }));
    // CloseDrawer for tray + OpenDrawer for notes (in some order).
    expect(
      h.dispatched.some(
        (c) =>
          c.type === CloseDrawer.name &&
          (c.payload as { id: string }).id === trayId,
      ),
    ).toBe(true);
    expect(
      h.dispatched.some(
        (c) =>
          c.type === OpenDrawer.name &&
          (c.payload as { id: string }).id === "@test/drawers/notes",
      ),
    ).toBe(true);
  });
});
