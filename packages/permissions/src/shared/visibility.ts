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

import { z, type Visibility } from "@vtt/substrate";
import type { Role } from "@vtt/auth";

/**
 * Zod shape mirroring the substrate's `Visibility` union — used by the
 * `Permissions` trait, by `SetPermissions`, and by every command that
 * carries an explicit visibility on an event.
 */
export const VisibilityShape = z.union([
  z.object({ kind: z.literal("everyone") }),
  z.object({ kind: z.literal("role"), role: z.string() }),
  z.object({ kind: z.literal("users"), userIds: z.array(z.string()) }),
]);

/**
 * The default — every connected client receives the event / sees the
 * entity. Equivalent to leaving `visibility` unset on an event;
 * provided as a builder so authors can be explicit when the choice
 * matters (`visibility: cmd.private ? gmOnly() : everyone()`).
 */
export const everyone = (): Visibility => ({ kind: "everyone" });

/**
 * Only clients whose session role matches receive the event. The
 * canonical use is `gmOnly()` — secret rolls, GM notes, hidden-DC
 * saves, GM-only sheet sections.
 */
export const ofRole = (role: Role): Visibility => ({ kind: "role", role });

export const gmOnly = (): Visibility => ofRole("gm");

/**
 * Only the listed userIds receive the event / see the entity. Whispers
 * are typically `actors([senderId, recipientId])`; private save-result
 * events are usually `actors([rollerId, gmUserId])`.
 */
export const actors = (userIds: ReadonlyArray<string>): Visibility => ({
  kind: "users",
  userIds: [...userIds],
});

/**
 * Convenience: a private event between two specific users. Identical to
 * `actors` but reads as intent at the call site.
 */
export const whisper = (between: ReadonlyArray<string>): Visibility =>
  actors(between);

/**
 * The default `Permissions` value for a freshly-created user-owned
 * entity: visible to everyone (snapshot filter passes), writable only
 * by the creator (plus GMs by universal bypass).
 *
 * Plugins call this from their spawn systems:
 *
 *   world.spawnAt(event.id, [
 *     MyTrait({ ... }),
 *     Permissions(ownedBy(event.createdByUserId)),
 *   ]);
 *
 * For GM-private entities use `{ read: gmOnly(), write: gmOnly() }`
 * directly; for public/co-edited use `{ read: everyone(), write: everyone() }`.
 */
export const ownedBy = (
  userId: string,
): { read: Visibility; write: Visibility } => ({
  read: everyone(),
  write: actors([userId]),
});

/**
 * GM-only on both axes. Convenience for spawn sites that mean "this
 * entity is GM-private" (hidden NPC, secret note, GM-only roll
 * residue).
 */
export const gmOnlyPermissions = (): {
  read: Visibility;
  write: Visibility;
} => ({
  read: gmOnly(),
  write: gmOnly(),
});

/**
 * Public on both axes — anyone can read, anyone can write. The world
 * bulletin board, a shared map of player goals, etc.
 */
export const publicPermissions = (): {
  read: Visibility;
  write: Visibility;
} => ({
  read: everyone(),
  write: everyone(),
});
