import WebSocket from "ws";
import { startServer } from "@vtt/substrate/server";
import { definePlugin, InMemoryWorldsRepository } from "@vtt/substrate";
import { Ping, PingReceived, Pong } from "@vtt/ping/shared";
import { PongRecordingSystem } from "@vtt/ping/server";
import { shellDefault } from "@vtt/shell-default";

/**
 * Two clients, two worlds, one process. Each client dispatches a Ping
 * and asserts that:
 *   - it only ever observes events for its own world
 *   - the other world's state was not mutated by the first client's command
 *
 * This is the substrate-level guarantee the user asked for: "we should
 * be able to have users logged in to different worlds playing at the
 * same time, and it should just work."
 */

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
const worldA = await worldsRepo.insert({
  id: "world-a",
  name: "Alpha",
  gameSystemPlugin: pingPlugin.name,
  ownerUserId: "user-a",
});
const worldB = await worldsRepo.insert({
  id: "world-b",
  name: "Beta",
  gameSystemPlugin: pingPlugin.name,
  ownerUserId: "user-b",
});

const handle = await startServer({
  port: 0,
  infrastructure: [shellDefault],
  optional: [pingPlugin],
  worldsRepo,
});

interface Msg {
  kind: string;
  worldId?: string;
  event?: { type: string; payload: { message: string } };
  commandId?: string;
  ok?: boolean;
}

async function connect(worldId: string): Promise<{
  ws: WebSocket;
  messages: Msg[];
}> {
  const ws = new WebSocket(
    `ws://127.0.0.1:${handle.port}/ws?worldId=${encodeURIComponent(worldId)}`,
  );
  const messages: Msg[] = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as Msg));
  await new Promise<void>((r) => ws.on("open", () => r()));
  return { ws, messages };
}

const a = await connect(worldA.id);
const b = await connect(worldB.id);

// Wait for both helloes to land before dispatching, so the assertion
// that "only my world's events arrived" isn't racing the catchup.
await new Promise((r) => setTimeout(r, 50));

const dispatch = (ws: WebSocket, message: string, id: string): void => {
  ws.send(
    JSON.stringify({
      kind: "command",
      id,
      issuedAt: Date.now(),
      cmd: {
        type: Ping.name,
        payload: { message, issuedAt: Date.now() },
      },
    }),
  );
};

dispatch(a.ws, "from-alpha", "cmd-a");
dispatch(b.ws, "from-beta", "cmd-b");

await new Promise((r) => setTimeout(r, 150));

const assert = (cond: unknown, msg: string): void => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
};

const aHello = a.messages.find((m) => m.kind === "hello");
const bHello = b.messages.find((m) => m.kind === "hello");
assert(aHello?.worldId === worldA.id, "client-a hello should carry worldA's id");
assert(bHello?.worldId === worldB.id, "client-b hello should carry worldB's id");

const aPings = a.messages
  .filter((m) => m.kind === "event" && m.event?.type === PingReceived.name)
  .map((m) => m.event!.payload.message);
const bPings = b.messages
  .filter((m) => m.kind === "event" && m.event?.type === PingReceived.name)
  .map((m) => m.event!.payload.message);

assert(aPings.length === 1, `client-a should see exactly one Pong; got ${aPings.length}`);
assert(bPings.length === 1, `client-b should see exactly one Pong; got ${bPings.length}`);
assert(
  aPings[0] === "from-alpha",
  `client-a should see only its own ping; got ${JSON.stringify(aPings)}`,
);
assert(
  bPings[0] === "from-beta",
  `client-b should see only its own ping; got ${JSON.stringify(bPings)}`,
);
assert(
  !aPings.includes("from-beta"),
  "world A must not receive world B's events",
);
assert(
  !bPings.includes("from-alpha"),
  "world B must not receive world A's events",
);

// World state isolation: each runtime should have spawned exactly one
// Pong entity from the command issued against it.
const rtA = handle.worldsRegistry.get(worldA.id);
const rtB = handle.worldsRegistry.get(worldB.id);
assert(rtA, "runtime A should exist after connection");
assert(rtB, "runtime B should exist after connection");
const aPongs = rtA!.world.query([Pong]);
const bPongs = rtB!.world.query([Pong]);
assert(aPongs.length === 1, `world A should have one Pong entity; got ${aPongs.length}`);
assert(bPongs.length === 1, `world B should have one Pong entity; got ${bPongs.length}`);
assert(
  (aPongs[0]!.values as { Pong: { message: string } }).Pong.message === "from-alpha",
  "world A's Pong should reflect its own ping",
);
assert(
  (bPongs[0]!.values as { Pong: { message: string } }).Pong.message === "from-beta",
  "world B's Pong should reflect its own ping",
);

// Sequence numbers are per-world: each world should be at seq 1 (or the
// system's fixpoint output count), not at seq 2 from a shared counter.
assert(
  rtA!.pipeline.currentSeq === rtB!.pipeline.currentSeq,
  "both worlds should be at the same per-world seq (independent counters, equal traffic)",
);

// Bonus: an unknown worldId is rejected at upgrade — verifies the
// substrate isn't auto-creating worlds on connect.
const ghostWs = new WebSocket(
  `ws://127.0.0.1:${handle.port}/ws?worldId=does-not-exist`,
);
const ghostResult = await new Promise<"opened" | "rejected">((resolve) => {
  ghostWs.on("open", () => resolve("opened"));
  ghostWs.on("error", () => resolve("rejected"));
  ghostWs.on("unexpected-response", () => resolve("rejected"));
});
assert(
  ghostResult === "rejected",
  "WS upgrade for an unknown worldId should be rejected",
);
ghostWs.close();

console.log("ok — two worlds, two clients, no cross-talk; unknown worldId rejected");
a.ws.close();
b.ws.close();
await handle.close();
process.exit(0);
