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

import { defineSystem } from "@vtt/substrate";
import { ownedBy, Permissions } from "@vtt/permissions/shared";
import { AssetDeleted, AssetRegistered, AssetRenamed } from "../shared/events.js";
import { Asset } from "../shared/traits.js";

/**
 * Universal mirror system: spawns the Asset entity carrying Asset +
 * Permissions on every side. Default Permissions is
 * `read: everyone, write: users:[uploader]` — anyone can see the
 * asset (so embedded references render), only the uploader can edit
 * or delete it (plus GMs by universal write bypass). Workbench's
 * PermissionsMenu can flip read to gmOnly() / users:[…] later.
 */
export const AssetSpawningSystem = defineSystem({
  name: "AssetSpawning",
  on: AssetRegistered,
  reads: [],
  writes: [Asset, Permissions],
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
      Permissions(ownedBy(event.uploadedByUserId)),
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
