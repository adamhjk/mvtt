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

import { defineTrait, z } from "@vtt/substrate";
import { RoleSchema } from "@vtt/auth";

/**
 * Marker that an entity *is* the in-World presence of an authenticated user.
 * The identity plugin spawns one of these per accepted WebSocket and never
 * attributes anything else (no character, no persona) to it. Future plugins
 * are responsible for richer concepts the user can claim/own.
 *
 * Transient: a Player exists only for the duration of a connection. After
 * a server restart, Players reconstitute as users reconnect; persisting
 * them would leave "ghost players" in the snapshot that no real session
 * is bound to.
 */
export const Identity = defineTrait({
  name: "@vtt/identity/Identity",
  schema: z.object({
    userId: z.string().min(1),
    role: RoleSchema,
  }),
  transient: true,
});

export const Name = defineTrait({
  name: "@vtt/identity/Name",
  schema: z.object({
    value: z.string().min(1).max(120),
  }),
  transient: true,
});

/**
 * Present iff the user is currently connected. Carries the connection's
 * clientId so we can find this entity again when the WS closes.
 */
export const Online = defineTrait({
  name: "@vtt/identity/Online",
  schema: z.object({
    clientId: z.string().min(1),
    since: z.number(),
  }),
  transient: true,
});
