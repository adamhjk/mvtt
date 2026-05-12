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
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { rename } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import {
  type EntityId,
  type WorldId,
  type WorldsRegistry,
  type WorldRuntime,
  matches,
  type Recipient,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { Asset } from "../shared/traits.js";
import { RegisterAsset } from "../shared/commands.js";
import { AssetRegistered } from "../shared/events.js";

/**
 * Per-world member authentication. Returns the synthesised AuthSession
 * (per-world role) when the requester is allowed, null otherwise.
 */
export type AuthenticateForWorld = (
  req: IncomingMessage,
  worldId: WorldId,
) => Promise<AuthSession | null>;

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB after client-side recompress
const DEFAULT_ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export interface AssetRoutesDeps {
  registry: WorldsRegistry;
  /** Root of `data/plugin-data`. Asset files live at `<root>/<worldId>/assets/<assetId>`. */
  pluginDataDir: string;
  authenticate: AuthenticateForWorld;
  /**
   * Global drain cap — never read more than this many bytes off the wire,
   * regardless of policy. This is the security ceiling.
   */
  maxBytes?: number;
  allowedMimes?: ReadonlySet<string>;
  /**
   * Optional per-mime policy cap. Effective cap for an upload is
   * `min(maxBytes, maxBytesByMime[mime] ?? maxBytes)`. Use this to keep
   * images small (e.g. 5 MB) while permitting larger PDFs (e.g. 250 MB).
   */
  maxBytesByMime?: Readonly<Record<string, number>>;
}

function sendJson(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function drainAndJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: object,
  cap: number,
): Promise<void> {
  if (req.readable) {
    let drained = 0;
    try {
      for await (const chunk of req) {
        drained += (chunk as Buffer).length;
        if (drained > cap) {
          req.destroy();
          break;
        }
      }
    } catch {
      /* socket already broken */
    }
  }
  sendJson(res, status, body);
}

function assetsDir(pluginDataDir: string, worldId: WorldId): string {
  return resolve(pluginDataDir, worldId, "assets");
}

function assetPath(pluginDataDir: string, worldId: WorldId, assetId: EntityId): string {
  return resolve(assetsDir(pluginDataDir, worldId), assetId);
}

/**
 * Search the world for an existing Asset entity with the given sha256.
 * Returns its assetId or null. Linear scan; v1 fine for sub-thousands
 * of assets.
 */
function findExistingAssetBySha256(
  runtime: WorldRuntime,
  sha256: string,
): EntityId | null {
  for (const row of runtime.world.query([Asset])) {
    const v = row.values.Asset as { sha256: string } | undefined;
    if (v && v.sha256 === sha256) return row.id;
  }
  return null;
}

/**
 * Programmatic asset save — the post-validation core of
 * `handleAssetUpload`. Given already-buffered bytes + mime + filename,
 * dedups against existing assets by sha256, dispatches `RegisterAsset`,
 * writes bytes to the canonical path, and returns the new (or existing)
 * assetId.
 *
 * Used by:
 *   - `handleAssetUpload` (the HTTP route)
 *   - `@vtt/adventures` bundle import → asset rewrite hook
 *
 * Mime / size policy enforcement is the *caller's* responsibility — this
 * helper trusts the inputs. The HTTP route validates Content-Type and
 * caps; the adventures import trusts the bundle's manifest descriptors.
 */
export async function saveAssetFromBytes(opts: {
  runtime: WorldRuntime;
  worldId: WorldId;
  pluginDataDir: string;
  bytes: Uint8Array;
  mime: string;
  filename: string | null;
  /** AuthSession used as `cmd.session` when dispatching `RegisterAsset`. */
  session: AuthSession;
}): Promise<{ assetId: EntityId; deduped: boolean }> {
  const { runtime, worldId, pluginDataDir, bytes, mime, session } = opts;
  const filename = opts.filename ? sanitiseFilename(opts.filename) : null;
  const dir = assetsDir(pluginDataDir, worldId);
  mkdirSync(dir, { recursive: true });

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // Dedup: if an Asset with this sha256 already exists in the world,
  // reuse its id and skip the write.
  const existing = findExistingAssetBySha256(runtime, sha256);
  if (existing !== null) return { assetId: existing, deduped: true };

  const tmpName = `.${randomBytes(8).toString("hex")}.partial`;
  const tmpPath = resolve(dir, tmpName);
  // Write the bytes synchronously to a temp file (small enough that the
  // sync API is fine; the streaming HTTP route uses pipeline() for
  // backpressure but this helper takes already-buffered bytes).
  const ws = createWriteStream(tmpPath);
  await new Promise<void>((res2, rej) => {
    ws.on("error", rej);
    ws.on("finish", res2);
    ws.end(bytes);
  });

  let dispatchResult;
  try {
    dispatchResult = await runtime.pipeline.dispatch({
      id: `programmatic-save-${randomBytes(12).toString("hex")}`,
      issuedBy: ("server-save-" + session.userId) as never,
      issuedAt: Date.now(),
      cmd: RegisterAsset({
        mime,
        sizeBytes: bytes.length,
        sha256,
        filename,
        width: null,
        height: null,
      }),
      session,
    });
  } catch (err) {
    cleanupTemp(tmpPath);
    throw err;
  }
  if (!dispatchResult.result.ok) {
    cleanupTemp(tmpPath);
    throw new Error(dispatchResult.result.reason ?? "RegisterAsset rejected");
  }
  const registered = dispatchResult.events.find(
    (e) => e.type === AssetRegistered.name,
  ) as { type: string; payload: { assetId: EntityId } } | undefined;
  if (!registered) {
    cleanupTemp(tmpPath);
    throw new Error("register dispatch produced no AssetRegistered event");
  }
  const assetId = registered.payload.assetId;
  const finalPath = assetPath(pluginDataDir, worldId, assetId);
  await rename(tmpPath, finalPath);
  return { assetId, deduped: false };
}

/**
 * Programmatic asset load — read bytes by assetId from disk. Used by
 * `@vtt/adventures` bundle export to fold asset bytes into a bundle.
 * Returns null when the asset isn't on disk (corrupt store, missing
 * file). Bytes are returned as a Uint8Array sized to the file length.
 *
 * Synchronous read — assets are typically <5 MB and this fires once
 * per export; the simpler API beats async for the call-site.
 */
export function loadAssetBytesFromDisk(opts: {
  pluginDataDir: string;
  worldId: WorldId;
  assetId: EntityId;
}): Uint8Array | null {
  const path = assetPath(opts.pluginDataDir, opts.worldId, opts.assetId);
  if (!existsSync(path)) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const buf = fs.readFileSync(path);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch {
    return null;
  }
}

/**
 * POST /api/worlds/:id/assets/upload
 *
 * Body: raw bytes of the asset.
 * Required header: `content-type` (asset mime).
 * Optional header: `x-filename` (display name; sanitised).
 *
 * Streams the body to a temp file, hashes it, validates mime/size,
 * dedups by sha256, dispatches RegisterAsset, atomically renames the
 * temp file to its canonical path.
 */
export async function handleAssetUpload(
  req: IncomingMessage,
  res: ServerResponse,
  worldId: WorldId,
  deps: AssetRoutesDeps,
): Promise<void> {
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowedMimes = deps.allowedMimes ?? DEFAULT_ALLOWED_MIMES;
  const maxBytesByMime = deps.maxBytesByMime;

  const session = await deps.authenticate(req, worldId);
  if (!session) {
    return drainAndJson(req, res, 401, { error: "not authenticated or not a world member" }, maxBytes);
  }

  const mime = (req.headers["content-type"] ?? "").toString().split(";")[0]!.trim();
  if (!allowedMimes.has(mime)) {
    return drainAndJson(req, res, 415, { error: `mime ${mime || "(none)"} not allowed` }, maxBytes);
  }

  // Per-mime policy cap, bounded by the global drain cap.
  const policyCap = Math.min(maxBytes, maxBytesByMime?.[mime] ?? maxBytes);

  const declaredLen = Number(req.headers["content-length"] ?? "");
  if (Number.isFinite(declaredLen) && declaredLen > policyCap) {
    return drainAndJson(req, res, 413, { error: "payload too large" }, maxBytes);
  }

  const filenameHeader = req.headers["x-filename"];
  const filename = sanitiseFilename(
    typeof filenameHeader === "string" ? filenameHeader : null,
  );

  // Acquire the runtime up-front so a failed acquire doesn't waste an
  // upload slot.
  let runtime: WorldRuntime;
  try {
    runtime = await deps.registry.acquire(worldId);
  } catch (err) {
    return drainAndJson(req, res, 404, { error: (err as Error).message }, maxBytes);
  }

  const dir = assetsDir(deps.pluginDataDir, worldId);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    return drainAndJson(req, res, 500, { error: `mkdir failed: ${(err as Error).message}` }, maxBytes);
  }

  const tmpName = `.${randomBytes(8).toString("hex")}.partial`;
  const tmpPath = resolve(dir, tmpName);

  let received = 0;
  let oversized = false;
  const hasher = createHash("sha256");

  req.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > policyCap) {
      oversized = true;
      req.destroy();
    }
    hasher.update(chunk);
  });

  const writeStream = createWriteStream(tmpPath);
  try {
    await pipeline(req, writeStream);
  } catch (err) {
    cleanupTemp(tmpPath);
    if (oversized) {
      sendJson(res, 413, { error: "payload too large" });
      return;
    }
    sendJson(res, 500, { error: `write failed: ${(err as Error).message}` });
    return;
  }

  if (received === 0) {
    cleanupTemp(tmpPath);
    sendJson(res, 400, { error: "empty payload" });
    return;
  }

  const sha256 = hasher.digest("hex");

  // Dedup: if an Asset with this sha256 already exists in the world,
  // reuse its id and discard the temp.
  const existing = findExistingAssetBySha256(runtime, sha256);
  if (existing !== null) {
    cleanupTemp(tmpPath);
    sendJson(res, 200, {
      assetId: existing,
      url: `/plugin-data/${worldId}/assets/${existing}`,
      deduped: true,
    });
    return;
  }

  // Dispatch RegisterAsset and pull the assetId off the resulting event.
  let dispatchResult;
  try {
    dispatchResult = await runtime.pipeline.dispatch({
      id: `upload-${randomBytes(12).toString("hex")}`,
      issuedBy: ("server-upload-" + session.userId) as any,
      issuedAt: Date.now(),
      cmd: RegisterAsset({
        mime,
        sizeBytes: received,
        sha256,
        filename,
        width: null,
        height: null,
      }),
      session,
    });
  } catch (err) {
    cleanupTemp(tmpPath);
    sendJson(res, 500, { error: `dispatch failed: ${(err as Error).message}` });
    return;
  }

  if (!dispatchResult.result.ok) {
    cleanupTemp(tmpPath);
    sendJson(res, 400, { error: dispatchResult.result.reason });
    return;
  }

  const registered = dispatchResult.events.find(
    (e) => e.type === AssetRegistered.name,
  ) as { type: string; payload: { assetId: EntityId } } | undefined;

  if (!registered) {
    cleanupTemp(tmpPath);
    sendJson(res, 500, { error: "register dispatch produced no AssetRegistered event" });
    return;
  }

  const assetId = registered.payload.assetId;
  const finalPath = assetPath(deps.pluginDataDir, worldId, assetId);

  try {
    await rename(tmpPath, finalPath);
  } catch (err) {
    cleanupTemp(tmpPath);
    sendJson(res, 500, { error: `rename failed: ${(err as Error).message}` });
    return;
  }

  sendJson(res, 200, {
    assetId,
    url: `/plugin-data/${worldId}/assets/${assetId}`,
    deduped: false,
  });
}

/**
 * GET /plugin-data/:worldId/assets/:assetId
 *
 * Validates: world membership AND EntityVisibility on the asset entity.
 * Streams bytes with `Cache-Control: public, max-age=31536000, immutable`
 * — assetIds never collide so cache-forever is safe.
 */
export async function handleAssetFetch(
  req: IncomingMessage,
  res: ServerResponse,
  worldId: WorldId,
  assetId: EntityId,
  deps: AssetRoutesDeps,
): Promise<void> {
  const session = await deps.authenticate(req, worldId);
  if (!session) {
    sendJson(res, 401, { error: "not authenticated or not a world member" });
    return;
  }

  let runtime: WorldRuntime;
  try {
    runtime = await deps.registry.acquire(worldId);
  } catch (err) {
    sendJson(res, 404, { error: (err as Error).message });
    return;
  }

  const recipient: Recipient = { userId: session.userId, role: session.role };
  const traits = collectTraits(runtime, assetId);
  if (!traits) {
    sendJson(res, 404, { error: "asset not found" });
    return;
  }

  const visibility = runtime.registry.resolveEntityVisibility(traits);
  if (visibility !== null && !matches(visibility, recipient)) {
    sendJson(res, 403, { error: "not authorised for this asset" });
    return;
  }

  const path = assetPath(deps.pluginDataDir, worldId, assetId);
  if (!isUnderRoot(path, assetsDir(deps.pluginDataDir, worldId))) {
    sendJson(res, 400, { error: "invalid asset path" });
    return;
  }
  if (!existsSync(path)) {
    sendJson(res, 404, { error: "asset bytes missing on disk" });
    return;
  }

  const stat = statSync(path);
  const asset = traits[Asset.name] as
    | { mime: string; sizeBytes: number }
    | undefined;
  res.statusCode = 200;
  if (asset?.mime) res.setHeader("content-type", asset.mime);
  res.setHeader("content-length", String(stat.size));
  res.setHeader("cache-control", "public, max-age=31536000, immutable");

  const stream = createReadStream(path);
  try {
    await pipeline(stream, res);
  } catch {
    // client probably aborted; nothing to do
  }
}

function collectTraits(
  runtime: WorldRuntime,
  entityId: EntityId,
): Record<string, unknown> | null {
  if (!runtime.world.has(entityId)) return null;
  const out: Record<string, unknown> = {};
  for (const [name, def] of runtime.registry.traits) {
    const got = runtime.world.get(entityId, [def]);
    if (got !== undefined) {
      // got is keyed by short name; we want the full trait name
      const short = name.split("/").pop() ?? name;
      const v = (got as Record<string, unknown>)[short];
      if (v !== undefined) out[name] = v;
    }
  }
  return out;
}

function isUnderRoot(p: string, root: string): boolean {
  return p === root || p.startsWith(root + sep);
}

function sanitiseFilename(raw: string | null): string | null {
  if (!raw) return null;
  // Strip path separators and control bytes; cap at 255 chars.
  const cleaned = raw
    .replace(/[/\\ -]/g, "")
    .trim()
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : null;
}

function cleanupTemp(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // already gone — fine
  }
}
