import { defineEvent, EntityId, z } from "@vtt/substrate";

/**
 * The owning user's WorkspaceState changed. Marked **transient** (never
 * persisted) and **broadcast** (replicated over the wire so the user's
 * other connections see live updates). The `WorkspaceState` trait itself
 * persists; only the per-mutation events are ephemeral.
 *
 * Carries the entire next state. The reasoning: WorkspaceState is small
 * enough that a full replacement is cheaper than a delta encoding plus
 * conflict resolution, and "snap to authoritative" matches what we want
 * after a multi-device sync anyway.
 *
 * Every command emits this with `withVisibility(actors([userId]))` so the
 * substrate's broadcast filter only delivers it to the owning user's other
 * connections (not to other users).
 */
export const WorkspaceStateChanged = defineEvent({
  name: "@vtt/shell-workbench/WorkspaceStateChanged",
  schema: z.object({
    ownerEntityId: EntityId,
    userId: z.string().min(1),
    next: z.unknown(),
  }),
  transient: true,
  broadcast: true,
});

/**
 * The workspace-bootstrap system spawned a fresh WorkspaceOwner for a user
 * who joined a world they hadn't visited before. Carries the new sentinel
 * id so the system runner can wire follow-on writes; UI listeners ignore it
 * (they react to WorkspaceStateChanged + the snapshot path instead).
 *
 * Transient and not broadcast — purely internal coordination.
 */
export const WorkspaceBootstrapped = defineEvent({
  name: "@vtt/shell-workbench/WorkspaceBootstrapped",
  schema: z.object({
    ownerEntityId: EntityId,
    userId: z.string().min(1),
  }),
  transient: true,
  broadcast: false,
});
