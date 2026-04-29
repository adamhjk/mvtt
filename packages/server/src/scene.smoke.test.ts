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
import { scene } from "@vtt/scene";
import {
  CreateScene,
  CreateToken,
  MoveToken,
  Position,
  Scene,
  SceneCreated,
  Token,
  TokenCreated,
  TokenMoved,
} from "@vtt/scene/shared";
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
      infrastructure: [shellWorkbench, identity, permissions],
      optional: [scene, sceneTestSystem],
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
});
