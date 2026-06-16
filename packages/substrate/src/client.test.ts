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
import { defineCommand, definePlugin, defineTrait, ok, z } from "./index.js";

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
 * server. Same shape as the connection layer consumes: `readyState`,
 * `send`, `addEventListener("open" | "close" | "message" | "error", fn)`,
 * `close`.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0; // CONNECTING
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
    this.readyState = 3; // CLOSED
    this.fire("close", { code: 1000, reason: "" });
  }

  // Test hooks
  open(): void {
    this.readyState = 1; // OPEN
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
  const clients: Array<ReturnType<typeof startClient>> = [];

  afterEach(() => {
    // Close every client so the connection layer's reconnect timers and
    // watchdog don't outlive the test (and try to dial a real WebSocket
    // once the global stub is removed).
    for (const c of clients.splice(0)) c.close();
    FakeSocket.instances = [];
    vi.unstubAllGlobals();
  });

  function bootClient(): {
    client: ReturnType<typeof startClient>;
    sock: FakeSocket;
  } {
    vi.stubGlobal("WebSocket", FakeSocket as unknown);
    const client = startClient({ url: "ws://test/ws", plugins: [] });
    clients.push(client);
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

  it("fails fast with {ok: false, reason: 'disconnected'} when dispatched before the socket opens", async () => {
    const { client, sock } = bootClient();
    // No sock.open(): still CONNECTING.
    const handle = client.dispatch(Noop({}));
    await expect(handle.ack).resolves.toEqual({
      ok: false,
      reason: "disconnected",
    });
    // Nothing went on the wire — browsers silently drop sends on
    // non-OPEN sockets, so the command frame must not be attempted.
    expect(sock.sent).toHaveLength(0);
  });

  it("fails fast when dispatched after a disconnect, instead of hanging forever", async () => {
    const { client, sock } = bootClient();
    sock.open();
    sock.close();
    expect(client.connected()).toBe(false);
    const handle = client.dispatch(Noop({}));
    // Previously this registered a pending ack AFTER the close drain ran
    // — an ack that could never resolve. Now it resolves immediately.
    await expect(handle.ack).resolves.toEqual({
      ok: false,
      reason: "disconnected",
    });
  });
});

/**
 * Reconnect behavior: the connection layer redials after a drop and the
 * server replays a fresh hello → snapshot → synced handshake. The client
 * must restore the snapshot wholesale (recovering any events missed
 * during the gap) and flip its connected/synced signals so UI can show
 * "reconnecting…" / "resyncing…" states.
 */
describe("startClient reconnect resync", () => {
  const clients: Array<ReturnType<typeof startClient>> = [];

  afterEach(() => {
    for (const c of clients.splice(0)) c.close();
    FakeSocket.instances = [];
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const SomeTrait = defineTrait({
    name: "@test/reconnect/Some",
    schema: z.object({ value: z.string() }),
  });
  const plugin = definePlugin({
    name: "@test/reconnect",
    version: "0",
    traits: [SomeTrait],
  });

  it("redials after a drop and resyncs world state from the fresh snapshot", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket as unknown);
    const client = startClient({ url: "ws://test/ws", plugins: [plugin] });
    clients.push(client);

    const sock0 = FakeSocket.instances[0]!;
    sock0.open();
    sock0.receive({ kind: "hello", clientId: "c1", worldId: "w", plugins: [] });
    sock0.receive({
      kind: "snapshot",
      worldId: "w",
      atSeq: 1,
      state: {
        nextId: 2,
        entities: { e1: { [SomeTrait.name]: { value: "before" } } },
      },
    });
    sock0.receive({ kind: "synced", atSeq: 1 });
    expect(client.connected()).toBe(true);
    expect(client.synced()).toBe(true);

    // The server (or Safari) kills the socket.
    sock0.close();
    expect(client.connected()).toBe(false);
    expect(client.synced()).toBe(false);

    // Backoff elapses → the connection layer dials a fresh socket.
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances.length).toBe(2);
    const sock1 = FakeSocket.instances[1]!;
    sock1.open();
    expect(client.connected()).toBe(true);
    expect(client.synced()).toBe(false); // resyncing until `synced` arrives

    // Fresh handshake: e1 changed and e2 appeared while we were gone.
    sock1.receive({ kind: "hello", clientId: "c2", worldId: "w", plugins: [] });
    sock1.receive({
      kind: "snapshot",
      worldId: "w",
      atSeq: 5,
      state: {
        nextId: 3,
        entities: {
          e1: { [SomeTrait.name]: { value: "after" } },
          e2: { [SomeTrait.name]: { value: "new" } },
        },
      },
    });
    sock1.receive({ kind: "synced", atSeq: 5 });

    expect(client.synced()).toBe(true);
    expect(client.lastAppliedSeq()).toBe(5);
    const e1 = client.world.get("e1", [SomeTrait]) as { Some: { value: string } } | undefined;
    expect(e1?.Some.value).toBe("after");
    expect(client.world.has("e2")).toBe(true);

    // Dispatch flows over the NEW socket.
    const handle = client.dispatch(Noop({}));
    expect(sock1.sent.some((s) => JSON.parse(s).id === handle.id)).toBe(true);
    expect(sock0.sent.some((s) => JSON.parse(s).kind === "command")).toBe(false);
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
  const clients: Array<ReturnType<typeof startClient>> = [];

  afterEach(() => {
    for (const c of clients.splice(0)) c.close();
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
    clients.push(client);
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
    const got = client.world.get("e1", [SomeTrait]) as { Some: { value: string } } | undefined;
    expect(got?.Some.value).toBe("hello");
  });

  it("entity-revealed updates traits on an entity that's already present (idempotent)", async () => {
    vi.stubGlobal("WebSocket", FakeSocket as unknown);
    const client = startClient({
      url: "ws://test/ws",
      plugins: [visPlugin],
    });
    clients.push(client);
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
    const got = client.world.get("e1", [SomeTrait]) as { Some: { value: string } } | undefined;
    expect(got?.Some.value).toBe("new");
  });

  it("entity-hidden despawns the entity locally", async () => {
    vi.stubGlobal("WebSocket", FakeSocket as unknown);
    const client = startClient({
      url: "ws://test/ws",
      plugins: [visPlugin],
    });
    clients.push(client);
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
