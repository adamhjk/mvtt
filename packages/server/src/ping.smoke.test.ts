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
import WebSocket from "ws";
import { startServer, type ServerHandle } from "@vtt/substrate/server";
import { definePlugin, InMemoryWorldsRepository } from "@vtt/substrate";
import { Ping, PingReceived, Pong } from "@vtt/ping/shared";
import { PongRecordingSystem } from "@vtt/ping/server";
import { shellDefault } from "@vtt/shell-default";

/**
 * Wire-protocol smoke for the ping plugin: a real server, a real ws
 * client, a real command envelope. Verifies that hello/ack/event
 * frames serialize correctly across the boundary and that a system
 * spawned the expected entity in the world's registry.
 *
 * Folded from packages/server/src/smoke.ts so smoke now runs inside
 * the same vitest pass as everything else — one pnpm test, one place
 * to look for failures, parallel scheduling.
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

interface HelloMsg { kind: "hello"; clientId: string }
interface EventMsg {
  kind: "event";
  seq: number;
  event: { type: string; payload: { message: string; pingedAt: number; pongedAt: number } };
}
interface AckMsg { kind: "ack"; commandId: string; ok: boolean; reason?: string }
type Msg = HelloMsg | EventMsg | AckMsg;

describe("ping wire smoke", () => {
  let handle: ServerHandle;
  let worldId: string;
  let ws: WebSocket;
  const messages: Msg[] = [];

  beforeAll(async () => {
    const worldsRepo = new InMemoryWorldsRepository();
    await worldsRepo.migrate();
    const world = await worldsRepo.insert({
      id: "smoke-world",
      name: "Smoke",
      gameSystemPlugin: pingPlugin.name,
      ownerUserId: "smoke-user",
    });
    worldId = world.id;
    handle = await startServer({
      port: 0,
      infrastructure: [shellDefault],
      optional: [pingPlugin],
      worldsRepo,
    });
  });

  afterAll(async () => {
    if (ws && ws.readyState === ws.OPEN) ws.close();
    if (handle) await handle.close();
  });

  it("round-trips a Ping over the wire and spawns a Pong entity", async () => {
    ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?worldId=${worldId}`);
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

    const hello = messages.find((m): m is HelloMsg => m.kind === "hello");
    expect(hello).toBeDefined();
    expect(hello!.clientId).toBeTruthy();

    const ack = messages.find(
      (m): m is AckMsg => m.kind === "ack" && m.commandId === "smoke-1",
    );
    expect(ack).toBeDefined();
    expect(ack!.ok).toBe(true);

    const event = messages.find((m): m is EventMsg => m.kind === "event");
    expect(event).toBeDefined();
    expect(event!.event.type).toBe(PingReceived.name);
    expect(event!.event.payload.message).toBe("smoke");
    expect(event!.event.payload.pingedAt).toBe(issuedAt);

    // Server-side state: the Pong recording system spawned exactly one entity.
    const runtime = handle.worldsRegistry.get(worldId);
    expect(runtime).not.toBeNull();
    const rows = runtime!.world.query([Pong]);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.values as { Pong: { message: string } }).Pong.message).toBe("smoke");
  });
});
