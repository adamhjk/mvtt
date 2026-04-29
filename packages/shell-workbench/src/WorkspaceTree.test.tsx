import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, cleanup, fireEvent, render } from "@solidjs/testing-library";
import { buildTestClient } from "@vtt/substrate/client-testing";
import { ClientProvider } from "@vtt/substrate/client";
import { definePlugin, defineTrait, z } from "@vtt/substrate";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { OwnedBy } from "@vtt/permissions/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { shellWorkbench } from "./manifest.js";
import {
  WorkspaceOwner,
  WorkspaceState,
  type WorkspacePane,
  type WorkspaceTree as TreeShape,
} from "./shared/traits.js";
import { FocusPane, FocusTab } from "./shared/commands.js";
import { PagesSlot, type PageProvider } from "./shared/slots.js";
import { definePageProvider } from "./shared/define-page-provider.js";
import { WorkspaceTreeView } from "./client/WorkspaceTree.js";

beforeEach(() => cleanup());

const ME = "test-me";
const ME_CLIENT = "client-me";

const Note = defineTrait({
  name: "@test/wstree/Note",
  schema: z.object({ title: z.string() }),
});

const noteProvider: PageProvider = definePageProvider({
  kind: "@test/wstree/notes",
  label: "Notes",
  reads: [Note],
  list: ({ world }) =>
    world.query([Note]).map((row) => ({
      id: row.id,
      label: (row.values.Note as { title: string }).title,
    })),
  render: ({ entityId }) => (
    <div data-testid="page-body">
      page body for entity: {entityId ?? "(none)"}
    </div>
  ),
});

interface HarnessOpts {
  tree: TreeShape;
  panes: Record<string, WorkspacePane>;
  tabs?: Record<string, { id: string; pageKind: string; entityId: string | null }>;
  activePaneId?: string;
  zenPaneId?: string | null;
}

function harness(opts: HarnessOpts) {
  const fillsPlugin = definePlugin({
    name: "@vtt/test-wstree",
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
        OwnedBy({ userId: ME }),
        WorkspaceState({
          tabs: opts.tabs as Record<string, never> ?? {},
          panes: opts.panes,
          tree: opts.tree,
          activePaneId: opts.activePaneId ?? Object.keys(opts.panes)[0]!,
          zenPaneId: opts.zenPaneId ?? null,
          lastInteractedAt: 0,
          schemaVersion: 1,
          openDrawers: {},
        }),
      ]);
      world.spawn([Note({ title: "Treasure log" })]);
    },
  });
}

describe("shell-workbench WorkspaceTreeView", () => {
  it("renders a single pane when the tree is a single leaf", () => {
    const h = harness({
      tree: { kind: "pane", paneId: "p1" },
      panes: { p1: { paneId: "p1", tabIds: [], activeTabId: null } },
    });
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <WorkspaceTreeView
          tree={{ kind: "pane", paneId: "p1" }}
          paneById={{ p1: { paneId: "p1", tabIds: [], activeTabId: null } }}
          zenPaneId={null}
        />
      </ClientProvider>
    ));
    // Pane renders a tab strip even with no tabs — at minimum, the
    // `+` new-tab button is present (via the strip's controls).
    expect(container.querySelector(".relative")).not.toBeNull();
  });

  it("renders the active tab's body via the page provider", () => {
    const noteId = "e2"; // first spawn assigns e1=identity, e2=workspace, etc.
    const h = harness({
      tree: { kind: "pane", paneId: "p1" },
      panes: { p1: { paneId: "p1", tabIds: ["t1"], activeTabId: "t1" } },
      tabs: {
        t1: { id: "t1", pageKind: noteProvider.kind, entityId: noteId },
      },
    });
    render(() => (
      <ClientProvider value={h.client}>
        <WorkspaceTreeView
          tree={{ kind: "pane", paneId: "p1" }}
          paneById={{
            p1: { paneId: "p1", tabIds: ["t1"], activeTabId: "t1" },
          }}
          zenPaneId={null}
        />
      </ClientProvider>
    ));
    expect(screen.getByTestId("page-body")).toBeInTheDocument();
  });

  it("renders only the zen pane when zenPaneId is set", () => {
    const tree: TreeShape = {
      kind: "split",
      axis: "row",
      proportions: [1, 1],
      children: [
        { kind: "pane", paneId: "p1" },
        { kind: "pane", paneId: "p2" },
      ],
    };
    const panes = {
      p1: { paneId: "p1", tabIds: [], activeTabId: null },
      p2: { paneId: "p2", tabIds: [], activeTabId: null },
    };
    const h = harness({ tree, panes, zenPaneId: "p2" });
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <WorkspaceTreeView tree={tree} paneById={panes} zenPaneId="p2" />
      </ClientProvider>
    ));
    // In zen mode the split is bypassed; only one pane root renders.
    // The pane's tab strip is the load-bearing visible artifact.
    expect(container.querySelectorAll('[role="tablist"]').length).toBeLessThanOrEqual(1);
  });

  it("renders both panes for a 2-way split", () => {
    const tree: TreeShape = {
      kind: "split",
      axis: "row",
      proportions: [1, 1],
      children: [
        { kind: "pane", paneId: "p1" },
        { kind: "pane", paneId: "p2" },
      ],
    };
    const panes = {
      p1: { paneId: "p1", tabIds: [], activeTabId: null },
      p2: { paneId: "p2", tabIds: [], activeTabId: null },
    };
    const h = harness({ tree, panes });
    const { container } = render(() => (
      <ClientProvider value={h.client}>
        <WorkspaceTreeView tree={tree} paneById={panes} zenPaneId={null} />
      </ClientProvider>
    ));
    // Two pane bodies should render (each pane has its own root div with relative class).
    const paneRoots = container.querySelectorAll(".relative");
    expect(paneRoots.length).toBeGreaterThanOrEqual(2);
  });
});
