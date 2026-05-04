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

import { describe, it, expect, beforeEach } from "vitest";
import {
  CommandPipeline,
  EventBus,
  Registry,
  World,
  defineTrait,
  definePlugin,
  runSystemsToFixpoint,
  z,
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { actors, Permissions } from "@vtt/permissions/shared";
import { PlayerJoined } from "@vtt/identity/shared";
import {
  TabSentinel,
  WorkspaceState,
  WorkspaceOwner,
} from "./shared/traits.js";
import { tabSentinelEntityId } from "./shared/tab-sentinel.js";
import {
  WorkspaceBootstrapped,
  WorkspaceStateChanged,
} from "./shared/events.js";
import {
  CloseDrawer,
  CloseTab,
  FocusPane,
  FocusTab,
  MoveTab,
  OpenDrawer,
  OpenPage,
  OpenPageAsSplit,
  OpenPageInNewTab,
  ResizeDrawer,
  RetargetTab,
  SetDrawerKeepOpen,
  SetSplitProportions,
  ShareTab,
  ToggleDrawer,
  ToggleZen,
  allCommands,
} from "./shared/commands.js";
import { TabShared } from "./shared/events.js";
import {
  TabSharedApplySystem,
  WorkspaceBootstrapSystem,
  WorkspaceStateApplySystem,
} from "./server/systems.js";
import { definePageProvider } from "./shared/define-page-provider.js";

const PLAYER: AuthSession = {
  userId: "player-1",
  email: "p@test.dev",
  name: "Player",
  role: "player",
};

const PLAYER_2: AuthSession = {
  userId: "player-2",
  email: "p2@test.dev",
  name: "Player Two",
  role: "player",
};

const GM: AuthSession = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

/**
 * Stand-in for a per-plugin per-tab UI-state trait. ShareTab gathers traits
 * with `share: true` (default) off the sender's tab sentinel and replays
 * them on the recipient's; this trait verifies that path end-to-end without
 * pulling a real plugin (notes/pdf-book) into the workbench's tests.
 */
const TestTabUiState = defineTrait({
  name: "@test/share/UiState",
  schema: z.object({ activePage: z.number().int().min(1) }),
});

/**
 * Stand-in for a trait that opts out of sharing. ShareTab must not copy
 * this onto the recipient's sentinel even though it's attached to the
 * sender's. Mirrors the role of TabSentinel/Permissions but
 * keeps the workbench tests free of cross-plugin imports.
 */
const TestPrivateState = defineTrait({
  name: "@test/share/Private",
  schema: z.object({ secret: z.string() }),
  share: false,
});

/**
 * Build a minimal server-side world: registry loaded with everything we
 * need to drive bootstrap + every command. Uses the *real* substrate +
 * permissions + identity primitives so tests exercise the same
 * machinery production runs.
 */
function setup() {
  const workbenchPlugin = definePlugin({
    name: "@vtt/shell-workbench",
    version: "0.1.0",
    traits: [
      WorkspaceState,
      WorkspaceOwner,
      TabSentinel,
      Permissions,
      TestTabUiState,
      TestPrivateState,
    ],
    events: [PlayerJoined, WorkspaceStateChanged, WorkspaceBootstrapped, TabShared],
    commands: [...allCommands],
    systems: [
      WorkspaceBootstrapSystem,
      WorkspaceStateApplySystem,
      TabSharedApplySystem,
    ],
    entityVisibility: (traits) => {
      const p = traits[Permissions.name] as
        | { read: import("@vtt/substrate").Visibility }
        | undefined;
      return p?.read ?? null;
    },
  });
  const registry = new Registry();
  registry.load(workbenchPlugin);
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  return { registry, world, bus, pipeline };
}

function bootstrap(
  registry: Registry,
  world: World,
  userId = PLAYER.userId,
): EntityId {
  // Drive PlayerJoined through the system runner — same as the substrate
  // does on a real ConnectionOpened-spawned PlayerJoined emission.
  runSystemsToFixpoint(registry, world, [
    PlayerJoined({
      playerId: `${userId}-player`,
      userId,
      name: "Player",
      role: "player",
      clientId: `c-${userId}`,
    }),
  ]);
  // Locate the freshly-spawned WorkspaceOwner.
  const found = world
    .query([WorkspaceOwner])
    .find((row) => (row.values.WorkspaceOwner as { userId: string }).userId === userId);
  if (!found) throw new Error("bootstrap should have spawned an owner");
  return found.id;
}

let cmdSeq = 0;
async function dispatch(
  pipeline: CommandPipeline,
  cmd: CommandInstance,
  session: unknown = PLAYER,
) {
  return pipeline.dispatch({
    id: `cmd-${++cmdSeq}`,
    issuedBy: "tester",
    issuedAt: Date.now(),
    cmd,
    session,
  });
}

function getState(world: World, ownerId: EntityId) {
  const got = world.get(ownerId, [WorkspaceState]) as
    | { WorkspaceState: import("zod").z.infer<typeof WorkspaceState.schema> }
    | undefined;
  if (!got) throw new Error("no workspace state");
  return got.WorkspaceState;
}

const KIND = "@vtt/test/things";
const KIND_2 = "@vtt/test/others";

// — schema —————————————————————————————————————————————————————

describe("@vtt/shell-workbench schemas", () => {
  it("uses plugin-namespaced ubiquitous-language names", () => {
    expect(WorkspaceState.name).toBe("@vtt/shell-workbench/WorkspaceState");
    expect(WorkspaceOwner.name).toBe("@vtt/shell-workbench/WorkspaceOwner");
    expect(WorkspaceStateChanged.name).toBe(
      "@vtt/shell-workbench/WorkspaceStateChanged",
    );
    expect(OpenPage.name).toBe("@vtt/shell-workbench/OpenPage");
    expect(OpenPageInNewTab.name).toBe(
      "@vtt/shell-workbench/OpenPageInNewTab",
    );
    expect(OpenPageAsSplit.name).toBe("@vtt/shell-workbench/OpenPageAsSplit");
    expect(CloseTab.name).toBe("@vtt/shell-workbench/CloseTab");
    expect(RetargetTab.name).toBe("@vtt/shell-workbench/RetargetTab");
    expect(FocusTab.name).toBe("@vtt/shell-workbench/FocusTab");
    expect(FocusPane.name).toBe("@vtt/shell-workbench/FocusPane");
    expect(ToggleZen.name).toBe("@vtt/shell-workbench/ToggleZen");
    expect(MoveTab.name).toBe("@vtt/shell-workbench/MoveTab");
    expect(SetSplitProportions.name).toBe(
      "@vtt/shell-workbench/SetSplitProportions",
    );
  });

  it("WorkspaceStateChanged event is transient and broadcast", () => {
    expect(WorkspaceStateChanged.transient).toBe(true);
    expect(WorkspaceStateChanged.broadcast).toBe(true);
  });

  it("WorkspaceBootstrapped event is transient and not broadcast", () => {
    expect(WorkspaceBootstrapped.transient).toBe(true);
    expect(WorkspaceBootstrapped.broadcast).toBe(false);
  });

  it("rejects an invalid pane proportion at the trait layer", () => {
    expect(() =>
      WorkspaceState({
        tabs: {},
        panes: {
          a: { paneId: "a", tabIds: [], activeTabId: null },
          b: { paneId: "b", tabIds: [], activeTabId: null },
        },
        tree: {
          kind: "split",
          axis: "row",
          children: [
            { kind: "pane", paneId: "a" },
            { kind: "pane", paneId: "b" },
          ],
          // Negative proportion — invalid.
          proportions: [-1, 1],
        },
        activePaneId: "a",
        zenPaneId: null,
        lastInteractedAt: 0,
        schemaVersion: 1,
      }),
    ).toThrow();
  });

  it("rejects a split with fewer than two children", () => {
    expect(() =>
      WorkspaceState({
        tabs: {},
        panes: { a: { paneId: "a", tabIds: [], activeTabId: null } },
        tree: {
          kind: "split",
          axis: "row",
          children: [{ kind: "pane", paneId: "a" }],
          proportions: [1],
        },
        activePaneId: "a",
        zenPaneId: null,
        lastInteractedAt: 0,
        schemaVersion: 1,
      }),
    ).toThrow();
  });

  it("OpenPage rejects a malformed pageKind at schema layer", () => {
    expect(() =>
      OpenPage({ pageKind: "not-a-qualified-name", entityId: null }),
    ).toThrow();
  });

  it("definePageProvider brands the kind into a QualifiedName", () => {
    const p = definePageProvider({
      kind: "@vtt/test/things",
      label: "Things",
      reads: [],
      list: () => [],
      render: () => null,
    });
    expect(p.kind).toBe("@vtt/test/things");
    expect(p.label).toBe("Things");
  });

  it("definePageProvider carries the declared trait reads through", () => {
    const p = definePageProvider({
      kind: "@vtt/test/things",
      label: "Things",
      reads: [WorkspaceState],
      list: () => [],
      render: () => null,
    });
    expect(p.reads).toEqual([WorkspaceState]);
  });

  it("definePageProvider throws on a non-qualified kind", () => {
    expect(() =>
      definePageProvider({
        kind: "things",
        label: "Things",
        reads: [],
        list: () => [],
        render: () => null,
      }),
    ).toThrow();
  });
});

// — bootstrap system ——————————————————————————————————————————————

describe("WorkspaceBootstrapSystem", () => {
  it("PlayerJoined spawns one WorkspaceOwner per user with private visibility", () => {
    const { registry, world } = setup();
    const ownerId = bootstrap(registry, world);
    const got = world.get(ownerId, [
      WorkspaceOwner,
      Permissions,
      WorkspaceState,
    ]) as {
      WorkspaceOwner: { userId: string };
      Permissions: {
        read: { kind: string; userIds?: string[] };
        write: { kind: string; userIds?: string[] };
      };
      WorkspaceState: import("zod").z.infer<typeof WorkspaceState.schema>;
    };
    expect(got.WorkspaceOwner.userId).toBe(PLAYER.userId);
    expect(got.Permissions.read.kind).toBe("users");
    expect(got.Permissions.read.userIds).toEqual([PLAYER.userId]);
    expect(got.Permissions.write.kind).toBe("users");
    expect(got.Permissions.write.userIds).toEqual([PLAYER.userId]);
    // Default workspace: one pane, no tabs, that pane is active, no zen.
    expect(Object.keys(got.WorkspaceState.panes)).toHaveLength(1);
    expect(got.WorkspaceState.tabs).toEqual({});
    expect(got.WorkspaceState.zenPaneId).toBeNull();
  });

  it("re-firing PlayerJoined for the same user is a no-op (idempotent)", () => {
    const { registry, world } = setup();
    bootstrap(registry, world);
    runSystemsToFixpoint(registry, world, [
      PlayerJoined({
        playerId: "p-2",
        userId: PLAYER.userId,
        name: "Player",
        role: "player",
        clientId: "c2",
      }),
    ]);
    const owners = world.query([WorkspaceOwner]).filter(
      (r) => (r.values.WorkspaceOwner as { userId: string }).userId === PLAYER.userId,
    );
    expect(owners).toHaveLength(1);
  });

  it("two distinct users get two distinct owner entities", () => {
    const { registry, world } = setup();
    bootstrap(registry, world, "u-1");
    bootstrap(registry, world, "u-2");
    const owners = world.query([WorkspaceOwner]);
    expect(owners).toHaveLength(2);
  });
});

// — apply system ——————————————————————————————————————————————————

describe("WorkspaceStateApplySystem", () => {
  it("WorkspaceStateChanged replaces the WorkspaceState trait on the owner entity", () => {
    const { registry, world } = setup();
    const ownerId = bootstrap(registry, world);
    const before = getState(world, ownerId);
    const updated = { ...before, lastInteractedAt: 999_999 };
    runSystemsToFixpoint(registry, world, [
      WorkspaceStateChanged({
        ownerEntityId: ownerId,
        userId: PLAYER.userId,
        next: updated,
      }),
    ]);
    expect(getState(world, ownerId).lastInteractedAt).toBe(999_999);
  });

  it("WorkspaceStateChanged for a non-existent entity is a no-op", () => {
    const { registry, world } = setup();
    const ownerId = bootstrap(registry, world);
    const stateBefore = getState(world, ownerId);
    runSystemsToFixpoint(registry, world, [
      WorkspaceStateChanged({
        ownerEntityId: "ghost-entity",
        userId: PLAYER.userId,
        next: { ...stateBefore, lastInteractedAt: 1 },
      }),
    ]);
    // Original owner untouched.
    expect(getState(world, ownerId).lastInteractedAt).toBe(
      stateBefore.lastInteractedAt,
    );
  });

  it("spawns a TabSentinel for each tab that appears in WorkspaceState.tabs", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    expect(world.query([TabSentinel])).toHaveLength(0);

    const res = await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND, entityId: "ent-1" as EntityId }),
    );
    expect(res.result.ok).toBe(true);

    const tabId = Object.keys(getState(world, ownerId).tabs)[0]!;
    const sentinelId = tabSentinelEntityId(tabId);
    expect(world.has(sentinelId)).toBe(true);
    const got = world.get(sentinelId, [TabSentinel, Permissions]) as {
      TabSentinel: { tabId: string };
      Permissions: {
        read: { kind: string; userIds?: string[] };
        write: { kind: string; userIds?: string[] };
      };
    };
    expect(got.TabSentinel.tabId).toBe(tabId);
    expect(got.Permissions.read.kind).toBe("users");
    expect(got.Permissions.read.userIds).toEqual([PLAYER.userId]);
    expect(got.Permissions.write.kind).toBe("users");
    expect(got.Permissions.write.userIds).toEqual([PLAYER.userId]);
  });

  it("despawns a TabSentinel when its tab is closed", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world);

    await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND, entityId: "ent-1" as EntityId }),
    );
    const sentinels = world.query([TabSentinel]);
    expect(sentinels).toHaveLength(1);
    const sentinelId = sentinels[0]!.id;
    const tabId = (sentinels[0]!.values.TabSentinel as { tabId: string }).tabId;

    // Find the pane the tab lives in.
    const ownerRow = world.query([WorkspaceOwner])[0]!;
    const state = (
      world.get(ownerRow.id, [WorkspaceState]) as { WorkspaceState: import("zod").z.infer<typeof WorkspaceState.schema> }
    ).WorkspaceState;
    const paneId = Object.values(state.panes).find((p) => p.tabIds.includes(tabId))!.paneId;

    const res = await dispatch(pipeline, CloseTab({ paneId, tabId }));
    expect(res.result.ok).toBe(true);
    expect(world.has(sentinelId)).toBe(false);
    expect(world.query([TabSentinel])).toHaveLength(0);
  });

  it("preserves a TabSentinel when its tab moves between panes", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world);

    // Open one tab, then split — moving the tab into the new pane.
    await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND, entityId: "ent-1" as EntityId }),
    );
    const beforeSentinels = world.query([TabSentinel]);
    expect(beforeSentinels).toHaveLength(1);
    const tabId = (beforeSentinels[0]!.values.TabSentinel as { tabId: string }).tabId;
    const sentinelIdBefore = beforeSentinels[0]!.id;

    // Open a second tab in a new split — first sentinel must persist.
    await dispatch(
      pipeline,
      OpenPageAsSplit({
        pageKind: KIND_2,
        entityId: "ent-2" as EntityId,
        direction: "right",
      }),
    );
    expect(world.has(sentinelIdBefore)).toBe(true);
    expect(world.query([TabSentinel])).toHaveLength(2);

    // The original tab id is unchanged — same sentinel.
    const stillThere = world
      .query([TabSentinel])
      .find((row) => (row.values.TabSentinel as { tabId: string }).tabId === tabId);
    expect(stillThere?.id).toBe(sentinelIdBefore);
  });

  it("spawns the sentinel BEFORE WorkspaceState fires its subscribers — Solid views querying the sentinel from a WorkspaceState reactor must find it already in the world", () => {
    const { registry, world } = setup();
    const ownerId = bootstrap(registry, world);
    const before = getState(world, ownerId);
    const tabId = "tab-race-test";
    const next = {
      ...before,
      tabs: { [tabId]: { id: tabId, pageKind: KIND, entityId: null } },
    };
    // Hook the WorkspaceState write — when the trait fires its
    // subscribers, the sentinel MUST already exist. (In production
    // this is what Solid's `useTrait` reactivity does inline.)
    let sentinelExistsWhenWsFires: boolean | null = null;
    const off = world.subscribe((id, traitName) => {
      if (id !== ownerId || traitName !== WorkspaceState.name) return;
      sentinelExistsWhenWsFires = world.has(tabSentinelEntityId(tabId));
    });
    runSystemsToFixpoint(registry, world, [
      WorkspaceStateChanged({ ownerEntityId: ownerId, userId: PLAYER.userId, next }),
    ]);
    off();
    expect(sentinelExistsWhenWsFires).toBe(true);
  });

  it("is idempotent — replaying the same WorkspaceStateChanged does not double-spawn", () => {
    const { registry, world } = setup();
    const ownerId = bootstrap(registry, world);
    const before = getState(world, ownerId);
    const tabId = "tab-X";
    const next = {
      ...before,
      tabs: { [tabId]: { id: tabId, pageKind: KIND, entityId: null } },
    };
    runSystemsToFixpoint(registry, world, [
      WorkspaceStateChanged({ ownerEntityId: ownerId, userId: PLAYER.userId, next }),
    ]);
    runSystemsToFixpoint(registry, world, [
      WorkspaceStateChanged({ ownerEntityId: ownerId, userId: PLAYER.userId, next }),
    ]);
    expect(world.query([TabSentinel])).toHaveLength(1);
    expect(world.has(tabSentinelEntityId(tabId))).toBe(true);
  });
});

// — commands ——————————————————————————————————————————————————————

describe("commands (require a WorkspaceOwner — bootstrap-on-join precondition)", () => {
  it("OpenPage rejects without a WorkspaceOwner", async () => {
    const { pipeline } = setup();
    const res = await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND, entityId: null }),
    );
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) {
      expect(res.result.reason).toContain("workspace owner");
    }
  });

  it("OpenPage rejects unauthenticated", async () => {
    const { pipeline } = setup();
    const res = await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND, entityId: null }),
      undefined,
    );
    expect(res.result.ok).toBe(false);
  });
});

describe("OpenPage", () => {
  it("opens a fresh tab in the active pane when no matching tab exists", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    const before = getState(world, ownerId);
    const res = await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND, entityId: "ent-1" as EntityId }),
    );
    expect(res.result.ok).toBe(true);
    const after = getState(world, ownerId);
    expect(Object.keys(after.tabs)).toHaveLength(1);
    const pane = after.panes[before.activePaneId]!;
    expect(pane.tabIds).toHaveLength(1);
    expect(pane.activeTabId).toBe(pane.tabIds[0]);
    const tab = after.tabs[pane.activeTabId!]!;
    expect(tab.pageKind).toBe(KIND);
    expect(tab.entityId).toBe("ent-1");
  });

  it("focuses an existing tab if one already targets the same (kind, entityId)", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND, entityId: "ent-1" as EntityId }),
    );
    await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND_2, entityId: "ent-2" as EntityId }),
    );
    // Two distinct tabs.
    const mid = getState(world, ownerId);
    expect(Object.keys(mid.tabs)).toHaveLength(2);

    // Re-open the first.
    await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND, entityId: "ent-1" as EntityId }),
    );
    const after = getState(world, ownerId);
    expect(Object.keys(after.tabs)).toHaveLength(2); // no new tab
    const pane = after.panes[after.activePaneId]!;
    const activeTab = after.tabs[pane.activeTabId!]!;
    expect(activeTab.pageKind).toBe(KIND);
    expect(activeTab.entityId).toBe("ent-1");
  });
});

describe("OpenPageInNewTab", () => {
  it("always opens a fresh tab even if the same page is already open", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND, entityId: "ent-1" as EntityId }),
    );
    await dispatch(
      pipeline,
      OpenPageInNewTab({ pageKind: KIND, entityId: "ent-1" as EntityId }),
    );
    const state = getState(world, ownerId);
    expect(Object.keys(state.tabs)).toHaveLength(2);
  });
});

describe("OpenPageAsSplit", () => {
  it("creates a new pane via split and makes the new pane active", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    const before = getState(world, ownerId);
    const oldPaneId = before.activePaneId;
    const res = await dispatch(
      pipeline,
      OpenPageAsSplit({
        pageKind: KIND,
        entityId: "ent-1" as EntityId,
        direction: "right",
      }),
    );
    expect(res.result.ok).toBe(true);
    const after = getState(world, ownerId);
    expect(Object.keys(after.panes)).toHaveLength(2);
    expect(after.activePaneId).not.toBe(oldPaneId);
    expect(after.tree.kind).toBe("split");
    if (after.tree.kind !== "split") throw new Error();
    expect(after.tree.axis).toBe("row");
    expect(after.tree.children).toHaveLength(2);
  });

  it("rejects when the workspace already has 4 panes", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world);
    for (let i = 0; i < 3; i++) {
      const r = await dispatch(
        pipeline,
        OpenPageAsSplit({
          pageKind: KIND,
          entityId: `e-${i}` as EntityId,
          direction: "right",
        }),
      );
      expect(r.result.ok).toBe(true);
    }
    const fourth = await dispatch(
      pipeline,
      OpenPageAsSplit({
        pageKind: KIND,
        entityId: "e-4" as EntityId,
        direction: "right",
      }),
    );
    expect(fourth.result.ok).toBe(false);
  });
});

describe("CloseTab", () => {
  it("removes a tab and reassigns activeTabId within the pane", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND, entityId: "a" as EntityId }),
    );
    await dispatch(
      pipeline,
      OpenPageInNewTab({ pageKind: KIND, entityId: "b" as EntityId }),
    );
    const mid = getState(world, ownerId);
    const pane = mid.panes[mid.activePaneId]!;
    const tabToClose = pane.activeTabId!;
    await dispatch(pipeline, CloseTab({ paneId: pane.paneId, tabId: tabToClose }));
    const after = getState(world, ownerId);
    expect(after.tabs[tabToClose]).toBeUndefined();
    const paneAfter = after.panes[mid.activePaneId]!;
    expect(paneAfter.tabIds).toHaveLength(1);
    expect(paneAfter.activeTabId).toBe(paneAfter.tabIds[0]);
  });

  it("closing the only tab of a non-only pane collapses the pane out of the tree", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(
      pipeline,
      OpenPageAsSplit({
        pageKind: KIND,
        entityId: "a" as EntityId,
        direction: "right",
      }),
    );
    const mid = getState(world, ownerId);
    expect(Object.keys(mid.panes)).toHaveLength(2);
    const newPaneId = mid.activePaneId;
    const newTabId = mid.panes[newPaneId]!.activeTabId!;
    await dispatch(pipeline, CloseTab({ paneId: newPaneId, tabId: newTabId }));
    const after = getState(world, ownerId);
    expect(after.panes[newPaneId]).toBeUndefined();
    expect(after.tree.kind).toBe("pane");
    expect(Object.keys(after.panes)).toHaveLength(1);
  });

  it("rejects when the named pane is unknown", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world);
    const res = await dispatch(
      pipeline,
      CloseTab({ paneId: "ghost", tabId: "ghost" }),
    );
    expect(res.result.ok).toBe(false);
  });
});

describe("RetargetTab", () => {
  it("changes pageKind and entityId in place", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND, entityId: "a" as EntityId }),
    );
    const before = getState(world, ownerId);
    const tabId = before.panes[before.activePaneId]!.activeTabId!;
    await dispatch(
      pipeline,
      RetargetTab({
        tabId,
        pageKind: KIND_2,
        entityId: "b" as EntityId,
      }),
    );
    const after = getState(world, ownerId);
    expect(after.tabs[tabId]!.pageKind).toBe(KIND_2);
    expect(after.tabs[tabId]!.entityId).toBe("b");
  });

  it("rejects when the tab id is unknown", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world);
    const res = await dispatch(
      pipeline,
      RetargetTab({ tabId: "ghost", pageKind: KIND, entityId: null }),
    );
    expect(res.result.ok).toBe(false);
  });
});

describe("FocusTab", () => {
  it("sets the named tab as the pane's active tab", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND, entityId: "a" as EntityId }),
    );
    await dispatch(
      pipeline,
      OpenPageInNewTab({ pageKind: KIND, entityId: "b" as EntityId }),
    );
    const mid = getState(world, ownerId);
    const pane = mid.panes[mid.activePaneId]!;
    const firstTab = pane.tabIds[0]!;
    await dispatch(
      pipeline,
      FocusTab({ paneId: pane.paneId, tabId: firstTab }),
    );
    const after = getState(world, ownerId);
    expect(after.panes[pane.paneId]!.activeTabId).toBe(firstTab);
  });
});

describe("FocusPane", () => {
  it("sets the active pane to the named pane", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(
      pipeline,
      OpenPageAsSplit({
        pageKind: KIND,
        entityId: "a" as EntityId,
        direction: "right",
      }),
    );
    const mid = getState(world, ownerId);
    const newPaneId = mid.activePaneId;
    const otherPaneId = Object.keys(mid.panes).find((id) => id !== newPaneId)!;
    await dispatch(pipeline, FocusPane({ paneId: otherPaneId }));
    const after = getState(world, ownerId);
    expect(after.activePaneId).toBe(otherPaneId);
  });
});

describe("ToggleZen", () => {
  it("toggles zenPaneId on and off the active pane", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    expect(getState(world, ownerId).zenPaneId).toBeNull();
    await dispatch(pipeline, ToggleZen({}));
    const after1 = getState(world, ownerId);
    expect(after1.zenPaneId).toBe(after1.activePaneId);
    await dispatch(pipeline, ToggleZen({}));
    expect(getState(world, ownerId).zenPaneId).toBeNull();
  });
});

describe("MoveTab", () => {
  it("reassigns a tab to another pane", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(
      pipeline,
      OpenPageAsSplit({
        pageKind: KIND,
        entityId: "a" as EntityId,
        direction: "right",
      }),
    );
    const mid = getState(world, ownerId);
    const fromPaneId = mid.activePaneId;
    const toPaneId = Object.keys(mid.panes).find((id) => id !== fromPaneId)!;
    const tabId = mid.panes[fromPaneId]!.activeTabId!;
    const res = await dispatch(
      pipeline,
      MoveTab({ tabId, fromPaneId, toPaneId }),
    );
    expect(res.result.ok).toBe(true);
    const after = getState(world, ownerId);
    expect(after.panes[fromPaneId]!.tabIds).not.toContain(tabId);
    expect(after.panes[toPaneId]!.tabIds).toContain(tabId);
    expect(after.activePaneId).toBe(toPaneId);
  });

  it("rejects when source pane is unknown", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world);
    const res = await dispatch(
      pipeline,
      MoveTab({ tabId: "x", fromPaneId: "ghost", toPaneId: "also-ghost" }),
    );
    expect(res.result.ok).toBe(false);
  });
});

describe("SetSplitProportions", () => {
  it("updates the root split's proportions in place", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(
      pipeline,
      OpenPageAsSplit({
        pageKind: KIND,
        entityId: "a" as EntityId,
        direction: "right",
      }),
    );
    const before = getState(world, ownerId);
    expect(before.tree.kind).toBe("split");
    if (before.tree.kind !== "split") throw new Error();
    expect(before.tree.proportions).toEqual([1, 1]);
    const res = await dispatch(
      pipeline,
      SetSplitProportions({ path: [], proportions: [2, 3] }),
    );
    expect(res.result.ok).toBe(true);
    const after = getState(world, ownerId);
    if (after.tree.kind !== "split") throw new Error();
    expect(after.tree.proportions).toEqual([2, 3]);
    expect(after.tree.children).toHaveLength(2);
  });

  it("rejects when path doesn't address a split node", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world);
    // Root is a single pane node out of the box — path [] addresses it.
    const res = await dispatch(
      pipeline,
      SetSplitProportions({ path: [], proportions: [1, 1] }),
    );
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) {
      expect(res.result.reason).toContain("split");
    }
  });

  it("rejects when proportions length doesn't match the split's children", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world);
    await dispatch(
      pipeline,
      OpenPageAsSplit({
        pageKind: KIND,
        entityId: "a" as EntityId,
        direction: "right",
      }),
    );
    const res = await dispatch(
      pipeline,
      SetSplitProportions({ path: [], proportions: [1, 1, 1] }),
    );
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) {
      expect(res.result.reason).toContain("doesn't match");
    }
  });

  it("rejects a non-positive proportion at the schema layer", () => {
    expect(() =>
      SetSplitProportions({ path: [], proportions: [1, 0] }),
    ).toThrow();
    expect(() =>
      SetSplitProportions({ path: [], proportions: [-1, 2] }),
    ).toThrow();
  });

  it("walks a nested path to a deeper split", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    // Make a horizontal split, then split the new pane vertically.
    await dispatch(
      pipeline,
      OpenPageAsSplit({
        pageKind: KIND,
        entityId: "a" as EntityId,
        direction: "right",
      }),
    );
    await dispatch(
      pipeline,
      OpenPageAsSplit({
        pageKind: KIND,
        entityId: "b" as EntityId,
        direction: "bottom",
      }),
    );
    const before = getState(world, ownerId);
    if (before.tree.kind !== "split") throw new Error();
    // The vertical split lives inside child[1] of the root.
    const inner = before.tree.children[1];
    if (!inner || inner.kind !== "split") throw new Error("expected nested split");
    expect(inner.axis).toBe("column");
    const res = await dispatch(
      pipeline,
      SetSplitProportions({ path: [1], proportions: [3, 1] }),
    );
    expect(res.result.ok).toBe(true);
    const after = getState(world, ownerId);
    if (after.tree.kind !== "split") throw new Error();
    const innerAfter = after.tree.children[1];
    if (!innerAfter || innerAfter.kind !== "split") throw new Error();
    expect(innerAfter.proportions).toEqual([3, 1]);
    // The outer split's proportions are unchanged.
    expect(after.tree.proportions).toEqual([1, 1]);
  });
});

describe("WorkspaceStateChanged broadcast scope", () => {
  it("commands emit WorkspaceStateChanged with actors([userId]) visibility", async () => {
    const { registry, world, pipeline, bus } = setup();
    bootstrap(registry, world);
    const seen: { type: string; visibility?: { kind: string; userIds?: string[] } }[] = [];
    bus.on(WorkspaceStateChanged.name, (e) => {
      const ev = e as {
        type: string;
        visibility?: { kind: string; userIds?: string[] };
      };
      seen.push({ type: ev.type, visibility: ev.visibility });
    });
    await dispatch(
      pipeline,
      OpenPage({ pageKind: KIND, entityId: "a" as EntityId }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]!.visibility?.kind).toBe("users");
    expect(seen[0]!.visibility?.userIds).toEqual([PLAYER.userId]);
  });
});

describe("drawers", () => {
  const DRAWER_A = "@vtt/test/drawer-a";
  const DRAWER_B = "@vtt/test/drawer-b";

  it("default workspace state has empty openDrawers", async () => {
    const { registry, world } = setup();
    const ownerId = bootstrap(registry, world);
    const state = getState(world, ownerId);
    expect(state.openDrawers).toEqual({});
  });

  it("OpenDrawer adds the id with an openedAt timestamp", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    const before = Date.now();
    const res = await dispatch(pipeline, OpenDrawer({ id: DRAWER_A }));
    expect(res.result.ok).toBe(true);
    const state = getState(world, ownerId);
    expect(state.openDrawers[DRAWER_A]).toBeDefined();
    expect(state.openDrawers[DRAWER_A]!.openedAt).toBeGreaterThanOrEqual(before);
  });

  it("OpenDrawer is idempotent — re-opening bumps openedAt and preserves persisted size", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_A }));
    await dispatch(pipeline, ResizeDrawer({ id: DRAWER_A, size: 320 }));
    const beforeRe = getState(world, ownerId).openDrawers[DRAWER_A]!;
    // Wait a tick so openedAt can move forward
    await new Promise((r) => setTimeout(r, 2));
    const res = await dispatch(pipeline, OpenDrawer({ id: DRAWER_A }));
    expect(res.result.ok).toBe(true);
    const after = getState(world, ownerId).openDrawers[DRAWER_A]!;
    expect(after.openedAt).toBeGreaterThanOrEqual(beforeRe.openedAt);
    expect(after.size).toBe(320);
  });

  it("CloseDrawer removes the entry", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_A }));
    expect(getState(world, ownerId).openDrawers[DRAWER_A]).toBeDefined();
    const res = await dispatch(pipeline, CloseDrawer({ id: DRAWER_A }));
    expect(res.result.ok).toBe(true);
    expect(getState(world, ownerId).openDrawers[DRAWER_A]).toBeUndefined();
  });

  it("CloseDrawer is a soft no-op when the drawer wasn't open", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    const res = await dispatch(pipeline, CloseDrawer({ id: DRAWER_A }));
    expect(res.result.ok).toBe(true);
    expect(getState(world, ownerId).openDrawers[DRAWER_A]).toBeUndefined();
  });

  it("ToggleDrawer flips open<->closed", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(pipeline, ToggleDrawer({ id: DRAWER_A }));
    expect(getState(world, ownerId).openDrawers[DRAWER_A]).toBeDefined();
    await dispatch(pipeline, ToggleDrawer({ id: DRAWER_A }));
    expect(getState(world, ownerId).openDrawers[DRAWER_A]).toBeUndefined();
  });

  it("ResizeDrawer persists size and survives re-open after close", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_A }));
    await dispatch(pipeline, ResizeDrawer({ id: DRAWER_A, size: 480 }));
    expect(getState(world, ownerId).openDrawers[DRAWER_A]!.size).toBe(480);
    // Close, then re-open: the size persists for the open entry.
    await dispatch(pipeline, CloseDrawer({ id: DRAWER_A }));
    // After close the entry is gone — size doesn't survive a full close.
    expect(getState(world, ownerId).openDrawers[DRAWER_A]).toBeUndefined();
    await dispatch(pipeline, ResizeDrawer({ id: DRAWER_A, size: 600 }));
    // Resizing a closed drawer records the size for the next open.
    expect(getState(world, ownerId).openDrawers[DRAWER_A]!.size).toBe(600);
  });

  it("multiple drawers coexist independently", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_A }));
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_B }));
    expect(Object.keys(getState(world, ownerId).openDrawers).sort()).toEqual(
      [DRAWER_A, DRAWER_B].sort(),
    );
    await dispatch(pipeline, CloseDrawer({ id: DRAWER_A }));
    expect(getState(world, ownerId).openDrawers[DRAWER_A]).toBeUndefined();
    expect(getState(world, ownerId).openDrawers[DRAWER_B]).toBeDefined();
  });

  it("rejects schema violations: missing id", () => {
    expect(() =>
      OpenDrawer({} as unknown as { id: string }),
    ).toThrow();
  });

  it("rejects malformed drawer id (not plugin-namespaced)", () => {
    expect(() => OpenDrawer({ id: "naked-id" as never })).toThrow();
  });

  it("rejects ResizeDrawer with size below the schema minimum", () => {
    expect(() =>
      ResizeDrawer({ id: DRAWER_A as never, size: 0 }),
    ).toThrow();
  });

  it("OpenDrawer defaults to keepOpen=false (auto-close eligible)", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_A }));
    const state = getState(world, ownerId);
    expect(state.openDrawers[DRAWER_A]!.keepOpen).toBe(false);
  });

  it("OpenDrawer({keepOpen:true}) records the sticky preference", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_A, keepOpen: true }));
    const state = getState(world, ownerId);
    expect(state.openDrawers[DRAWER_A]!.keepOpen).toBe(true);
  });

  it("OpenDrawer never downgrades a sticky drawer on auto re-open", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_A, keepOpen: true }));
    // Auto re-open (keepOpen omitted/false) must not flip the
    // existing sticky preference back off.
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_A, keepOpen: false }));
    expect(getState(world, ownerId).openDrawers[DRAWER_A]!.keepOpen).toBe(true);
  });

  it("OpenDrawer upgrades a non-sticky open to sticky when keepOpen:true", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_A, keepOpen: false }));
    expect(getState(world, ownerId).openDrawers[DRAWER_A]!.keepOpen).toBe(false);
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_A, keepOpen: true }));
    expect(getState(world, ownerId).openDrawers[DRAWER_A]!.keepOpen).toBe(true);
  });

  it("ToggleDrawer toggle-to-open sets keepOpen=true (user action)", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(pipeline, ToggleDrawer({ id: DRAWER_A }));
    expect(getState(world, ownerId).openDrawers[DRAWER_A]!.keepOpen).toBe(true);
  });

  it("SetDrawerKeepOpen flips the preference without changing open state", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_A, keepOpen: false }));
    const before = getState(world, ownerId).openDrawers[DRAWER_A]!;
    await dispatch(
      pipeline,
      SetDrawerKeepOpen({ id: DRAWER_A, keepOpen: true }),
    );
    const after = getState(world, ownerId).openDrawers[DRAWER_A]!;
    expect(after.keepOpen).toBe(true);
    // openedAt isn't touched — only the preference flips.
    expect(after.openedAt).toBe(before.openedAt);
  });

  it("SetDrawerKeepOpen on a closed drawer is a no-op (no entry created)", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(
      pipeline,
      SetDrawerKeepOpen({ id: DRAWER_A, keepOpen: true }),
    );
    expect(getState(world, ownerId).openDrawers[DRAWER_A]).toBeUndefined();
  });

  it("CloseDrawer clears keepOpen (next auto-open is auto-close-eligible)", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world);
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_A, keepOpen: true }));
    await dispatch(pipeline, CloseDrawer({ id: DRAWER_A }));
    await dispatch(pipeline, OpenDrawer({ id: DRAWER_A }));
    expect(getState(world, ownerId).openDrawers[DRAWER_A]!.keepOpen).toBe(false);
  });
});

// — ShareTab ——————————————————————————————————————————————————————

describe("ShareTab", () => {
  /**
   * Open a tab in the sender's workspace and return the new tab id —
   * helper because every share test needs a sender with at least one tab.
   */
  async function openSenderTab(
    pipeline: CommandPipeline,
    senderOwnerId: EntityId,
    world: World,
    session: AuthSession = PLAYER,
    pageKind = KIND,
    entityId: EntityId | null = null,
  ): Promise<string> {
    await dispatch(pipeline, OpenPage({ pageKind, entityId }), session);
    const state = getState(world, senderOwnerId);
    const tabIds = Object.keys(state.tabs);
    if (tabIds.length === 0) throw new Error("no tab opened");
    return tabIds[tabIds.length - 1]!;
  }

  it("delivers a fresh tab into the recipient's workspace with the same (pageKind, entityId)", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world, PLAYER.userId);
    const recipientOwnerId = bootstrap(registry, world, PLAYER_2.userId);
    const senderOwnerId = world
      .query([WorkspaceOwner])
      .find((r) => (r.values.WorkspaceOwner as { userId: string }).userId === PLAYER.userId)!.id;

    const senderTabId = await openSenderTab(pipeline, senderOwnerId, world);
    await dispatch(
      pipeline,
      ShareTab({ tabId: senderTabId, recipientUserIds: [PLAYER_2.userId] }),
      PLAYER,
    );

    const recipientState = getState(world, recipientOwnerId);
    const recipientTabs = Object.values(recipientState.tabs);
    expect(recipientTabs).toHaveLength(1);
    expect(recipientTabs[0]!.pageKind).toBe(KIND);
    // The recipient's tab id is freshly minted — not the sender's.
    expect(recipientTabs[0]!.id).not.toBe(senderTabId);
  });

  it("snapshots the sender's per-tab UI-state traits onto the recipient's new sentinel", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world, PLAYER.userId);
    bootstrap(registry, world, PLAYER_2.userId);
    const senderOwnerId = world
      .query([WorkspaceOwner])
      .find((r) => (r.values.WorkspaceOwner as { userId: string }).userId === PLAYER.userId)!.id;
    const senderTabId = await openSenderTab(pipeline, senderOwnerId, world);

    // The sender's per-tab UI state — the "page 11" of the rulebook.
    world.set(
      tabSentinelEntityId(senderTabId),
      TestTabUiState,
      { activePage: 11 },
    );

    await dispatch(
      pipeline,
      ShareTab({ tabId: senderTabId, recipientUserIds: [PLAYER_2.userId] }),
      PLAYER,
    );

    const recipientOwnerId = world
      .query([WorkspaceOwner])
      .find((r) => (r.values.WorkspaceOwner as { userId: string }).userId === PLAYER_2.userId)!.id;
    const recipientTabId = Object.keys(getState(world, recipientOwnerId).tabs)[0]!;
    const recipientSentinelId = tabSentinelEntityId(recipientTabId);
    const got = world.get(recipientSentinelId, [TestTabUiState]) as
      | { UiState: { activePage: number } }
      | undefined;
    expect(got?.UiState.activePage).toBe(11);
  });

  it("does NOT copy traits whose definition sets share: false", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world, PLAYER.userId);
    bootstrap(registry, world, PLAYER_2.userId);
    const senderOwnerId = world
      .query([WorkspaceOwner])
      .find((r) => (r.values.WorkspaceOwner as { userId: string }).userId === PLAYER.userId)!.id;
    const senderTabId = await openSenderTab(pipeline, senderOwnerId, world);

    // A trait that opts out of sharing — must not land on the recipient.
    world.set(
      tabSentinelEntityId(senderTabId),
      TestPrivateState,
      { secret: "do not copy" },
    );

    await dispatch(
      pipeline,
      ShareTab({ tabId: senderTabId, recipientUserIds: [PLAYER_2.userId] }),
      PLAYER,
    );

    const recipientOwnerId = world
      .query([WorkspaceOwner])
      .find((r) => (r.values.WorkspaceOwner as { userId: string }).userId === PLAYER_2.userId)!.id;
    const recipientTabId = Object.keys(getState(world, recipientOwnerId).tabs)[0]!;
    const traits = world.traitsOn(tabSentinelEntityId(recipientTabId));
    expect(traits.has("@test/share/Private" as never)).toBe(false);
  });

  it("recipient's sentinel is freshly scoped — TabSentinel/Permissions name the recipient, not the sender", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world, PLAYER.userId);
    const recipientOwnerId = bootstrap(registry, world, PLAYER_2.userId);
    const senderOwnerId = world
      .query([WorkspaceOwner])
      .find((r) => (r.values.WorkspaceOwner as { userId: string }).userId === PLAYER.userId)!.id;
    const senderTabId = await openSenderTab(pipeline, senderOwnerId, world);

    await dispatch(
      pipeline,
      ShareTab({ tabId: senderTabId, recipientUserIds: [PLAYER_2.userId] }),
      PLAYER,
    );

    const recipientTabId = Object.keys(getState(world, recipientOwnerId).tabs)[0]!;
    const got = world.get(tabSentinelEntityId(recipientTabId), [
      TabSentinel,
      Permissions,
    ]) as {
      TabSentinel: { tabId: string };
      Permissions: {
        read: { kind: string; userIds?: string[] };
        write: { kind: string; userIds?: string[] };
      };
    };
    expect(got.TabSentinel.tabId).toBe(recipientTabId);
    expect(got.Permissions.read.kind).toBe("users");
    expect(got.Permissions.read.userIds).toEqual([PLAYER_2.userId]);
    expect(got.Permissions.write.kind).toBe("users");
    expect(got.Permissions.write.userIds).toEqual([PLAYER_2.userId]);
  });

  it("forceFocus: false leaves the recipient's activeTabId untouched", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world, PLAYER.userId);
    const recipientOwnerId = bootstrap(registry, world, PLAYER_2.userId);
    const senderOwnerId = world
      .query([WorkspaceOwner])
      .find((r) => (r.values.WorkspaceOwner as { userId: string }).userId === PLAYER.userId)!.id;
    const senderTabId = await openSenderTab(pipeline, senderOwnerId, world);

    const beforeActive = getState(world, recipientOwnerId)
      .panes[getState(world, recipientOwnerId).activePaneId]!.activeTabId;
    expect(beforeActive).toBeNull(); // recipient has no tabs yet

    await dispatch(
      pipeline,
      ShareTab({
        tabId: senderTabId,
        recipientUserIds: [PLAYER_2.userId],
        forceFocus: false,
      }),
      PLAYER,
    );

    const afterPane = getState(world, recipientOwnerId)
      .panes[getState(world, recipientOwnerId).activePaneId]!;
    // New tab is in the pane's tab list, but pane.activeTabId stays null —
    // the recipient sees a new tab head appear without being yanked to it.
    expect(afterPane.tabIds).toHaveLength(1);
    expect(afterPane.activeTabId).toBeNull();
  });

  it("forceFocus: true (as GM) flips the recipient's activeTabId to the shared tab", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world, GM.userId);
    const recipientOwnerId = bootstrap(registry, world, PLAYER_2.userId);
    const gmOwnerId = world
      .query([WorkspaceOwner])
      .find((r) => (r.values.WorkspaceOwner as { userId: string }).userId === GM.userId)!.id;
    const senderTabId = await openSenderTab(pipeline, gmOwnerId, world, GM);

    await dispatch(
      pipeline,
      ShareTab({
        tabId: senderTabId,
        recipientUserIds: [PLAYER_2.userId],
        forceFocus: true,
      }),
      GM,
    );

    const recipientState = getState(world, recipientOwnerId);
    const pane = recipientState.panes[recipientState.activePaneId]!;
    const recipientTabId = Object.keys(recipientState.tabs)[0]!;
    expect(pane.activeTabId).toBe(recipientTabId);
  });

  it("forceFocus: true is rejected when the dispatcher is not a GM", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world, PLAYER.userId);
    bootstrap(registry, world, PLAYER_2.userId);
    const senderOwnerId = world
      .query([WorkspaceOwner])
      .find((r) => (r.values.WorkspaceOwner as { userId: string }).userId === PLAYER.userId)!.id;
    const senderTabId = await openSenderTab(pipeline, senderOwnerId, world);

    const ack = await dispatch(
      pipeline,
      ShareTab({
        tabId: senderTabId,
        recipientUserIds: [PLAYER_2.userId],
        forceFocus: true,
      }),
      PLAYER,
    );
    expect(ack.result.ok).toBe(false);
  });

  it("delivers to multiple recipients in one dispatch — each gets a fresh tab", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world, PLAYER.userId);
    const r1Owner = bootstrap(registry, world, PLAYER_2.userId);
    const r2Owner = bootstrap(registry, world, "player-3");
    const senderOwnerId = world
      .query([WorkspaceOwner])
      .find((r) => (r.values.WorkspaceOwner as { userId: string }).userId === PLAYER.userId)!.id;
    const senderTabId = await openSenderTab(pipeline, senderOwnerId, world);

    await dispatch(
      pipeline,
      ShareTab({
        tabId: senderTabId,
        recipientUserIds: [PLAYER_2.userId, "player-3"],
      }),
      PLAYER,
    );

    expect(Object.keys(getState(world, r1Owner).tabs)).toHaveLength(1);
    expect(Object.keys(getState(world, r2Owner).tabs)).toHaveLength(1);
  });

  it("rejects sharing a tab with yourself", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world, PLAYER.userId);
    const senderTabId = await openSenderTab(pipeline, ownerId, world);

    const ack = await dispatch(
      pipeline,
      ShareTab({ tabId: senderTabId, recipientUserIds: [PLAYER.userId] }),
      PLAYER,
    );
    expect(ack.result.ok).toBe(false);
  });

  it("rejects an unknown recipient (no workspace)", async () => {
    const { registry, world, pipeline } = setup();
    const ownerId = bootstrap(registry, world, PLAYER.userId);
    const senderTabId = await openSenderTab(pipeline, ownerId, world);

    const ack = await dispatch(
      pipeline,
      ShareTab({ tabId: senderTabId, recipientUserIds: ["nobody"] }),
      PLAYER,
    );
    expect(ack.result.ok).toBe(false);
  });

  it("rejects sharing an unknown tab", async () => {
    const { registry, world, pipeline } = setup();
    bootstrap(registry, world, PLAYER.userId);
    bootstrap(registry, world, PLAYER_2.userId);

    const ack = await dispatch(
      pipeline,
      ShareTab({ tabId: "no-such-tab", recipientUserIds: [PLAYER_2.userId] }),
      PLAYER,
    );
    expect(ack.result.ok).toBe(false);
  });

  it("rejects an empty recipient list at the schema layer", () => {
    expect(() => ShareTab({ tabId: "t", recipientUserIds: [] })).toThrow();
  });
});
