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

import { afterEach, describe, expect, it, vi } from "vitest";
import { startClient } from "./client.js";
import {
  defineCommand,
  definePlugin,
  defineTrait,
  ok,
  z,
} from "./index.js";

/**
 * Minimal MessageEvent-shaped object for the message handler. The
 * substrate client only reads `.data`, so a plain object suffices —
 * avoids depending on a DOM lib that the node test environment may not
 * provide.
 */
interface FakeMessageEvent {
  data: string;
}

/**
 * Fake `WebSocket` that captures `send` calls and lets the test inject
 * inbound messages and lifecycle events. Used to drive the substrate
 * client's wire-protocol state machine without spinning up a real
 * server. Same shape as the substrate client uses: `send`,
 * `addEventListener("open" | "close" | "message", fn)`, `close`.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly sent: string[] = [];
  private listeners: Record<string, Array<(e: unknown) => void>> = {};

  constructor(public readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.fire("close", { code: 1000, reason: "" });
  }

  // Test hooks
  open(): void {
    this.fire("open", {});
  }

  receive(msg: object): void {
    const ev: FakeMessageEvent = { data: JSON.stringify(msg) };
    this.fire("message", ev);
  }

  private fire(type: string, ev: unknown): void {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
}

const Noop = defineCommand({
  name: "@test/noop/Noop",
  schema: z.object({}),
  validate: () => ok(),
  apply: () => [],
});

describe("startClient dispatch ack routing", () => {
  afterEach(() => {
    FakeSocket.instances = [];
    vi.unstubAllGlobals();
  });

  function bootClient(): {
    client: ReturnType<typeof startClient>;
    sock: FakeSocket;
  } {
    vi.stubGlobal("WebSocket", FakeSocket as unknown);
    const client = startClient({ url: "ws://test/ws", plugins: [] });
    const sock = FakeSocket.instances[0]!;
    return { client, sock };
  }

  it("returns a DispatchHandle with id and ack promise", () => {
    const { client, sock } = bootClient();
    sock.open();
    const handle = client.dispatch(Noop({}));
    expect(typeof handle.id).toBe("string");
    expect(handle.ack).toBeInstanceOf(Promise);
    // Wire frame was sent with the same id the handle reports.
    expect(sock.sent.length).toBe(1);
    const sent = JSON.parse(sock.sent[0]!) as { kind: string; id: string };
    expect(sent.kind).toBe("command");
    expect(sent.id).toBe(handle.id);
  });

  it("resolves the ack promise with {ok: true} on a success ack", async () => {
    const { client, sock } = bootClient();
    sock.open();
    const handle = client.dispatch(Noop({}));
    sock.receive({ kind: "ack", commandId: handle.id, ok: true });
    await expect(handle.ack).resolves.toEqual({
      ok: true,
      reason: undefined,
    });
  });

  it("resolves the ack promise with {ok: false, reason} on a failure ack", async () => {
    const { client, sock } = bootClient();
    sock.open();
    const handle = client.dispatch(Noop({}));
    sock.receive({
      kind: "ack",
      commandId: handle.id,
      ok: false,
      reason: "unknown command: @test/noop/Noop",
    });
    await expect(handle.ack).resolves.toEqual({
      ok: false,
      reason: "unknown command: @test/noop/Noop",
    });
  });

  it("ignores acks for unknown command ids without error", async () => {
    const { client, sock } = bootClient();
    sock.open();
    const handle = client.dispatch(Noop({}));
    // Unrelated ack id — must not crash, must not resolve our handle.
    sock.receive({ kind: "ack", commandId: "cmd-bogus", ok: true });
    let resolved = false;
    void handle.ack.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(resolved).toBe(false);
    // Real ack still works.
    sock.receive({ kind: "ack", commandId: handle.id, ok: true });
    await expect(handle.ack).resolves.toEqual({
      ok: true,
      reason: undefined,
    });
  });

  it("drains pending acks with reason 'disconnected' on socket close", async () => {
    const { client, sock } = bootClient();
    sock.open();
    const a = client.dispatch(Noop({}));
    const b = client.dispatch(Noop({}));
    sock.close();
    await expect(a.ack).resolves.toEqual({
      ok: false,
      reason: "disconnected",
    });
    await expect(b.ack).resolves.toEqual({
      ok: false,
      reason: "disconnected",
    });
  });
});

/**
 * Live visibility deltas: when the server pushes an `entity-revealed`
 * frame the client spawns the entity locally; when it pushes
 * `entity-hidden` the client despawns. The substrate client treats
 * both as substrate-level wire frames — no plugin involvement, no
 * resolver invocation. Per-recipient visibility computation lives on
 * the server (which has the connection registry); the client just
 * applies the deltas to its local world.
 */
describe("startClient applies entity-revealed / entity-hidden wire frames", () => {
  afterEach(() => {
    FakeSocket.instances = [];
    vi.unstubAllGlobals();
  });

  const SomeTrait = defineTrait({
    name: "@test/vis/Some",
    schema: z.object({ value: z.string() }),
  });
  const visPlugin = definePlugin({
    name: "@test/vis",
    version: "0",
    traits: [SomeTrait],
  });

  it("entity-revealed spawns an entity not previously in the local world", async () => {
    vi.stubGlobal("WebSocket", FakeSocket as unknown);
    const client = startClient({
      url: "ws://test/ws",
      plugins: [visPlugin],
    });
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.receive({
      kind: "hello",
      clientId: "test",
      worldId: "w",
      plugins: [],
    });
    sock.receive({
      kind: "snapshot",
      worldId: "w",
      atSeq: 0,
      state: { nextId: 2, entities: {} },
    });
    expect(client.world.has("e1")).toBe(false);

    sock.receive({
      kind: "entity-revealed",
      worldId: "w",
      seq: 1,
      entityId: "e1",
      traits: { [SomeTrait.name]: { value: "hello" } },
    });
    expect(client.world.has("e1")).toBe(true);
    const got = client.world.get("e1", [SomeTrait]) as
      | { Some: { value: string } }
      | undefined;
    expect(got?.Some.value).toBe("hello");
  });

  it("entity-revealed updates traits on an entity that's already present (idempotent)", async () => {
    vi.stubGlobal("WebSocket", FakeSocket as unknown);
    const client = startClient({
      url: "ws://test/ws",
      plugins: [visPlugin],
    });
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.receive({
      kind: "hello",
      clientId: "test",
      worldId: "w",
      plugins: [],
    });
    sock.receive({
      kind: "snapshot",
      worldId: "w",
      atSeq: 0,
      state: {
        nextId: 2,
        entities: { e1: { [SomeTrait.name]: { value: "old" } } },
      },
    });

    sock.receive({
      kind: "entity-revealed",
      worldId: "w",
      seq: 1,
      entityId: "e1",
      traits: { [SomeTrait.name]: { value: "new" } },
    });
    const got = client.world.get("e1", [SomeTrait]) as
      | { Some: { value: string } }
      | undefined;
    expect(got?.Some.value).toBe("new");
  });

  it("entity-hidden despawns the entity locally", async () => {
    vi.stubGlobal("WebSocket", FakeSocket as unknown);
    const client = startClient({
      url: "ws://test/ws",
      plugins: [visPlugin],
    });
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.receive({
      kind: "hello",
      clientId: "test",
      worldId: "w",
      plugins: [],
    });
    sock.receive({
      kind: "snapshot",
      worldId: "w",
      atSeq: 0,
      state: {
        nextId: 2,
        entities: { e1: { [SomeTrait.name]: { value: "x" } } },
      },
    });
    expect(client.world.has("e1")).toBe(true);

    sock.receive({
      kind: "entity-hidden",
      worldId: "w",
      seq: 1,
      entityId: "e1",
    });
    expect(client.world.has("e1")).toBe(false);
  });
});
