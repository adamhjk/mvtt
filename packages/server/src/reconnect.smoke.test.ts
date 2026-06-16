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
 * Wire-protocol smoke for the reconnect surface the substrate client's
 * connection layer depends on (see substrate/src/connection.ts):
 *
 * 1. App-level `{kind:"ping"}` → `{kind:"pong"}` — the client's zombie
 *    watchdog needs JS-visible traffic, which the ws-protocol-level
 *    heartbeat can't provide (browsers answer those pongs in the network
 *    stack, invisibly to the page).
 * 2. A second connection to the same world after the first one drops
 *    gets a complete fresh handshake — hello / snapshot / synced — with
 *    the snapshot carrying state that changed while disconnected. This
 *    is the resync contract that makes client-side auto-reconnect safe.
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

interface WireFrame {
  kind: string;
  [key: string]: unknown;
}

/** Collect inbound frames on a socket into an array, with await helper. */
function collect(ws: WebSocket): {
  frames: WireFrame[];
  waitFor: (kind: string) => Promise<WireFrame>;
} {
  const frames: WireFrame[] = [];
  const waiters: Array<{ kind: string; resolve: (f: WireFrame) => void }> = [];
  ws.on("message", (raw) => {
    const frame = JSON.parse(raw.toString()) as WireFrame;
    frames.push(frame);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.kind === frame.kind) {
        waiters[i]!.resolve(frame);
        waiters.splice(i, 1);
      }
    }
  });
  return {
    frames,
    waitFor: (kind) => {
      const existing = frames.find((f) => f.kind === kind);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => waiters.push({ kind, resolve }));
    },
  };
}

describe("reconnect wire smoke", () => {
  let handle: ServerHandle;
  let worldId: string;
  const sockets: WebSocket[] = [];

  const connect = (): WebSocket => {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?worldId=${worldId}`);
    sockets.push(ws);
    return ws;
  };

  beforeAll(async () => {
    const worldsRepo = new InMemoryWorldsRepository();
    await worldsRepo.migrate();
    const world = await worldsRepo.insert({
      id: "reconnect-world",
      name: "Reconnect",
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
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.close();
    }
    if (handle) await handle.close();
  });

  it("answers an app-level ping with a pong echoing t", async () => {
    const ws = connect();
    const inbox = collect(ws);
    await new Promise<void>((r) => ws.on("open", () => r()));
    await inbox.waitFor("synced");

    ws.send(JSON.stringify({ kind: "ping", t: 12345 }));
    const pong = await inbox.waitFor("pong");
    expect(pong.t).toBe(12345);
    ws.close();
  });

  it("gives a dropped-and-redialed client a fresh hello/snapshot/synced with state mutated during the gap", async () => {
    // First connection: complete the handshake, then drop it.
    const ws1 = connect();
    const inbox1 = collect(ws1);
    await new Promise<void>((r) => ws1.on("open", () => r()));
    const hello1 = await inbox1.waitFor("hello");
    await inbox1.waitFor("synced");
    ws1.close();
    await new Promise<void>((r) => ws1.on("close", () => r()));

    // World changes while the client is gone — exactly what happens when
    // a Safari player's tab is suspended mid-session.
    const issuedAt = Date.now();
    const ws2 = connect();
    const inbox2 = collect(ws2);
    await new Promise<void>((r) => ws2.on("open", () => r()));
    await inbox2.waitFor("synced");
    ws2.send(
      JSON.stringify({
        kind: "command",
        id: "during-gap-1",
        issuedAt,
        cmd: { type: Ping.name, payload: { message: "missed-me", issuedAt } },
      }),
    );
    const ack = (await inbox2.waitFor("ack")) as WireFrame & { ok: boolean };
    expect(ack.ok).toBe(true);

    // The dropped client redials: a brand-new socket, like the
    // connection layer creates. It must get the full handshake and a
    // snapshot that already contains the Pong spawned during the gap —
    // no event-gap detection needed on the client.
    const ws3 = connect();
    const inbox3 = collect(ws3);
    await new Promise<void>((r) => ws3.on("open", () => r()));
    const hello3 = await inbox3.waitFor("hello");
    expect(hello3.clientId).toBeTruthy();
    expect(hello3.clientId).not.toBe(hello1.clientId);

    const snapshot = (await inbox3.waitFor("snapshot")) as WireFrame & {
      state: { entities: Record<string, Record<string, unknown>> };
    };
    const pongs = Object.values(snapshot.state.entities).filter((traits) => Pong.name in traits);
    expect(pongs).toHaveLength(1);
    expect((pongs[0]![Pong.name] as { message: string }).message).toBe("missed-me");

    const synced = (await inbox3.waitFor("synced")) as WireFrame & {
      atSeq: number;
    };
    expect(synced.atSeq).toBeGreaterThanOrEqual(1);

    // And the redialed socket is fully live: commands round-trip.
    ws3.send(
      JSON.stringify({
        kind: "command",
        id: "after-reconnect-1",
        issuedAt: Date.now(),
        cmd: {
          type: Ping.name,
          payload: { message: "back", issuedAt: Date.now() },
        },
      }),
    );
    const ack3 = (await inbox3.waitFor("ack")) as WireFrame & { ok: boolean };
    expect(ack3.ok).toBe(true);
  });
});
