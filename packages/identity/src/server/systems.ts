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

import { defineSystem, ConnectionOpened, ConnectionClosed } from "@vtt/substrate";
import { parseAuthSession } from "@vtt/auth";
import { Identity, Name, Online } from "../shared/traits.js";
import { PlayerJoined, PlayerLeft } from "../shared/events.js";

/**
 * Server-side: a WS connection has been authenticated. Spawn one
 * Connection entity per socket — a user with multiple browser windows
 * gets one entity per window, all carrying the same `userId`/`role`/`name`
 * with distinct `clientId`s. The player list view groups by `userId` for
 * display; per-tab state (focused scene, current selection, drag ghosts)
 * has a natural home on this entity later.
 *
 * Stale entities from refreshes are bounded by the substrate's WS
 * heartbeat (ping every 15s, terminate on missing pong within 30s) — see
 * `substrate/src/server.ts`. Without that backstop the spawn-per-socket
 * model would leak entities until TCP keepalive eventually dropped the
 * dead socket.
 */
export const PlayerSpawningSystem = defineSystem({
  name: "PlayerSpawning",
  on: ConnectionOpened,
  reads: [],
  writes: [Identity, Name, Online],
  run: ({ event, world }) => {
    const session = parseAuthSession(event.session);
    if (!session) return [];

    const playerId = world.spawn([
      Identity({ userId: session.userId, role: session.role }),
      Name({ value: session.name }),
      Online({ clientId: event.clientId, since: Date.now() }),
    ]);
    return [
      PlayerJoined({
        playerId,
        userId: session.userId,
        name: session.name,
        role: session.role,
        clientId: event.clientId,
      }),
    ];
  },
});

/**
 * Universal mirror: runs on every side that receives PlayerJoined.
 * The server has already spawned the entity (in PlayerSpawningSystem)
 * and put its id on the event as `playerId`; clients call `spawnAt`
 * with that same id so every side agrees regardless of how many other
 * events have shifted local counters.
 */
export const PlayerMirrorSystem = defineSystem({
  name: "PlayerMirror",
  on: PlayerJoined,
  reads: [Online],
  writes: [Identity, Name, Online],
  run: ({ event, world }) => {
    if (world.has(event.playerId)) return [];
    world.spawnAt(event.playerId, [
      Identity({ userId: event.userId, role: event.role }),
      Name({ value: event.name }),
      Online({ clientId: event.clientId, since: Date.now() }),
    ]);
    return [];
  },
});

/**
 * Server-side: WS closed. Find the Connection entity for this socket by
 * `clientId` and despawn it. Other connections for the same user (if
 * any) remain — only when the last one detaches does the user fall out
 * of the player list.
 */
export const PlayerDespawnSystem = defineSystem({
  name: "PlayerDespawn",
  on: ConnectionClosed,
  reads: [Online, Identity],
  writes: [],
  run: ({ event, world }) => {
    const match = world
      .query([Online, Identity])
      .find((r) => (r.values.Online as { clientId: string }).clientId === event.clientId);
    if (!match) return [];
    const id = match.values.Identity as { userId: string };
    world.despawn(match.id);
    return [
      PlayerLeft({
        playerId: match.id,
        userId: id.userId,
        clientId: event.clientId,
      }),
    ];
  },
});

/**
 * Universal mirror: runs everywhere on PlayerLeft. Match by `clientId`
 * (unique per socket) rather than `userId` — multi-tab users can have
 * several entities with the same `userId`, and we only want to despawn
 * the one whose socket actually disconnected.
 */
export const PlayerLeftMirrorSystem = defineSystem({
  name: "PlayerLeftMirror",
  on: PlayerLeft,
  reads: [Online],
  writes: [],
  run: ({ event, world }) => {
    const match = world
      .query([Online])
      .find((r) => (r.values.Online as { clientId: string }).clientId === event.clientId);
    if (!match) return [];
    world.despawn(match.id);
    return [];
  },
});
