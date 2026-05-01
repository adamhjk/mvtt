// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { startServer, type ServerHandle } from "@vtt/substrate/server";
import { definePlugin, InMemoryWorldsRepository } from "@vtt/substrate";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "@vtt/notes";
import { characters } from "@vtt/characters";
import {
  Character,
  CharacterCreated,
  CharacterRemoved,
  CharacterRenamed,
  CreateCharacter,
  RemoveCharacter,
  RenameCharacter,
} from "@vtt/characters/shared";
import { OwnedBy } from "@vtt/permissions/shared";
import type { AuthSession } from "@vtt/auth";

/**
 * Wire-protocol smoke for the characters plugin: create, rename, remove
 * a character; verify the world state and event stream.
 */

const PLAYER: AuthSession = {
  userId: "player-1",
  email: "p@test.dev",
  name: "Player",
  role: "player",
};

const charactersTestSystem = definePlugin({
  name: "@vtt/characters-test-system",
  version: "0",
  dependsOn: ["@vtt/characters@^0"],
  gameSystem: true,
});

interface AckMsg { kind: "ack"; commandId: string; ok: boolean; reason?: string }
interface EventMsg {
  kind: "event";
  seq: number;
  event: { type: string; payload: Record<string, unknown> };
}
type Msg =
  | { kind: "hello"; clientId: string }
  | { kind: "snapshot"; atSeq: number; entities: { id: string }[] }
  | EventMsg
  | AckMsg
  | { kind: "synced" };

describe("characters wire smoke", () => {
  let handle: ServerHandle;
  let worldId: string;
  let ws: WebSocket;
  const messages: Msg[] = [];

  beforeAll(async () => {
    const worldsRepo = new InMemoryWorldsRepository();
    await worldsRepo.migrate();
    const world = await worldsRepo.insert({
      id: "characters-smoke",
      name: "Characters smoke",
      gameSystemPlugin: charactersTestSystem.name,
      ownerUserId: PLAYER.userId,
    });
    worldId = world.id;
    handle = await startServer({
      port: 0,
      infrastructure: [shellWorkbench, identity, permissions, notes],
      optional: [characters, charactersTestSystem],
      worldsRepo,
      authenticateUpgrade: async () => PLAYER,
      extractRecipient: (s) => {
        const sess = s as AuthSession | null;
        return sess ? { userId: sess.userId, role: sess.role } : null;
      },
    });
  });

  afterAll(async () => {
    if (ws && ws.readyState === ws.OPEN) ws.close();
    if (handle) await handle.close();
  });

  it("round-trips create/rename/remove over the wire", async () => {
    ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?worldId=${worldId}`);
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as Msg));
    await new Promise<void>((r) => ws.on("open", () => r()));

    const send = (env: object) => ws.send(JSON.stringify(env));

    send({
      kind: "command",
      id: "create-character",
      issuedAt: Date.now(),
      cmd: {
        type: CreateCharacter.name,
        payload: CreateCharacter({ name: "Tarn the Bold" }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const after = handle.worldsRegistry.get(worldId)!.world.query([Character]);
    expect(after).toHaveLength(1);
    const characterId = after[0]!.id;
    const initial = handle.worldsRegistry
      .get(worldId)!
      .world.get(characterId, [Character, OwnedBy]) as {
      Character: { name: string };
      OwnedBy: { userId: string };
    };
    expect(initial.Character.name).toBe("Tarn the Bold");
    expect(initial.OwnedBy.userId).toBe(PLAYER.userId);

    send({
      kind: "command",
      id: "rename-character",
      issuedAt: Date.now(),
      cmd: {
        type: RenameCharacter.name,
        payload: RenameCharacter({ characterId, name: "Tarn the Bolder" }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const renamed = handle.worldsRegistry
      .get(worldId)!
      .world.get(characterId, [Character]) as { Character: { name: string } };
    expect(renamed.Character.name).toBe("Tarn the Bolder");

    send({
      kind: "command",
      id: "remove-character",
      issuedAt: Date.now(),
      cmd: {
        type: RemoveCharacter.name,
        payload: RemoveCharacter({ characterId }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    expect(handle.worldsRegistry.get(worldId)!.world.has(characterId)).toBe(false);

    const eventTypes = messages
      .filter((m): m is EventMsg => m.kind === "event")
      .map((m) => m.event.type);
    expect(eventTypes).toContain(CharacterCreated.name);
    expect(eventTypes).toContain(CharacterRenamed.name);
    expect(eventTypes).toContain(CharacterRemoved.name);

    const acks = messages.filter((m): m is AckMsg => m.kind === "ack");
    expect(acks).toHaveLength(3);
    expect(acks.every((a) => a.ok)).toBe(true);
  });
});
