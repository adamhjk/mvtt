import { describe, it, expect, beforeEach } from "vitest";
import {
  ConnectionClosed,
  ConnectionOpened,
  EventBus,
  Registry,
  World,
  definePlugin,
  runSystemsToFixpoint,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { Identity, Name, Online } from "./shared/traits.js";
import { PlayerJoined, PlayerLeft } from "./shared/events.js";
import { findPlayerByUserId } from "./shared/helpers.js";
import {
  PlayerSpawningSystem,
  PlayerMirrorSystem,
  PlayerDespawnSystem,
  PlayerLeftMirrorSystem,
} from "./server/systems.js";

const serverPlugin = definePlugin({
  name: "@vtt/identity",
  version: "0.1.0",
  traits: [Identity, Name, Online],
  events: [PlayerJoined, PlayerLeft],
  systems: [
    PlayerSpawningSystem,
    PlayerMirrorSystem,
    PlayerDespawnSystem,
    PlayerLeftMirrorSystem,
  ],
});

const SESSION: AuthSession = {
  userId: "user-1",
  email: "hero@test.dev",
  name: "Hero",
  role: "player",
};

function setup() {
  const registry = new Registry();
  // ConnectionOpened/ConnectionClosed live in the substrate core; register it
  // explicitly so the system runner has the event defs to look up.
  registry.events.set(ConnectionOpened.name, ConnectionOpened);
  registry.events.set(ConnectionClosed.name, ConnectionClosed);
  registry.load(serverPlugin);
  const world = new World();
  const bus = new EventBus();
  return { registry, world, bus };
}

function fire(registry: Registry, world: World, bus: EventBus, event: { type: any; payload: any }) {
  const all = runSystemsToFixpoint(registry, world, [event]);
  for (const e of all) bus.emit(e);
  return all;
}

describe("@vtt/identity", () => {
  let registry: Registry;
  let world: World;
  let bus: EventBus;

  beforeEach(() => {
    ({ registry, world, bus } = setup());
  });

  it("ConnectionOpened spawns a Player entity and emits PlayerJoined", () => {
    const all = fire(
      registry,
      world,
      bus,
      ConnectionOpened({ clientId: "client-1", session: SESSION }),
    );
    expect(all.map((e) => e.type)).toEqual([
      ConnectionOpened.name,
      PlayerJoined.name,
    ]);
    const playerId = findPlayerByUserId(world, SESSION.userId);
    expect(playerId).not.toBeNull();
    const row = world.query([Identity, Name, Online])[0]!;
    expect((row.values.Identity as { userId: string }).userId).toBe(SESSION.userId);
    expect((row.values.Name as { value: string }).value).toBe(SESSION.name);
    expect((row.values.Online as { clientId: string }).clientId).toBe("client-1");
  });

  it("PlayerJoined mirror is idempotent — server doesn't double-spawn", () => {
    fire(registry, world, bus, ConnectionOpened({ clientId: "c1", session: SESSION }));
    expect(world.query([Identity])).toHaveLength(1);
    // Replay the same PlayerJoined event (as a remote client would receive it).
    fire(
      registry,
      world,
      bus,
      PlayerJoined({
        playerId: "e99" as any,
        userId: SESSION.userId,
        name: SESSION.name,
        role: SESSION.role,
        clientId: "c1",
      }),
    );
    expect(world.query([Identity])).toHaveLength(1);
  });

  it("PlayerJoined alone (no preceding ConnectionOpened) spawns the Player — client mirror path", () => {
    fire(
      registry,
      world,
      bus,
      PlayerJoined({
        playerId: "e1" as any,
        userId: SESSION.userId,
        name: SESSION.name,
        role: SESSION.role,
        clientId: "c1",
      }),
    );
    expect(findPlayerByUserId(world, SESSION.userId)).not.toBeNull();
  });

  it("ConnectionClosed despawns the Player and emits PlayerLeft", () => {
    fire(registry, world, bus, ConnectionOpened({ clientId: "c1", session: SESSION }));
    expect(world.query([Identity])).toHaveLength(1);
    const all = fire(registry, world, bus, ConnectionClosed({ clientId: "c1" }));
    expect(all.map((e) => e.type)).toContain(PlayerLeft.name);
    expect(world.query([Identity])).toHaveLength(0);
  });

  it("rejects a malformed session payload (missing fields) without spawning", () => {
    fire(
      registry,
      world,
      bus,
      ConnectionOpened({ clientId: "c1", session: { not: "a session" } }),
    );
    expect(world.query([Identity])).toHaveLength(0);
  });

  it("uses plugin-namespaced names", () => {
    expect(Identity.name).toBe("@vtt/identity/Identity");
    expect(Name.name).toBe("@vtt/identity/Name");
    expect(Online.name).toBe("@vtt/identity/Online");
    expect(PlayerJoined.name).toBe("@vtt/identity/PlayerJoined");
    expect(PlayerLeft.name).toBe("@vtt/identity/PlayerLeft");
  });
});
