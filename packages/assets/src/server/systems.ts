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

import { defineSystem, type Visibility } from "@vtt/substrate";
import { everyone } from "@vtt/permissions/shared";
import { EntityVisibility, OwnedBy } from "@vtt/permissions/shared";
import {
  AssetDeleted,
  AssetRegistered,
  AssetRenamed,
  AssetVisibilityChanged,
} from "../shared/events.js";
import { Asset } from "../shared/traits.js";

/**
 * Universal mirror system: spawns the Asset entity carrying Asset +
 * OwnedBy + EntityVisibility on every side. Default visibility is
 * `everyone()`; the uploader can narrow it via `SetAssetVisibility`.
 */
export const AssetSpawningSystem = defineSystem({
  name: "AssetSpawning",
  on: AssetRegistered,
  reads: [],
  writes: [Asset, OwnedBy, EntityVisibility],
  run: ({ event, world }) => {
    world.spawnAt(event.assetId, [
      Asset({
        mime: event.mime,
        sizeBytes: event.sizeBytes,
        sha256: event.sha256,
        filename: event.filename,
        width: event.width,
        height: event.height,
        uploadedAt: event.uploadedAt,
      }),
      OwnedBy({ userId: event.uploadedByUserId }),
      EntityVisibility({ visibility: everyone() }),
    ]);
    return [];
  },
});

/**
 * Universal mirror: replaces the filename on the Asset trait. Other
 * fields (mime, sizeBytes, sha256, width, height, uploadedAt) are
 * immutable post-registration.
 */
export const AssetRenameSystem = defineSystem({
  name: "AssetRename",
  on: AssetRenamed,
  reads: [Asset],
  writes: [Asset],
  run: ({ event, world }) => {
    const got = world.get(event.assetId, [Asset]) as
      | {
          Asset: {
            mime: string;
            sizeBytes: number;
            sha256: string;
            filename: string | null;
            width: number | null;
            height: number | null;
            uploadedAt: number;
          };
        }
      | undefined;
    if (!got) return [];
    world.set(event.assetId, Asset, {
      ...got.Asset,
      filename: event.filename,
    });
    return [];
  },
});

/**
 * Universal mirror: writes the new EntityVisibility trait. Permissions
 * plugin's resolver picks it up on the next snapshot/broadcast.
 */
export const AssetVisibilityChangeSystem = defineSystem({
  name: "AssetVisibilityChange",
  on: AssetVisibilityChanged,
  reads: [],
  writes: [EntityVisibility],
  run: ({ event, world }) => {
    if (!world.has(event.assetId)) return [];
    world.set(event.assetId, EntityVisibility, {
      visibility: event.visibility as Visibility,
    });
    return [];
  },
});

/**
 * Universal mirror: despawn the Asset entity. A separate server-only
 * system (in ./bytes-cleanup.ts) reacts to the same event to remove the
 * bytes from disk — splitting it keeps the mirror universal and the
 * filesystem-touching code on the server side.
 */
export const AssetDespawnSystem = defineSystem({
  name: "AssetDespawn",
  on: AssetDeleted,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.assetId)) world.despawn(event.assetId);
    return [];
  },
});
