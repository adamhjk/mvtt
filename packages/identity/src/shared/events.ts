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

import { defineEvent, EntityId, z } from "@vtt/substrate";
import { RoleSchema } from "@vtt/auth";

/**
 * A user has come online. Emitted by the identity plugin's system in
 * response to a substrate ConnectionOpened. Transient — reflects connection
 * state, not durable game history.
 */
export const PlayerJoined = defineEvent({
  name: "@vtt/identity/PlayerJoined",
  schema: z.object({
    playerId: EntityId,
    userId: z.string(),
    name: z.string(),
    role: RoleSchema,
    clientId: z.string(),
  }),
  transient: true,
});

export const PlayerLeft = defineEvent({
  name: "@vtt/identity/PlayerLeft",
  schema: z.object({
    playerId: EntityId,
    userId: z.string(),
    clientId: z.string(),
  }),
  transient: true,
});
