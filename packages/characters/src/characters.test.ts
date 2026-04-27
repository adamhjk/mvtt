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
  Character,
  CharacterCreated,
  CharacterRemoved,
  CharacterRenamed,
  CharacterSheetSectionsSlot,
  CreateCharacter,
  RemoveCharacter,
  RenameCharacter,
} from "./shared/index.js";
import {
  CharacterRemovalSystem,
  CharacterRenameSystem,
  CharacterSpawningSystem,
} from "./server/systems.js";

const charactersServerPlugin = definePlugin({
  name: "@vtt/characters",
  version: "0.1.0",
  traits: [Character, OwnedBy],
  events: [CharacterCreated, CharacterRenamed, CharacterRemoved],
  commands: [CreateCharacter, RemoveCharacter, RenameCharacter],
  systems: [
    CharacterSpawningSystem,
    CharacterRenameSystem,
    CharacterRemovalSystem,
  ],
  slots: [CharacterSheetSectionsSlot],
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
  registry.load(charactersServerPlugin);
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
) {
  return pipeline.dispatch({
    id: `cmd-${++cmdSeq}`,
    issuedBy: "tester",
    issuedAt: Date.now(),
    cmd,
    session,
  });
}

async function makeCharacter(
  pipeline: CommandPipeline,
  world: World,
  session: AuthSession = PLAYER,
  payload: { name: string; ownerUserId?: string } = { name: "Tarn" },
): Promise<EntityId> {
  const before = world.query([Character]).length;
  const res = await dispatch(
    pipeline,
    CreateCharacter(payload),
    session,
  );
  expect(res.result.ok).toBe(true);
  const rows = world.query([Character, OwnedBy]);
  expect(rows).toHaveLength(before + 1);
  return rows.at(-1)!.id;
}

describe("@vtt/characters", () => {
  let pipeline: CommandPipeline;
  let world: World;
  let bus: EventBus;

  beforeEach(() => {
    ({ pipeline, world, bus } = setup());
  });

  it("uses plugin-namespaced ubiquitous-language names", () => {
    expect(CreateCharacter.name).toBe("@vtt/characters/CreateCharacter");
    expect(RenameCharacter.name).toBe("@vtt/characters/RenameCharacter");
    expect(RemoveCharacter.name).toBe("@vtt/characters/RemoveCharacter");
    expect(CharacterCreated.name).toBe("@vtt/characters/CharacterCreated");
    expect(CharacterRenamed.name).toBe("@vtt/characters/CharacterRenamed");
    expect(CharacterRemoved.name).toBe("@vtt/characters/CharacterRemoved");
    expect(Character.name).toBe("@vtt/characters/Character");
    expect(CharacterSheetSectionsSlot.name).toBe(
      "@vtt/characters/sheet-sections",
    );
  });

  describe("CreateCharacter", () => {
    it("player dispatch spawns Character + OwnedBy on the dispatcher", async () => {
      const seen: string[] = [];
      bus.onAny((e) => seen.push(e.type));
      const id = await makeCharacter(pipeline, world);
      expect(seen).toEqual([CharacterCreated.name]);
      const got = world.get(id, [Character, OwnedBy]) as {
        Character: { name: string };
        OwnedBy: { userId: string };
      };
      expect(got.Character.name).toBe("Tarn");
      expect(got.OwnedBy.userId).toBe(PLAYER.userId);
    });

    it("GM may create a character on behalf of another user", async () => {
      const id = await makeCharacter(pipeline, world, GM, {
        name: "GM-made",
        ownerUserId: PLAYER.userId,
      });
      const got = world.get(id, [OwnedBy]) as { OwnedBy: { userId: string } };
      expect(got.OwnedBy.userId).toBe(PLAYER.userId);
    });

    it("rejects a player trying to create a character for someone else", async () => {
      const res = await dispatch(
        pipeline,
        CreateCharacter({
          name: "Spoof",
          ownerUserId: OTHER_PLAYER.userId,
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
      expect(world.query([Character])).toHaveLength(0);
    });

    it("ignores ownerUserId when it matches the dispatcher's own id", async () => {
      const id = await makeCharacter(pipeline, world, PLAYER, {
        name: "Tarn",
        ownerUserId: PLAYER.userId,
      });
      const got = world.get(id, [OwnedBy]) as { OwnedBy: { userId: string } };
      expect(got.OwnedBy.userId).toBe(PLAYER.userId);
    });

    it("rejects an unauthenticated dispatch", async () => {
      const res = await dispatch(
        pipeline,
        CreateCharacter({ name: "Anon" }),
        undefined,
      );
      expect(res.result.ok).toBe(false);
      expect(world.query([Character])).toHaveLength(0);
    });

    it("rejects empty name at the schema layer", () => {
      expect(() => CreateCharacter({ name: "" })).toThrow();
    });

    it("rejects names over 120 chars at the schema layer", () => {
      expect(() => CreateCharacter({ name: "a".repeat(121) })).toThrow();
    });
  });

  describe("RenameCharacter", () => {
    it("owner renames their own character", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        RenameCharacter({ characterId: id, name: "Tarn the Bold" }),
        PLAYER,
      );
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([CharacterRenamed.name]);
      const got = world.get(id, [Character]) as {
        Character: { name: string };
      };
      expect(got.Character.name).toBe("Tarn the Bold");
    });

    it("GM renames any character", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        RenameCharacter({ characterId: id, name: "Renamed by GM" }),
        GM,
      );
      expect(res.result.ok).toBe(true);
      const got = world.get(id, [Character]) as {
        Character: { name: string };
      };
      expect(got.Character.name).toBe("Renamed by GM");
    });

    it("non-owner non-GM is rejected", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        RenameCharacter({ characterId: id, name: "Hax" }),
        OTHER_PLAYER,
      );
      expect(res.result.ok).toBe(false);
      const got = world.get(id, [Character]) as {
        Character: { name: string };
      };
      expect(got.Character.name).toBe("Tarn");
    });

    it("rejects rename of a non-existent character", async () => {
      const res = await dispatch(
        pipeline,
        RenameCharacter({
          characterId: "ghost" as EntityId,
          name: "X",
        }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects rename of an entity that isn't a character", async () => {
      // Spawn a bare entity with only OwnedBy — no Character trait.
      const stranger = world.spawn([OwnedBy({ userId: PLAYER.userId })]);
      const res = await dispatch(
        pipeline,
        RenameCharacter({ characterId: stranger, name: "Nope" }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects empty name at the schema layer", () => {
      expect(() =>
        RenameCharacter({ characterId: "x" as EntityId, name: "" }),
      ).toThrow();
    });
  });

  describe("RemoveCharacter", () => {
    it("owner removes their own character", async () => {
      const id = await makeCharacter(pipeline, world);
      expect(world.has(id)).toBe(true);
      const res = await dispatch(
        pipeline,
        RemoveCharacter({ characterId: id }),
        PLAYER,
      );
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([CharacterRemoved.name]);
      expect(world.has(id)).toBe(false);
    });

    it("GM removes any character", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        RemoveCharacter({ characterId: id }),
        GM,
      );
      expect(res.result.ok).toBe(true);
      expect(world.has(id)).toBe(false);
    });

    it("non-owner non-GM is rejected", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        RemoveCharacter({ characterId: id }),
        OTHER_PLAYER,
      );
      expect(res.result.ok).toBe(false);
      expect(world.has(id)).toBe(true);
    });

    it("rejects removal of a non-existent character", async () => {
      const res = await dispatch(
        pipeline,
        RemoveCharacter({ characterId: "ghost" as EntityId }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });
  });

  describe("systems", () => {
    it("CharacterSpawningSystem is wired to CharacterCreated and writes Character + OwnedBy", () => {
      expect(CharacterSpawningSystem.name).toBe("CharacterSpawning");
      expect(CharacterSpawningSystem.on.name).toBe(CharacterCreated.name);
      const writes = CharacterSpawningSystem.writes.map((t) => t.name);
      expect(writes).toEqual(
        expect.arrayContaining([Character.name, OwnedBy.name]),
      );
    });

    it("CharacterRenameSystem reads + writes Character", () => {
      expect(CharacterRenameSystem.on.name).toBe(CharacterRenamed.name);
      expect(CharacterRenameSystem.reads.map((t) => t.name)).toContain(
        Character.name,
      );
      expect(CharacterRenameSystem.writes.map((t) => t.name)).toContain(
        Character.name,
      );
    });

    it("CharacterRenameSystem is a no-op for a despawned character id", () => {
      const events = CharacterRenameSystem.run({
        event: { characterId: "ghost" as EntityId, name: "x" } as never,
        world,
      });
      expect(events).toEqual([]);
    });

    it("CharacterRemovalSystem is a no-op for a despawned character id", () => {
      const events = CharacterRemovalSystem.run({
        event: { characterId: "ghost" as EntityId } as never,
        world,
      });
      expect(events).toEqual([]);
    });
  });
});
