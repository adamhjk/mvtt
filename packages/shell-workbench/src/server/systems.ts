// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { defineSystem, type EntityId } from "@vtt/substrate";
import {
  EntityVisibility,
  OwnedBy,
  actors,
} from "@vtt/permissions/shared";
import { PlayerJoined } from "@vtt/identity/shared";
import {
  TabSentinel,
  WorkspaceOwner,
  WorkspaceState,
  type WorkspaceTree,
} from "../shared/traits.js";
import { tabSentinelEntityId } from "../shared/tab-sentinel.js";
import {
  WorkspaceBootstrapped,
  WorkspaceStateChanged,
} from "../shared/events.js";

/**
 * The empty default workspace: one pane, one empty tab, no zen, no UI
 * state. Ready for the user to either pick something with the picker or
 * open a page from the palette. (A future v0.x will pull this from the
 * user's global "layout template" pref in @vtt/identity instead of
 * hardcoding it here — the design doc calls this out as a layered prefs
 * gap. For v0 the hardcoded default is fine.)
 */
function defaultWorkspaceState() {
  const paneId = `pane-${Date.now().toString(36)}-1`;
  const tree: WorkspaceTree = { kind: "pane", paneId };
  return {
    tabs: {},
    panes: {
      [paneId]: {
        paneId,
        tabIds: [],
        activeTabId: null,
      },
    },
    tree,
    activePaneId: paneId,
    zenPaneId: null,
    lastInteractedAt: Date.now(),
    schemaVersion: 1 as const,
    openDrawers: {},
  };
}

/**
 * Deterministic id for a user's WorkspaceOwner sentinel. Derived from
 * userId so server and every client agree on the id without relying on
 * synchronized auto-increment counters — this is the entity that
 * `WorkspaceStateChanged.ownerEntityId` references.
 */
function workspaceOwnerEntityId(userId: string): EntityId {
  return `workspace-owner:${userId}` as EntityId;
}

/**
 * Bootstrap-on-join: when a user appears (PlayerJoined), make sure they
 * have a WorkspaceOwner sentinel for this world. Runs as a universal
 * mirror; the entity's id is deterministically `workspace-owner:<userId>`
 * so every side computes the same one regardless of how many other
 * spawns each side has processed. Idempotent — `world.has` short-circuits
 * when the owner already exists.
 */
export const WorkspaceBootstrapSystem = defineSystem({
  name: "WorkspaceBootstrap",
  on: PlayerJoined,
  reads: [WorkspaceOwner, OwnedBy],
  writes: [WorkspaceOwner, OwnedBy, EntityVisibility, WorkspaceState],
  run: ({ event, world }) => {
    const ownerId = workspaceOwnerEntityId(event.userId);
    if (world.has(ownerId)) return [];
    world.spawnAt(ownerId, [
      WorkspaceOwner({ userId: event.userId }),
      OwnedBy({ userId: event.userId }),
      EntityVisibility({ visibility: actors([event.userId]) }),
      WorkspaceState(defaultWorkspaceState()),
    ]);
    return [
      WorkspaceBootstrapped({
        ownerEntityId: ownerId,
        userId: event.userId,
      }),
    ];
  },
});

/**
 * Apply a WorkspaceStateChanged event to the relevant entity's
 * WorkspaceState trait. Universal mirror — runs on the server and on the
 * owning user's other connections (the broadcast filter scopes by userId
 * via the event's actors visibility). Other users' clients never see
 * either the event or the entity.
 *
 * No-op if the named owner entity isn't in this world (the user's other
 * tab might be racing the broadcast against a dispatch from this tab —
 * either way, the trait write is idempotent on the next event).
 */
export const WorkspaceStateApplySystem = defineSystem({
  name: "WorkspaceStateApply",
  on: WorkspaceStateChanged,
  reads: [WorkspaceState],
  writes: [WorkspaceState, TabSentinel, OwnedBy, EntityVisibility],
  run: ({ event, world }) => {
    if (!world.has(event.ownerEntityId)) return [];
    const prev = world.get(event.ownerEntityId, [WorkspaceState]) as
      | { WorkspaceState: { tabs: Record<string, unknown> } }
      | undefined;
    const prevTabIds = prev ? Object.keys(prev.WorkspaceState.tabs) : [];
    const nextState = event.next as { tabs: Record<string, unknown> };
    const nextTabIds = Object.keys(nextState.tabs);
    const before = new Set(prevTabIds);
    const after = new Set(nextTabIds);

    // Order matters. `world.set(WorkspaceState, …)` fires every
    // `useTrait`/`useQuery` subscriber synchronously, which in Solid
    // re-evaluates dependent JSX *immediately*, mounting the new
    // pane/tab/NoteView and running their `createOptimisticTrait`
    // calls — which look up the per-tab sentinel by deterministic id.
    // If we spawned sentinels AFTER world.set, the new view would
    // race the spawn and find no sentinel, no default, no initial,
    // and throw. Spawn before world.set; despawn after, so a view
    // rendering the closing tab still has its sentinel through the
    // last frame of the trait-update cascade.
    for (const tabId of after) {
      if (before.has(tabId)) continue;
      const id = tabSentinelEntityId(tabId);
      if (world.has(id)) continue;
      world.spawnAt(id, [
        TabSentinel({ tabId }),
        OwnedBy({ userId: event.userId }),
        EntityVisibility({ visibility: actors([event.userId]) }),
      ]);
    }
    world.set(event.ownerEntityId, WorkspaceState, event.next);
    for (const tabId of before) {
      if (after.has(tabId)) continue;
      const id = tabSentinelEntityId(tabId);
      if (!world.has(id)) continue;
      world.despawn(id);
    }
    return [];
  },
});
