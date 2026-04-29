import type { CommandInstance, EventInstance, PluginDef } from "./define.js";
import { Registry } from "./registry.js";
import { World } from "./world.js";
import { EventBus } from "./event-bus.js";
import { WireMsg } from "./protocol.js";
import type { EventName, QualifiedName } from "./schema.js";
import { substrateCorePlugin } from "./core-plugin.js";
import { runSystemsToFixpoint } from "./systems-runner.js";
import { createContext, createSignal, useContext } from "solid-js";

export interface ClientOptions {
  url: string;
  plugins: ReadonlyArray<PluginDef>;
}

/**
 * High-frequency, non-event-sourced side channel — drag ghosts, cursors,
 * "X is typing", anything where freshness matters and durability doesn't.
 * The substrate fans `publish`ed payloads out to all OTHER clients (the
 * originator already knows the value locally); `subscribe` runs the
 * provided callback for incoming payloads on the named channel.
 */
export interface PresenceApi {
  publish(channel: string, payload: unknown, opts?: { to?: string[] }): void;
  subscribe<T = unknown>(
    channel: string,
    fn: (payload: T) => void,
  ): () => void;
}

/**
 * Resolution of a dispatched command: ok/reason as the server reported
 * it on the wire. Resolves once the server's `ack` for this command id
 * arrives. Never rejects — a connection drop after dispatch resolves
 * with `ok: false, reason: "disconnected"` so callers can clear UI
 * busy-state instead of hanging.
 */
export interface DispatchAck {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface DispatchHandle {
  /** The wire-level command id; useful for correlating with logs. */
  readonly id: string;
  /** Resolves when the server acks this command. */
  readonly ack: Promise<DispatchAck>;
}

export interface ClientHandle {
  readonly registry: Registry;
  readonly world: World;
  readonly bus: EventBus;
  readonly presence: PresenceApi;
  readonly clientId: () => string | null;
  /** The worldId this client is connected to, as advertised by the server's hello. Null until connected. */
  readonly worldId: () => string | null;
  readonly connected: () => boolean;
  /** Highest event seq this client has applied (snapshot.atSeq or event.seq). */
  readonly lastAppliedSeq: () => number;
  /** True once the server has sent `synced` — initial catchup is complete. */
  readonly synced: () => boolean;
  dispatch(cmd: CommandInstance, opts?: { causalState?: unknown }): DispatchHandle;
  onConnect(fn: () => void): () => void;
  /** Fires once when the client transitions from catchup to live mode. */
  onSynced(fn: () => void): () => void;
  close(): void;
}

let cmdCounter = 1;
const newCmdId = () =>
  `cmd-${Date.now().toString(36)}-${cmdCounter++}-${Math.random().toString(36).slice(2, 8)}`;

export function startClient(opts: ClientOptions): ClientHandle {
  const registry = new Registry();
  registry.load(substrateCorePlugin);
  for (const p of opts.plugins) registry.load(p);
  registry.validate();

  const world = new World();
  const bus = new EventBus();

  // These are exposed to the UI (clientId, connected, synced, lastAppliedSeq)
  // and are read inside Solid `createMemo`/`createEffect`. Storing them as
  // Solid signals — not plain closure variables — makes views that depend
  // on them re-render correctly when they change. The rule for client
  // state that views observe: signal, not closure.
  const [clientId, setClientId] = createSignal<string | null>(null);
  const [worldId, setWorldId] = createSignal<string | null>(null);
  const [connected, setConnected] = createSignal(false);
  const [lastAppliedSeq, setLastAppliedSeq] = createSignal(0);
  const [synced, setSynced] = createSignal(false);
  const connectListeners = new Set<() => void>();
  const syncedListeners = new Set<() => void>();
  // commandId -> deferred ack. Set on dispatch, drained on the matching
  // `ack` wire frame (or on disconnect, see the close handler below).
  const pendingAcks = new Map<
    string,
    { resolve: (ack: DispatchAck) => void }
  >();
  const sock = new WebSocket(opts.url);

  sock.addEventListener("open", () => {
    setConnected(true);
  });

  sock.addEventListener("close", () => {
    setConnected(false);
    // Drain pending acks so callers awaiting them don't hang forever.
    // Disconnect mid-dispatch is indistinguishable from a server-side
    // failure from the caller's perspective; surface it as not-ok with a
    // reason so UI busy-states can clear.
    for (const pending of pendingAcks.values()) {
      pending.resolve({ ok: false, reason: "disconnected" });
    }
    pendingAcks.clear();
  });

  sock.addEventListener("message", (e) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof e.data === "string" ? e.data : "");
    } catch {
      return;
    }
    const msg = WireMsg.safeParse(parsed);
    if (!msg.success) return;
    switch (msg.data.kind) {
      case "hello":
        setClientId(msg.data.clientId);
        setWorldId(msg.data.worldId);
        for (const fn of connectListeners) fn();
        break;
      case "snapshot":
        // Server-authoritative state replacement: apply directly to the
        // local World without running systems. The snapshot is "frozen
        // state" — the server already ran the systems that produced it.
        world.restore(msg.data.state);
        setLastAppliedSeq(msg.data.atSeq);
        break;
      case "synced": {
        const atSeq = msg.data.atSeq;
        setSynced(true);
        setLastAppliedSeq((prev) => Math.max(prev, atSeq));
        for (const fn of syncedListeners) fn();
        break;
      }
      case "event": {
        const evType = msg.data.event.type as EventName;
        const def = registry.events.get(evType);
        if (!def) return;
        const ev: EventInstance = {
          type: evType,
          payload: def.schema.parse(msg.data.event.payload),
        };
        // Apply through the same fixpoint runner the server uses so the
        // client's local World mirrors authoritative state.
        const all = runSystemsToFixpoint(registry, world, [ev]);
        for (const e of all) bus.emit(e);
        const seq = msg.data.seq;
        if (typeof seq === "number") {
          setLastAppliedSeq((prev) => Math.max(prev, seq));
        }
        break;
      }
      case "ack": {
        const pending = pendingAcks.get(msg.data.commandId);
        if (pending) {
          pendingAcks.delete(msg.data.commandId);
          pending.resolve({
            ok: msg.data.ok,
            reason: msg.data.reason,
          });
        }
        break;
      }
      case "presence": {
        const subs = presenceSubs.get(msg.data.channel as QualifiedName);
        if (subs) for (const fn of subs) fn(msg.data.payload);
        break;
      }
    }
  });

  // Presence: per-channel listeners, not buffered. Late-joining a channel
  // means you start hearing from "now"; the design is for ephemeral state
  // (cursor positions, drag ghosts) where stale snapshots aren't useful.
  const presenceSubs = new Map<QualifiedName, Set<(payload: unknown) => void>>();
  const presence: PresenceApi = {
    publish(channel, payload, pubOpts) {
      sock.send(
        JSON.stringify({
          kind: "presence",
          channel,
          payload,
          to: pubOpts?.to,
        }),
      );
    },
    subscribe(channel, fn) {
      const key = channel as QualifiedName;
      let set = presenceSubs.get(key);
      if (!set) {
        set = new Set();
        presenceSubs.set(key, set);
      }
      set.add(fn as (p: unknown) => void);
      return () => {
        set!.delete(fn as (p: unknown) => void);
      };
    },
  };

  return {
    registry,
    world,
    bus,
    presence,
    clientId,
    worldId,
    connected,
    lastAppliedSeq,
    synced,
    dispatch(cmd, dispatchOpts) {
      const id = newCmdId();
      let resolve!: (ack: DispatchAck) => void;
      const ack = new Promise<DispatchAck>((r) => {
        resolve = r;
      });
      pendingAcks.set(id, { resolve });
      sock.send(
        JSON.stringify({
          kind: "command",
          id,
          issuedAt: Date.now(),
          cmd,
          causalState: dispatchOpts?.causalState,
        }),
      );
      return { id, ack };
    },
    onConnect(fn) {
      connectListeners.add(fn);
      if (clientId() !== null) fn();
      return () => connectListeners.delete(fn);
    },
    onSynced(fn) {
      syncedListeners.add(fn);
      if (synced()) fn();
      return () => syncedListeners.delete(fn);
    },
    close() {
      sock.close();
    },
  };
}

const ClientContext = createContext<ClientHandle>();
export const ClientProvider = ClientContext.Provider;

export function useClient(): ClientHandle {
  const c = useContext(ClientContext);
  if (!c) throw new Error("useClient must be used inside ClientProvider");
  return c;
}

export { Surface, useTrait, useQuery } from "./reactivity.jsx";
export type { QueryRow } from "./reactivity.jsx";
export type { PluginDef } from "./define.js";
