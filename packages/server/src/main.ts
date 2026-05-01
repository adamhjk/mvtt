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

import { fileURLToPath } from "node:url";
import { dirname, extname, resolve, basename, sep } from "node:path";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { startServer, WorldsService } from "@vtt/substrate/server";
import { listGameSystems, resolveActivePlugins, type EntityId, type WorldId, type WorldsRegistry } from "@vtt/substrate";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { comms } from "@vtt/comms";
import { notes } from "@vtt/notes";
import {
  attachNotesSearchBridge,
  handleNotesSearch,
  NotesSearchIndex,
} from "@vtt/notes/server";
import { assets } from "@vtt/assets";
import { handleAssetFetch, handleAssetUpload } from "@vtt/assets/server";
import { resolution } from "@vtt/resolution";
import { scene } from "@vtt/scene";
import { books } from "@vtt/books";
import { pdfBook } from "@vtt/pdf-book";
import { pdfBookAssetRoots } from "@vtt/pdf-book/server";
import { characters } from "@vtt/characters";
import { diceTray } from "@vtt/dice-tray";
import { diceTrayAssetRoots } from "@vtt/dice-tray/server";
import { systemSimple } from "@vtt/system-simple";
import { createAuth } from "@vtt/auth/server";
import { parseAuthSession, type AuthSession } from "@vtt/auth";
import { SqlitePersistence, SqliteWorldsRepository } from "@vtt/persistence-sqlite";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const dataDir = resolve(repoRoot, "data");
const dbPath = resolve(dataDir, "mvtt.db");
const secretPath = resolve(dataDir, "auth.secret");
const clientRoot = resolve(here, "../../client/dist");
const iconsRoot = resolve(repoRoot, "assets/icons/ffffff/transparent/1x1");
// Plugin-owned writable storage. Each plugin gets a subdirectory under
// the world it belongs to: data/plugin-data/<worldId>/<plugin>/...
// Mounted read-only at `/plugin-data/`; uploads go through
// /api/plugin-data/<worldId>/<plugin>/...
const pluginDataDir = resolve(dataDir, "plugin-data");
mkdirSync(pluginDataDir, { recursive: true });

const port = Number(process.env.PORT ?? 3001);
const baseURL = process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`;

mkdirSync(dataDir, { recursive: true });
const secret = process.env.BETTER_AUTH_SECRET ?? loadOrCreateSecret(secretPath);

const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const auth = createAuth({
  databasePath: dbPath,
  baseURL,
  secret,
  trustedOrigins,
});

await auth.migrate();

// Share the SQLite handle the auth package opened — one DB file per
// deployment, world_event/world_snapshot/world/world_membership tables
// alongside the auth tables.
const persistence = new SqlitePersistence({ db: auth.db });
await persistence.migrate();
const worldsRepo = new SqliteWorldsRepository(auth.db);
await worldsRepo.migrate();

// WorldsService used by HTTP routes. The substrate constructs its own
// internally for WS upgrade gating; both share the same repo so reads
// stay consistent.
const worldsService = new WorldsService({
  worldsRepo,
  persistence,
  pluginDataRoot: pluginDataDir,
});

// One-shot scan of the icon directory at boot. The catalog is fixed at
// deploy time so there's no need to rescan; the picker fetches this
// manifest once per session and caches it client-side.
type IconEntry = { slug: string; artist: string; name: string };
const iconManifest: IconEntry[] = existsSync(iconsRoot)
  ? buildIconManifest(iconsRoot)
  : [];
const iconManifestBody = JSON.stringify({ icons: iconManifest });

const ALLOWED_PLUGIN_DATA_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".pdf",
]);
const MAX_PLUGIN_DATA_BYTES = 250 * 1024 * 1024; // 250 MB

// Plugin set, split into infrastructure (always-on) and optional
// (game-system-and-shared-mechanics; loaded per world based on its
// chosen game system's transitive dependsOn).
const infrastructurePlugins = [
  shellWorkbench,
  identity,
  permissions,
  comms,
  notes,
  assets,
];
const optionalPlugins = [
  resolution,
  scene,
  books,
  pdfBook,
  characters,
  diceTray,
  systemSimple,
];

const authHandler = toNodeHandler(auth.auth.handler);

// Set inside `await startServer(...)`'s resolution; needed by the asset
// upload/fetch handlers (which dispatch commands and read world state).
// Top-level await on startServer ensures this is populated before any
// HTTP request is serviced.
let assetWorldsRegistry: WorldsRegistry | null = null;

// FTS5 search index for note pages, shared across worlds (rows scoped
// by worldId). Migrated below; bridged into each WorldRuntime via
// `onRuntimeCreated`.
const notesSearchIndex = new NotesSearchIndex(auth.db);
notesSearchIndex.migrate();

/**
 * Per-world member auth shared by the asset upload + fetch routes.
 * Mirrors the WS-upgrade flow: parse the cookie session, gate on world
 * membership, synthesise a per-world role.
 */
async function authenticateForWorld(
  req: IncomingMessage,
  worldId: WorldId,
): Promise<AuthSession | null> {
  const headers = fromNodeHeaders(req.headers);
  const raw = await auth.resolveSession(headers);
  const session = parseAuthSession(raw);
  if (!session) return null;
  const allowed = await worldsService.canAccess(worldId, session.userId);
  if (!allowed) return null;
  const perWorldRole =
    (await worldsService.roleFor(worldId, session.userId)) ?? "player";
  return {
    userId: session.userId,
    email: session.email,
    name: session.name,
    role: perWorldRole,
  };
}
const httpHandler = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
  const url = req.url ?? "/";
  const path = url.split("?")[0]!;

  if (url.startsWith("/api/auth/")) {
    await authHandler(req, res);
    return true;
  }
  if (url === "/api/has-gm") {
    sendJson(res, 200, { hasGameMaster: auth.hasGameMaster() });
    return true;
  }
  if (url === "/api/icons/manifest") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, max-age=300");
    res.end(iconManifestBody);
    return true;
  }

  // ---- worlds API ----

  if (path === "/api/game-systems" && req.method === "GET") {
    return await handleListGameSystems(req, res);
  }
  if (path === "/api/worlds" && req.method === "GET") {
    return await handleListWorlds(req, res);
  }
  if (path === "/api/worlds" && req.method === "POST") {
    return await handleCreateWorld(req, res);
  }
  // /api/worlds/:id...
  const worldsIdMatch = /^\/api\/worlds\/([^/]+)(\/.*)?$/.exec(path);
  if (worldsIdMatch) {
    const worldId = decodeURIComponent(worldsIdMatch[1]!) as WorldId;
    const rest = worldsIdMatch[2] ?? "";
    if (rest === "" && req.method === "DELETE") {
      return await handleHardDeleteWorld(req, res, worldId, url);
    }
    if (rest === "/archive" && req.method === "POST") {
      return await handleArchiveWorld(req, res, worldId);
    }
    if (rest === "/memberships" && req.method === "GET") {
      return await handleListMemberships(req, res, worldId);
    }
    if (rest === "/memberships" && req.method === "POST") {
      return await handleAddMembership(req, res, worldId);
    }
    const memMatch = /^\/memberships\/([^/]+)$/.exec(rest);
    if (memMatch && req.method === "DELETE") {
      const userId = decodeURIComponent(memMatch[1]!);
      return await handleRemoveMembership(req, res, worldId, userId);
    }
  }

  // ---- plugin-data upload (per-world) ----
  // POST /api/plugin-data/<worldId>/<plugin>/<rest>
  if (url.startsWith("/api/plugin-data/") && req.method === "POST") {
    const rel = decodeURIComponent(
      url.slice("/api/plugin-data/".length).split("?")[0]!,
    );
    return await handlePluginDataUpload(req, res, rel);
  }

  // ---- assets upload (per-world) ----
  // POST /api/worlds/<worldId>/assets/upload
  const assetUploadMatch = /^\/api\/worlds\/([^/]+)\/assets\/upload$/.exec(path);
  if (assetUploadMatch && req.method === "POST") {
    if (!assetWorldsRegistry) {
      sendJson(res, 503, { error: "server still warming up" });
      return true;
    }
    const worldId = decodeURIComponent(assetUploadMatch[1]!) as WorldId;
    await handleAssetUpload(req, res, worldId, {
      registry: assetWorldsRegistry,
      pluginDataDir,
      authenticate: authenticateForWorld,
    });
    return true;
  }

  // ---- assets fetch (per-world, visibility-checked) ----
  // GET /plugin-data/<worldId>/assets/<assetId>
  // Intercepts BEFORE the static `/plugin-data/` mount so we can run
  // the EntityVisibility resolver per request.
  const assetFetchMatch = /^\/plugin-data\/([^/]+)\/assets\/([^/?#]+)$/.exec(path);
  if (assetFetchMatch && req.method === "GET") {
    if (!assetWorldsRegistry) {
      sendJson(res, 503, { error: "server still warming up" });
      return true;
    }
    const worldId = decodeURIComponent(assetFetchMatch[1]!) as WorldId;
    const assetId = decodeURIComponent(assetFetchMatch[2]!) as EntityId;
    await handleAssetFetch(req, res, worldId, assetId, {
      registry: assetWorldsRegistry,
      pluginDataDir,
      authenticate: authenticateForWorld,
    });
    return true;
  }

  // ---- notes search (per-world, visibility-filtered) ----
  // GET /api/worlds/<worldId>/notes/search?q=...
  const notesSearchMatch = /^\/api\/worlds\/([^/]+)\/notes\/search$/.exec(path);
  if (notesSearchMatch && req.method === "GET") {
    if (!assetWorldsRegistry) {
      sendJson(res, 503, { error: "server still warming up" });
      return true;
    }
    const worldId = decodeURIComponent(notesSearchMatch[1]!) as WorldId;
    const u = new URL(url, "http://placeholder");
    const q = u.searchParams.get("q") ?? "";
    const limitRaw = u.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : 25;
    await handleNotesSearch(
      req,
      res,
      worldId,
      q,
      Number.isFinite(limit) ? limit : 25,
      {
        registry: assetWorldsRegistry,
        index: notesSearchIndex,
        authenticate: authenticateForWorld,
      },
    );
    return true;
  }

  return false;
};

function sendJson(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  const MAX_JSON = 64 * 1024;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_JSON) throw new Error("body too large");
    chunks.push(buf);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new Error("invalid JSON");
  }
}

async function requireSession(req: IncomingMessage): Promise<AuthSession | null> {
  return parseAuthSession(await auth.resolveSession(fromNodeHeaders(req.headers)));
}

async function handleListGameSystems(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const session = await requireSession(req);
  if (!session) {
    sendJson(res, 401, { error: "not authenticated" });
    return true;
  }
  // The list of game systems is identical across users; the auth check
  // is just to keep the server's surface area private.
  const systems = listGameSystems(optionalPlugins).map((p) => ({
    name: p.name,
    version: p.version,
  }));
  sendJson(res, 200, { gameSystems: systems });
  return true;
}

async function handleListWorlds(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const session = await requireSession(req);
  if (!session) {
    sendJson(res, 401, { error: "not authenticated" });
    return true;
  }
  const worlds = await worldsRepo.worldsForUser(session.userId);
  // Include the resolved session in the response so the client doesn't
  // need a separate /api/auth/get-session round-trip during the post-
  // login WorldGate boot — cutting that fetch removes a real race
  // where better-auth's client returned a cached null right after a
  // successful sign-in, leaving WorldGate stuck on its loading state.
  //
  // The `plugins` array is the resolved active plugin set for the
  // world (infrastructure ∪ chosenGameSystem ∪ deps). The client uses
  // it to filter its own plugin imports before constructing
  // startClient — without this, the workbench chrome shows page
  // providers / palette commands / etc. for plugins the world's
  // server-side Registry doesn't have, and dispatching against them
  // produces "unknown command" nacks.
  sendJson(res, 200, {
    me: {
      userId: session.userId,
      email: session.email,
      name: session.name,
      role: session.role,
    },
    worlds: worlds.map((w) => ({
      id: w.id,
      name: w.name,
      gameSystemPlugin: w.gameSystemPlugin,
      ownerUserId: w.ownerUserId,
      createdAt: w.createdAt,
      isOwner: w.ownerUserId === session.userId,
      plugins: resolveActivePluginsForWorld(w.gameSystemPlugin),
    })),
  });
  return true;
}

/**
 * Resolve a world's active plugin name list (best-effort) for shipping
 * to the client. Returns an empty list if the game system can't be
 * resolved against the current binary — the client falls back to
 * loading nothing extra in that case, which is safer than loading
 * stale/wrong UI.
 */
function resolveActivePluginsForWorld(gameSystemPlugin: string): string[] {
  try {
    const resolved = resolveActivePlugins({
      infrastructure: infrastructurePlugins,
      optional: optionalPlugins,
      gameSystemPlugin,
    });
    return resolved.plugins.map((p) => p.name);
  } catch {
    return [];
  }
}

async function handleCreateWorld(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const session = await requireSession(req);
  if (!session) {
    sendJson(res, 401, { error: "not authenticated" });
    return true;
  }
  // Only the global GM may create worlds.
  if (session.role !== "gm") {
    sendJson(res, 403, { error: "only the GM can create worlds" });
    return true;
  }
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return true;
  }
  const input = body as { name?: unknown; gameSystem?: unknown };
  if (typeof input.name !== "string" || input.name.trim() === "") {
    sendJson(res, 400, { error: "missing name" });
    return true;
  }
  if (typeof input.gameSystem !== "string") {
    sendJson(res, 400, { error: "missing gameSystem" });
    return true;
  }
  const game = optionalPlugins.find(
    (p) => p.name === input.gameSystem && p.gameSystem === true,
  );
  if (!game) {
    sendJson(res, 400, { error: "unknown game system" });
    return true;
  }
  const world = await worldsService.create({
    name: input.name.trim(),
    gameSystemPlugin: game.name,
    ownerUserId: session.userId,
  });
  sendJson(res, 201, {
    world: {
      id: world.id,
      name: world.name,
      gameSystemPlugin: world.gameSystemPlugin,
      ownerUserId: world.ownerUserId,
      createdAt: world.createdAt,
    },
  });
  return true;
}

async function handleArchiveWorld(
  req: IncomingMessage,
  res: ServerResponse,
  worldId: WorldId,
): Promise<boolean> {
  const session = await requireSession(req);
  if (!session) {
    sendJson(res, 401, { error: "not authenticated" });
    return true;
  }
  const world = await worldsRepo.get(worldId);
  if (!world) {
    sendJson(res, 404, { error: "world not found" });
    return true;
  }
  if (world.ownerUserId !== session.userId) {
    sendJson(res, 403, { error: "only the world owner can archive it" });
    return true;
  }
  await worldsService.archive(worldId);
  sendJson(res, 200, { ok: true });
  return true;
}

async function handleHardDeleteWorld(
  req: IncomingMessage,
  res: ServerResponse,
  worldId: WorldId,
  url: string,
): Promise<boolean> {
  const session = await requireSession(req);
  if (!session) {
    sendJson(res, 401, { error: "not authenticated" });
    return true;
  }
  const world = await worldsRepo.get(worldId);
  if (!world) {
    sendJson(res, 404, { error: "world not found" });
    return true;
  }
  if (world.ownerUserId !== session.userId) {
    sendJson(res, 403, { error: "only the world owner can delete it" });
    return true;
  }
  // Require ?confirm=true so an accidental DELETE doesn't wipe data.
  const confirm = new URL(url, "http://_").searchParams.get("confirm");
  if (confirm !== "true") {
    sendJson(res, 400, {
      error: "hard delete requires ?confirm=true (drops events, snapshots, plugin-data)",
    });
    return true;
  }
  await worldsService.hardDelete(worldId);
  sendJson(res, 200, { ok: true });
  return true;
}

async function handleListMemberships(
  req: IncomingMessage,
  res: ServerResponse,
  worldId: WorldId,
): Promise<boolean> {
  const session = await requireSession(req);
  if (!session) {
    sendJson(res, 401, { error: "not authenticated" });
    return true;
  }
  const world = await worldsRepo.get(worldId);
  if (!world) {
    sendJson(res, 404, { error: "world not found" });
    return true;
  }
  const ms = await worldsRepo.listMemberships(worldId);
  const isMember =
    world.ownerUserId === session.userId ||
    ms.some((m) => m.userId === session.userId);
  if (!isMember) {
    sendJson(res, 403, { error: "not a member of this world" });
    return true;
  }
  // Enrich with display name + email from the better-auth user table
  // so the UI can show humans rather than opaque IDs.
  const userIds = [world.ownerUserId, ...ms.map((m) => m.userId)];
  const placeholders = userIds.map(() => "?").join(",");
  const rows = userIds.length
    ? (auth.db
        .prepare(
          `SELECT id, name, email FROM "user" WHERE id IN (${placeholders})`,
        )
        .all(...userIds) as Array<{ id: string; name: string; email: string }>)
    : [];
  const lookup = new Map(rows.map((r) => [r.id, r]));
  const decorate = (userId: string): { name: string; email: string } => {
    const r = lookup.get(userId);
    return r ? { name: r.name, email: r.email } : { name: userId, email: "" };
  };
  sendJson(res, 200, {
    owner: { userId: world.ownerUserId, ...decorate(world.ownerUserId) },
    members: ms.map((m) => ({
      userId: m.userId,
      role: m.role,
      addedAt: m.addedAt,
      ...decorate(m.userId),
    })),
  });
  return true;
}

async function handleAddMembership(
  req: IncomingMessage,
  res: ServerResponse,
  worldId: WorldId,
): Promise<boolean> {
  const session = await requireSession(req);
  if (!session) {
    sendJson(res, 401, { error: "not authenticated" });
    return true;
  }
  const world = await worldsRepo.get(worldId);
  if (!world) {
    sendJson(res, 404, { error: "world not found" });
    return true;
  }
  if (world.ownerUserId !== session.userId) {
    sendJson(res, 403, { error: "only the world owner can add members" });
    return true;
  }
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
    return true;
  }
  const input = body as { userId?: unknown; email?: unknown; role?: unknown };
  // Prefer email lookup — the GM doesn't typically know better-auth's
  // opaque userId. Fall back to userId for tooling/scripts.
  let userId: string | null = null;
  let userName: string | null = null;
  if (typeof input.email === "string" && input.email.trim() !== "") {
    const row = auth.db
      .prepare(`SELECT id, name FROM "user" WHERE email = ?`)
      .get(input.email.trim()) as { id?: string; name?: string } | undefined;
    if (!row?.id) {
      sendJson(res, 404, {
        error: "no user with that email — they need to sign up first",
      });
      return true;
    }
    userId = row.id;
    userName = row.name ?? null;
  } else if (typeof input.userId === "string" && input.userId !== "") {
    userId = input.userId;
  }
  if (!userId) {
    sendJson(res, 400, { error: "missing email or userId" });
    return true;
  }
  if (userId === world.ownerUserId) {
    sendJson(res, 400, { error: "owner is already implicitly a member" });
    return true;
  }
  const role = input.role === "gm" ? "gm" : "player";
  await worldsService.addMember({ worldId, userId, role });
  sendJson(res, 200, { ok: true, userId, name: userName });
  return true;
}

async function handleRemoveMembership(
  req: IncomingMessage,
  res: ServerResponse,
  worldId: WorldId,
  userId: string,
): Promise<boolean> {
  const session = await requireSession(req);
  if (!session) {
    sendJson(res, 401, { error: "not authenticated" });
    return true;
  }
  const world = await worldsRepo.get(worldId);
  if (!world) {
    sendJson(res, 404, { error: "world not found" });
    return true;
  }
  if (world.ownerUserId !== session.userId) {
    sendJson(res, 403, { error: "only the world owner can remove members" });
    return true;
  }
  await worldsService.removeMember(worldId, userId);
  sendJson(res, 200, { ok: true });
  return true;
}

async function handlePluginDataUpload(
  req: IncomingMessage,
  res: ServerResponse,
  rel: string,
): Promise<boolean> {
  const sendAfterDrain = async (status: number, body: object) => {
    if (req.readable) {
      let drained = 0;
      try {
        for await (const chunk of req) {
          drained += (chunk as Buffer).length;
          if (drained > MAX_PLUGIN_DATA_BYTES) {
            req.destroy();
            break;
          }
        }
      } catch {
        /* socket already broken */
      }
    }
    sendJson(res, status, body);
    return true;
  };

  // First path segment is the worldId; the rest is the plugin's
  // freeform path (kept for plugin-determined naming).
  const slash = rel.indexOf("/");
  if (slash === -1 || slash === 0) {
    return sendAfterDrain(400, { error: "expected /api/plugin-data/<worldId>/<rest>" });
  }
  const worldIdSegment = rel.slice(0, slash) as WorldId;
  const subPath = rel.slice(slash + 1);

  if (!subPath || subPath.includes("..") || subPath.startsWith("/")) {
    return sendAfterDrain(400, { error: "invalid path" });
  }
  const ext = extname(subPath).toLowerCase();
  if (!ALLOWED_PLUGIN_DATA_EXTS.has(ext)) {
    return sendAfterDrain(400, {
      error: `extension ${ext || "(none)"} not allowed`,
    });
  }

  const session = await requireSession(req);
  if (!session) return sendAfterDrain(401, { error: "not authenticated" });

  // Must be GM of the named world. For v1 the only GM-of-world is the
  // owner, so we check ownership.
  const world = await worldsRepo.get(worldIdSegment);
  if (!world) return sendAfterDrain(404, { error: "world not found" });
  if (world.ownerUserId !== session.userId) {
    return sendAfterDrain(403, { error: "only the world's GM can upload" });
  }

  const worldDir = resolve(pluginDataDir, worldIdSegment);
  const absolute = resolve(worldDir, subPath);
  if (absolute !== worldDir && !absolute.startsWith(worldDir + sep)) {
    return sendAfterDrain(400, { error: "path escapes world plugin-data root" });
  }

  const declaredLen = Number(req.headers["content-length"] ?? "");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_PLUGIN_DATA_BYTES) {
    return sendAfterDrain(413, { error: "payload too large" });
  }

  const dir = dirname(absolute);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    return sendAfterDrain(500, { error: `mkdir failed: ${(err as Error).message}` });
  }
  const tmpPath = resolve(
    dir,
    `.${basename(absolute)}.${randomBytes(6).toString("hex")}.partial`,
  );

  let received = 0;
  let oversized = false;
  req.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > MAX_PLUGIN_DATA_BYTES) {
      oversized = true;
      req.destroy();
    }
  });

  const writeStream = createWriteStream(tmpPath);
  try {
    await pipeline(req, writeStream);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* already gone */
    }
    if (oversized) return sendAfterDrain(413, { error: "payload too large" });
    return sendAfterDrain(500, {
      error: `write failed: ${(err as Error).message}`,
    });
  }

  // Replace any sibling file with the same base name but a different
  // extension. Keeps one file-per-slot when GM uploads PNG, then JPG, etc.
  try {
    const stem = basename(absolute, ext);
    for (const sibling of readdirSync(dir)) {
      if (sibling === basename(absolute)) continue;
      if (sibling.startsWith(".")) continue;
      if (basename(sibling, extname(sibling)) === stem) {
        try {
          unlinkSync(resolve(dir, sibling));
        } catch {
          /* best-effort */
        }
      }
    }
    await rename(tmpPath, absolute);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* already gone */
    }
    return sendAfterDrain(500, {
      error: `rename failed: ${(err as Error).message}`,
    });
  }

  // Cache-bust on overwrite. The public URL stays under /plugin-data/.
  const publicPath = `/plugin-data/${worldIdSegment}/${subPath}?v=${received}`;
  sendJson(res, 200, { path: publicPath, size: received });
  return true;
}

const devProxy = process.env.DEV_PROXY_URL;

const handle = await startServer({
  port,
  infrastructure: infrastructurePlugins,
  optional: optionalPlugins,
  worldsRepo,
  clientRoot: existsSync(clientRoot) ? clientRoot : undefined,
  httpHandler,
  authenticateUpgrade: async (req, worldId) => {
    const headers = fromNodeHeaders(req.headers);
    const raw = await auth.resolveSession(headers);
    const session = parseAuthSession(raw);
    if (!session) return null;
    // Membership gate: only worlds the user can access (owner or
    // listed in world_membership). The substrate has already
    // validated the world exists + isn't archived.
    const allowed = await worldsService.canAccess(worldId, session.userId);
    if (!allowed) return null;
    // Per-world session: override the global role with whatever role
    // applies to this world. Plugins read `session.role` and expect
    // per-world semantics.
    const perWorldRole = (await worldsService.roleFor(worldId, session.userId))
      ?? "player";
    const perWorldSession: AuthSession = {
      userId: session.userId,
      email: session.email,
      name: session.name,
      role: perWorldRole,
    };
    return perWorldSession;
  },
  extractRecipient: (session) => {
    const s = parseAuthSession(session);
    return s ? { userId: s.userId, role: s.role } : null;
  },
  persistence,
  devProxy,
  assetRoots: {
    ...(existsSync(iconsRoot) ? { "/icons/": iconsRoot } : {}),
    "/plugin-data/": pluginDataDir,
    ...pdfBookAssetRoots(),
    ...diceTrayAssetRoots(),
  },
  onRuntimeCreated: (runtime) => {
    // Wire the FTS bridge to maintain the per-world index from event
    // bus broadcasts. Bootstrap re-indexes everything on cold-boot;
    // subsequent events stream in.
    attachNotesSearchBridge(runtime, notesSearchIndex);
  },
});

// The asset upload/fetch handlers need the registry; it doesn't exist
// until startServer resolves. Top-level await above + this assignment
// before any request is serviced means the routes never see null.
assetWorldsRegistry = handle.worldsRegistry;

console.log(`mvtt server listening on ${baseURL}`);
console.log(
  `infrastructure: ${infrastructurePlugins.map((p) => p.name).join(", ")}`,
);
console.log(`optional: ${optionalPlugins.map((p) => p.name).join(", ")}`);
console.log(
  `game systems: ${listGameSystems(optionalPlugins).map((p) => p.name).join(", ")}`,
);
console.log(`auth db: ${dbPath}`);
console.log(
  `game master ${auth.hasGameMaster() ? "exists" : "not yet — first signup will become GM"}`,
);
if (devProxy) {
  console.log(`dev proxy: forwarding non-API HTTP and HMR to ${devProxy}`);
} else if (existsSync(clientRoot)) {
  console.log(`client served from ${clientRoot}`);
} else {
  console.log(
    `client bundle not built — run \`pnpm --filter @vtt/client build\` to enable serving at /`,
  );
}
if (existsSync(iconsRoot)) {
  console.log(`icons: ${iconManifest.length} mounted at /icons/ (${iconsRoot})`);
} else {
  console.log(`icons: ${iconsRoot} not found — token picker will be empty`);
}

const shutdown = async () => {
  await handle.close();
  auth.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function buildIconManifest(root: string): IconEntry[] {
  const out: IconEntry[] = [];
  for (const artistEnt of readdirSync(root, { withFileTypes: true })) {
    if (!artistEnt.isDirectory()) continue;
    const artist = artistEnt.name;
    const dir = resolve(root, artist);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".svg")) continue;
      const name = basename(file, ".svg");
      out.push({ slug: `${artist}/${name}`, artist, name });
    }
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

function loadOrCreateSecret(path: string): string {
  if (existsSync(path)) {
    return readFileSync(path, "utf-8").trim();
  }
  const generated = randomBytes(32).toString("base64");
  writeFileSync(path, generated + "\n", { mode: 0o600 });
  console.log(`generated new auth secret at ${path}`);
  return generated;
}
