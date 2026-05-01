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

import type { CommandContext, EntityId } from "@vtt/substrate";
import type { World } from "@vtt/substrate";
import { type AuthSession, parseAuthSession } from "@vtt/auth";
import { Identity, Name } from "./traits.js";

/**
 * Narrow `ctx.session` (opaque `unknown` from the substrate) to a typed
 * AuthSession. Returns null if the value isn't a valid session — most
 * callers pair this with `fail("not authenticated")` in command validate.
 */
export function requireSession(ctx: { session?: unknown }): AuthSession | null {
  return parseAuthSession(ctx.session);
}

/**
 * Find the Player entity that represents the current user, if any. The
 * identity plugin guarantees there's at most one Player per userId at a
 * time (spawned on ConnectionOpened, despawned on ConnectionClosed).
 */
export function currentPlayer(ctx: CommandContext<unknown>): EntityId | null {
  const session = requireSession(ctx);
  if (!session) return null;
  return findPlayerByUserId(ctx.world, session.userId);
}

export function findPlayerByUserId(world: World, userId: string): EntityId | null {
  for (const row of world.query([Identity])) {
    const id = row.values.Identity as { userId: string };
    if (id.userId === userId) return row.id;
  }
  return null;
}

export function findPlayerName(world: World, userId: string): string | null {
  for (const row of world.query([Identity, Name])) {
    const id = row.values.Identity as { userId: string };
    if (id.userId === userId) {
      return (row.values.Name as { value: string }).value;
    }
  }
  return null;
}
