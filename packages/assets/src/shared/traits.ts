// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { defineTrait, z } from "@vtt/substrate";

/**
 * An Asset is an immutable byte blob the world stores at a stable id.
 * The trait carries metadata only; the bytes live on disk under
 * `data/plugin-data/<worldId>/assets/<assetId>`.
 *
 * Assets are created via the upload route (HTTP) → server-dispatched
 * `RegisterAsset` command → `AssetRegistered` event → spawn system.
 * Bytes are immutable post-upload; mutating means a new asset.
 *
 * Embedded into markdown via the `asset` link kind: `![[asset:<id>]]`.
 * The link kind chooses the renderer based on `mime` (image, video,
 * audio, …); the notes plugin doesn't fork on mime.
 */
export const Asset = defineTrait({
  name: "@vtt/assets/Asset",
  schema: z.object({
    /** IANA mime type, e.g. "image/webp", "image/png", "image/jpeg". */
    mime: z.string().min(1).max(127),
    /** Final on-disk size after server-side validation. */
    sizeBytes: z.number().int().nonnegative(),
    /** Hex sha256 of the bytes; used for upload-time dedup. */
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** Display name; user-visible in chips and the asset library. */
    filename: z.string().min(1).max(255).nullable(),
    /** Pixel width — populated for raster images at upload time. */
    width: z.number().int().positive().nullable(),
    /** Pixel height — populated for raster images at upload time. */
    height: z.number().int().positive().nullable(),
    /** Epoch ms; never changes after registration. */
    uploadedAt: z.number().int().nonnegative(),
  }),
});
