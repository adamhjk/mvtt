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
 * Two clients, two worlds, one process. Each client dispatches a Ping
 * and asserts that:
 *   - it only ever observes events for its own world
 *   - the other world's state is not mutated by the first client's command
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

interface Msg {
  kind: string;
  worldId?: string;
  event?: { type: string; payload: { message: string } };
  commandId?: string;
  ok?: boolean;
}

describe("multi-world wire smoke", () => {
  let handle: ServerHandle;
  let worldAId: string;
  let worldBId: string;
  let aWs: WebSocket | undefined;
  let bWs: WebSocket | undefined;
  const aMessages: Msg[] = [];
  const bMessages: Msg[] = [];

  beforeAll(async () => {
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
    worldAId = worldA.id;
    worldBId = worldB.id;
    handle = await startServer({
      port: 0,
      infrastructure: [shellDefault],
      optional: [pingPlugin],
      worldsRepo,
    });
  });

  afterAll(async () => {
    if (aWs && aWs.readyState === aWs.OPEN) aWs.close();
    if (bWs && bWs.readyState === bWs.OPEN) bWs.close();
    if (handle) await handle.close();
  });

  async function connect(worldId: string, sink: Msg[]): Promise<WebSocket> {
    const ws = new WebSocket(
      `ws://127.0.0.1:${handle.port}/ws?worldId=${encodeURIComponent(worldId)}`,
    );
    ws.on("message", (raw) => sink.push(JSON.parse(raw.toString()) as Msg));
    await new Promise<void>((r) => ws.on("open", () => r()));
    return ws;
  }

  it("isolates events per world and rejects unknown worldIds", async () => {
    aWs = await connect(worldAId, aMessages);
    bWs = await connect(worldBId, bMessages);
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
    dispatch(aWs, "from-alpha", "cmd-a");
    dispatch(bWs, "from-beta", "cmd-b");

    await new Promise((r) => setTimeout(r, 150));

    const aHello = aMessages.find((m) => m.kind === "hello");
    const bHello = bMessages.find((m) => m.kind === "hello");
    expect(aHello?.worldId).toBe(worldAId);
    expect(bHello?.worldId).toBe(worldBId);

    const aPings = aMessages
      .filter((m) => m.kind === "event" && m.event?.type === PingReceived.name)
      .map((m) => m.event!.payload.message);
    const bPings = bMessages
      .filter((m) => m.kind === "event" && m.event?.type === PingReceived.name)
      .map((m) => m.event!.payload.message);

    expect(aPings).toEqual(["from-alpha"]);
    expect(bPings).toEqual(["from-beta"]);

    // Server-side world-state isolation.
    const rtA = handle.worldsRegistry.get(worldAId);
    const rtB = handle.worldsRegistry.get(worldBId);
    expect(rtA).not.toBeNull();
    expect(rtB).not.toBeNull();
    const aPongs = rtA!.world.query([Pong]);
    const bPongs = rtB!.world.query([Pong]);
    expect(aPongs).toHaveLength(1);
    expect(bPongs).toHaveLength(1);
    expect((aPongs[0]!.values as { Pong: { message: string } }).Pong.message).toBe("from-alpha");
    expect((bPongs[0]!.values as { Pong: { message: string } }).Pong.message).toBe("from-beta");

    // Per-world seq counters: equal traffic → equal currentSeq, not a
    // shared counter that would diverge.
    expect(rtA!.pipeline.currentSeq).toBe(rtB!.pipeline.currentSeq);

    // Unknown worldId is rejected at the WS upgrade.
    const ghostWs = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?worldId=does-not-exist`);
    const ghostResult = await new Promise<"opened" | "rejected">((resolve) => {
      ghostWs.on("open", () => resolve("opened"));
      ghostWs.on("error", () => resolve("rejected"));
      ghostWs.on("unexpected-response", () => resolve("rejected"));
    });
    expect(ghostResult).toBe("rejected");
    ghostWs.close();
  });
});
