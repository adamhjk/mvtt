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

import type { IncomingMessage, ServerResponse } from "node:http";
import type { EntityId, WorldId, WorldsRegistry } from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { buildBlockKindIndex } from "../shared/block-kinds.js";
import { buildBundle, type BuildBundleOptions } from "./bundle.js";
import { computeUpdateDiff } from "./update-diff.js";
import { importBundle } from "./bundle.js";
import { bundleToZip, zipToBundle } from "./zip.js";

const ADVENTURE_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export type AuthenticateForWorld = (
  req: IncomingMessage,
  worldId: WorldId,
) => Promise<AuthSession | null>;

export interface AdventureRoutesDeps {
  registry: WorldsRegistry;
  authenticate: AuthenticateForWorld;
  /** Max bytes to read off the wire for an upload. Default 50 MB. */
  maxBytes?: number;
  /**
   * Optional hook to load asset bytes by entity id (during export).
   * When provided, `[[asset:<id>]]` references in note bodies are
   * resolved and the bytes are bundled. The server typically passes
   * `loadAssetBytesFromDisk` from `@vtt/assets/server`.
   */
  loadAssetBytes?: (
    worldId: WorldId,
    assetId: EntityId,
  ) => Uint8Array | null | Promise<Uint8Array | null>;
  /**
   * Optional hook to save asset bytes (during import). When provided,
   * bundle assets are uploaded into the target world and refs are
   * rewritten from old → new ids. The server typically passes
   * `saveAssetFromBytes` from `@vtt/assets/server`.
   */
  saveAssetBytes?: (
    worldId: WorldId,
    bytes: Uint8Array,
    descriptor: { sha256: string; mime: string; name: string; bytes: number },
    session: AuthSession,
  ) => EntityId | Promise<EntityId>;
}

function sendJson(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, cap: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > cap) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function requireGm(
  req: IncomingMessage,
  res: ServerResponse,
  worldId: WorldId,
  deps: AdventureRoutesDeps,
): Promise<AuthSession | null> {
  const session = await deps.authenticate(req, worldId);
  if (!session) {
    sendJson(res, 401, { error: "not authenticated or not a world member" });
    return null;
  }
  if (session.role !== "gm") {
    sendJson(res, 403, { error: "GM role required" });
    return null;
  }
  return session;
}

/**
 * POST /api/worlds/:id/adventures/import
 *
 * Body: raw `.advt.zip` bytes (Content-Type: application/zip or octet-stream).
 *
 * Response: `{ notesCreated, pagesCreated, bundleId, version }`
 */
export async function handleAdventureImport(
  req: IncomingMessage,
  res: ServerResponse,
  worldId: WorldId,
  deps: AdventureRoutesDeps,
): Promise<void> {
  const maxBytes = deps.maxBytes ?? ADVENTURE_MAX_BYTES;
  const session = await requireGm(req, res, worldId, deps);
  if (!session) return;
  const body = await readBody(req, maxBytes);
  if (!body) {
    sendJson(res, 413, { error: "payload too large" });
    return;
  }
  let bundle;
  try {
    bundle = zipToBundle(new Uint8Array(body));
  } catch (err) {
    sendJson(res, 400, { error: `invalid bundle: ${(err as Error).message}` });
    return;
  }
  let runtime;
  try {
    runtime = await deps.registry.acquire(worldId);
  } catch (err) {
    sendJson(res, 404, { error: (err as Error).message });
    return;
  }
  try {
    const idx = buildBlockKindIndex(runtime.registry);
    const hooks: Parameters<typeof importBundle>[3] = {
      importerUserId: session.userId,
      ...(deps.saveAssetBytes
        ? {
            saveAssetBytes: async (
              bytes: Uint8Array,
              descriptor: { sha256: string; mime: string; name: string; bytes: number },
            ) => deps.saveAssetBytes!(worldId, bytes, descriptor, session),
          }
        : {}),
    };
    const result = await importBundle(runtime.world, bundle, idx, hooks);
    sendJson(res, 200, {
      bundleId: bundle.manifest.bundleId,
      version: bundle.manifest.version,
      notesCreated: result.notesCreated,
      pagesCreated: result.pagesCreated,
      assetsUploaded: result.assetsUploaded,
    });
  } catch (err) {
    sendJson(res, 500, { error: (err as Error).message });
  }
}

/**
 * POST /api/worlds/:id/adventures/export
 *
 * Body: JSON `{ name, version, summary?, author?, gameSystem?, requires?, noteIds: string[] }`
 *
 * Response: raw `.advt.zip` bytes.
 */
export async function handleAdventureExport(
  req: IncomingMessage,
  res: ServerResponse,
  worldId: WorldId,
  deps: AdventureRoutesDeps,
): Promise<void> {
  const maxBytes = deps.maxBytes ?? ADVENTURE_MAX_BYTES;
  const session = await requireGm(req, res, worldId, deps);
  if (!session) return;
  const body = await readBody(req, maxBytes);
  if (!body) {
    sendJson(res, 413, { error: "payload too large" });
    return;
  }
  let opts: BuildBundleOptions & { bundleId?: string };
  try {
    const parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.name !== "string") throw new Error("missing 'name'");
    if (typeof parsed.version !== "string") throw new Error("missing 'version'");
    if (!Array.isArray(parsed.noteIds)) throw new Error("missing 'noteIds[]'");
    opts = {
      bundleId: typeof parsed.bundleId === "string" ? parsed.bundleId : `bundle:${Date.now()}`,
      name: parsed.name,
      version: parsed.version,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      author: typeof parsed.author === "string" ? parsed.author : "",
      ...(typeof parsed.gameSystem === "string" && { gameSystem: parsed.gameSystem }),
      requires: Array.isArray(parsed.requires) ? (parsed.requires as string[]) : [],
      noteIds: parsed.noteIds as EntityId[],
    };
  } catch (err) {
    sendJson(res, 400, { error: `invalid request: ${(err as Error).message}` });
    return;
  }
  let runtime;
  try {
    runtime = await deps.registry.acquire(worldId);
  } catch (err) {
    sendJson(res, 404, { error: (err as Error).message });
    return;
  }
  try {
    const bundleOpts = deps.loadAssetBytes
      ? {
          ...opts,
          loadAssetBytes: (assetId: EntityId) => deps.loadAssetBytes!(worldId, assetId),
        }
      : opts;
    const bundle = await buildBundle(runtime.world, bundleOpts);
    const zip = bundleToZip(bundle);
    res.statusCode = 200;
    res.setHeader("content-type", "application/zip");
    res.setHeader(
      "content-disposition",
      `attachment; filename="${sanitiseFilename(opts.name)}.advt.zip"`,
    );
    res.end(Buffer.from(zip));
  } catch (err) {
    sendJson(res, 500, { error: (err as Error).message });
  }
}

/**
 * POST /api/worlds/:id/adventures/check-update
 *
 * Body: raw `.advt.zip` bytes (the new version of an already-imported bundle).
 *
 * Response: JSON shape of `UpdateDiff` from update-diff.ts.
 */
export async function handleAdventureCheckUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  worldId: WorldId,
  deps: AdventureRoutesDeps,
): Promise<void> {
  const maxBytes = deps.maxBytes ?? ADVENTURE_MAX_BYTES;
  const session = await requireGm(req, res, worldId, deps);
  if (!session) return;
  const body = await readBody(req, maxBytes);
  if (!body) {
    sendJson(res, 413, { error: "payload too large" });
    return;
  }
  let bundle;
  try {
    bundle = zipToBundle(new Uint8Array(body));
  } catch (err) {
    sendJson(res, 400, { error: `invalid bundle: ${(err as Error).message}` });
    return;
  }
  let runtime;
  try {
    runtime = await deps.registry.acquire(worldId);
  } catch (err) {
    sendJson(res, 404, { error: (err as Error).message });
    return;
  }
  try {
    const idx = buildBlockKindIndex(runtime.registry);
    const recognized = new Set<string>(idx.byName.keys());
    const diff = computeUpdateDiff(runtime.world, bundle, recognized);
    sendJson(res, 200, diff);
  } catch (err) {
    sendJson(res, 500, { error: (err as Error).message });
  }
}

/**
 * Recognise the three adventure routes and dispatch. Returns true when
 * the request was handled, false otherwise — caller composes with
 * other route matchers.
 */
export async function maybeHandleAdventureRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdventureRoutesDeps,
): Promise<boolean> {
  const url = req.url ?? "/";
  const path = url.split("?")[0]!;
  const m = /^\/api\/worlds\/([^/]+)\/adventures\/([^/]+)$/.exec(path);
  if (!m || req.method !== "POST") return false;
  const worldId = decodeURIComponent(m[1]!) as WorldId;
  const action = m[2]!;
  if (action === "import") {
    await handleAdventureImport(req, res, worldId, deps);
    return true;
  }
  if (action === "export") {
    await handleAdventureExport(req, res, worldId, deps);
    return true;
  }
  if (action === "check-update") {
    await handleAdventureCheckUpdate(req, res, worldId, deps);
    return true;
  }
  return false;
}

function sanitiseFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "adventure";
}
