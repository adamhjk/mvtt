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

import { defineEvent, EntityId, QualifiedNameSchema, z } from "@vtt/substrate";

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
 * A user shared one of their tabs into another user's workspace. Emitted
 * once per recipient by the `ShareTab` command; the visibility is scoped
 * to the recipient (`actors([recipientUserId])`) so only that user's
 * connections see it.
 *
 * Carries (a) the recipient's pre-computed next `WorkspaceState` so the
 * mirror system can write it directly, mirroring the WorkspaceStateChanged
 * pattern, and (b) the per-tab UI-state `snapshot` gathered off the
 * sender's tab sentinel — the recipient's mirror system replays each
 * `[traitName, value]` onto the freshly-spawned recipient tab sentinel
 * so the recipient lands on "page 11 of the rulebook" / "page 5 of the
 * note" exactly as the sender saw it. System traits (`TabSentinel`,
 * `OwnedBy`, `EntityVisibility`) and any other trait whose definition
 * sets `share: false` are filtered out by the sender side.
 *
 * `forceFocus: true` instructs the mirror to also flip the recipient's
 * `activePaneId` to the new tab's pane (GM-only, enforced in `validate`).
 * `forceFocus: false` inserts the tab in the active pane but leaves
 * focus alone so the recipient notices the new tab without being
 * yanked out of what they were doing.
 */
export const TabShared = defineEvent({
  name: "@vtt/shell-workbench/TabShared",
  schema: z.object({
    recipientUserId: z.string().min(1),
    recipientOwnerEntityId: EntityId,
    newTabId: z.string().min(1),
    pageKind: QualifiedNameSchema,
    entityId: EntityId.nullable(),
    snapshot: z.record(z.string(), z.unknown()),
    forceFocus: z.boolean(),
    sharedBy: z.string().min(1),
    recipientNext: z.unknown(),
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
