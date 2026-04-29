import WebSocket from "ws";
import { startServer } from "@vtt/substrate/server";
import { definePlugin, InMemoryWorldsRepository } from "@vtt/substrate";
import { Ping, PingReceived, Pong } from "@vtt/ping/shared";
import { PongRecordingSystem } from "@vtt/ping/server";
import { shellDefault } from "@vtt/shell-default";

// Marker game-system plugin for the smoke. Real installs use
// @vtt/system-simple etc.; the smoke just needs *some* plugin to be
// the world's chosen game system.
const pingPlugin = definePlugin({
  name: "@vtt/ping",
  version: "0.2.0",
  traits: [Pong],
  events: [PingReceived],
  commands: [Ping],
  systems: [PongRecordingSystem],
  gameSystem: true,
});

const worldsRepo = new InMemoryWorldsRepository();
await worldsRepo.migrate();
const world = await worldsRepo.insert({
  id: "smoke-world",
  name: "Smoke",
  gameSystemPlugin: pingPlugin.name,
  ownerUserId: "smoke-user",
});

const handle = await startServer({
  port: 0,
  infrastructure: [shellDefault],
  optional: [pingPlugin],
  worldsRepo,
});

const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?worldId=${world.id}`);

type Msg =
  | { kind: "hello"; clientId: string }
  | {
      kind: "event";
      seq: number;
      event: { type: string; payload: { message: string; pingedAt: number; pongedAt: number } };
    }
  | { kind: "ack"; commandId: string; ok: boolean; reason?: string };

const messages: Msg[] = [];
ws.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as Msg));

await new Promise<void>((r) => ws.on("open", () => r()));

const issuedAt = Date.now();
ws.send(
  JSON.stringify({
    kind: "command",
    id: "smoke-1",
    issuedAt,
    cmd: { type: Ping.name, payload: { message: "smoke", issuedAt } },
  }),
);

await new Promise((r) => setTimeout(r, 100));

const hello = messages.find((m): m is Msg & { kind: "hello" } => m.kind === "hello");
const event = messages.find((m): m is Msg & { kind: "event" } => m.kind === "event");
const ack = messages.find(
  (m): m is Msg & { kind: "ack" } => m.kind === "ack" && m.commandId === "smoke-1",
);

const assert = (cond: unknown, msg: string): void => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
};

assert(hello && hello.clientId, "expected hello with clientId");
assert(ack && ack.ok === true, "expected ack ok=true");
assert(event && event.event.type === PingReceived.name, "expected PingReceived event");
assert(event!.event.payload.message === "smoke", "expected message echoed");
assert(event!.event.payload.pingedAt === issuedAt, "expected pingedAt preserved");

const runtime = handle.worldsRegistry.get(world.id);
assert(runtime !== null, "expected runtime to exist for smoke world");
const rows = runtime!.world.query([Pong]);
assert(rows.length === 1, "expected exactly one Pong entity in the world");
assert(
  (rows[0]!.values as { Pong: { message: string } }).Pong.message === "smoke",
  "expected spawned entity to carry the message",
);

console.log("ok — wire protocol round-trips ping, system spawns Pong entity");
ws.close();
await handle.close();
process.exit(0);
