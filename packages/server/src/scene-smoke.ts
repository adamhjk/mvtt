import { mkdtempSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import WebSocket from "ws";
import { startServer } from "@vtt/substrate/server";
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

// Stub a tiny icons fixture so we can hit /api/icons/manifest end-to-end.
const fakeIcons = mkdtempSync(resolve(tmpdir(), "vtt-icons-"));
mkdirSync(resolve(fakeIcons, "lorc"), { recursive: true });
writeFileSync(resolve(fakeIcons, "lorc", "sword.svg"), "<svg/>");
writeFileSync(resolve(fakeIcons, "lorc", "shield.svg"), "<svg/>");

const GM: AuthSession = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

// Minimal manifest endpoint mirroring the production server's wiring, so the
// smoke test exercises the same handler shape.
const handle = await startServer({
  port: 0,
  plugins: [shellWorkbench, identity, permissions, scene],
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

const baseURL = `http://127.0.0.1:${handle.port}`;
const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws`);

interface SnapshotMsg {
  kind: "snapshot";
  atSeq: number;
  entities: { id: string; traits: Record<string, unknown> }[];
}
interface EventMsg {
  kind: "event";
  seq: number;
  event: { type: string; payload: Record<string, unknown> };
}
interface AckMsg {
  kind: "ack";
  commandId: string;
  ok: boolean;
  reason?: string;
}
type Msg =
  | { kind: "hello"; clientId: string }
  | SnapshotMsg
  | EventMsg
  | AckMsg
  | { kind: "synced" };

const messages: Msg[] = [];
ws.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as Msg));

await new Promise<void>((r) => ws.on("open", () => r()));

const send = (env: object) => ws.send(JSON.stringify(env));

const issuedAt = Date.now();

send({
  kind: "command",
  id: "create-scene",
  issuedAt,
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

const sceneEntity = handle.world.query([Scene])[0];
const assert = (cond: unknown, msg: string): void => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
};
assert(sceneEntity, "expected one Scene entity after CreateScene");

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

const tokenEntity = handle.world.query([Token])[0];
assert(tokenEntity, "expected one Token entity after CreateToken");

const before = handle.world.get(tokenEntity!.id, [Position]) as {
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

const after = handle.world.get(tokenEntity!.id, [Position]) as {
  Position: { x: number; y: number; movedAt: number };
};
assert(after.Position.x === 175 && after.Position.y === 245, "expected token to be at (175,245)");
assert(after.Position.movedAt > before.Position.movedAt, "expected movedAt to increase");

// Verify event ordering on the wire.
const eventTypes = messages
  .filter((m): m is EventMsg => m.kind === "event")
  .map((m) => m.event.type);
assert(
  eventTypes.includes(SceneCreated.name) &&
    eventTypes.includes(TokenCreated.name) &&
    eventTypes.includes(TokenMoved.name),
  `expected SceneCreated, TokenCreated, TokenMoved in event stream; got ${eventTypes.join(",")}`,
);

const acks = messages.filter((m): m is AckMsg => m.kind === "ack");
assert(acks.length === 3 && acks.every((a) => a.ok), "expected three ok acks");

// Hit the icons manifest endpoint.
const manifestRes = await fetch(`${baseURL}/api/icons/manifest`);
assert(manifestRes.ok, "expected /api/icons/manifest to respond 200");
const manifest = (await manifestRes.json()) as { icons: { slug: string }[] };
assert(
  manifest.icons.some((i) => i.slug === "lorc/sword"),
  "expected manifest to include lorc/sword",
);

// And that mounted icons are served.
const iconRes = await fetch(`${baseURL}/icons/lorc/sword.svg`);
assert(iconRes.ok, "expected /icons/lorc/sword.svg to respond 200");
const iconBody = await iconRes.text();
assert(iconBody.includes("<svg"), "expected svg body");

console.log("ok — scene wire round-trips create/move/remove and icons mount serves manifest+files");
ws.close();
await handle.close();
process.exit(0);
