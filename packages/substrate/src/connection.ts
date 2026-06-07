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

/**
 * Reconnecting WebSocket wrapper — the substrate client's connection
 * lifecycle, factored out of the wire-protocol state machine.
 *
 * Why this exists: browsers — Safari most aggressively — kill WebSockets
 * out from under a page. Background-tab suspension, device sleep, and
 * network transitions all terminate the socket, and Safari frequently
 * does so WITHOUT firing a `close` event: `readyState` stays OPEN while
 * sends silently vanish into a dead pipe (a "zombie" socket). A client
 * that creates one socket and never looks back (the previous behavior)
 * turns every such kill into a session that looks alive but persists
 * nothing and receives nothing until a manual page reload.
 *
 * Three recovery layers, in order of how fast they catch a dead pipe:
 *
 * 1. **close/error events** — when the browser is honest about the drop,
 *    we hear it immediately and reconnect with jittered exponential
 *    backoff.
 * 2. **Resume triggers** — `visibilitychange` → visible, `pageshow`,
 *    `online`, `focus`. The moment a suspended tab comes back, we check
 *    the socket and force an immediate reconnect if it isn't OPEN (or
 *    probe it with a ping if it claims to be).
 * 3. **Staleness watchdog** — an app-level `{kind:"ping"}` goes out every
 *    `pingIntervalMs`; the server answers `{kind:"pong"}` (see
 *    protocol.ts). Any inbound traffic bumps `lastActivityAt`. If a
 *    socket claims OPEN but nothing has arrived for `staleAfterMs`, it's
 *    a zombie — recycle it. (The server's ws-protocol-level ping/pong
 *    heartbeat can't serve this purpose: browsers answer protocol pongs
 *    in the network stack, invisibly to page JavaScript.)
 *
 * The wrapper deliberately does NOT queue outbound data across drops.
 * `send` returns false when the socket isn't OPEN and the caller decides
 * what failure means — for commands that's an immediate not-ok ack
 * (replaying stale commands after a resync could act on a world that
 * moved underneath them), for presence it's a silent drop (ephemeral by
 * design).
 */

/**
 * Structural subset of the browser `WebSocket` the connection needs.
 * Tests substitute a fake; production uses the real one.
 */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, fn: (e: unknown) => void): void;
}

/** WebSocket readyState values (mirrors the DOM constants). */
const CONNECTING = 0;
const OPEN = 1;

export interface ConnectionOptions {
  url: string;
  /** A socket connected (after `open` fires the first frame can flow). */
  onOpen(): void;
  /** A complete inbound text frame. */
  onMessage(data: string): void;
  /**
   * An established connection was lost (close, error, or zombie
   * recycle). Fires once per established connection — failed reconnect
   * attempts don't re-fire it. Reconnection is already scheduled by the
   * time this runs.
   */
  onDisconnect(): void;
  /** Socket factory; defaults to `new WebSocket(url)`. Tests inject a fake. */
  makeSocket?: (url: string) => SocketLike;
  /** First-retry backoff; doubles per attempt. Default 500ms. */
  baseBackoffMs?: number;
  /** Backoff ceiling. Default 8s. */
  maxBackoffMs?: number;
  /** App-level ping cadence while OPEN. Default 15s. */
  pingIntervalMs?: number;
  /** No inbound traffic for this long while OPEN ⇒ zombie. Default 45s. */
  staleAfterMs?: number;
  /** Jitter source; injectable for deterministic tests. Default Math.random. */
  random?: () => number;
}

export interface ConnectionHandle {
  /**
   * Send a text frame if the socket is OPEN. Returns false — without
   * throwing — when it isn't; the data is NOT queued.
   */
  send(data: string): boolean;
  isOpen(): boolean;
  /** Permanently close: stops reconnecting and detaches all listeners. */
  close(): void;
}

export function createConnection(opts: ConnectionOptions): ConnectionHandle {
  const makeSocket =
    opts.makeSocket ??
    ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const baseBackoffMs = opts.baseBackoffMs ?? 500;
  const maxBackoffMs = opts.maxBackoffMs ?? 8_000;
  const pingIntervalMs = opts.pingIntervalMs ?? 15_000;
  const staleAfterMs = opts.staleAfterMs ?? 45_000;
  const random = opts.random ?? Math.random;

  let sock: SocketLike | null = null;
  // Bumped on every connect/recycle; handlers capture their generation
  // and no-op when stale, so a late `close` from an abandoned socket
  // can't tear down its replacement.
  let generation = 0;
  let attempts = 0;
  // True between onOpen and the loss of that connection — gates
  // onDisconnect to once per established connection.
  let up = false;
  let closedByUser = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastActivityAt = Date.now();

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (closedByUser || reconnectTimer !== null) return;
    // Exponential backoff with half-jitter: [delay/2, delay]. The floor
    // keeps a reconnect storm from synchronizing without ever waiting
    // longer than the cap.
    const exp = Math.min(maxBackoffMs, baseBackoffMs * 2 ** attempts);
    const delay = exp * (0.5 + 0.5 * random());
    attempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  /** Connection went down (close/error/zombie): notify once, retry. */
  const handleDown = () => {
    sock = null;
    if (up) {
      up = false;
      opts.onDisconnect();
    }
    scheduleReconnect();
  };

  const connect = () => {
    if (closedByUser) return;
    clearReconnectTimer();
    const gen = ++generation;
    let s: SocketLike;
    try {
      s = makeSocket(opts.url);
    } catch {
      // Constructor can throw synchronously (malformed URL, Safari under
      // memory pressure). Treat like an immediate failed attempt.
      scheduleReconnect();
      return;
    }
    sock = s;
    // close and error both signal "this socket is done"; browsers fire
    // them in varying orders (error-then-close normally, error-only in
    // some Safari paths) — `down` makes the pair idempotent.
    let down = false;
    const markDown = () => {
      if (gen !== generation || closedByUser || down) return;
      down = true;
      handleDown();
    };
    s.addEventListener("open", () => {
      if (gen !== generation || closedByUser) return;
      attempts = 0;
      lastActivityAt = Date.now();
      up = true;
      opts.onOpen();
    });
    s.addEventListener("message", (e) => {
      if (gen !== generation || closedByUser) return;
      lastActivityAt = Date.now();
      const data = (e as { data?: unknown }).data;
      if (typeof data === "string") opts.onMessage(data);
    });
    s.addEventListener("close", markDown);
    s.addEventListener("error", markDown);
  };

  /**
   * Abandon the current socket (if any) and reconnect immediately with
   * backoff reset. Used by the resume triggers and the zombie watchdog —
   * cases where we have positive evidence the old socket is dead or the
   * user is actively back and waiting.
   */
  const forceReconnect = () => {
    if (closedByUser) return;
    generation += 1; // orphan the old socket's events
    const old = sock;
    sock = null;
    if (old) {
      try {
        old.close();
      } catch {
        // half-closed sockets may throw; the socket is orphaned either way
      }
    }
    if (up) {
      up = false;
      opts.onDisconnect();
    }
    clearReconnectTimer();
    attempts = 0;
    connect();
  };

  const sendPing = () => {
    if (!sock || sock.readyState !== OPEN) return;
    try {
      sock.send(JSON.stringify({ kind: "ping", t: Date.now() }));
    } catch {
      // a throw here means the socket is dead; the watchdog or a close
      // event will recycle it
    }
  };

  // Layer 3: staleness watchdog + keepalive traffic.
  const watchdog = setInterval(() => {
    if (closedByUser) return;
    if (!sock || sock.readyState !== OPEN) return;
    if (Date.now() - lastActivityAt > staleAfterMs) {
      // Claims OPEN but nothing inbound for too long: zombie (Safari
      // post-suspension signature). Don't trust its close event either —
      // force the recycle.
      forceReconnect();
      return;
    }
    sendPing();
  }, pingIntervalMs);
  // Node test envs: don't hold the process open. (In the browser
  // setInterval returns a number; in node a Timeout with unref. The
  // substrate client compiles against DOM types, so reach through
  // unknown rather than narrowing a type that claims to be number.)
  const watchdogTimer = watchdog as unknown as { unref?: () => void };
  if (typeof watchdogTimer.unref === "function") watchdogTimer.unref();

  // Layer 2: resume triggers. Guarded — the substrate client also runs
  // under vitest's node environment where document/window don't exist.
  const onResume = () => {
    if (closedByUser) return;
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }
    if (sock && sock.readyState === CONNECTING) return; // already retrying
    if (!sock || sock.readyState !== OPEN) {
      forceReconnect();
      return;
    }
    if (Date.now() - lastActivityAt > staleAfterMs) {
      forceReconnect();
      return;
    }
    // Looks healthy — probe it. A zombie won't answer and the watchdog's
    // staleness check picks it up on the next tick.
    sendPing();
  };
  const onVisibility = () => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "visible"
    ) {
      onResume();
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pageshow", onResume);
    window.addEventListener("online", onResume);
    window.addEventListener("focus", onResume);
  }

  connect();

  return {
    send: (data) => {
      if (!sock || sock.readyState !== OPEN) return false;
      try {
        sock.send(data);
        return true;
      } catch {
        return false;
      }
    },
    isOpen: () => sock !== null && sock.readyState === OPEN,
    close: () => {
      if (closedByUser) return;
      closedByUser = true;
      clearReconnectTimer();
      clearInterval(watchdog);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("pageshow", onResume);
        window.removeEventListener("online", onResume);
        window.removeEventListener("focus", onResume);
      }
      const old = sock;
      sock = null;
      if (old) {
        try {
          old.close();
        } catch {
          // already dead; nothing to release
        }
      }
    },
  };
}
