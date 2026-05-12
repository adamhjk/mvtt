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

import type { EntityId } from "@vtt/substrate";

/**
 * Asset-first precedence for `Scene.backgroundAssetId` vs the legacy
 * `Scene.backgroundImage` URL. Mirrors `resolveCharacterTokenUrl`
 * shape-for-shape — same docstring rules apply.
 */
export interface SceneBackgroundValue {
  readonly backgroundAssetId: EntityId | string | null;
  readonly backgroundImage: string | null;
}

export function resolveSceneBackgroundUrl(
  scene: SceneBackgroundValue | null | undefined,
  worldId: string | null | undefined,
): string | null {
  if (!scene) return null;
  if (scene.backgroundAssetId && worldId) {
    return `/plugin-data/${encodeURIComponent(worldId)}/assets/${encodeURIComponent(scene.backgroundAssetId)}`;
  }
  if (scene.backgroundImage) return scene.backgroundImage;
  return null;
}

/**
 * Asset-first precedence for `TokenImage.assetId` vs the legacy
 * `TokenImage.url`. Same shape as `resolveSceneBackgroundUrl`.
 */
export interface TokenImageValue {
  readonly assetId: EntityId | string | null;
  readonly url: string | null;
}

export function resolveTokenImageUrl(
  token: TokenImageValue | null | undefined,
  worldId: string | null | undefined,
): string | null {
  if (!token) return null;
  if (token.assetId && worldId) {
    return `/plugin-data/${encodeURIComponent(worldId)}/assets/${encodeURIComponent(token.assetId)}`;
  }
  if (token.url) return token.url;
  return null;
}
