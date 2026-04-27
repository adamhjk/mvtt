import { WebSocketServer, type WebSocket } from "ws";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { stat, readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { PluginDef, EventInstance } from "./define.js";
import { Registry } from "./registry.js";
import { World } from "./world.js";
import { EventBus } from "./event-bus.js";
import { CommandPipeline, type CommandEnvelope } from "./command-pipeline.js";
import { WireMsg } from "./protocol.js";
import {
  type CommandName,
  type WorldId,
  DEFAULT_WORLD_ID,
} from "./schema.js";
import {
  substrateCorePlugin,
  ConnectionOpened,
  ConnectionClosed,
} from "./core-plugin.js";
import { runSystemsToFixpoint } from "./systems-runner.js";
import type { PersistenceAdapter } from "./persistence.js";
import { matches as matchesVisibility, type Recipient } from "./visibility.js";
import type { WorldState } from "./world.js";

/**
 * Filter a serialised WorldState down to entities visible to a specific
 * recipient. Entities without a registered visibility resolver claim are
 * treated as public. The substrate uses this on every catchup snapshot
 * so a player connecting after a GM-only roll doesn't see the Roll
 * entity in their snapshot — the live broadcast filter alone isn't
 * enough to prevent that leak.
 */
function dumpForRecipient(
  state: WorldState,
  registry: Registry,
  recipient: Recipient | null,
): WorldState {
  const entities: Record<string, Record<string, unknown>> = {};
  for (const [id, traits] of Object.entries(state.entities)) {
    const vis = registry.resolveEntityVisibility(traits);
    if (matchesVisibility(vis ?? undefined, recipient)) {
      entities[id] = traits;
    }
  }
  return { nextId: state.nextId, entities };
}

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean;

/**
 * Validate an inbound WebSocket upgrade. Return a session object to accept
 * (the substrate threads it through to command contexts as `actor.session`),
 * or null to reject the upgrade with 401. The substrate is auth-agnostic;
 * the server entry decides the rules.
 */
export type AuthenticateUpgrade = (req: IncomingMessage) => Promise<unknown | null> | unknown | null;

/**
 * Pull the substrate's `Recipient` shape out of an opaque session for the
 * purposes of visibility filtering. Auth-aware servers wire this to their
 * AuthSession parser; auth-less servers leave it absent and the visibility
 * filter treats every event as public.
 */
export type ExtractRecipient = (session: unknown) => Recipient | null;

export interface ServerOptions {
  port: number;
  plugins: ReadonlyArray<PluginDef>;
  /** Directory of built client assets to serve at /. Skipped if absent. */
  clientRoot?: string;
  /** Application HTTP handler — gets first crack at every request. Return true if handled. */
  httpHandler?: HttpHandler;
  /** WS upgrade gate. If absent, all upgrades are accepted with no session. */
  authenticateUpgrade?: AuthenticateUpgrade;
  /**
   * Pull a `{userId, role}` Recipient out of the opaque session. Used by
   * the per-recipient visibility filter on the broadcast path. If absent,
   * every connection is treated as anonymous and any non-public event is
   * dropped for safety.
   */
  extractRecipient?: ExtractRecipient;
  /**
   * Optional persistence adapter. When provided, the server cold-boots by
   * loading the latest snapshot, replaying events past it, and only then
   * accepting connections. Subsequent durable events are written before
   * broadcast so a crash mid-dispatch is recoverable.
   */
  persistence?: PersistenceAdapter;
  /**
   * Which world this server hosts. v1 servers host exactly one. The schema
   * has worldId as a primary-key column from day one so multi-world hosting
   * is a wiring change, not a migration. Defaults to "default".
   */
  worldId?: WorldId;
  /**
   * Take a snapshot every N committed events. Defaults to 200. Set to a
   * very large number to effectively disable periodic snapshots.
   */
  snapshotEveryEvents?: number;
  /**
   * Keep this many most-recent snapshots; older ones are pruned. Defaults to 3.
   */
  snapshotsToKeep?: number;
  /**
   * Dev-only: forward non-API HTTP requests and non-`/ws` WebSocket
   * upgrades to a Vite dev server (or any HTTP+WS upstream). When set,
   * `clientRoot` is ignored — fresh source from Vite (with HMR) reaches
   * the browser even if the user is loading the substrate's port directly.
   * Format: `http://host:port` (no trailing slash). Leave unset in prod.
   */
  devProxy?: string;
  /**
   * Static-mounted directories, keyed by URL prefix (e.g. `"/icons/"` →
   * `"/abs/path/to/icons"`). Resolved before `devProxy` and `clientRoot`
   * so plugin/server-shipped assets aren't shadowed by Vite or the
   * built bundle. Each prefix MUST start and end with `/`.
   */
  assetRoots?: Readonly<Record<string, string>>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/**
 * Forward a plain HTTP request to a dev upstream (Vite). Streams the body
 * both ways. Used in dev so the substrate's port (3001) serves Vite's
 * compiled output with HMR rather than a stale built bundle.
 */
function proxyHttp(
  upstream: URL,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const headers = { ...req.headers, host: upstream.host };
  const upReq = httpRequest(
    {
      hostname: upstream.hostname,
      port: upstream.port,
      path: req.url ?? "/",
      method: req.method,
      headers,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  upReq.on("error", (err) => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("content-type", "text/plain");
    }
    res.end(`dev proxy error: ${err.message}`);
  });
  req.pipe(upReq);
}

/**
 * Forward a WebSocket upgrade to a dev upstream. Lets Vite's HMR socket
 * (which is on a path other than `/ws`) reach the browser through the
 * substrate's port without the substrate needing to understand HMR.
 */
function proxyUpgrade(
  upstream: URL,
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): void {
  const headers = { ...req.headers, host: upstream.host };
  const upReq = httpRequest({
    hostname: upstream.hostname,
    port: upstream.port,
    path: req.url ?? "/",
    method: req.method,
    headers,
  });
  upReq.on("upgrade", (upRes, upSocket, upHead) => {
    const lines = [
      `HTTP/1.1 ${upRes.statusCode ?? 101} ${upRes.statusMessage ?? "Switching Protocols"}`,
    ];
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) for (const item of v) lines.push(`${k}: ${item}`);
      else lines.push(`${k}: ${v}`);
    }
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    if (upHead.length) socket.write(upHead);
    if (head.length) upSocket.write(head);
    upSocket.pipe(socket).pipe(upSocket);
  });
  upReq.on("error", () => socket.destroy());
  upReq.end();
}

async function serveStatic(
  root: string,
  req: IncomingMessage,
  res: ServerResponse,
  opts: { spaFallback?: boolean } = {},
): Promise<void> {
  const spaFallback = opts.spaFallback ?? true;
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  const wantedRel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const absolute = resolve(join(root, normalize(wantedRel)));
  const safeRoot = resolve(root);
  if (absolute !== safeRoot && !absolute.startsWith(safeRoot + sep)) {
    res.statusCode = 403;
    res.end("forbidden");
    return;
  }
  const fallbackOr404 = async () => {
    if (spaFallback) {
      try {
        const fallback = await readFile(join(safeRoot, "index.html"));
        res.statusCode = 200;
        res.setHeader("content-type", MIME[".html"]!);
        res.end(fallback);
        return;
      } catch {
        // fall through
      }
    }
    res.statusCode = 404;
    res.end("not found");
  };
  try {
    const s = await stat(absolute);
    if (!s.isFile()) {
      await fallbackOr404();
      return;
    }
    const body = await readFile(absolute);
    res.statusCode = 200;
    res.setHeader("content-type", MIME[extname(absolute).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("content-length", String(body.byteLength));
    res.end(body);
  } catch {
    await fallbackOr404();
  }
}

export interface ServerHandle {
  readonly registry: Registry;
  readonly world: World;
  readonly bus: EventBus;
  readonly pipeline: CommandPipeline;
  readonly port: number;
  readonly worldId: WorldId;
  /** Force a snapshot to disk now. Resolves once the snapshot has been written. */
  takeSnapshot(): Promise<void>;
  close(): Promise<void>;
}

let nextClient = 1;

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  const worldId: WorldId = opts.worldId ?? DEFAULT_WORLD_ID;
  const snapshotEvery = opts.snapshotEveryEvents ?? 200;
  const snapshotsToKeep = opts.snapshotsToKeep ?? 3;

  const registry = new Registry();
  registry.load(substrateCorePlugin);
  for (const p of opts.plugins) registry.load(p);
  registry.validate();

  const world = new World(worldId);
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus, {
    persistence: opts.persistence,
  });

  // Cold-boot replay. Load latest snapshot, restore the World, and replay
  // any events past it through systems so the in-memory World matches the
  // last persisted seq. WS doesn't open until this is done.
  if (opts.persistence) {
    await opts.persistence.migrate();
    const snapshot = await opts.persistence.loadLatestSnapshot(worldId);
    if (snapshot) world.restore(snapshot.state);
    const sinceSeq = snapshot?.atSeq ?? 0;
    const tail = await opts.persistence.readEventsSince(worldId, sinceSeq);
    if (tail.length > 0) {
      const events: EventInstance[] = tail.map((e) => ({
        type: e.type as EventInstance["type"],
        payload: e.payload,
      }));
      // Replay through systems but DON'T re-persist or re-broadcast — the
      // events are already in the log and there's no one connected yet.
      runSystemsToFixpoint(registry, world, events);
    }
    const highest = await opts.persistence.highestSeq(worldId);
    pipeline.setNextSeq(highest + 1);
  }

  // Persisted snapshots strip transient traits — session state (Online,
  // Identity, Name) shouldn't carry forward across restarts. Live catchup
  // snapshots sent to clients still include them so the new client has the
  // current presence picture.
  const isDurableTrait = (traitName: import("./schema.js").TraitName): boolean => {
    const def = registry.traits.get(traitName);
    return def ? !def.transient : true;
  };

  let eventsSinceSnapshot = 0;
  const takeSnapshot = async (): Promise<void> => {
    if (!opts.persistence) return;
    const atSeq = pipeline.currentSeq;
    if (atSeq === 0) return;
    await opts.persistence.writeSnapshot({
      worldId,
      atSeq,
      state: world.dump(isDurableTrait),
      takenAt: Date.now(),
    });
    if (opts.persistence.pruneSnapshots) {
      await opts.persistence.pruneSnapshots(worldId, snapshotsToKeep);
    }
    eventsSinceSnapshot = 0;
  };

  const devProxyUrl = opts.devProxy ? new URL(opts.devProxy) : null;
  // Pre-resolve asset roots so the per-request hot path is just a prefix
  // match. Sorted by descending prefix length so a more-specific mount
  // wins over a parent (e.g. `/icons/foo/` before `/icons/`).
  const assetRoots = Object.entries(opts.assetRoots ?? {})
    .map(([prefix, root]) => ({ prefix, root: resolve(root) }))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  const httpServer = createServer(async (req, res) => {
    try {
      if (opts.httpHandler) {
        const handled = await opts.httpHandler(req, res);
        if (handled) return;
      }
      // assetRoots take priority over devProxy/clientRoot so server-shipped
      // assets (icons, etc.) aren't shadowed.
      const url = (req.url ?? "/").split("?")[0]!;
      for (const { prefix, root } of assetRoots) {
        if (!url.startsWith(prefix)) continue;
        const rel = url.slice(prefix.length);
        await serveStatic(
          root,
          { ...req, url: "/" + rel } as IncomingMessage,
          res,
          { spaFallback: false },
        );
        return;
      }
      // Dev mode: stream non-API HTTP through Vite so source changes (and
      // HMR's injected client script) reach the browser without a rebuild.
      if (devProxyUrl) {
        proxyHttp(devProxyUrl, req, res);
        return;
      }
      if (opts.clientRoot) {
        await serveStatic(opts.clientRoot, req, res);
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain");
      }
      res.end(`server error: ${(err as Error).message}`);
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  type Conn = {
    sock: WebSocket;
    clientId: string;
    session: unknown;
    recipient: Recipient | null;
    /**
     * Heartbeat liveness flag. Flipped to `false` when we send a ping;
     * the socket's `pong` handler flips it back to `true`. If the next
     * heartbeat tick still finds it `false`, the socket missed a full
     * ping cycle and gets terminated.
     */
    isAlive: boolean;
  };
  const conns = new Set<Conn>();

  // WS heartbeat: ping every 15s, terminate if a pong didn't arrive in
  // the prior interval. Detection bound is one full cycle (~30s), which
  // is fast enough to keep the player list honest after a browser crash
  // or a silently-dropped connection without false-positives on brief
  // network jitter. Browsers send a clean close frame on tab close /
  // refresh in the normal case — this is the backstop for the abnormal
  // ones (OOM kill, laptop snap, NAT drop).
  const HEARTBEAT_INTERVAL_MS = 15_000;
  const heartbeat = setInterval(() => {
    for (const conn of conns) {
      if (!conn.isAlive) {
        // Missed a ping cycle. `terminate` skips the close handshake;
        // the 'close' event still fires, which runs the despawn system.
        conn.sock.terminate();
        continue;
      }
      conn.isAlive = false;
      try {
        conn.sock.ping();
      } catch {
        // ping() can throw on a half-closed socket; let the next tick
        // pick it up via the isAlive check.
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  // Don't keep the Node process alive just for the heartbeat.
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  httpServer.on("upgrade", async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    // When a dev proxy is configured, the substrate accepts WS at exactly
    // `/ws` and forwards anything else (e.g. Vite's HMR socket) upstream.
    // Without a dev proxy, all upgrades go to the substrate WS — preserves
    // the historical "WS works at any path" behaviour for tests and tools.
    if (devProxyUrl) {
      const path = (req.url ?? "/").split("?")[0]!;
      if (path !== "/ws") {
        proxyUpgrade(devProxyUrl, req, socket, head);
        return;
      }
    }

    let session: unknown = null;
    if (opts.authenticateUpgrade) {
      try {
        session = await opts.authenticateUpgrade(req);
      } catch {
        session = null;
      }
      if (!session) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(req, socket, head, (sock) => {
      wss.emit("connection", sock, req, session);
    });
  });

  bus.onAny((event: EventInstance) => {
    const def = registry.events.get(event.type);
    if (def && !def.broadcast) return;
    const seq = pipeline.seqFor(event) ?? -1;
    const msg = JSON.stringify({ kind: "event", seq, event });
    for (const conn of conns) {
      if (conn.sock.readyState !== conn.sock.OPEN) continue;
      // Per-recipient visibility: events without `visibility` are public
      // (the common case); restricted events check against the recipient
      // shape extracted from the session at connect time.
      if (!matchesVisibility(event.visibility, conn.recipient)) continue;
      conn.sock.send(msg);
    }

    // Snapshot cadence: only count durable events (the ones the pipeline
    // assigned a real seq to). Take the snapshot off the hot path.
    if (def && !def.transient && opts.persistence) {
      eventsSinceSnapshot++;
      if (eventsSinceSnapshot >= snapshotEvery) {
        // Fire and forget; failures are logged but don't crash dispatch.
        void takeSnapshot().catch((err) => {
          console.error("[mvtt] snapshot write failed:", (err as Error).message);
        });
      }
    }
  });

  wss.on("connection", (sock: WebSocket, _req: IncomingMessage, session: unknown) => {
    const clientId = `client-${nextClient++}`;
    const recipient = opts.extractRecipient ? opts.extractRecipient(session) : null;
    const conn: Conn = { sock, clientId, session, recipient, isAlive: true };
    conns.add(conn);
    sock.on("pong", () => {
      conn.isAlive = true;
    });

    sock.send(
      JSON.stringify({
        kind: "hello",
        clientId,
        worldId,
        plugins: registry.plugins.map((p) => ({ name: p.name, version: p.version })),
      }),
    );

    // Catchup: deliver the current World state to this client as a synthetic
    // snapshot, then mark them as synced. After this they receive every
    // subsequent event live via bus.onAny. The dump is filtered per
    // recipient — entities whose visibility excludes this connection are
    // omitted, matching the live broadcast filter so the snapshot can't
    // leak GM-only state to a freshly-connecting player.
    sock.send(
      JSON.stringify({
        kind: "snapshot",
        worldId,
        atSeq: pipeline.currentSeq,
        state: dumpForRecipient(world.dump(), registry, recipient),
      }),
    );
    sock.send(
      JSON.stringify({
        kind: "synced",
        atSeq: pipeline.currentSeq,
      }),
    );

    // Lifecycle event — identity plugin spawns Player, broadcasts.
    const opened = runSystemsToFixpoint(registry, world, [
      ConnectionOpened({ clientId, session }),
    ]);
    for (const ev of opened) bus.emit(ev);

    sock.on("message", async (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const msg = WireMsg.safeParse(parsed);
      if (!msg.success) return;

      if (msg.data.kind === "command") {
        const env: CommandEnvelope = {
          id: msg.data.id,
          issuedBy: clientId,
          issuedAt: msg.data.issuedAt,
          cmd: { type: msg.data.cmd.type as CommandName, payload: msg.data.cmd.payload },
          session: conn.session,
          causalState: msg.data.causalState,
        };
        const result = await pipeline.dispatch(env);
        sock.send(
          JSON.stringify({
            kind: "ack",
            commandId: env.id,
            ok: result.result.ok,
            reason: result.result.ok ? undefined : result.result.reason,
          }),
        );
        return;
      }

      if (msg.data.kind === "presence") {
        // Fan presence out to every OTHER connection — the originator
        // already has the value locally. Whisper-style scoping applies if
        // `to` is set; otherwise visibility-style "everyone" semantics.
        const allowList = msg.data.to;
        const out = JSON.stringify(msg.data);
        for (const peer of conns) {
          if (peer === conn) continue;
          if (peer.sock.readyState !== peer.sock.OPEN) continue;
          if (allowList) {
            const recipientId = peer.recipient?.userId;
            if (!recipientId || !allowList.includes(recipientId)) continue;
          }
          peer.sock.send(out);
        }
        return;
      }
    });

    sock.on("close", () => {
      conns.delete(conn);
      const closed = runSystemsToFixpoint(registry, world, [
        ConnectionClosed({ clientId }),
      ]);
      for (const ev of closed) bus.emit(ev);
    });
  });

  return new Promise<ServerHandle>((resolveHandle) => {
    httpServer.listen(opts.port, () => {
      const addr = httpServer.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      resolveHandle({
        registry,
        world,
        bus,
        pipeline,
        port,
        worldId,
        takeSnapshot,
        close: async () => {
          // Take a final snapshot so a graceful shutdown leaves replay-cost
          // bounded for the next boot.
          try {
            await takeSnapshot();
          } catch {
            // best-effort
          }
          clearInterval(heartbeat);
          for (const conn of conns) conn.sock.close();
          await new Promise<void>((r) => wss.close(() => httpServer.close(() => r())));
          if (opts.persistence?.close) await opts.persistence.close();
        },
      });
    });
  });
}
