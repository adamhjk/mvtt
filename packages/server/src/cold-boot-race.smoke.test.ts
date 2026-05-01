// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
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
import {
  definePlugin,
  InMemoryWorldsRepository,
  type PersistenceAdapter,
} from "@vtt/substrate";
import { Ping, PingReceived, Pong } from "@vtt/ping/shared";
import { PongRecordingSystem } from "@vtt/ping/server";
import { shellDefault } from "@vtt/shell-default";

/**
 * Regression: when a client sent a command immediately after the WS
 * opened, the server's cold-boot replay (`worldsRegistry.acquire`)
 * was awaited inside the `connection` handler — leaving a window in
 * which `sock.on("message", …)` wasn't attached yet. Node's
 * EventEmitter doesn't buffer; frames that arrived in that window
 * were dropped, so the very first browser load after creating a
 * world saw clicks fail to update the UI (events never came back).
 * After a hard refresh the runtime was already cached, so the
 * window collapsed and clicks worked.
 *
 * This test widens the window deterministically by injecting a slow
 * persistence adapter, then sends a command on the `open` event so
 * the frame lands during the would-be drop window. It must still be
 * processed.
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

function slowMemoryPersistence(delayMs: number): PersistenceAdapter {
  const sleep = () => new Promise((r) => setTimeout(r, delayMs));
  return {
    migrate: async () => {},
    appendEvents: async () => {},
    readEventsSince: async () => {
      await sleep();
      return [];
    },
    highestSeq: async () => {
      await sleep();
      return 0;
    },
    loadLatestSnapshot: async () => {
      await sleep();
      return null;
    },
    writeSnapshot: async () => {},
    hardDeleteWorld: async () => {},
  };
}

interface AckMsg { kind: "ack"; commandId: string; ok: boolean; reason?: string }
interface EventMsg { kind: "event"; seq: number; event: { type: string; payload: unknown } }
type Msg = AckMsg | EventMsg | { kind: "hello" | "snapshot" | "synced" | "presence" };

describe("cold-boot race wire smoke", () => {
  let handle: ServerHandle;
  let worldId: string;
  const messages: Msg[] = [];

  beforeAll(async () => {
    const worldsRepo = new InMemoryWorldsRepository();
    await worldsRepo.migrate();
    const world = await worldsRepo.insert({
      id: "race-world",
      name: "Race",
      gameSystemPlugin: pingPlugin.name,
      ownerUserId: "owner",
    });
    worldId = world.id;
    handle = await startServer({
      port: 0,
      infrastructure: [shellDefault],
      optional: [pingPlugin],
      worldsRepo,
      // Persistence whose cold-boot reads sleep long enough that a
      // pre-fix `connection` handler would still be awaiting them when
      // the client's first command arrives.
      persistence: slowMemoryPersistence(120),
    });
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  it("processes commands sent immediately on WS open during cold-boot", async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${handle.port}/ws?worldId=${encodeURIComponent(worldId)}`,
    );
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as Msg));

    // Send the moment the socket opens — before hello/snapshot/synced.
    // With the bug, the message lands while the server is still inside
    // `await worldsRegistry.acquire(...)` so the listener doesn't exist
    // yet and the command is silently dropped (no ack, no event).
    await new Promise<void>((resolve) => {
      ws.once("open", () => {
        const issuedAt = Date.now();
        ws.send(
          JSON.stringify({
            kind: "command",
            id: "race-1",
            issuedAt,
            cmd: {
              type: Ping.name,
              payload: { message: "early", issuedAt },
            },
          }),
        );
        resolve();
      });
    });

    // Give cold-boot replay + dispatch + broadcast time to complete.
    await new Promise((r) => setTimeout(r, 400));

    const acks = messages.filter((m): m is AckMsg => m.kind === "ack");
    expect(acks).toHaveLength(1);
    expect(acks[0]!.ok).toBe(true);

    const pingEvents = messages.filter(
      (m): m is EventMsg =>
        m.kind === "event" && m.event?.type === PingReceived.name,
    );
    expect(pingEvents).toHaveLength(1);

    ws.close();
  });
});
