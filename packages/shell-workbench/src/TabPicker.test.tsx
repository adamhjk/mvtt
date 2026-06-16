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
import { definePlugin, defineTrait, z } from "@vtt/substrate";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { actors, Permissions } from "@vtt/permissions/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { shellWorkbench } from "./manifest.js";
import { WorkspaceOwner, WorkspaceState } from "./shared/traits.js";
import { OpenPage, RetargetTab } from "./shared/commands.js";
import { PagesSlot, type PageProvider } from "./shared/slots.js";
import { definePageProvider } from "./shared/define-page-provider.js";
import { TabPicker } from "./client/TabPicker.js";

beforeEach(() => cleanup());

const ME = "test-me";
const ME_CLIENT = "client-me";

const Note = defineTrait({
  name: "@test/tabpicker/Note",
  schema: z.object({ title: z.string() }),
});

const noteProvider: PageProvider = definePageProvider({
  kind: "@test/tabpicker/notes",
  label: "Notes",
  reads: [Note],
  list: ({ world }) =>
    world.query([Note]).map((row) => ({
      id: row.id,
      label: (row.values.Note as { title: string }).title,
    })),
  render: () => null,
});

function harness() {
  const fillsPlugin = definePlugin({
    name: "@vtt/test-tabpicker",
    version: "0.0.0",
    traits: [Note],
    fills: { [PagesSlot.name]: [noteProvider] },
  });
  return buildTestClient({
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
      world.spawn([
        WorkspaceOwner({ userId: ME }),
        Permissions({ read: actors([ME]), write: actors([ME]) }),
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
      world.spawn([Note({ title: "Treasure log" })]);
      world.spawn([Note({ title: "Random NPCs" })]);
    },
  });
}

const ctx = {
  world: undefined as never,
  registry: undefined as never,
  userId: ME,
  role: "player",
};

describe("shell-workbench TabPicker", () => {
  it("renders 'Pick a type' as the kind disclosure when no tab is bound", () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        <TabPicker ctx={{ ...ctx, world: h.world, registry: h.registry }} />
      </ClientProvider>
    ));
    expect(screen.getByText(/Pick a type/i)).toBeInTheDocument();
  });

  it("renders the tab's current kind label and entity label when a tab is bound", () => {
    const h = harness();
    const noteId = h.world.query([Note])[0]!.id;
    render(() => (
      <ClientProvider value={h.client}>
        <TabPicker
          ctx={{ ...ctx, world: h.world, registry: h.registry }}
          tab={{
            id: "tab-1",
            pageKind: noteProvider.kind as never,
            entityId: noteId,
            lastFocusedAt: 0,
          }}
        />
      </ClientProvider>
    ));
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Treasure log")).toBeInTheDocument();
  });

  it("clicking the kind disclosure opens the kind dropdown listing every provider", () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        <TabPicker ctx={{ ...ctx, world: h.world, registry: h.registry }} />
      </ClientProvider>
    ));
    fireEvent.click(screen.getByText(/Pick a type/i));
    // Kind dropdown is portaled to body — Notes appears in it.
    expect(screen.getAllByText("Notes").length).toBeGreaterThan(0);
  });

  it("picking a kind without a tab dispatches OpenPage", () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        <TabPicker ctx={{ ...ctx, world: h.world, registry: h.registry }} />
      </ClientProvider>
    ));
    fireEvent.click(screen.getByText(/Pick a type/i));
    fireEvent.click(screen.getAllByText("Notes")[0]!);
    expect(h.dispatched.some((c) => c.type === OpenPage.name)).toBe(true);
    const open = h.dispatched.find((c) => c.type === OpenPage.name)!;
    expect((open.payload as { pageKind: string }).pageKind).toBe(noteProvider.kind);
  });

  it("picking a kind on a bound tab dispatches RetargetTab instead", () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        <TabPicker
          ctx={{ ...ctx, world: h.world, registry: h.registry }}
          tab={{
            id: "tab-1",
            pageKind: noteProvider.kind as never,
            entityId: null,
            lastFocusedAt: 0,
          }}
        />
      </ClientProvider>
    ));
    // Open kind dropdown via the kind button (it has the label or "Pick a type")
    fireEvent.click(screen.getByText("Notes"));
    // Pick the kind that was already chosen (re-target with same kind)
    const optionLi = screen.getAllByText("Notes").find((n) => n.closest('[role="option"]'));
    if (optionLi) fireEvent.click(optionLi);
    expect(h.dispatched.some((c) => c.type === RetargetTab.name)).toBe(true);
  });

  it("calls onPick instead of dispatching when provided", () => {
    const h = harness();
    let captured: { kind: string; entityId: string | null } | null = null;
    render(() => (
      <ClientProvider value={h.client}>
        <TabPicker
          ctx={{ ...ctx, world: h.world, registry: h.registry }}
          onPick={(kind, entityId) => {
            captured = { kind, entityId };
          }}
        />
      </ClientProvider>
    ));
    fireEvent.click(screen.getByText(/Pick a type/i));
    fireEvent.click(screen.getAllByText("Notes")[0]!);
    expect(captured).toEqual({ kind: noteProvider.kind, entityId: null });
    expect(h.dispatched).toHaveLength(0);
  });
});
