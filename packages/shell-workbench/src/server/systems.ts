import { defineSystem, type EntityId, type World } from "@vtt/substrate";
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
 * Look up the WorkspaceOwner entity for a userId. Returns null if no
 * owner exists yet for that user in this World.
 */
function findOwnerEntity(world: World, userId: string): EntityId | null {
  for (const row of world.query([WorkspaceOwner, OwnedBy])) {
    const own = row.values.OwnedBy as { userId: string };
    if (own.userId === userId) return row.id;
  }
  return null;
}

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
 * Bootstrap-on-join: when a user appears (PlayerJoined), make sure they
 * have a WorkspaceOwner sentinel for this world. Runs on every recipient
 * (server + every client that sees the PlayerJoined mirror), and is
 * idempotent — the lookup short-circuits when an owner is already present.
 *
 * Per the design doc: only the user's own connections see their owner
 * entity (visibility = actors([userId])), so each client only ever creates
 * the entity for their own userId. Other users' PlayerJoined arrives but
 * the visibility filter on subsequent WorkspaceStateChanged events keeps
 * them away from each other's data.
 *
 * NOTE: PlayerJoined is broadcast to *every* client (it's how the player
 * list updates), but the WorkspaceOwner entity that gets created for user
 * X carries EntityVisibility{actors:[X]} so it doesn't leak into other
 * users' snapshots. We deliberately spawn on every side (server + clients
 * that see the event) so EntityIds stay in lockstep — same pattern as
 * SceneSpawningSystem.
 */
export const WorkspaceBootstrapSystem = defineSystem({
  name: "WorkspaceBootstrap",
  on: PlayerJoined,
  reads: [WorkspaceOwner, OwnedBy],
  writes: [WorkspaceOwner, OwnedBy, EntityVisibility, WorkspaceState],
  run: ({ event, world }) => {
    if (findOwnerEntity(world, event.userId)) return [];
    const ownerId = world.spawn([
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
