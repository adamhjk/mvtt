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

import {
  defineCommand,
  defineEvent,
  defineSystem,
  defineTrait,
  EntityId,
  fail,
  ok,
  withVisibility,
  z,
  type EntityId as EntityIdType,
} from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { actors, Permissions } from "@vtt/permissions/shared";

/**
 * Deterministic per-user sentinel id holding that user's dismissed
 * notifications. Deterministic (derived from userId, not allocated) so the
 * universal-mirror system can `spawnAt` it identically on every side
 * without counter drift — the same trick `tabSentinelEntityId` uses.
 */
export function notificationDismissalsId(userId: string): EntityIdType {
  return `notif-dismissals:${userId}` as EntityIdType;
}

/**
 * One user's dismissed-notification ids. Per-user (not global): dismissing
 * a card hides it for *you* only — the backing entity stays put so other
 * players still see their copy. The entity is visibility-scoped to its
 * owner, so a client only ever sees its own list.
 */
export const NotificationDismissals = defineTrait({
  name: "@vtt/shell-workbench/NotificationDismissals",
  schema: z.object({
    userId: z.string().min(1),
    ids: z.array(z.string()).default([]),
  }),
});

export const NotificationDismissed = defineEvent({
  name: "@vtt/shell-workbench/NotificationDismissed",
  schema: z.object({
    userId: z.string().min(1),
    entityId: z.string().min(1),
  }),
  broadcast: true,
});

/**
 * Dismiss a notification card for the dispatching user only. Records the
 * entity id in the user's `NotificationDismissals` so the overlay filters
 * it out — permanently (it survives refresh) and privately (other players
 * are unaffected). The notification entity itself is never despawned.
 */
export const DismissNotification = defineCommand({
  name: "@vtt/shell-workbench/DismissNotification",
  schema: z.object({ entityId: EntityId }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    return ok();
  },
  apply: ({ cmd, session }) => {
    const auth = requireSession({ session });
    if (!auth) throw new Error("DismissNotification.apply called without session");
    // Scope the event to the dismissing user — only their sessions update
    // their (visibility-scoped) dismissals entity; nobody else is touched.
    return [
      withVisibility(
        NotificationDismissed({ userId: auth.userId, entityId: cmd.entityId }),
        actors([auth.userId]),
      ),
    ];
  },
});

/**
 * Universal mirror: append the dismissed id to the user's dismissals
 * entity, creating it (at the deterministic id, owner-scoped) on first
 * use. Idempotent — re-dismissing an already-dismissed id is a no-op.
 */
export const NotificationDismissedSystem = defineSystem({
  name: "NotificationDismissed",
  on: NotificationDismissed,
  reads: [NotificationDismissals],
  writes: [NotificationDismissals, Permissions],
  run: ({ event, world }) => {
    const id = notificationDismissalsId(event.userId);
    if (world.has(id)) {
      const cur = world.get(id, [NotificationDismissals]) as
        | { NotificationDismissals: { userId: string; ids: string[] } }
        | undefined;
      const ids = cur?.NotificationDismissals.ids ?? [];
      if (ids.includes(event.entityId)) return [];
      world.set(id, NotificationDismissals, {
        userId: event.userId,
        ids: [...ids, event.entityId],
      });
    } else {
      world.spawnAt(id, [
        NotificationDismissals({
          userId: event.userId,
          ids: [event.entityId],
        }),
        Permissions({
          read: actors([event.userId]),
          write: actors([event.userId]),
        }),
      ]);
    }
    return [];
  },
});
