import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, cleanup, render } from "@solidjs/testing-library";
import { buildTestClient } from "@vtt/substrate/client-testing";
import { ClientProvider } from "@vtt/substrate/client";
import { definePlugin, defineTrait, z } from "@vtt/substrate";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { OwnedBy } from "@vtt/permissions/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { shellWorkbench } from "./manifest.js";
import { WorkspaceOwner, WorkspaceState } from "./shared/traits.js";
import { PagesSlot, type PageProvider } from "./shared/slots.js";
import { definePageProvider } from "./shared/define-page-provider.js";
import { WorkbenchView } from "./client/Workbench.js";

beforeEach(() => cleanup());

const ME = "test-me";
const ME_CLIENT = "client-me";

const Note = defineTrait({
  name: "@test/workbench/Note",
  schema: z.object({ title: z.string() }),
});

const noteProvider: PageProvider = definePageProvider({
  kind: "@test/workbench/notes",
  label: "Notes",
  reads: [Note],
  list: ({ world }) =>
    world.query([Note]).map((row) => ({
      id: row.id,
      label: (row.values.Note as { title: string }).title,
    })),
  render: () => <div data-testid="note-page">a note page</div>,
});

function harness(opts?: { withWorkspaceState?: boolean }) {
  // Mock fetch so the WorldPicker's createResource doesn't trigger
  // the unhandled-promise warning chain in the test runner.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/worlds")) {
      return new Response(
        JSON.stringify({
          worlds: [
            {
              id: "test-world",
              name: "Test World",
              gameSystemPlugin: "@vtt/test",
              ownerUserId: ME,
              createdAt: 0,
              isOwner: true,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/api/game-systems")) {
      return new Response(JSON.stringify({ gameSystems: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  });
  const fillsPlugin = definePlugin({
    name: "@vtt/test-workbench-fills",
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
      if (opts?.withWorkspaceState !== false) {
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
      }
    },
  });
}

describe("shell-workbench WorkbenchView", () => {
  it("renders the header with the mvtt brand and search trigger", () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        {WorkbenchView.render({}) as never}
      </ClientProvider>
    ));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("mvtt");
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });

  it("shows the bootstrap fallback when no WorkspaceState exists yet", () => {
    const h = harness({ withWorkspaceState: false });
    render(() => (
      <ClientProvider value={h.client}>
        {WorkbenchView.render({}) as never}
      </ClientProvider>
    ));
    expect(screen.getByText(/Setting your workspace…/i)).toBeInTheDocument();
  });

  it("mounts the WorkspaceTreeView when WorkspaceState is present", () => {
    const h = harness();
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        {WorkbenchView.render({}) as never}
      </ClientProvider>
    ));
    // Bootstrap fallback should NOT be visible — workspace renders.
    expect(screen.queryByText(/Setting your workspace…/i)).toBeNull();
    // The chat rail renders as an aside element; the main pane renders
    // somewhere in the body. Both indicate the workbench mounted fully.
    expect(container.querySelector("aside")).not.toBeNull();
    expect(container.querySelector("main")).not.toBeNull();
  });
});
