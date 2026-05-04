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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import WebSocket from "ws";
import { startServer, type ServerHandle } from "@vtt/substrate/server";
import { definePlugin, InMemoryWorldsRepository } from "@vtt/substrate";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "@vtt/notes";
import { characters } from "@vtt/characters";
import { scene } from "@vtt/scene";
import {
  CharacterTokenPlaced,
  CreateScene,
  CreateToken,
  LinkedCharacter,
  MoveToken,
  PlaceCharacterToken,
  Position,
  Scene,
  SceneCreated,
  Token,
  TokenCreated,
  TokenImage,
  TokenMoved,
} from "@vtt/scene/shared";
import {
  Character,
  CharacterToken,
  CharacterTokenImageSet,
  CreateCharacter,
  SetCharacterTokenImage,
} from "@vtt/characters/shared";
import { Permissions } from "@vtt/permissions/shared";
import type { AuthSession } from "@vtt/auth";

/**
 * Wire-protocol smoke for the scene plugin: create a scene, drop a
 * token, move it, and verify both the world state and the event stream.
 * Also exercises the icons asset mount + manifest endpoint to catch
 * regressions in the substrate's HTTP routing layer.
 */

const GM: AuthSession = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

const sceneTestSystem = definePlugin({
  name: "@vtt/scene-test-system",
  version: "0",
  dependsOn: ["@vtt/scene@^0"],
  gameSystem: true,
});

interface SnapshotMsg { kind: "snapshot"; atSeq: number }
interface EventMsg {
  kind: "event";
  seq: number;
  event: { type: string; payload: Record<string, unknown> };
}
interface AckMsg { kind: "ack"; commandId: string; ok: boolean; reason?: string }
type Msg =
  | { kind: "hello"; clientId: string }
  | SnapshotMsg
  | EventMsg
  | AckMsg
  | { kind: "synced" };

describe("scene wire smoke", () => {
  let handle: ServerHandle;
  let worldId: string;
  let baseURL: string;
  let ws: WebSocket;
  const messages: Msg[] = [];
  let fakeIcons: string;

  beforeAll(async () => {
    fakeIcons = mkdtempSync(resolve(tmpdir(), "vtt-icons-"));
    mkdirSync(resolve(fakeIcons, "lorc"), { recursive: true });
    writeFileSync(resolve(fakeIcons, "lorc", "sword.svg"), "<svg/>");
    writeFileSync(resolve(fakeIcons, "lorc", "shield.svg"), "<svg/>");

    const worldsRepo = new InMemoryWorldsRepository();
    await worldsRepo.migrate();
    const world = await worldsRepo.insert({
      id: "scene-smoke",
      name: "Scene smoke",
      gameSystemPlugin: sceneTestSystem.name,
      ownerUserId: GM.userId,
    });
    worldId = world.id;

    handle = await startServer({
      port: 0,
      infrastructure: [shellWorkbench, identity, permissions, notes],
      optional: [characters, scene, sceneTestSystem],
      worldsRepo,
      authenticateUpgrade: async () => GM,
      extractRecipient: (s) => {
        const sess = s as AuthSession | null;
        return sess ? { userId: sess.userId, role: sess.role } : null;
      },
      assetRoots: { "/icons/": fakeIcons },
      httpHandler: async (req, res) => {
        if (req.url !== "/api/icons/manifest") return false;
        const icons: { slug: string }[] = [];
        for (const a of readdirSync(fakeIcons, { withFileTypes: true })) {
          if (!a.isDirectory()) continue;
          for (const f of readdirSync(resolve(fakeIcons, a.name))) {
            if (f.endsWith(".svg")) {
              icons.push({ slug: `${a.name}/${f.replace(/\.svg$/, "")}` });
            }
          }
        }
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ icons }));
        return true;
      },
    });
    baseURL = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    if (ws && ws.readyState === ws.OPEN) ws.close();
    if (handle) await handle.close();
  });

  it("round-trips create/move and serves icons assets", async () => {
    ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?worldId=${worldId}`);
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as Msg));
    await new Promise<void>((r) => ws.on("open", () => r()));

    const send = (env: object) => ws.send(JSON.stringify(env));

    send({
      kind: "command",
      id: "create-scene",
      issuedAt: Date.now(),
      cmd: {
        type: CreateScene.name,
        payload: CreateScene({
          name: "Tomb",
          gridSize: 70,
          widthPx: 2100,
          heightPx: 1400,
          backgroundColor: "#1a1a1a",
        }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const sceneEntity = handle.worldsRegistry.get(worldId)!.world.query([Scene])[0];
    expect(sceneEntity).toBeDefined();

    send({
      kind: "command",
      id: "create-token",
      issuedAt: Date.now(),
      cmd: {
        type: CreateToken.name,
        payload: CreateToken({
          sceneId: sceneEntity!.id,
          iconSlug: "lorc/sword",
          tint: 0xffffff,
          size: 70,
          label: "goblin",
          kind: "creature",
          x: 0,
          y: 0,
        }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const tokenEntity = handle.worldsRegistry.get(worldId)!.world.query([Token])[0];
    expect(tokenEntity).toBeDefined();

    const before = handle.worldsRegistry.get(worldId)!.world.get(tokenEntity!.id, [Position]) as {
      Position: { movedAt: number };
    };

    send({
      kind: "command",
      id: "move-token",
      issuedAt: Date.now(),
      cmd: {
        type: MoveToken.name,
        payload: MoveToken({ tokenId: tokenEntity!.id, x: 175, y: 245 }).payload,
      },
      causalState: { lastSeenMovedAt: before.Position.movedAt },
    });
    await new Promise((r) => setTimeout(r, 80));

    const after = handle.worldsRegistry.get(worldId)!.world.get(tokenEntity!.id, [Position]) as {
      Position: { x: number; y: number; movedAt: number };
    };
    expect(after.Position.x).toBe(175);
    expect(after.Position.y).toBe(245);
    expect(after.Position.movedAt).toBeGreaterThan(before.Position.movedAt);

    const eventTypes = messages
      .filter((m): m is EventMsg => m.kind === "event")
      .map((m) => m.event.type);
    expect(eventTypes).toContain(SceneCreated.name);
    expect(eventTypes).toContain(TokenCreated.name);
    expect(eventTypes).toContain(TokenMoved.name);

    const acks = messages.filter((m): m is AckMsg => m.kind === "ack");
    expect(acks).toHaveLength(3);
    expect(acks.every((a) => a.ok)).toBe(true);

    const manifestRes = await fetch(`${baseURL}/api/icons/manifest`);
    expect(manifestRes.ok).toBe(true);
    const manifest = (await manifestRes.json()) as { icons: { slug: string }[] };
    expect(manifest.icons.some((i) => i.slug === "lorc/sword")).toBe(true);

    const iconRes = await fetch(`${baseURL}/icons/lorc/sword.svg`);
    expect(iconRes.ok).toBe(true);
    const iconBody = await iconRes.text();
    expect(iconBody).toContain("<svg");
  });

  it("end-to-end: SetCharacterTokenImage + PlaceCharacterToken round-trip", async () => {
    // Continue using the same WebSocket — the previous test already
    // created a Scene + a non-character token. We add a Character,
    // upload its portrait URL via SetCharacterTokenImage, then place
    // the character on the scene and verify both the trait shape and
    // place-once enforcement.
    const runtime = handle.worldsRegistry.get(worldId)!;
    const sceneId = runtime.world.query([Scene])[0]!.id;
    const send = (env: object) => ws.send(JSON.stringify(env));

    send({
      kind: "command",
      id: "create-character",
      issuedAt: Date.now(),
      cmd: {
        type: CreateCharacter.name,
        payload: CreateCharacter({ name: "Tarn" }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const charEntity = runtime.world.query([Character, Permissions])[0];
    expect(charEntity).toBeDefined();
    const charId = charEntity!.id;

    const url = `/plugin-data/${worldId}/@vtt/characters/characters/${charId}/token.png?v=42`;
    send({
      kind: "command",
      id: "set-character-image",
      issuedAt: Date.now(),
      cmd: {
        type: SetCharacterTokenImage.name,
        payload: SetCharacterTokenImage({
          characterId: charId,
          imageUrl: url,
        }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const ct = runtime.world.get(charId, [CharacterToken]) as
      | { CharacterToken: { imageUrl: string | null } }
      | undefined;
    expect(ct?.CharacterToken.imageUrl).toBe(url);

    send({
      kind: "command",
      id: "place-character",
      issuedAt: Date.now(),
      cmd: {
        type: PlaceCharacterToken.name,
        payload: PlaceCharacterToken({
          sceneId,
          characterId: charId,
          iconSlug: "person",
          imageUrl: url,
          tint: 0xffffff,
          size: 70,
          label: "Tarn",
          x: 105,
          y: 105,

        }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const linkedRows = runtime.world.query([LinkedCharacter, Position]);
    const linked = linkedRows.find((r) => {
      const lc = r.values.LinkedCharacter as { characterId: string };
      const pos = r.values.Position as { sceneId: string };
      return lc.characterId === charId && pos.sceneId === sceneId;
    });
    expect(linked).toBeDefined();
    const tokenImage = runtime.world.get(linked!.id, [TokenImage]) as
      | { TokenImage: { url: string } }
      | undefined;
    expect(tokenImage?.TokenImage.url).toBe(url);

    // Place-once: a second placement of the same character on the
    // same scene must fail.
    send({
      kind: "command",
      id: "place-character-again",
      issuedAt: Date.now(),
      cmd: {
        type: PlaceCharacterToken.name,
        payload: PlaceCharacterToken({
          sceneId,
          characterId: charId,
          iconSlug: "person",
          imageUrl: url,
          tint: 0xffffff,
          size: 70,
          label: "Tarn II",
          x: 245,
          y: 245,

        }).payload,
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const acks = messages.filter((m): m is AckMsg => m.kind === "ack");
    const placeAgain = acks.find((a) => a.commandId === "place-character-again");
    expect(placeAgain).toBeDefined();
    expect(placeAgain!.ok).toBe(false);

    // Still exactly one linked token for this character on this scene.
    const placedAfter = runtime.world
      .query([LinkedCharacter, Position])
      .filter((r) => {
        const lc = r.values.LinkedCharacter as { characterId: string };
        const pos = r.values.Position as { sceneId: string };
        return lc.characterId === charId && pos.sceneId === sceneId;
      });
    expect(placedAfter).toHaveLength(1);

    const eventTypes = messages
      .filter((m): m is EventMsg => m.kind === "event")
      .map((m) => m.event.type);
    expect(eventTypes).toContain(CharacterTokenImageSet.name);
    expect(eventTypes).toContain(CharacterTokenPlaced.name);
  });
});
