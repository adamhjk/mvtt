import { defineSystem, ConnectionOpened, ConnectionClosed } from "@vtt/substrate";
import { parseAuthSession } from "@vtt/auth";
import { Identity, Name, Online } from "../shared/traits.js";
import { PlayerJoined, PlayerLeft } from "../shared/events.js";
import { findPlayerByUserId } from "../shared/helpers.js";

/**
 * Server-side: a WS connection has been authenticated. We narrow the opaque
 * session payload, spawn a Player entity carrying just identity (Identity +
 * Name + Online), and emit PlayerJoined for everyone — including the
 * connecting client itself, which uses it to mirror the entity into its
 * local World. Only the server runs this system in practice (the
 * ConnectionOpened event is `broadcast: false` because it carries session
 * details).
 *
 * This entity intentionally does *not* model a character, persona, or
 * actor-in-the-fiction — those are concerns for plugins yet to land. The
 * Player is purely "this user is here right now."
 */
export const PlayerSpawningSystem = defineSystem({
  name: "PlayerSpawning",
  on: ConnectionOpened,
  reads: [Identity],
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
 * Universal mirror: runs on every side that receives PlayerJoined. The
 * server already spawned the entity in PlayerSpawningSystem (above), so on
 * the server this is an idempotent no-op. On every other client it's the
 * actual spawn — they never saw ConnectionOpened. Idempotency is keyed on
 * `userId` (the stable cross-session identifier) rather than `playerId`
 * (which is only stable per-World, hence per-client).
 */
export const PlayerMirrorSystem = defineSystem({
  name: "PlayerMirror",
  on: PlayerJoined,
  reads: [Identity],
  writes: [Identity, Name, Online],
  run: ({ event, world }) => {
    if (findPlayerByUserId(world, event.userId) !== null) return [];
    world.spawn([
      Identity({ userId: event.userId, role: event.role }),
      Name({ value: event.name }),
      Online({ clientId: event.clientId, since: Date.now() }),
    ]);
    return [];
  },
});

/**
 * Server-side: WS closed. Find the matching Player by clientId, despawn it,
 * and emit PlayerLeft so every other client can mirror the disconnect.
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
 * Universal mirror: runs everywhere on PlayerLeft. Server has already
 * despawned (idempotent — find-by-userId returns null). Every other client
 * uses this to remove the disconnected player from its local World.
 */
export const PlayerLeftMirrorSystem = defineSystem({
  name: "PlayerLeftMirror",
  on: PlayerLeft,
  reads: [Identity],
  writes: [],
  run: ({ event, world }) => {
    const playerId = findPlayerByUserId(world, event.userId);
    if (playerId === null) return [];
    world.despawn(playerId);
    return [];
  },
});
