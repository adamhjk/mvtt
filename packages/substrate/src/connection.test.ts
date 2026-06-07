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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnection, type ConnectionHandle } from "./connection.js";

/**
 * Fake socket for driving the connection state machine. Mirrors the
 * browser API surface `createConnection` consumes: `readyState`, `send`,
 * `close`, `addEventListener`. Calling `close()` does NOT fire the close
 * event — tests fire lifecycle events explicitly, because the whole
 * point of the connection layer is that browsers (Safari) don't reliably
 * fire them.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0; // CONNECTING
  readonly sent: string[] = [];
  closeCalled = false;
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
    this.closeCalled = true;
    this.readyState = 3; // CLOSED — but no close event; see class doc.
  }

  // Test hooks
  open(): void {
    this.readyState = 1;
    this.fire("open", {});
  }

  receive(msg: object): void {
    this.fire("message", { data: JSON.stringify(msg) });
  }

  serverClose(): void {
    this.readyState = 3;
    this.fire("close", { code: 1006 });
  }

  error(): void {
    this.fire("error", {});
  }

  fire(type: string, ev: unknown): void {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
}

interface Harness {
  conn: ConnectionHandle;
  opens: number[];
  disconnects: number[];
  messages: string[];
}

/**
 * Build a connection against FakeSocket with deterministic jitter
 * (random()=1 ⇒ delay = min(cap, base·2^attempt) exactly) and short,
 * round-number timings so tests advance fake time predictably.
 */
function boot(over: Partial<Parameters<typeof createConnection>[0]> = {}): Harness {
  const opens: number[] = [];
  const disconnects: number[] = [];
  const messages: string[] = [];
  const conn = createConnection({
    url: "ws://test/ws",
    makeSocket: (url) => new FakeSocket(url),
    onOpen: () => opens.push(Date.now()),
    onMessage: (d) => messages.push(d),
    onDisconnect: () => disconnects.push(Date.now()),
    baseBackoffMs: 500,
    maxBackoffMs: 8_000,
    pingIntervalMs: 15_000,
    staleAfterMs: 40_000,
    random: () => 1,
    ...over,
  });
  return { conn, opens, disconnects, messages };
}

const sock = (i: number): FakeSocket => {
  const s = FakeSocket.instances[i];
  if (!s) throw new Error(`no FakeSocket instance ${i}`);
  return s;
};

describe("createConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    FakeSocket.instances = [];
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects immediately and reports open/send/message through", () => {
    const h = boot();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(h.conn.isOpen()).toBe(false);
    expect(h.conn.send("x")).toBe(false); // CONNECTING: not queued

    sock(0).open();
    expect(h.opens).toHaveLength(1);
    expect(h.conn.isOpen()).toBe(true);
    expect(h.conn.send("hello")).toBe(true);
    expect(sock(0).sent).toContain("hello");

    sock(0).receive({ kind: "pong", t: 1 });
    expect(h.messages).toHaveLength(1);
  });

  it("reconnects after a server close, with backoff, and resyncs callbacks", () => {
    const h = boot();
    sock(0).open();
    sock(0).serverClose();

    expect(h.disconnects).toHaveLength(1);
    expect(h.conn.isOpen()).toBe(false);
    expect(FakeSocket.instances).toHaveLength(1);

    // First retry at base backoff (500ms with random()=1).
    vi.advanceTimersByTime(499);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    sock(1).open();
    expect(h.opens).toHaveLength(2);
    expect(h.conn.isOpen()).toBe(true);
    expect(h.conn.send("after-reconnect")).toBe(true);
    expect(sock(1).sent).toContain("after-reconnect");
  });

  it("backs off exponentially across failed attempts and fires onDisconnect only once", () => {
    const h = boot();
    sock(0).open();
    sock(0).serverClose(); // attempt 0 scheduled at +500

    vi.advanceTimersByTime(500);
    sock(1).serverClose(); // never opened ⇒ no extra onDisconnect; next at +1000
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    sock(2).serverClose(); // next at +2000
    vi.advanceTimersByTime(2000);
    expect(FakeSocket.instances).toHaveLength(4);

    expect(h.disconnects).toHaveLength(1);

    // A successful open resets the backoff ladder.
    sock(3).open();
    expect(h.opens).toHaveLength(2);
    sock(3).serverClose();
    vi.advanceTimersByTime(500); // back to base, not 4000
    expect(FakeSocket.instances).toHaveLength(5);
  });

  it("treats error-without-close as a drop (Safari path) and doesn't double-handle error+close", () => {
    const h = boot();
    sock(0).open();
    sock(0).error(); // no close event at all
    expect(h.disconnects).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);

    // Late close from the same dead socket: idempotent, no second retry.
    sock(0).serverClose();
    expect(h.disconnects).toHaveLength(1);
    vi.advanceTimersByTime(8_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("ignores events from an orphaned socket after a forced recycle", () => {
    const h = boot();
    sock(0).open();
    // Zombie: stale for longer than staleAfterMs (40s) with no traffic.
    vi.advanceTimersByTime(45_000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(sock(0).closeCalled).toBe(true);
    expect(h.disconnects).toHaveLength(1);

    sock(1).open();
    expect(h.opens).toHaveLength(2);

    // The zombie finally emits close — must not affect the replacement.
    sock(0).fire("close", { code: 1006 });
    expect(h.disconnects).toHaveLength(1);
    expect(h.conn.isOpen()).toBe(true);

    // And inbound frames from the zombie are dropped.
    sock(0).receive({ kind: "pong", t: 1 });
    expect(h.messages).toHaveLength(0);
  });

  it("sends an app-level ping on the watchdog interval while open", () => {
    boot();
    sock(0).open();
    vi.advanceTimersByTime(15_000);
    const pings = sock(0).sent.filter((s) => JSON.parse(s).kind === "ping");
    expect(pings).toHaveLength(1);

    // Inbound traffic keeps it alive: no recycle as long as frames flow.
    sock(0).receive({ kind: "pong", t: 1 });
    vi.advanceTimersByTime(15_000);
    sock(0).receive({ kind: "pong", t: 2 });
    vi.advanceTimersByTime(15_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("close() stops reconnecting permanently", () => {
    const h = boot();
    sock(0).open();
    h.conn.close();
    expect(sock(0).closeCalled).toBe(true);
    // No disconnect callback for a user-initiated close…
    expect(h.disconnects).toHaveLength(0);
    // …and no new sockets, ever.
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("resume trigger reconnects immediately when the socket is not open", () => {
    // Stub a DOM so the connection registers resume listeners (the node
    // test env has neither document nor window).
    const docListeners: Record<string, Array<() => void>> = {};
    const winListeners: Record<string, Array<() => void>> = {};
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: (t: string, fn: () => void) => {
        (docListeners[t] ??= []).push(fn);
      },
      removeEventListener: () => {},
    });
    vi.stubGlobal("window", {
      addEventListener: (t: string, fn: () => void) => {
        (winListeners[t] ??= []).push(fn);
      },
      removeEventListener: () => {},
    });

    const h = boot();
    sock(0).open();
    // Safari kills the socket without any event: readyState flips to
    // CLOSED behind our back.
    sock(0).readyState = 3;
    expect(h.disconnects).toHaveLength(0); // nobody told us

    // Tab comes back: visibilitychange → immediate reconnect, no backoff.
    for (const fn of docListeners["visibilitychange"] ?? []) fn();
    expect(h.disconnects).toHaveLength(1);
    expect(FakeSocket.instances).toHaveLength(2);

    sock(1).open();
    expect(h.opens).toHaveLength(2);

    // A healthy socket on resume just gets probed with a ping.
    for (const fn of winListeners["focus"] ?? []) fn();
    expect(FakeSocket.instances).toHaveLength(2);
    const pings = sock(1).sent.filter((s) => JSON.parse(s).kind === "ping");
    expect(pings).toHaveLength(1);
  });
});
