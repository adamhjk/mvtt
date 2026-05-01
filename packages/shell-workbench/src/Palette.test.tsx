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
import {
  defineCommand,
  definePlugin,
  defineTrait,
  ok,
  qualifiedName,
  z,
} from "@vtt/substrate";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { OwnedBy } from "@vtt/permissions/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { shellWorkbench } from "./manifest.js";
import { WorkspaceOwner, WorkspaceState } from "./shared/traits.js";
import { OpenPage, OpenPageInNewTab } from "./shared/commands.js";
import {
  PagesSlot,
  PaletteCommandsSlot,
  type PageProvider,
  type PaletteCommand,
} from "./shared/slots.js";
import { definePageProvider } from "./shared/define-page-provider.js";
import { Palette } from "./client/Palette.js";

beforeEach(() => cleanup());

const ME = "test-me";
const ME_CLIENT = "client-me";

// Synthetic content kind: a "Note" entity with a Name trait. The page
// provider's `list` returns one row per Note, palette can fuzzy-match
// over those rows.
const Note = defineTrait({
  name: "@test/palette/Note",
  schema: z.object({ title: z.string() }),
});

const noteProvider: PageProvider = definePageProvider({
  kind: "@test/palette/notes",
  label: "Notes",
  reads: [Note],
  list: ({ world }) =>
    world.query([Note]).map((row) => ({
      id: row.id,
      label: (row.values.Note as { title: string }).title,
    })),
  render: () => null,
});

// Synthetic palette command: "Toggle GM mode" — returns a no-op
// CommandInstance the palette will dispatch.
const NoopCmd = defineCommand({
  name: "@test/palette/Noop",
  schema: z.object({}),
  validate: () => ok(),
  apply: () => [],
});

const noopVerb: PaletteCommand = {
  id: qualifiedName("@test/palette/toggle-gm-mode") as PaletteCommand["id"],
  label: "Toggle GM mode",
  hint: "GM only",
  run: () => NoopCmd({}),
};

function harness() {
  const fillsPlugin = definePlugin({
    name: "@vtt/test-palette",
    version: "0.0.0",
    traits: [Note],
    commands: [NoopCmd],
    fills: {
      [PagesSlot.name]: [noteProvider],
      [PaletteCommandsSlot.name]: [noopVerb],
    },
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
        OwnedBy({ userId: ME }),
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
      // Three notes so the palette has something to pick from.
      world.spawn([Note({ title: "Treasure log" })]);
      world.spawn([Note({ title: "Session prep" })]);
      world.spawn([Note({ title: "Random NPCs" })]);
    },
  });
}

describe("shell-workbench Palette", () => {
  it("renders nothing when closed", () => {
    const h = harness();
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <Palette open={false} onClose={() => {}} />
      </ClientProvider>
    ));
    expect(container.querySelector('input[type="text"]')).toBeNull();
  });

  it("when open, lists every page from registered providers + palette commands", () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        <Palette open={true} onClose={() => {}} />
      </ClientProvider>
    ));
    expect(screen.getByText("Treasure log")).toBeInTheDocument();
    expect(screen.getByText("Session prep")).toBeInTheDocument();
    expect(screen.getByText("Random NPCs")).toBeInTheDocument();
    expect(screen.getByText("Toggle GM mode")).toBeInTheDocument();
  });

  it("typing filters results via fuzzy match", () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        <Palette open={true} onClose={() => {}} />
      </ClientProvider>
    ));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "treasure" } });
    expect(screen.getByText("Treasure log")).toBeInTheDocument();
    expect(screen.queryByText("Session prep")).toBeNull();
  });

  it("Enter on a page hit dispatches OpenPage with the entity id", () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        <Palette open={true} onClose={() => {}} />
      </ClientProvider>
    ));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "treasure" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const open = h.dispatched.find((c) => c.type === OpenPage.name);
    expect(open).toBeDefined();
    expect(open!.payload).toMatchObject({ pageKind: noteProvider.kind });
  });

  it("Cmd+Enter on a page hit dispatches OpenPageInNewTab", () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        <Palette open={true} onClose={() => {}} />
      </ClientProvider>
    ));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "session" } });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    const newTab = h.dispatched.find((c) => c.type === OpenPageInNewTab.name);
    expect(newTab).toBeDefined();
  });

  it("clicking a palette-command row runs its command via the verb's run fn", () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        <Palette open={true} onClose={() => {}} />
      </ClientProvider>
    ));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Toggle GM" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.dispatched.some((c) => c.type === NoopCmd.name)).toBe(true);
  });

  it("Escape closes the palette via onClose", () => {
    const h = harness();
    let closed = false;
    render(() => (
      <ClientProvider value={h.client}>
        <Palette open={true} onClose={() => { closed = true; }} />
      </ClientProvider>
    ));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(closed).toBe(true);
  });
});
