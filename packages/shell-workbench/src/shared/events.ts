// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

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
