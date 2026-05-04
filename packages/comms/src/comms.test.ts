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
  definePlugin,
  type EntityId,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { Permissions } from "@vtt/permissions/shared";
import { Character } from "@vtt/characters/shared";
import {
  ChatMessage,
  MessageSent,
  SendMessage,
} from "./shared/index.js";
import { MessageRecordingSystem } from "./server/systems.js";

const serverPlugin = definePlugin({
  name: "@vtt/comms",
  version: "0.1.0",
  traits: [ChatMessage, Permissions, Character],
  events: [MessageSent],
  commands: [SendMessage],
  systems: [MessageRecordingSystem],
});

const SESSION: AuthSession = {
  userId: "user-1",
  email: "hero@test.dev",
  name: "Hero",
  role: "gm",
};

function setup() {
  const registry = new Registry();
  registry.load(serverPlugin);
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  return { registry, world, bus, pipeline };
}

function dispatch(
  pipeline: CommandPipeline,
  id: string,
  cmd: ReturnType<typeof SendMessage>,
  session: unknown = SESSION,
) {
  return pipeline.dispatch({
    id,
    issuedBy: "tester",
    issuedAt: Date.now(),
    cmd,
    session,
  });
}

describe("@vtt/comms", () => {
  let pipeline: CommandPipeline;
  let world: World;
  let bus: EventBus;

  beforeEach(() => {
    ({ pipeline, world, bus } = setup());
  });

  it("uses plugin-namespaced ubiquitous-language names", () => {
    expect(SendMessage.name).toBe("@vtt/comms/SendMessage");
    expect(MessageSent.name).toBe("@vtt/comms/MessageSent");
    expect(ChatMessage.name).toBe("@vtt/comms/ChatMessage");
  });

  it("rejects an unauthenticated dispatch", async () => {
    const res = await pipeline.dispatch({
      id: "m1",
      issuedBy: "tester",
      issuedAt: Date.now(),
      cmd: SendMessage({ body: "hi" }),
      // session intentionally omitted
    });
    expect(res.result.ok).toBe(false);
    expect(world.query([ChatMessage])).toHaveLength(0);
  });

  it("public message → MessageSent → entity carrying ChatMessage with read=everyone Permissions", async () => {
    const seen: string[] = [];
    bus.onAny((e) => seen.push(e.type));

    const res = await dispatch(pipeline, "m1", SendMessage({ body: "hello world" }));

    expect(res.result.ok).toBe(true);
    expect(seen).toEqual([MessageSent.name]);
    const rows = world.query([ChatMessage, Permissions]);
    expect(rows).toHaveLength(1);
    const v = rows[0]!.values as {
      ChatMessage: { authorUserId: string; authorName: string; body: string; whisperTo?: string[] };
      Permissions: { read: { kind: string } };
    };
    expect(v.ChatMessage.authorUserId).toBe(SESSION.userId);
    expect(v.ChatMessage.authorName).toBe(SESSION.name);
    expect(v.ChatMessage.body).toBe("hello world");
    expect(v.ChatMessage.whisperTo).toBeUndefined();
    expect(v.Permissions.read.kind).toBe("everyone");
  });

  it("whisper attaches users-only Permissions containing both sender and recipient", async () => {
    await dispatch(
      pipeline,
      "m1",
      SendMessage({ body: "psst", whisperTo: ["user-2"] }),
    );
    const row = world.query([ChatMessage, Permissions])[0]!;
    const v = row.values as {
      ChatMessage: { whisperTo?: string[] };
      Permissions: { read: { kind: string; userIds?: string[] } };
    };
    expect(v.Permissions.read.kind).toBe("users");
    expect(v.Permissions.read.userIds).toEqual(
      expect.arrayContaining([SESSION.userId, "user-2"]),
    );
    expect(v.ChatMessage.whisperTo).toEqual(
      expect.arrayContaining([SESSION.userId, "user-2"]),
    );
  });

  it("whisper event itself is broadcast with users-restricted visibility", async () => {
    let captured: { visibility?: { kind: string; userIds?: string[] } } | null = null;
    bus.on(MessageSent.name, (e) => {
      captured = { visibility: (e as { visibility?: { kind: string; userIds?: string[] } }).visibility };
    });
    await dispatch(
      pipeline,
      "m1",
      SendMessage({ body: "psst", whisperTo: ["user-2"] }),
    );
    expect(captured!.visibility?.kind).toBe("users");
    expect(captured!.visibility?.userIds).toEqual(
      expect.arrayContaining([SESSION.userId, "user-2"]),
    );
  });

  it("rejects messages over the size limit at the schema layer", () => {
    expect(() => SendMessage({ body: "x".repeat(2001) })).toThrow();
  });

  it("rejects empty messages at the schema layer", () => {
    expect(() => SendMessage({ body: "" })).toThrow();
  });

  describe("gm-only visibility", () => {
    const PLAYER: AuthSession = {
      userId: "player-1",
      email: "p@test.dev",
      name: "Player",
      role: "player",
    };

    it("a GM may send a gm-only message; entity gets role-based visibility", async () => {
      const res = await dispatch(
        pipeline,
        "m1",
        SendMessage({ body: "secret", visibility: "gm-only" }),
      );
      expect(res.result.ok).toBe(true);
      const row = world.query([ChatMessage, Permissions])[0]!;
      const v = row.values as {
        ChatMessage: { visibility?: string };
        Permissions: { read: { kind: string; role?: string } };
      };
      expect(v.ChatMessage.visibility).toBe("gm-only");
      expect(v.Permissions.read).toEqual({
        kind: "role",
        role: "gm",
      });
    });

    it("rejects gm-only from a non-GM player", async () => {
      const res = await dispatch(
        pipeline,
        "m1",
        SendMessage({ body: "boo", visibility: "gm-only" }),
        PLAYER,
      );
      expect(res.result.ok).toBe(false);
      expect(world.query([ChatMessage])).toHaveLength(0);
    });

    it("default visibility is 'public' (everyone)", async () => {
      await dispatch(pipeline, "m1", SendMessage({ body: "hi" }));
      const row = world.query([ChatMessage, Permissions])[0]!;
      const v = row.values as {
        ChatMessage: { visibility?: string };
        Permissions: { read: { kind: string } };
      };
      expect(v.ChatMessage.visibility).toBe("public");
      expect(v.Permissions.read.kind).toBe("everyone");
    });

    it("whisper wins over gm-only — entity restricted to listed users", async () => {
      await dispatch(
        pipeline,
        "m1",
        SendMessage({
          body: "psst",
          whisperTo: ["user-2"],
          visibility: "gm-only",
        }),
      );
      const row = world.query([ChatMessage, Permissions])[0]!;
      const v = row.values.Permissions as {
        read: { kind: string; userIds?: string[] };
      };
      expect(v.read.kind).toBe("users");
      expect(v.read.userIds).toEqual(
        expect.arrayContaining([SESSION.userId, "user-2"]),
      );
    });
  });

  describe("speakingAsCharacterId", () => {
    function spawnCharacter(
      world: World,
      args: { name: string; writers: string[] },
    ): EntityId {
      return world.spawn([
        Character({ name: args.name }),
        Permissions({
          read: { kind: "everyone" },
          write: { kind: "users", userIds: args.writers },
        }),
      ]);
    }

    it("uses the character's name as authorName when the user can write the character", async () => {
      const charId = spawnCharacter(world, {
        name: "Tarn",
        writers: [SESSION.userId],
      });
      const res = await dispatch(
        pipeline,
        "m1",
        SendMessage({ body: "for honour", speakingAsCharacterId: charId }),
      );
      expect(res.result.ok).toBe(true);
      const row = world.query([ChatMessage]).at(-1)!;
      const v = row.values.ChatMessage as {
        authorName: string;
        authorUserId: string;
        speakingAsCharacterId?: string;
      };
      expect(v.authorName).toBe("Tarn");
      expect(v.authorUserId).toBe(SESSION.userId);
      expect(v.speakingAsCharacterId).toBe(charId);
    });

    it("rejects speak-as when the dispatcher isn't in Permissions.write", async () => {
      const charId = spawnCharacter(world, {
        name: "Other's PC",
        writers: ["user-2"],
      });
      const player: AuthSession = {
        userId: "player-1",
        email: "p@test.dev",
        name: "Player",
        role: "player",
      };
      const res = await dispatch(
        pipeline,
        "m1",
        SendMessage({ body: "spoof", speakingAsCharacterId: charId }),
        player,
      );
      expect(res.result.ok).toBe(false);
      expect(world.query([ChatMessage])).toHaveLength(0);
    });

    it("GM may speak as any character (universal write bypass)", async () => {
      const charId = spawnCharacter(world, {
        name: "NPC",
        writers: ["someone-else"],
      });
      const res = await dispatch(
        pipeline,
        "m1",
        SendMessage({ body: "boo", speakingAsCharacterId: charId }),
      );
      expect(res.result.ok).toBe(true);
      const row = world.query([ChatMessage]).at(-1)!;
      const v = row.values.ChatMessage as { authorName: string };
      expect(v.authorName).toBe("NPC");
    });

    it("rejects speak-as on a non-existent entity", async () => {
      const res = await dispatch(
        pipeline,
        "m1",
        SendMessage({
          body: "ghost",
          speakingAsCharacterId: "ghost" as EntityId,
        }),
      );
      expect(res.result.ok).toBe(false);
      expect(world.query([ChatMessage])).toHaveLength(0);
    });

    it("rejects speak-as on an entity that lacks the Character trait", async () => {
      const stranger = world.spawn([
        Permissions({
          read: { kind: "everyone" },
          write: { kind: "users", userIds: [SESSION.userId] },
        }),
      ]);
      const res = await dispatch(
        pipeline,
        "m1",
        SendMessage({ body: "huh", speakingAsCharacterId: stranger }),
      );
      expect(res.result.ok).toBe(false);
    });
  });
});
