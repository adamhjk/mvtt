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
  TabShared,
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
 * Recipient-side mirror for `TabShared`. Runs on the server and on the
 * recipient's clients (the event's `actors([recipientUserId])` visibility
 * keeps it off other users' wires). Three steps, ordered:
 *
 *   1. Spawn the recipient's per-tab sentinel for the new tab id, with
 *      fresh system traits (TabSentinel pointing at the new id, OwnedBy
 *      naming the recipient, EntityVisibility scoped to the recipient).
 *      `share: false` on those traits keeps them out of the snapshot, so
 *      we always write fresh values here rather than copying the sender's.
 *
 *   2. Replay each `[traitName, value]` from the snapshot onto the new
 *      sentinel via the trait registry. Unknown traits (the recipient
 *      doesn't have the plugin loaded) are silently skipped; values that
 *      fail their trait schema are also silently skipped — the recipient
 *      just lands at default UI state for that plugin's slice, which is
 *      benign and self-fixing.
 *
 *   3. Write the recipient's pre-computed `recipientNext` WorkspaceState.
 *      The sender pre-computed it in `apply` so the mirror doesn't need
 *      access to the recipient's prior state. Mirrors WorkspaceStateChanged
 *      semantics — including the "spawn before set" ordering — so any
 *      view that mounts in response to the new tab id finds its sentinel
 *      already populated with the snapshot traits, no flicker.
 */
export const TabSharedApplySystem = defineSystem({
  name: "TabSharedApply",
  on: TabShared,
  reads: [WorkspaceState],
  writes: [WorkspaceState, TabSentinel, OwnedBy, EntityVisibility],
  run: ({ event, world, registry }) => {
    if (!world.has(event.recipientOwnerEntityId)) return [];
    const sentinelId = tabSentinelEntityId(event.newTabId);
    if (!world.has(sentinelId)) {
      world.spawnAt(sentinelId, [
        TabSentinel({ tabId: event.newTabId }),
        OwnedBy({ userId: event.recipientUserId }),
        EntityVisibility({ visibility: actors([event.recipientUserId]) }),
      ]);
    }
    for (const [traitName, value] of Object.entries(event.snapshot)) {
      const meta = registry.traits.get(traitName as never);
      if (!meta) continue;
      try {
        world.set(sentinelId, meta, value);
      } catch {
        // Schema validation failed — recipient lands at default for this
        // trait. Nothing actionable; don't crash the mirror.
      }
    }
    world.set(event.recipientOwnerEntityId, WorkspaceState, event.recipientNext);
    return [];
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
