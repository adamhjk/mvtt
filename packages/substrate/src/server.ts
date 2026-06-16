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
import type { Registry } from "./registry.js";
import { WireMsg } from "./protocol.js";
import { type CommandName, type WorldId } from "./schema.js";
import { ConnectionOpened, ConnectionClosed } from "./core-plugin.js";
import { runSystemsToFixpoint } from "./systems-runner.js";
import type { PersistenceAdapter } from "./persistence.js";
import { matches as matchesVisibility, type Recipient } from "./visibility.js";
import type { WorldState } from "./world.js";
import type { CommandEnvelope } from "./command-pipeline.js";
import { WorldsRegistry, type WorldRuntime } from "./worlds-registry.js";
import { WorldsService } from "./worlds-service.js";
import type { WorldsRepository } from "./worlds-repository.js";

export { WorldsService } from "./worlds-service.js";
export type { WorldsServiceOptions } from "./worlds-service.js";

/**
 * Filter a serialised WorldState down to entities visible to a specific
 * recipient. Entities without a registered visibility resolver claim are
 * treated as public.
 *
 * **GM read bypass:** GMs see every entity regardless of its
 * `Permissions.read` (or any other entity-visibility resolver claim).
 * That's the universal escape hatch — GMs run the world and need to
 * see everything in it. Event-level visibility (whispers, GM-only
 * rolls) intentionally does NOT apply this bypass, because event
 * visibility is the per-message broadcast policy, not an
 * "is this thing visible to you" question.
 */
/**
 * Pluck every attached trait off an entity, keyed by full qualified
 * name — the shape `entityVisibility` resolvers and the wire-frame
 * `entity-revealed.traits` field expect. Returns an empty object if
 * the entity has been despawned.
 */
function collectAllTraits(runtime: WorldRuntime, entityId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!runtime.world.has(entityId)) return out;
  for (const [name, def] of runtime.registry.traits) {
    const got = runtime.world.get(entityId, [def]);
    if (got === undefined) continue;
    const short = name.split("/").pop() ?? name;
    const v = (got as Record<string, unknown>)[short];
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/**
 * Per-connection visibility delta: for a single entity whose
 * visibility just changed, decide for each connection whether the
 * recipient gained or lost access and push the matching wire frame.
 * Updates `conn.visibleEntities` so the next delta sees the right
 * starting state.
 *
 * GMs always pass (universal bypass) — they never lose access. The
 * resolver returning `null` means the entity is public; everyone keeps
 * it.
 */
function emitVisibilityDeltas(
  runtime: WorldRuntime,
  conns: Set<Conn>,
  entityId: string,
  seq: number,
): void {
  const exists = runtime.world.has(entityId);
  const traits = exists ? collectAllTraits(runtime, entityId) : {};
  const vis = exists ? runtime.registry.resolveEntityVisibility(traits) : null;
  for (const conn of conns) {
    if (conn.worldId !== runtime.worldId) continue;
    if (conn.sock.readyState !== conn.sock.OPEN) continue;
    const had = conn.visibleEntities.has(entityId);
    const isGm = conn.recipient?.role === "gm";
    const should = exists && (isGm || vis === null || matchesVisibility(vis, conn.recipient));
    if (should && !had) {
      conn.sock.send(
        JSON.stringify({
          kind: "entity-revealed",
          worldId: runtime.worldId,
          seq,
          entityId,
          traits,
        }),
      );
      conn.visibleEntities.add(entityId);
    } else if (!should) {
      // Always hide on revoke — even when `visibleEntities` says the
      // recipient never had it, the client may have spawned the entity
      // locally from a public-broadcast spawn event (the substrate
      // doesn't currently filter universal-mirror events by per-entity
      // visibility). Sending `entity-hidden` is idempotent on clients
      // that don't have the entity, so the cost of "extra" frames is
      // a no-op despawn rather than incorrect visibility.
      conn.sock.send(
        JSON.stringify({
          kind: "entity-hidden",
          worldId: runtime.worldId,
          seq,
          entityId,
        }),
      );
      conn.visibleEntities.delete(entityId);
    }
  }
}

function dumpForRecipient(
  state: WorldState,
  registry: Registry,
  recipient: Recipient | null,
): WorldState {
  const entities: Record<string, Record<string, unknown>> = {};
  const isGm = recipient?.role === "gm";
  for (const [id, traits] of Object.entries(state.entities)) {
    if (isGm) {
      entities[id] = traits;
      continue;
    }
    const vis = registry.resolveEntityVisibility(traits);
    if (matchesVisibility(vis ?? undefined, recipient)) {
      entities[id] = traits;
    }
  }
  return { nextId: state.nextId, entities };
}

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean;

/**
 * Validate an inbound WebSocket upgrade. The substrate has already
 * parsed the worldId out of the query string and confirmed the world
 * exists; the callback decides whether this user (a) has a valid
 * session and (b) is allowed to connect to this world. Return the
 * opaque session object to accept (it is threaded through to commands
 * as `actor.session`), or null to reject the upgrade with 401/403.
 */
export type AuthenticateUpgrade = (
  req: IncomingMessage,
  worldId: WorldId,
) => Promise<unknown | null> | unknown | null;

/**
 * Pull the substrate's `Recipient` shape out of an opaque session for the
 * purposes of visibility filtering. Auth-aware servers wire this to their
 * AuthSession parser; auth-less servers leave it absent and the visibility
 * filter treats every event as public.
 */
export type ExtractRecipient = (session: unknown) => Recipient | null;

export interface ServerOptions {
  port: number;
  /**
   * Plugins loaded into every world's Registry regardless of game
   * system: substrate-core (auto-loaded), auth, identity, permissions,
   * comms, shell-workbench, etc. The deployment owner decides what
   * counts as infrastructure — the substrate doesn't hardcode a list.
   */
  infrastructure: ReadonlyArray<PluginDef>;
  /**
   * The universe of optional plugins. Each world's Registry is filtered
   * to its chosen game system + that system's transitive `dependsOn`,
   * drawn from this set. Includes both shared-mechanics plugins
   * (`@vtt/dice-tray`, `@vtt/characters`, ...) and game-system plugins
   * marked `gameSystem: true` (`@vtt/system-simple`, ...).
   */
  optional: ReadonlyArray<PluginDef>;
  /**
   * Worlds aggregate storage — list of worlds, owners, memberships.
   * The server constructs a WorldsService over this and uses it to
   * gate WS upgrades by membership.
   */
  worldsRepo: WorldsRepository;
  /** Directory of built client assets to serve at /. Skipped if absent. */
  clientRoot?: string;
  /** Application HTTP handler — gets first crack at every request. Return true if handled. */
  httpHandler?: HttpHandler;
  /**
   * WS upgrade gate. The substrate has already validated the worldId
   * (exists, not archived). The callback decides session + access. If
   * absent, all upgrades are accepted with no session (insecure — only
   * suitable for tests and local dev without auth).
   */
  authenticateUpgrade?: AuthenticateUpgrade;
  /**
   * Pull a `{userId, role}` Recipient out of the opaque session. Used
   * by the per-recipient visibility filter on the broadcast path.
   */
  extractRecipient?: ExtractRecipient;
  /**
   * Optional persistence adapter. When provided, every world's runtime
   * cold-boots by loading its latest snapshot, replaying its events,
   * and only then accepting connections.
   */
  persistence?: PersistenceAdapter;
  /**
   * Take a snapshot every N committed events per world. Defaults to 200.
   */
  snapshotEveryEvents?: number;
  /** Keep this many most-recent snapshots per world. Defaults to 3. */
  snapshotsToKeep?: number;
  /** Dev: forward non-`/ws` traffic to a Vite upstream for HMR. */
  devProxy?: string;
  /** Static-mounted directories, keyed by URL prefix. */
  assetRoots?: Readonly<Record<string, string>>;
  /**
   * Called once per world runtime, after cold-boot replay completes
   * and after the substrate's own broadcast wiring is attached, but
   * before any connection has been bound to the runtime. Server-only
   * subsystems (e.g. notes' FTS bridge) use this to subscribe to the
   * runtime's bus and bootstrap per-world state.
   */
  onRuntimeCreated?: (runtime: WorldRuntime) => void;
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

function proxyHttp(upstream: URL, req: IncomingMessage, res: ServerResponse): void {
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

function proxyUpgrade(upstream: URL, req: IncomingMessage, socket: Socket, head: Buffer): void {
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
    res.setHeader(
      "content-type",
      MIME[extname(absolute).toLowerCase()] ?? "application/octet-stream",
    );
    res.setHeader("content-length", String(body.byteLength));
    res.end(body);
  } catch {
    await fallbackOr404();
  }
}

export interface ServerHandle {
  readonly worldsService: WorldsService;
  readonly worldsRegistry: WorldsRegistry;
  readonly port: number;
  /** Force a snapshot to disk for every loaded runtime. */
  takeSnapshots(): Promise<void>;
  close(): Promise<void>;
}

let nextClient = 1;

interface Conn {
  sock: WebSocket;
  clientId: string;
  worldId: WorldId;
  session: unknown;
  recipient: Recipient | null;
  /** Heartbeat liveness flag, see HEARTBEAT_INTERVAL_MS comment. */
  isAlive: boolean;
  /**
   * Entities currently visible to this recipient — the source of truth
   * for live visibility deltas. Initialised at snapshot send time from
   * the dump's filtered entity set, then maintained by the broadcast
   * hook when visibility-affecting traits change. Used to decide
   * whether a `PermissionsChanged` event should fire an
   * `entity-revealed` (gain access) or `entity-hidden` (lose access)
   * wire frame on this connection.
   */
  visibleEntities: Set<string>;
}

/**
 * Parse the worldId off an upgrade request. The wire shape is
 * `/ws?worldId=<id>` (query string). Path-only `/ws` is rejected with
 * 400 — there is no implicit default world in multi-world mode.
 *
 * Returns null if the URL is malformed or the worldId is missing.
 */
function parseWorldIdFromUpgrade(req: IncomingMessage): WorldId | null {
  // Build a URL from the relative path; the host doesn't matter, we
  // only want the searchParams.
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://_");
  } catch {
    return null;
  }
  const id = url.searchParams.get("worldId");
  if (!id) return null;
  return id as WorldId;
}

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  const snapshotEvery = opts.snapshotEveryEvents ?? 200;
  const snapshotsToKeep = opts.snapshotsToKeep ?? 3;

  // Boot order: persistence migrate → worlds-repo migrate → service
  // and registry constructed → HTTP/WS server. WorldRuntimes are lazy
  // and instantiate on the first connection per world.
  if (opts.persistence) await opts.persistence.migrate();
  await opts.worldsRepo.migrate();

  const persistence = opts.persistence ?? memoryPersistenceFallback();
  const worldsService = new WorldsService({
    worldsRepo: opts.worldsRepo,
    persistence,
  });

  const conns = new Set<Conn>();

  // Per-runtime broadcast handler. Registered once per runtime when it
  // is first acquired; iterates the global conns set filtered to this
  // runtime's worldId. Runs the visibility filter per recipient and
  // drives snapshot cadence via runtime.observeBroadcast.
  const wireRuntimeBroadcasts = (runtime: WorldRuntime): void => {
    runtime.bus.onAny((event: EventInstance) => {
      const def = runtime.registry.events.get(event.type);
      if (def && !def.broadcast) return;
      const seq = runtime.pipeline.seqFor(event) ?? -1;
      const msg = JSON.stringify({ kind: "event", seq, event });
      for (const conn of conns) {
        if (conn.worldId !== runtime.worldId) continue;
        if (conn.sock.readyState !== conn.sock.OPEN) continue;
        if (!matchesVisibility(event.visibility, conn.recipient)) continue;
        conn.sock.send(msg);
      }
      // Live read-permission deltas: when an entity's `Permissions.read`
      // changes such that some recipient now should/shouldn't see it,
      // fan out per-recipient `entity-revealed` (gain access) or
      // `entity-hidden` (lose access) wire frames so the affected
      // clients spawn or despawn the entity locally without waiting
      // for a reconnect. The substrate stays trait-agnostic about
      // which trait signals visibility — it relies on the registry's
      // resolver to derive the entity's current visibility post-event.
      // The hook is keyed on the (always-on) `@vtt/permissions/PermissionsChanged`
      // event because that's the only thing that flips visibility today;
      // a future "any visibility-affecting event" mechanism would
      // generalise this off the dirty map exposed by the pipeline.
      if (event.type === "@vtt/permissions/PermissionsChanged") {
        const entityId = (event.payload as { entityId: string }).entityId;
        emitVisibilityDeltas(runtime, conns, entityId, seq);
      }
      runtime.observeBroadcast(event);
    });
  };

  const worldsRegistry = new WorldsRegistry({
    worldsRepo: opts.worldsRepo,
    persistence: opts.persistence,
    infrastructure: opts.infrastructure,
    optional: opts.optional,
    snapshotEvery,
    snapshotsToKeep,
    onRuntimeCreated: (rt) => {
      wireRuntimeBroadcasts(rt);
      opts.onRuntimeCreated?.(rt);
    },
  });

  const devProxyUrl = opts.devProxy ? new URL(opts.devProxy) : null;
  const assetRoots = Object.entries(opts.assetRoots ?? {})
    .map(([prefix, root]) => ({ prefix, root: resolve(root) }))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  const httpServer = createServer(async (req, res) => {
    try {
      if (opts.httpHandler) {
        const handled = await opts.httpHandler(req, res);
        if (handled) return;
      }
      const url = (req.url ?? "/").split("?")[0]!;
      for (const { prefix, root } of assetRoots) {
        if (!url.startsWith(prefix)) continue;
        const rel = url.slice(prefix.length);
        await serveStatic(root, { ...req, url: "/" + rel } as IncomingMessage, res, {
          spaFallback: false,
        });
        return;
      }
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

  // Heartbeat is global across all worlds — one timer pings every conn
  // regardless of which runtime it's attached to. See HEARTBEAT_INTERVAL_MS.
  const HEARTBEAT_INTERVAL_MS = 15_000;
  const heartbeat = setInterval(() => {
    for (const conn of conns) {
      if (!conn.isAlive) {
        conn.sock.terminate();
        continue;
      }
      conn.isAlive = false;
      try {
        conn.sock.ping();
      } catch {
        // ping() may throw on a half-closed socket; next tick catches it.
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  httpServer.on("upgrade", async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    // Dev-proxy: forward non-`/ws` upgrades upstream (Vite HMR socket).
    if (devProxyUrl) {
      const path = (req.url ?? "/").split("?")[0]!;
      if (path !== "/ws") {
        proxyUpgrade(devProxyUrl, req, socket, head);
        return;
      }
    }

    const worldId = parseWorldIdFromUpgrade(req);
    if (!worldId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\nmissing worldId");
      socket.destroy();
      return;
    }

    // Validate the world exists and is bootable. We don't pre-acquire
    // here — auth happens first; a missing/archived world is a 404 even
    // for a logged-in user.
    const record = await worldsService.get(worldId);
    if (!record || record.archivedAt !== null) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\nunknown world");
      socket.destroy();
      return;
    }

    let session: unknown = null;
    if (opts.authenticateUpgrade) {
      try {
        session = await opts.authenticateUpgrade(req, worldId);
      } catch {
        session = null;
      }
      if (!session) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    // Acquire the runtime BEFORE handing the socket to the WS server.
    // Doing acquire inside the connection handler created a window where
    // the socket was open and the client could send commands, but the
    // server's `sock.on("message", …)` listener hadn't been attached yet
    // — Node EventEmitters don't buffer, so frames arriving during the
    // cold-boot replay were silently dropped. The first browser load
    // after world creation hit this every time (cold-boot from disk);
    // a hard refresh worked because the runtime was already cached.
    let runtime: WorldRuntime;
    try {
      runtime = await worldsRegistry.acquire(worldId);
    } catch (err) {
      socket.write(`HTTP/1.1 500 Internal Server Error\r\n\r\n${(err as Error).message}`);
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (sock) => {
      wss.emit("connection", sock, req, { session, worldId, runtime });
    });
  });

  wss.on(
    "connection",
    (
      sock: WebSocket,
      _req: IncomingMessage,
      ctx: { session: unknown; worldId: WorldId; runtime: WorldRuntime },
    ) => {
      const runtime = ctx.runtime;

      const clientId = `client-${nextClient++}`;
      const recipient = opts.extractRecipient ? opts.extractRecipient(ctx.session) : null;
      const conn: Conn = {
        sock,
        clientId,
        worldId: ctx.worldId,
        session: ctx.session,
        recipient,
        isAlive: true,
        visibleEntities: new Set<string>(),
      };
      conns.add(conn);
      sock.on("pong", () => {
        conn.isAlive = true;
      });

      // Register the message listener synchronously, BEFORE any sends or
      // system runs, so frames can never land in a dropped-event gap.
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
            cmd: {
              type: msg.data.cmd.type as CommandName,
              payload: msg.data.cmd.payload,
            },
            session: conn.session,
            causalState: msg.data.causalState,
          };
          const result = await runtime.pipeline.dispatch(env);
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

        if (msg.data.kind === "ping") {
          // App-level liveness probe (see ClientPingMsg in protocol.ts).
          // Reply directly on this socket; no world or runtime involved.
          sock.send(JSON.stringify({ kind: "pong", t: msg.data.t }));
          return;
        }

        if (msg.data.kind === "presence") {
          // Per-world presence: scoped to the originator's runtime.
          const allowList = msg.data.to;
          const out = JSON.stringify(msg.data);
          for (const peer of conns) {
            if (peer === conn) continue;
            if (peer.worldId !== conn.worldId) continue;
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

      sock.send(
        JSON.stringify({
          kind: "hello",
          clientId,
          worldId: ctx.worldId,
          plugins: runtime.registry.plugins.map((p) => ({
            name: p.name,
            version: p.version,
          })),
        }),
      );

      const filteredState = dumpForRecipient(runtime.world.dump(), runtime.registry, recipient);
      // Seed the connection's visible-entities set from the snapshot
      // we're about to send. Subsequent visibility deltas (driven by
      // `PermissionsChanged`) are computed against this set, so what
      // the recipient initially sees defines the starting point.
      conn.visibleEntities = new Set(Object.keys(filteredState.entities));
      sock.send(
        JSON.stringify({
          kind: "snapshot",
          worldId: ctx.worldId,
          atSeq: runtime.pipeline.currentSeq,
          state: filteredState,
        }),
      );
      sock.send(
        JSON.stringify({
          kind: "synced",
          atSeq: runtime.pipeline.currentSeq,
        }),
      );

      // Lifecycle event scoped to this runtime.
      const opened = runSystemsToFixpoint(runtime.registry, runtime.world, [
        ConnectionOpened({ clientId, session: ctx.session }),
      ]);
      for (const ev of opened) runtime.bus.emit(ev);

      sock.on("close", () => {
        conns.delete(conn);
        const closed = runSystemsToFixpoint(runtime.registry, runtime.world, [
          ConnectionClosed({ clientId }),
        ]);
        for (const ev of closed) runtime.bus.emit(ev);
      });
    },
  );

  return new Promise<ServerHandle>((resolveHandle) => {
    httpServer.listen(opts.port, () => {
      const addr = httpServer.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      resolveHandle({
        worldsService,
        worldsRegistry,
        port,
        takeSnapshots: async () => {
          await Promise.allSettled(worldsRegistry.all().map((rt) => rt.takeSnapshot()));
        },
        close: async () => {
          try {
            await worldsRegistry.closeAll();
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

/**
 * Stand-in PersistenceAdapter for callers that omit `opts.persistence`
 * — keeps WorldsService.hardDelete from blowing up. Doesn't preserve
 * any state (event log, snapshots all empty); that's the caller's
 * choice when they declined to pass a real adapter.
 */
function memoryPersistenceFallback(): PersistenceAdapter {
  return {
    migrate: async () => {},
    appendEvents: async () => {},
    readEventsSince: async () => [],
    highestSeq: async () => 0,
    loadLatestSnapshot: async () => null,
    writeSnapshot: async () => {},
    hardDeleteWorld: async () => {},
  };
}
