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

import type { EntityId, WorldId } from "@vtt/substrate";

/**
 * Result of a successful asset upload — the new (or deduped-existing)
 * asset's id, plus a `deduped` flag the caller can surface ("we already
 * had this image, reusing it"). Mirrors the server's response shape
 * from `handleAssetUpload`.
 */
export interface UploadAssetResult {
  readonly assetId: EntityId;
  readonly deduped: boolean;
}

/**
 * POST raw bytes to `/api/worlds/<worldId>/assets/upload` and resolve
 * to the assetId the server allocated (or deduped against by sha256).
 *
 * Every plugin that used to write its own `/api/plugin-data/<wid>/<plugin>/...`
 * upload route now goes through this helper. The server pipeline:
 *   1. validates mime + size (per-mime policy caps)
 *   2. streams bytes to a tmp file + sha256
 *   3. dedups by content (returns the existing assetId if the bytes
 *      already exist in the world)
 *   4. dispatches RegisterAsset, atomically renames temp → final
 *   5. responds with `{ assetId, deduped }`
 *
 * Throws on non-OK status with the server's error message — callers
 * typically display it in an inline error banner.
 *
 * Why `Blob | File` and not `ArrayBuffer`: lets the caller hand off
 * the raw `<input type="file">` value without slurping the bytes
 * client-side; the browser streams them to the wire.
 */
export async function uploadAssetForWorld(
  worldId: WorldId,
  file: Blob | File,
  opts: {
    /** Display name. When `file` is a `File`, defaults to `file.name`. */
    filename?: string;
  } = {},
): Promise<UploadAssetResult> {
  const url = `/api/worlds/${encodeURIComponent(worldId)}/assets/upload`;
  const headers: Record<string, string> = {};
  // The server reads mime off `content-type`. Browsers default this to
  // the File's type; for raw Blobs we let it default to
  // `application/octet-stream` — which would be rejected. Set
  // explicitly when known.
  if (file.type) headers["content-type"] = file.type;
  const filename =
    opts.filename ?? (file instanceof File ? file.name : undefined);
  if (filename) headers["x-filename"] = filename;
  const res = await fetch(url, {
    method: "POST",
    body: file,
    credentials: "same-origin",
    headers,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `upload failed (${res.status})`);
  }
  const body = (await res.json()) as {
    assetId: EntityId;
    deduped?: boolean;
  };
  return { assetId: body.assetId, deduped: body.deduped === true };
}

/**
 * Build the canonical fetch URL for an asset.
 *
 * Centralised so every plugin uses the same shape — when this changes
 * (e.g. a future CDN edge), it changes in one place. The path matches
 * the server's `handleAssetFetch` route registered in main.ts.
 *
 * Returns null when either argument is empty/null so callers can
 * `assetUrl(...) ?? defaultPlaceholder` without checking themselves.
 */
export function assetUrl(
  worldId: WorldId | string | null | undefined,
  assetId: EntityId | string | null | undefined,
): string | null {
  if (!worldId || !assetId) return null;
  return `/plugin-data/${encodeURIComponent(worldId)}/assets/${encodeURIComponent(assetId)}`;
}
