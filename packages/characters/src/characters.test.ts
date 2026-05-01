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

import { describe, it, expect, beforeEach } from "vitest";
import {
  CommandPipeline,
  EventBus,
  Registry,
  World,
  defineTrait,
  definePlugin,
  z,
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { OwnedBy } from "@vtt/permissions/shared";
import {
  AssignCharacter,
  Character,
  CharacterAssigned,
  CharacterCreated,
  CharacterFieldSet,
  CharacterRemoved,
  CharacterRenamed,
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
  CharacterToken,
  CharacterTokenImageSet,
  CreateCharacter,
  RemoveCharacter,
  RenameCharacter,
  SetCharacterTokenImage,
  SetField,
} from "./shared/index.js";
import {
  CharacterAssignmentSystem,
  CharacterFieldSetSystem,
  CharacterRemovalSystem,
  CharacterRenameSystem,
  CharacterSpawningSystem,
  CharacterTokenImageSetSystem,
} from "./server/systems.js";

// Synthetic game-system trait for SetField tests — a small ability-scores
// shape with a Zod default. Lets us exercise both "trait already attached"
// and "trait absent but defaulted" code paths.
const TestAbilities = defineTrait({
  name: "@test/sheet/Abilities",
  schema: z
    .object({
      str: z.number().int().min(1).max(30).default(10),
      dex: z.number().int().min(1).max(30).default(10),
    })
    .default({ str: 10, dex: 10 }),
});

const charactersServerPlugin = definePlugin({
  name: "@vtt/characters",
  version: "0.1.0",
  traits: [Character, CharacterToken, OwnedBy, TestAbilities],
  events: [
    CharacterCreated,
    CharacterRenamed,
    CharacterRemoved,
    CharacterAssigned,
    CharacterFieldSet,
    CharacterTokenImageSet,
  ],
  commands: [
    CreateCharacter,
    RemoveCharacter,
    RenameCharacter,
    AssignCharacter,
    SetCharacterTokenImage,
    SetField,
  ],
  systems: [
    CharacterSpawningSystem,
    CharacterRenameSystem,
    CharacterRemovalSystem,
    CharacterAssignmentSystem,
    CharacterFieldSetSystem,
    CharacterTokenImageSetSystem,
  ],
  slots: [
    CharacterSheetIdentitySlot,
    CharacterSheetVitalsSlot,
    CharacterSheetStatusSlot,
    CharacterSheetTabsSlot,
    CharacterSheetActionsSlot,
  ],
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
  payload: { name: string; ownerUserId?: string; playerUserId?: string } = {
    name: "Tarn",
  },
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
  let registry: Registry;

  beforeEach(() => {
    ({ pipeline, world, bus, registry } = setup());
  });

  it("uses plugin-namespaced ubiquitous-language names", () => {
    expect(CreateCharacter.name).toBe("@vtt/characters/CreateCharacter");
    expect(RenameCharacter.name).toBe("@vtt/characters/RenameCharacter");
    expect(RemoveCharacter.name).toBe("@vtt/characters/RemoveCharacter");
    expect(AssignCharacter.name).toBe("@vtt/characters/AssignCharacter");
    expect(CharacterCreated.name).toBe("@vtt/characters/CharacterCreated");
    expect(CharacterRenamed.name).toBe("@vtt/characters/CharacterRenamed");
    expect(CharacterRemoved.name).toBe("@vtt/characters/CharacterRemoved");
    expect(CharacterAssigned.name).toBe("@vtt/characters/CharacterAssigned");
    expect(Character.name).toBe("@vtt/characters/Character");
    expect(CharacterSheetIdentitySlot.name).toBe(
      "@vtt/characters/sheet-identity",
    );
    expect(CharacterSheetVitalsSlot.name).toBe(
      "@vtt/characters/sheet-vitals",
    );
    expect(CharacterSheetStatusSlot.name).toBe(
      "@vtt/characters/sheet-status",
    );
    expect(CharacterSheetTabsSlot.name).toBe("@vtt/characters/sheet-tabs");
    expect(CharacterSheetActionsSlot.name).toBe(
      "@vtt/characters/sheet-actions",
    );
  });

  describe("CreateCharacter", () => {
    it("player dispatch spawns Character + OwnedBy on the dispatcher and self-assigns", async () => {
      const seen: string[] = [];
      bus.onAny((e) => seen.push(e.type));
      const id = await makeCharacter(pipeline, world);
      expect(seen).toEqual([CharacterCreated.name]);
      const got = world.get(id, [Character, OwnedBy]) as {
        Character: { name: string; playerUserId?: string };
        OwnedBy: { userId: string };
      };
      expect(got.Character.name).toBe("Tarn");
      expect(got.Character.playerUserId).toBe(PLAYER.userId);
      expect(got.OwnedBy.userId).toBe(PLAYER.userId);
    });

    it("GM creating an unassigned character (playerUserId='') leaves it without an assignee", async () => {
      const id = await makeCharacter(pipeline, world, GM, {
        name: "NPC",
        playerUserId: "",
      });
      const got = world.get(id, [Character]) as {
        Character: { name: string; playerUserId?: string };
      };
      expect(got.Character.playerUserId).toBeUndefined();
    });

    it("GM may create a character assigned to a specific player", async () => {
      const id = await makeCharacter(pipeline, world, GM, {
        name: "Assigned",
        ownerUserId: PLAYER.userId,
        playerUserId: OTHER_PLAYER.userId,
      });
      const got = world.get(id, [Character, OwnedBy]) as {
        Character: { playerUserId?: string };
        OwnedBy: { userId: string };
      };
      expect(got.OwnedBy.userId).toBe(PLAYER.userId);
      expect(got.Character.playerUserId).toBe(OTHER_PLAYER.userId);
    });

    it("rejects a player trying to create a character assigned to someone else", async () => {
      const res = await dispatch(
        pipeline,
        CreateCharacter({
          name: "Spoof",
          playerUserId: OTHER_PLAYER.userId,
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
      expect(world.query([Character])).toHaveLength(0);
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

  describe("AssignCharacter", () => {
    it("owner reassigns their own character to another player", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        AssignCharacter({
          characterId: id,
          playerUserId: OTHER_PLAYER.userId,
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([
        CharacterAssigned.name,
      ]);
      const got = world.get(id, [Character]) as {
        Character: { name: string; playerUserId?: string };
      };
      expect(got.Character.playerUserId).toBe(OTHER_PLAYER.userId);
    });

    it("clearing assignment with empty string leaves playerUserId undefined", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        AssignCharacter({ characterId: id, playerUserId: "" }),
        PLAYER,
      );
      expect(res.result.ok).toBe(true);
      const got = world.get(id, [Character]) as {
        Character: { playerUserId?: string };
      };
      expect(got.Character.playerUserId).toBeUndefined();
    });

    it("GM reassigns any character", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        AssignCharacter({
          characterId: id,
          playerUserId: OTHER_PLAYER.userId,
        }),
        GM,
      );
      expect(res.result.ok).toBe(true);
      const got = world.get(id, [Character]) as {
        Character: { playerUserId?: string };
      };
      expect(got.Character.playerUserId).toBe(OTHER_PLAYER.userId);
    });

    it("non-owner non-GM is rejected", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        AssignCharacter({
          characterId: id,
          playerUserId: OTHER_PLAYER.userId,
        }),
        OTHER_PLAYER,
      );
      expect(res.result.ok).toBe(false);
      const got = world.get(id, [Character]) as {
        Character: { playerUserId?: string };
      };
      expect(got.Character.playerUserId).toBe(PLAYER.userId);
    });

    it("rename preserves the assignment", async () => {
      const id = await makeCharacter(pipeline, world);
      await dispatch(
        pipeline,
        AssignCharacter({
          characterId: id,
          playerUserId: OTHER_PLAYER.userId,
        }),
        GM,
      );
      await dispatch(
        pipeline,
        RenameCharacter({ characterId: id, name: "Tarn II" }),
        GM,
      );
      const got = world.get(id, [Character]) as {
        Character: { name: string; playerUserId?: string };
      };
      expect(got.Character.name).toBe("Tarn II");
      expect(got.Character.playerUserId).toBe(OTHER_PLAYER.userId);
    });

    it("rejects assignment of a non-existent character", async () => {
      const res = await dispatch(
        pipeline,
        AssignCharacter({
          characterId: "ghost" as EntityId,
          playerUserId: PLAYER.userId,
        }),
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
        registry,
      });
      expect(events).toEqual([]);
    });

    it("CharacterRemovalSystem is a no-op for a despawned character id", () => {
      const events = CharacterRemovalSystem.run({
        event: { characterId: "ghost" as EntityId } as never,
        world,
        registry,
      });
      expect(events).toEqual([]);
    });

    it("CharacterAssignmentSystem is wired to CharacterAssigned and writes Character", () => {
      expect(CharacterAssignmentSystem.name).toBe("CharacterAssignment");
      expect(CharacterAssignmentSystem.on.name).toBe(
        CharacterAssigned.name,
      );
      expect(CharacterAssignmentSystem.writes.map((t) => t.name)).toContain(
        Character.name,
      );
    });

    it("CharacterAssignmentSystem is a no-op for a despawned character id", () => {
      const events = CharacterAssignmentSystem.run({
        event: {
          characterId: "ghost" as EntityId,
          playerUserId: "x",
        } as never,
        world,
        registry,
      });
      expect(events).toEqual([]);
    });
  });

  describe("SetField", () => {
    it("rejects writes by a non-owner non-GM", async () => {
      const id = await makeCharacter(pipeline, world, PLAYER, { name: "Aelric" });
      world.set(id, TestAbilities, { str: 10, dex: 10 });
      const res = await dispatch(
        pipeline,
        SetField({
          characterId: id,
          trait: TestAbilities.name,
          path: ["str"],
          value: 16,
        }),
        OTHER_PLAYER,
      );
      expect(res.result.ok).toBe(false);
    });

    it("owner edits a field via path; system writes the new value", async () => {
      const id = await makeCharacter(pipeline, world, PLAYER, { name: "Aelric" });
      // Attach the trait first.
      world.set(id, TestAbilities, { str: 10, dex: 10 });
      const res = await dispatch(
        pipeline,
        SetField({
          characterId: id,
          trait: TestAbilities.name,
          path: ["str"],
          value: 16,
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(true);
      const got = world.get(id, [TestAbilities]) as
        | { Abilities: { str: number; dex: number } }
        | undefined;
      expect(got).toBeDefined();
      expect(got!.Abilities).toEqual({ str: 16, dex: 10 });
    });

    it("attaches a defaulted trait on first edit (no need to pre-spawn)", async () => {
      const id = await makeCharacter(pipeline, world, PLAYER, { name: "Aelric" });
      // TestAbilities is NOT attached yet — its schema default kicks in.
      const res = await dispatch(
        pipeline,
        SetField({
          characterId: id,
          trait: TestAbilities.name,
          path: ["str"],
          value: 18,
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(true);
      const got = world.get(id, [TestAbilities]) as
        | { Abilities: { str: number; dex: number } }
        | undefined;
      expect(got).toBeDefined();
      expect(got!.Abilities).toEqual({ str: 18, dex: 10 });
    });

    it("rejects writes that fail the trait schema", async () => {
      const id = await makeCharacter(pipeline, world, PLAYER, { name: "Aelric" });
      world.set(id, TestAbilities, { str: 10, dex: 10 });
      const res = await dispatch(
        pipeline,
        SetField({
          characterId: id,
          trait: TestAbilities.name,
          path: ["str"],
          value: 100, // out of [1..30]
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects writes to an unknown trait", async () => {
      const id = await makeCharacter(pipeline, world, PLAYER, { name: "Aelric" });
      const res = await dispatch(
        pipeline,
        SetField({
          characterId: id,
          trait: "@vtt/never/Registered",
          path: [],
          value: { foo: 1 },
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
    });

    it("GM can edit any character's fields", async () => {
      const id = await makeCharacter(pipeline, world, PLAYER, { name: "Aelric" });
      world.set(id, TestAbilities, { str: 10, dex: 10 });
      const res = await dispatch(
        pipeline,
        SetField({
          characterId: id,
          trait: TestAbilities.name,
          path: ["dex"],
          value: 20,
        }),
        GM,
      );
      expect(res.result.ok).toBe(true);
      const got = world.get(id, [TestAbilities]) as
        | { Abilities: { str: number; dex: number } }
        | undefined;
      expect(got!.Abilities.dex).toBe(20);
    });

    it("rejects edits to non-character entities", async () => {
      // Create a bare entity with no Character trait.
      const orphan = world.spawn([]);
      const res = await dispatch(
        pipeline,
        SetField({
          characterId: orphan,
          trait: TestAbilities.name,
          path: ["str"],
          value: 14,
        }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("emits a CharacterFieldSet event on success", async () => {
      const id = await makeCharacter(pipeline, world, PLAYER, { name: "Aelric" });
      world.set(id, TestAbilities, { str: 10, dex: 10 });
      const events: string[] = [];
      bus.onAny((e) => events.push(e.type));
      await dispatch(
        pipeline,
        SetField({
          characterId: id,
          trait: TestAbilities.name,
          path: ["str"],
          value: 12,
        }),
        PLAYER,
      );
      expect(events).toContain(CharacterFieldSet.name);
    });
  });

  describe("SetCharacterTokenImage", () => {
    const goodUrl = (charId: string) =>
      `/plugin-data/${world.worldId}/@vtt/characters/characters/${charId}/token.png?v=42`;

    it("attaches a CharacterToken trait when the owner uploads", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        SetCharacterTokenImage({
          characterId: id,
          imageUrl: goodUrl(id),
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(true);
      expect(res.events.map((e) => e.type)).toEqual([
        CharacterTokenImageSet.name,
      ]);
      const got = world.get(id, [CharacterToken]) as
        | { CharacterToken: { imageUrl: string | null } }
        | undefined;
      expect(got).toBeDefined();
      expect(got!.CharacterToken.imageUrl).toBe(goodUrl(id));
    });

    it("GM may upload for any character", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        SetCharacterTokenImage({
          characterId: id,
          imageUrl: goodUrl(id),
        }),
        GM,
      );
      expect(res.result.ok).toBe(true);
    });

    it("rejects upload by a non-owner non-GM", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        SetCharacterTokenImage({
          characterId: id,
          imageUrl: goodUrl(id),
        }),
        OTHER_PLAYER,
      );
      expect(res.result.ok).toBe(false);
      expect(world.get(id, [CharacterToken])).toBeUndefined();
    });

    it("rejects URLs outside the character's plugin-data prefix", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        SetCharacterTokenImage({
          characterId: id,
          imageUrl: "https://evil.example.com/lol.png",
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects URLs containing path traversal", async () => {
      const id = await makeCharacter(pipeline, world);
      const res = await dispatch(
        pipeline,
        SetCharacterTokenImage({
          characterId: id,
          imageUrl:
            `/plugin-data/${world.worldId}/@vtt/characters/characters/${id}/../../foo.png`,
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects when the URL targets a different character's prefix", async () => {
      const idA = await makeCharacter(pipeline, world);
      const idB = await makeCharacter(pipeline, world, OTHER_PLAYER, {
        name: "Other",
      });
      const res = await dispatch(
        pipeline,
        SetCharacterTokenImage({
          characterId: idA,
          imageUrl: goodUrl(idB),
        }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
    });

    it("clearing with imageUrl=null replaces the trait with null", async () => {
      const id = await makeCharacter(pipeline, world);
      await dispatch(
        pipeline,
        SetCharacterTokenImage({
          characterId: id,
          imageUrl: goodUrl(id),
        }),
        PLAYER,
      );
      const res = await dispatch(
        pipeline,
        SetCharacterTokenImage({ characterId: id, imageUrl: null }),
        PLAYER,
      );
      expect(res.result.ok).toBe(true);
      const got = world.get(id, [CharacterToken]) as
        | { CharacterToken: { imageUrl: string | null } }
        | undefined;
      expect(got).toBeDefined();
      expect(got!.CharacterToken.imageUrl).toBeNull();
    });

    it("rejects setting on a non-existent character", async () => {
      const res = await dispatch(
        pipeline,
        SetCharacterTokenImage({
          characterId: "ghost" as EntityId,
          imageUrl: null,
        }),
        GM,
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects setting on an entity that isn't a character", async () => {
      const stranger = world.spawn([OwnedBy({ userId: PLAYER.userId })]);
      const res = await dispatch(
        pipeline,
        SetCharacterTokenImage({ characterId: stranger, imageUrl: null }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
    });

    it("CharacterTokenImageSetSystem is wired and a no-op for despawned ids", () => {
      expect(CharacterTokenImageSetSystem.on.name).toBe(
        CharacterTokenImageSet.name,
      );
      const events = CharacterTokenImageSetSystem.run({
        event: {
          characterId: "ghost" as EntityId,
          imageUrl: null,
        } as never,
        world,
        registry,
      });
      expect(events).toEqual([]);
    });
  });
});
