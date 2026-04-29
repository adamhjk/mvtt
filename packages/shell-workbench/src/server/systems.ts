import { defineSystem, type EntityId } from "@vtt/substrate";
import {
  EntityVisibility,
  OwnedBy,
  actors,
} from "@vtt/permissions/shared";
import { PlayerJoined } from "@vtt/identity/shared";
import {
  WorkspaceOwner,
  WorkspaceState,
  type WorkspaceTree,
} from "../shared/traits.js";
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
  writes: [WorkspaceState],
  run: ({ event, world }) => {
    if (!world.has(event.ownerEntityId)) return [];
    world.set(event.ownerEntityId, WorkspaceState, event.next);
    return [];
  },
});
