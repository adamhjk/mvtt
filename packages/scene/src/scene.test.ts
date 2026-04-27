import { describe, it, expect, beforeEach } from "vitest";
import {
  CommandPipeline,
  EventBus,
  Registry,
  World,
  definePlugin,
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { OwnedBy } from "@vtt/permissions/shared";
import {
  CreateScene,
  CreateToken,
  MoveToken,
  RemoveScene,
  RemoveToken,
  Position,
  Scene,
  SceneCanvasSurface,
  SceneCreated,
  SceneRemoved,
  SceneUpdated,
  Sprite,
  Token,
  TokenCreated,
  TokenMoved,
  TokenRemoved,
  UpdateScene,
} from "./shared/index.js";
import {
  SceneRemovalSystem,
  SceneSpawningSystem,
  SceneUpdateSystem,
  TokenMovementSystem,
  TokenRemovalSystem,
  TokenSpawningSystem,
} from "./server/systems.js";

const sceneServerPlugin = definePlugin({
  name: "@vtt/scene",
  version: "0.3.0",
  traits: [Scene, Position, Sprite, Token, OwnedBy],
  events: [
    SceneCreated,
    SceneRemoved,
    SceneUpdated,
    TokenCreated,
    TokenMoved,
    TokenRemoved,
  ],
  commands: [
    CreateScene,
    CreateToken,
    MoveToken,
    RemoveScene,
    RemoveToken,
    UpdateScene,
  ],
  systems: [
    SceneSpawningSystem,
    SceneRemovalSystem,
    SceneUpdateSystem,
    TokenSpawningSystem,
    TokenMovementSystem,
    TokenRemovalSystem,
  ],
  surfaces: [SceneCanvasSurface],
});

const GM: AuthSession = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

const PLAYER: AuthSession = {
  userId: "player-1",
  email: "p@test.dev",
  name: "Player",
  role: "player",
};

const OTHER_PLAYER: AuthSession = {
  userId: "player-2",
  email: "o@test.dev",
  name: "Other",
  role: "player",
};

function setup() {
  const registry = new Registry();
  registry.load(sceneServerPlugin);
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  return { registry, world, bus, pipeline };
}

let cmdSeq = 0;
async function dispatch(
  pipeline: CommandPipeline,
  cmd: CommandInstance,
  session: unknown,
  causalState?: unknown,
) {
  return pipeline.dispatch({
    id: `cmd-${++cmdSeq}`,
    issuedBy: "tester",
    issuedAt: Date.now(),
    cmd,
    session,
    causalState,
  });
}

async function makeScene(pipeline: CommandPipeline) {
  const res = await dispatch(
    pipeline,
    CreateScene({
      name: "Tomb",
      gridSize: 70,
      widthPx: 2100,
      heightPx: 1400,
      backgroundColor: "#1a1a1a",
    }),
    GM,
  );
  expect(res.result.ok).toBe(true);
  return res;
}

async function makeToken(
  pipeline: CommandPipeline,
  world: World,
  sceneId: EntityId,
  ownerUserId: string = PLAYER.userId,
): Promise<EntityId> {
  const before = world.query([Token]).length;
  await dispatch(
    pipeline,
    CreateToken({
      sceneId,
      iconSlug: "lorc/sword",
      tint: 0xffffff,
      size: 70,
      label: "goblin",
      kind: "creature",
      x: 0,
      y: 0,
      ownerUserId,
    }),
    GM,
  );
  const rows = world.query([Token, Position, Sprite, OwnedBy]);
  expect(rows).toHaveLength(before + 1);
  return rows.at(-1)!.id;
}

describe("@vtt/scene", () => {
  let pipeline: CommandPipeline;
  let world: World;
  let bus: EventBus;

  beforeEach(() => {
    ({ pipeline, world, bus } = setup());
  });

  it("uses plugin-namespaced ubiquitous-language names", () => {
    expect(CreateScene.name).toBe("@vtt/scene/CreateScene");
    expect(CreateToken.name).toBe("@vtt/scene/CreateToken");
    expect(MoveToken.name).toBe("@vtt/scene/MoveToken");
    expect(RemoveToken.name).toBe("@vtt/scene/RemoveToken");
    expect(SceneCreated.name).toBe("@vtt/scene/SceneCreated");
    expect(TokenCreated.name).toBe("@vtt/scene/TokenCreated");
    expect(TokenMoved.name).toBe("@vtt/scene/TokenMoved");
    expect(TokenRemoved.name).toBe("@vtt/scene/TokenRemoved");
    expect(Scene.name).toBe("@vtt/scene/Scene");
    expect(Position.name).toBe("@vtt/scene/Position");
    expect(Sprite.name).toBe("@vtt/scene/Sprite");
    expect(Token.name).toBe("@vtt/scene/Token");
  });

  describe("CreateScene", () => {
    it("GM dispatch spawns one Scene entity carrying the trait values", async () => {
      const seen: string[] = [];
      bus.onAny((e) => seen.push(e.type));
      const res = await makeScene(pipeline);
      expect(res.events.map((e) => e.type)).toEqual([SceneCreated.name]);
      expect(seen).toEqual([SceneCreated.name]);
      const rows = world.query([Scene]);
      expect(rows).toHaveLength(1);
      const v = rows[0]!.values.Scene as {
        name: string;
        gridSize: number;
        widthPx: number;
        heightPx: number;
        backgroundColor: string;
      };
      expect(v).toMatchObject({
        name: "Tomb",
        gridSize: 70,
        widthPx: 2100,
        heightPx: 1400,
        backgroundColor: "#1a1a1a",
      });
    });

    it("rejects a player dispatch", async () => {
      const res = await dispatch(
        pipeline,
        CreateScene({
          name: "Tomb",
          gridSize: 70,
          widthPx: 2100,
          heightPx: 1400,
          backgroundColor: "#1a1a1a",
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
      expect(world.query([Scene])).toHaveLength(0);
    });

    it("rejects an unauthenticated dispatch", async () => {
      const res = await dispatch(
        pipeline,
        CreateScene({
          name: "Tomb",
          gridSize: 70,
          widthPx: 2100,
          heightPx: 1400,
          backgroundColor: "#1a1a1a",
        }),
        undefined,
      );
      expect(res.result.ok).toBe(false);
      expect(world.query([Scene])).toHaveLength(0);
    });

    it("rejects malformed background colors at the schema layer", () => {
      expect(() =>
        CreateScene({
          name: "Tomb",
          gridSize: 70,
          widthPx: 2100,
          heightPx: 1400,
          backgroundColor: "not-a-color",
        }),
      ).toThrow();
    });
  });

  describe("CreateToken", () => {
    it("GM creates a token; recording system spawns Token+Sprite+Position+OwnedBy", async () => {
      await makeScene(pipeline);
      // SceneCreated carries no sceneId — the recording system spawns the
      // entity in lockstep on every side. Pull the freshly-spawned Scene
      // from the World here, exactly as the client renderer would.
      const sceneId = world.query([Scene])[0]!.id;
      expect(sceneId).toBeDefined();

      const tokenId = await makeToken(pipeline, world, sceneId);

      const got = world.get(tokenId, [Token, Sprite, Position, OwnedBy]) as {
        Token: { label: string; kind: string };
        Sprite: { iconSlug: string; tint: number; size: number };
        Position: { sceneId: EntityId; x: number; y: number; movedAt: number };
        OwnedBy: { userId: string };
      };
      expect(got.Token).toMatchObject({ label: "goblin", kind: "creature" });
      expect(got.Sprite).toMatchObject({ iconSlug: "lorc/sword", size: 70 });
      expect(got.Position.sceneId).toBe(sceneId);
      expect(got.Position.movedAt).toBe(0);
      expect(got.OwnedBy.userId).toBe(PLAYER.userId);
    });

    it("rejects a player dispatch even with a valid scene", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const res = await dispatch(
        pipeline,
        CreateToken({
          sceneId,
          iconSlug: "lorc/sword",
          tint: 0xffffff,
          size: 70,
          label: "goblin",
          kind: "creature",
          x: 0,
          y: 0,
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
      expect(world.query([Token])).toHaveLength(0);
    });

    it("rejects a token whose sceneId does not exist", async () => {
      const res = await dispatch(
        pipeline,
        CreateToken({
          sceneId: "ghost-scene" as EntityId,
          iconSlug: "lorc/sword",
          tint: 0xffffff,
          size: 70,
          label: "goblin",
          kind: "creature",
          x: 0,
          y: 0,
        }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("defaults ownerUserId to the dispatching GM when omitted", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      await dispatch(
        pipeline,
        CreateToken({
          sceneId,
          iconSlug: "lorc/sword",
          tint: 0xffffff,
          size: 70,
          label: "torch",
          kind: "object",
          x: 0,
          y: 0,
        }),
        GM,
      );
      const own = world.query([OwnedBy])[0]!.values.OwnedBy as {
        userId: string;
      };
      expect(own.userId).toBe(GM.userId);
    });
  });

  describe("MoveToken", () => {
    it("owner moves their own token; Position is replaced with new coords + monotonic movedAt", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const tokenId = await makeToken(pipeline, world, sceneId, PLAYER.userId);
      const before = world.get(tokenId, [Position]) as {
        Position: { movedAt: number };
      };
      const start = Date.now();
      const res = await dispatch(
        pipeline,
        MoveToken({ tokenId, x: 175, y: 245 }),
        PLAYER,
      );
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([TokenMoved.name]);
      const after = world.get(tokenId, [Position]) as {
        Position: { x: number; y: number; movedAt: number; sceneId: EntityId };
      };
      expect(after.Position.x).toBe(175);
      expect(after.Position.y).toBe(245);
      expect(after.Position.sceneId).toBe(sceneId);
      expect(after.Position.movedAt).toBeGreaterThanOrEqual(start);
      expect(after.Position.movedAt).toBeGreaterThan(before.Position.movedAt);
    });

    it("GM can move any token regardless of owner", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const tokenId = await makeToken(pipeline, world, sceneId, PLAYER.userId);
      const res = await dispatch(
        pipeline,
        MoveToken({ tokenId, x: 99, y: 99 }),
        GM,
      );
      expect(res.result.ok).toBe(true);
    });

    it("non-owner non-GM is rejected", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const tokenId = await makeToken(pipeline, world, sceneId, PLAYER.userId);
      const res = await dispatch(
        pipeline,
        MoveToken({ tokenId, x: 0, y: 0 }),
        OTHER_PLAYER,
      );
      expect(res.result.ok).toBe(false);
    });

    it("CAS check rejects when the authoritative token has moved since the client's last seen movedAt", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const tokenId = await makeToken(pipeline, world, sceneId, PLAYER.userId);

      // First move sets movedAt to a real timestamp.
      await dispatch(
        pipeline,
        MoveToken({ tokenId, x: 70, y: 70 }),
        PLAYER,
      );
      const after = world.get(tokenId, [Position]) as {
        Position: { movedAt: number };
      };
      const stale = after.Position.movedAt - 1;

      const res = await dispatch(
        pipeline,
        MoveToken({ tokenId, x: 140, y: 70 }),
        PLAYER,
        { lastSeenMovedAt: stale },
      );
      expect(res.result.ok).toBe(false);
      // Coords must remain at the previous server-authoritative move.
      const pos = world.get(tokenId, [Position]) as {
        Position: { x: number; y: number };
      };
      expect(pos.Position).toMatchObject({ x: 70, y: 70 });
    });

    it("CAS check accepts when client's lastSeenMovedAt matches authoritative", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const tokenId = await makeToken(pipeline, world, sceneId, PLAYER.userId);
      const cur = world.get(tokenId, [Position]) as {
        Position: { movedAt: number };
      };
      const res = await dispatch(
        pipeline,
        MoveToken({ tokenId, x: 7, y: 7 }),
        PLAYER,
        { lastSeenMovedAt: cur.Position.movedAt },
      );
      expect(res.result.ok).toBe(true);
    });

    it("rejects an unauthenticated dispatch", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const tokenId = await makeToken(pipeline, world, sceneId, PLAYER.userId);
      const res = await dispatch(
        pipeline,
        MoveToken({ tokenId, x: 0, y: 0 }),
        undefined,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects when tokenId does not exist", async () => {
      const res = await dispatch(
        pipeline,
        MoveToken({ tokenId: "ghost-token" as EntityId, x: 0, y: 0 }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });
  });

  describe("RemoveToken", () => {
    it("GM removes the token; entity is despawned", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const tokenId = await makeToken(pipeline, world, sceneId);
      expect(world.has(tokenId)).toBe(true);

      const res = await dispatch(pipeline, RemoveToken({ tokenId }), GM);
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([TokenRemoved.name]);
      expect(world.has(tokenId)).toBe(false);
    });

    it("rejects a player dispatch", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const tokenId = await makeToken(pipeline, world, sceneId);
      const res = await dispatch(
        pipeline,
        RemoveToken({ tokenId }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
      expect(world.has(tokenId)).toBe(true);
    });

    it("rejects when the tokenId does not exist", async () => {
      const res = await dispatch(
        pipeline,
        RemoveToken({ tokenId: "ghost" as EntityId }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });
  });

  describe("schema validation", () => {
    it("rejects empty scene name", () => {
      expect(() =>
        CreateScene({
          name: "",
          gridSize: 70,
          widthPx: 2100,
          heightPx: 1400,
          backgroundColor: "#000000",
        }),
      ).toThrow();
    });

    it("rejects non-integer gridSize", () => {
      expect(() =>
        CreateScene({
          name: "Tomb",
          gridSize: 7.5,
          widthPx: 2100,
          heightPx: 1400,
          backgroundColor: "#000000",
        }),
      ).toThrow();
    });

    it("rejects token kind outside the enum", () => {
      expect(() =>
        CreateToken({
          sceneId: "scene-x" as EntityId,
          iconSlug: "lorc/sword",
          tint: 0xffffff,
          size: 70,
          label: "goblin",
          kind: "monster" as never,
          x: 0,
          y: 0,
        }),
      ).toThrow();
    });

    it("rejects iconSlug shorter than 1 char", () => {
      expect(() =>
        CreateToken({
          sceneId: "scene-x" as EntityId,
          iconSlug: "",
          tint: 0xffffff,
          size: 70,
          label: "goblin",
          kind: "creature",
          x: 0,
          y: 0,
        }),
      ).toThrow();
    });

    it("rejects tint above the 24-bit colour ceiling", () => {
      expect(() =>
        CreateToken({
          sceneId: "scene-x" as EntityId,
          iconSlug: "lorc/sword",
          tint: 0x1000000,
          size: 70,
          label: "goblin",
          kind: "creature",
          x: 0,
          y: 0,
        }),
      ).toThrow();
    });
  });

  describe("systems", () => {
    it("SceneSpawningSystem: handler is wired to SceneCreated and writes Scene", () => {
      expect(SceneSpawningSystem.name).toBe("SceneSpawning");
      expect(SceneSpawningSystem.on.name).toBe(SceneCreated.name);
      expect(SceneSpawningSystem.writes.map((t) => t.name)).toContain(
        Scene.name,
      );
    });

    it("TokenSpawningSystem writes the four token-related traits", () => {
      const writes = TokenSpawningSystem.writes.map((t) => t.name);
      expect(writes).toEqual(
        expect.arrayContaining([Token.name, Sprite.name, Position.name, OwnedBy.name]),
      );
    });

    it("TokenMovementSystem is a Position read+write reactor", () => {
      expect(TokenMovementSystem.on.name).toBe(TokenMoved.name);
      expect(TokenMovementSystem.reads.map((t) => t.name)).toContain(
        Position.name,
      );
      expect(TokenMovementSystem.writes.map((t) => t.name)).toContain(
        Position.name,
      );
    });

    it("TokenRemovalSystem is a no-op for an already-despawned id", () => {
      // Drive the system directly: feed it a TokenRemoved with a ghost id.
      const events = TokenRemovalSystem.run({
        event: { tokenId: "ghost" as EntityId } as never,
        world,
      });
      expect(events).toEqual([]);
    });

    it("SceneUpdateSystem reacts to SceneUpdated and writes Scene", () => {
      expect(SceneUpdateSystem.on.name).toBe(SceneUpdated.name);
      expect(SceneUpdateSystem.reads.map((t) => t.name)).toContain(Scene.name);
      expect(SceneUpdateSystem.writes.map((t) => t.name)).toContain(Scene.name);
    });

    it("SceneUpdateSystem is a no-op for a despawned scene id", () => {
      const events = SceneUpdateSystem.run({
        event: { sceneId: "ghost" as EntityId, name: "x" } as never,
        world,
      });
      expect(events).toEqual([]);
    });
  });

  describe("UpdateScene", () => {
    it("GM rename merges over existing trait, leaves other fields intact", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const before = world.get(sceneId, [Scene]) as {
        Scene: {
          name: string;
          gridSize: number;
          widthPx: number;
          heightPx: number;
          backgroundColor: string;
        };
      };
      const res = await dispatch(
        pipeline,
        UpdateScene({ sceneId, name: "Renamed Scene" }),
        GM,
      );
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([SceneUpdated.name]);
      const after = world.get(sceneId, [Scene]) as {
        Scene: {
          name: string;
          gridSize: number;
          widthPx: number;
          heightPx: number;
          backgroundColor: string;
        };
      };
      expect(after.Scene.name).toBe("Renamed Scene");
      // Untouched fields keep their pre-update value.
      expect(after.Scene.gridSize).toBe(before.Scene.gridSize);
      expect(after.Scene.widthPx).toBe(before.Scene.widthPx);
      expect(after.Scene.heightPx).toBe(before.Scene.heightPx);
      expect(after.Scene.backgroundColor).toBe(before.Scene.backgroundColor);
    });

    it("supports updating multiple fields in one dispatch", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const res = await dispatch(
        pipeline,
        UpdateScene({
          sceneId,
          name: "All Edited",
          gridSize: 96,
          widthPx: 2800,
          heightPx: 1750,
          backgroundColor: "#0c0c12",
        }),
        GM,
      );
      expect(res.result.ok).toBe(true);
      const after = world.get(sceneId, [Scene]) as {
        Scene: {
          name: string;
          gridSize: number;
          widthPx: number;
          heightPx: number;
          backgroundColor: string;
        };
      };
      expect(after.Scene).toMatchObject({
        name: "All Edited",
        gridSize: 96,
        widthPx: 2800,
        heightPx: 1750,
        backgroundColor: "#0c0c12",
      });
    });

    it("rejects a player dispatch", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const res = await dispatch(
        pipeline,
        UpdateScene({ sceneId, name: "Hax" }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
      const after = world.get(sceneId, [Scene]) as {
        Scene: { name: string };
      };
      expect(after.Scene.name).not.toBe("Hax");
    });

    it("rejects when the sceneId does not exist", async () => {
      const res = await dispatch(
        pipeline,
        UpdateScene({ sceneId: "ghost-scene" as EntityId, name: "x" }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects malformed background color at the schema layer", () => {
      expect(() =>
        UpdateScene({
          sceneId: "scene-x" as EntityId,
          backgroundColor: "not-a-color",
        }),
      ).toThrow();
    });

    it("rejects empty-string name at the schema layer", () => {
      expect(() =>
        UpdateScene({
          sceneId: "scene-x" as EntityId,
          name: "",
        }),
      ).toThrow();
    });

    it("accepts a backgroundImage URL under this scene's plugin-data prefix", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const url = `/plugin-data/@vtt/scene/scenes/${sceneId}/background.png?v=12345`;
      const res = await dispatch(
        pipeline,
        UpdateScene({ sceneId, backgroundImage: url }),
        GM,
      );
      expect(res.result.ok).toBe(true);
      const after = world.get(sceneId, [Scene]) as {
        Scene: { backgroundImage: string | null };
      };
      expect(after.Scene.backgroundImage).toBe(url);
    });

    it("accepts null to clear an existing backgroundImage", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      // First set one
      await dispatch(
        pipeline,
        UpdateScene({
          sceneId,
          backgroundImage: `/plugin-data/@vtt/scene/scenes/${sceneId}/background.png`,
        }),
        GM,
      );
      // Then clear
      const res = await dispatch(
        pipeline,
        UpdateScene({ sceneId, backgroundImage: null }),
        GM,
      );
      expect(res.result.ok).toBe(true);
      const after = world.get(sceneId, [Scene]) as {
        Scene: { backgroundImage: string | null };
      };
      expect(after.Scene.backgroundImage).toBeNull();
    });

    it("rejects a backgroundImage URL pointing at a different scene", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const res = await dispatch(
        pipeline,
        UpdateScene({
          sceneId,
          backgroundImage:
            "/plugin-data/@vtt/scene/scenes/some-other-scene/background.png",
        }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects a backgroundImage URL outside the plugin-data prefix", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const res = await dispatch(
        pipeline,
        UpdateScene({
          sceneId,
          backgroundImage: "https://evil.example/payload.png",
        }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects a backgroundImage URL containing path traversal", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const res = await dispatch(
        pipeline,
        UpdateScene({
          sceneId,
          backgroundImage: `/plugin-data/@vtt/scene/scenes/${sceneId}/../../../etc/passwd.png`,
        }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });
  });

  describe("RemoveScene", () => {
    it("GM removes the scene; the entity is despawned", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      expect(world.has(sceneId)).toBe(true);
      const res = await dispatch(pipeline, RemoveScene({ sceneId }), GM);
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([SceneRemoved.name]);
      expect(world.has(sceneId)).toBe(false);
    });

    it("cascades: removing a scene also despawns every token on it", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const t1 = await makeToken(pipeline, world, sceneId);
      const t2 = await makeToken(pipeline, world, sceneId);
      expect(world.query([Token])).toHaveLength(2);
      await dispatch(pipeline, RemoveScene({ sceneId }), GM);
      expect(world.has(t1)).toBe(false);
      expect(world.has(t2)).toBe(false);
      expect(world.query([Token])).toHaveLength(0);
    });

    it("does not despawn tokens belonging to other scenes", async () => {
      // Two scenes; tokens placed on each. Removing scene A leaves
      // scene B's tokens intact.
      await makeScene(pipeline);
      const sceneA = world.query([Scene])[0]!.id;
      const ta = await makeToken(pipeline, world, sceneA);
      // Make a second scene by issuing another CreateScene.
      await dispatch(
        pipeline,
        CreateScene({
          name: "Inn",
          gridSize: 70,
          widthPx: 2100,
          heightPx: 1400,
          backgroundColor: "#1a1a1a",
        }),
        GM,
      );
      const sceneB = world.query([Scene]).find((r) => r.id !== sceneA)!.id;
      const tb = await makeToken(pipeline, world, sceneB);
      expect(world.query([Token])).toHaveLength(2);
      await dispatch(pipeline, RemoveScene({ sceneId: sceneA }), GM);
      expect(world.has(ta)).toBe(false);
      expect(world.has(tb)).toBe(true);
      expect(world.has(sceneB)).toBe(true);
    });

    it("rejects a player dispatch", async () => {
      await makeScene(pipeline);
      const sceneId = world.query([Scene])[0]!.id;
      const res = await dispatch(
        pipeline,
        RemoveScene({ sceneId }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
      expect(world.has(sceneId)).toBe(true);
    });

    it("rejects when sceneId does not exist", async () => {
      const res = await dispatch(
        pipeline,
        RemoveScene({ sceneId: "ghost-scene" as EntityId }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });
  });
});
