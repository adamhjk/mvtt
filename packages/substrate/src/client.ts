import type { CommandInstance, EventInstance, PluginDef } from "./define.js";
import { Registry } from "./registry.js";
import { World } from "./world.js";
import { EventBus } from "./event-bus.js";
import { WireMsg } from "./protocol.js";
import type { EventName } from "./schema.js";
import { substrateCorePlugin } from "./core-plugin.js";
import { runSystemsToFixpoint } from "./systems-runner.js";
import { createContext, createSignal, useContext } from "solid-js";

export interface ClientOptions {
  url: string;
  plugins: ReadonlyArray<PluginDef>;
}

export interface ClientHandle {
  readonly registry: Registry;
  readonly world: World;
  readonly bus: EventBus;
  readonly clientId: () => string | null;
  readonly connected: () => boolean;
  /** Highest event seq this client has applied (snapshot.atSeq or event.seq). */
  readonly lastAppliedSeq: () => number;
  /** True once the server has sent `synced` — initial catchup is complete. */
  readonly synced: () => boolean;
  dispatch(cmd: CommandInstance): string;
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
  const [connected, setConnected] = createSignal(false);
  const [lastAppliedSeq, setLastAppliedSeq] = createSignal(0);
  const [synced, setSynced] = createSignal(false);
  const connectListeners = new Set<() => void>();
  const syncedListeners = new Set<() => void>();
  const sock = new WebSocket(opts.url);

  sock.addEventListener("open", () => {
    setConnected(true);
  });

  sock.addEventListener("close", () => {
    setConnected(false);
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
      case "ack":
        // nothing to do for the demo
        break;
    }
  });

  return {
    registry,
    world,
    bus,
    clientId,
    connected,
    lastAppliedSeq,
    synced,
    dispatch(cmd) {
      const id = newCmdId();
      sock.send(
        JSON.stringify({
          kind: "command",
          id,
          issuedAt: Date.now(),
          cmd,
        }),
      );
      return id;
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
