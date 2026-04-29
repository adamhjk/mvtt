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
]);

export interface AssetRoutesDeps {
  registry: WorldsRegistry;
  /** Root of `data/plugin-data`. Asset files live at `<root>/<worldId>/assets/<assetId>`. */
  pluginDataDir: string;
  authenticate: AuthenticateForWorld;
  maxBytes?: number;
  allowedMimes?: ReadonlySet<string>;
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

  const session = await deps.authenticate(req, worldId);
  if (!session) {
    return drainAndJson(req, res, 401, { error: "not authenticated or not a world member" }, maxBytes);
  }

  const mime = (req.headers["content-type"] ?? "").toString().split(";")[0]!.trim();
  if (!allowedMimes.has(mime)) {
    return drainAndJson(req, res, 415, { error: `mime ${mime || "(none)"} not allowed` }, maxBytes);
  }

  const declaredLen = Number(req.headers["content-length"] ?? "");
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
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
    if (received > maxBytes) {
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
