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
  tabs?: Record<
    string,
    { id: string; pageKind: string; entityId: string | null; lastFocusedAt?: number }
  >;
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
      // Backfill `lastFocusedAt` on any test-supplied tab that omits
      // it — the schema requires it but the per-test inline tab
      // literals predate the field and shouldn't have to repeat it.
      const tabsIn = opts.tabs ?? {};
      const tabs: Record<string, never> = {};
      for (const [k, t] of Object.entries(tabsIn)) {
        (tabs as Record<string, unknown>)[k] = {
          ...t,
          lastFocusedAt: t.lastFocusedAt ?? 0,
        };
      }
      world.spawn([
        WorkspaceOwner({ userId: ME }),
        Permissions({ read: actors([ME]), write: actors([ME]) }),
        WorkspaceState({
          tabs,
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

  it("the Pane subtree's DOM identity survives a `tree` reference change in a split (For-vs-Index regression)", async () => {
    // Repro for the bug where SplitNode's `<For each={split.children}>`
    // keyed children by reference. Every WorkspaceState clone (FocusPane,
    // OpenPage, bumpInteracted) does `structuredClone(state.tree)`, so
    // `split.children` got fresh entries — For sees new refs → unmounts
    // every child wrapper → Pane unmounts → PdfReader unmounts → pdfjs
    // reloads and snaps the viewer back to page 1. The fix uses `<Index>`
    // (keys by position) so identity survives the clone.
    const noteId = "e2";
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
      p1: { paneId: "p1", tabIds: ["t1"], activeTabId: "t1" },
      p2: { paneId: "p2", tabIds: [], activeTabId: null },
    };
    const tabs = {
      t1: { id: "t1", pageKind: noteProvider.kind, entityId: noteId },
    };
    const h = harness({ tree, panes, tabs });
    const { createSignal } = await import("solid-js");
    const [treeSig, setTree] = createSignal<TreeShape>(tree);
    const [paneByIdSig, setPaneById] = createSignal<
      Record<string, WorkspacePane>
    >(panes);
    render(() => (
      <ClientProvider value={h.client}>
        <WorkspaceTreeView
          tree={treeSig()}
          paneById={paneByIdSig()}
          zenPaneId={null}
        />
      </ClientProvider>
    ));
    const before = screen.getByTestId("page-body");
    // Clone everything — exactly what FocusPane's apply does.
    setTree(structuredClone(tree));
    setPaneById({
      p1: { paneId: "p1", tabIds: ["t1"], activeTabId: "t1" },
      p2: { paneId: "p2", tabIds: [], activeTabId: null },
    });
    const after = screen.getByTestId("page-body");
    expect(after).toBe(before);
  });

  it("the Pane subtree's DOM identity survives a `paneById` reference change with the same pane shape", async () => {
    // Repro for the bug where FocusPane (or any other WorkspaceState
    // mutation that re-clones panes) used to remount every Pane via the
    // IIFE pattern in <Show fallback={...}>. Mounting a fresh Pane
    // tears down PdfReader and reloads pdfjs.getDocument, snapping the
    // user back to page 1. The fix moves the per-branch JSX into stable
    // child components (PaneLeaf / SplitBranch).
    const noteId = "e2";
    const h = harness({
      tree: { kind: "pane", paneId: "p1" },
      panes: { p1: { paneId: "p1", tabIds: ["t1"], activeTabId: "t1" } },
      tabs: {
        t1: { id: "t1", pageKind: noteProvider.kind, entityId: noteId },
      },
    });
    const { createSignal } = await import("solid-js");
    const [paneById, setPaneById] = createSignal<Record<string, WorkspacePane>>(
      { p1: { paneId: "p1", tabIds: ["t1"], activeTabId: "t1" } },
    );
    render(() => (
      <ClientProvider value={h.client}>
        <WorkspaceTreeView
          tree={{ kind: "pane", paneId: "p1" }}
          paneById={paneById()}
          zenPaneId={null}
        />
      </ClientProvider>
    ));
    const before = screen.getByTestId("page-body");
    // Replace paneById with a fresh dict whose pane object is also a
    // fresh reference — exactly what FocusPane does via clone().
    setPaneById({ p1: { paneId: "p1", tabIds: ["t1"], activeTabId: "t1" } });
    const after = screen.getByTestId("page-body");
    expect(after).toBe(before);
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
