import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer, type ServerHandle } from "@vtt/substrate/server";
import { startClient, type ClientHandle } from "@vtt/substrate/client";
import {
  defineCommand,
  defineEvent,
  definePlugin,
  defineSystem,
  defineTrait,
  EntityId,
  InMemoryWorldsRepository,
  ok,
  z,
  type TraitName,
} from "@vtt/substrate";

/**
 * Wire-protocol smoke for the trait subscription path that
 * `createOptimisticTrait` reconciles against. A throwaway plugin defines
 * a UI-state-shaped trait + a Set command + a mirror system; the test
 * dispatches the command through a real WS round-trip and asserts the
 * client's world.subscribe fires for the matching `(entityId, trait)`
 * with the post-mirror value. This is the substrate seam the primitive
 * binds to in production; the optimistic / reconcile / rollback
 * semantics on top of that seam are unit-tested in
 * `packages/substrate/src/optimistic-trait.test.tsx`.
 */

const ENTITY_ID = "ent-1" as EntityId;

const UiTrait = defineTrait({
  name: "@vtt/_smoke-optimistic/Ui",
  schema: z
    .object({
      count: z.number().default(0),
      text: z.string().default(""),
    })
    .default({ count: 0, text: "" }),
});

const UiChanged = defineEvent({
  name: "@vtt/_smoke-optimistic/UiChanged",
  schema: z.object({
    entityId: EntityId,
    value: z.object({ count: z.number(), text: z.string() }),
  }),
});

const SetUi = defineCommand({
  name: "@vtt/_smoke-optimistic/SetUi",
  schema: z.object({
    entityId: EntityId,
    value: z.object({ count: z.number(), text: z.string() }),
  }),
  validate: () => ok(),
  apply: ({ cmd }) => [UiChanged({ entityId: cmd.entityId, value: cmd.value })],
});

const SpawnEntity = defineEvent({
  name: "@vtt/_smoke-optimistic/Spawn",
  schema: z.object({ entityId: EntityId }),
});

const Spawn = defineCommand({
  name: "@vtt/_smoke-optimistic/Spawn",
  schema: z.object({ entityId: EntityId }),
  validate: () => ok(),
  apply: ({ cmd }) => [SpawnEntity({ entityId: cmd.entityId })],
});

const SpawnSystem = defineSystem({
  name: "SpawnSentinel",
  on: SpawnEntity,
  reads: [],
  writes: [UiTrait],
  run: ({ event, world }) => {
    world.spawnAt(event.entityId, [UiTrait({ count: 0, text: "" })]);
    return [];
  },
});

const MirrorUi = defineSystem({
  name: "MirrorUi",
  on: UiChanged,
  reads: [],
  writes: [UiTrait],
  run: ({ event, world }) => {
    world.set(event.entityId, UiTrait, event.value);
    return [];
  },
});

const smokePlugin = definePlugin({
  name: "@vtt/_smoke-optimistic",
  version: "0.0.0",
  gameSystem: true,
  traits: [UiTrait],
  events: [UiChanged, SpawnEntity],
  commands: [SetUi, Spawn],
  systems: [SpawnSystem, MirrorUi],
});

describe("createOptimisticTrait wire smoke", () => {
  let server: ServerHandle;
  let client: ClientHandle;
  let worldId: string;

  beforeAll(async () => {
    const worldsRepo = new InMemoryWorldsRepository();
    await worldsRepo.migrate();
    const w = await worldsRepo.insert({
      id: "smoke-optimistic",
      name: "smoke-optimistic",
      gameSystemPlugin: smokePlugin.name,
      ownerUserId: "u1",
    });
    worldId = w.id;

    server = await startServer({
      port: 0,
      infrastructure: [],
      optional: [smokePlugin],
      worldsRepo,
      authenticateUpgrade: async () => ({ userId: "u1", role: "gm" }),
      extractRecipient: (s) => {
        const sess = s as { userId: string; role: string } | null;
        return sess ? { userId: sess.userId, role: sess.role } : null;
      },
    });

    client = startClient({
      url: `ws://127.0.0.1:${server.port}/ws?worldId=${worldId}`,
      plugins: [smokePlugin],
    });
    await new Promise<void>((resolve) => {
      const off = client.onSynced(() => {
        off();
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (client) client.close();
    if (server) await server.close();
  });

  it("propagates trait writes to the client and fires world.subscribe with the post-mirror value", async () => {
    // Spawn an entity carrying the UI trait, then dispatch a set; both round-trip via the real WS.
    await client.dispatch(Spawn({ entityId: ENTITY_ID })).ack;

    // Capture every (id, trait) the client's world fires on.
    const fires: Array<{ id: EntityId; trait: TraitName }> = [];
    const off = client.world.subscribe((id, trait) => {
      fires.push({ id, trait });
    });

    const ack = await client.dispatch(
      SetUi({ entityId: ENTITY_ID, value: { count: 7, text: "hello" } }),
    ).ack;
    expect(ack.ok).toBe(true);

    // Allow the broadcast event to land and the mirror system to run.
    await new Promise<void>((r) => setTimeout(r, 50));

    off();

    expect(fires.some((f) => f.id === ENTITY_ID && f.trait === UiTrait.name)).toBe(true);

    const got = client.world.get(ENTITY_ID, [UiTrait]) as
      | { Ui: { count: number; text: string } }
      | undefined;
    expect(got?.Ui).toEqual({ count: 7, text: "hello" });
  });
});
