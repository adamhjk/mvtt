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
 * Asset-first precedence: `assetId` wins, `imageUrl` is the legacy
 * fallback. Pure value shape — no World access here so this can run
 * client-side without a registry.
 */
export interface CharacterTokenValue {
  readonly assetId: EntityId | string | null;
  readonly imageUrl: string | null;
}

/**
 * Resolve the URL to fetch for a character's portrait. Asset-first
 * (the post-refactor canonical path) with a fallback to the legacy
 * `imageUrl` path so entities materialised before the refactor keep
 * rendering.
 *
 *   resolveCharacterTokenUrl({assetId: "e123", imageUrl: null}, "w1")
 *     // → "/plugin-data/w1/assets/e123"
 *
 *   resolveCharacterTokenUrl({assetId: null, imageUrl: "/plugin-data/.../token.png?v=42"}, "w1")
 *     // → "/plugin-data/.../token.png?v=42"  (legacy passthrough)
 *
 *   resolveCharacterTokenUrl({assetId: null, imageUrl: null}, "w1")
 *     // → null
 *
 * The `worldId` argument is required only for the asset-id path —
 * callers without a worldId can still resolve legacy imageUrl values
 * by passing an empty string.
 */
export function resolveCharacterTokenUrl(
  token: CharacterTokenValue | null | undefined,
  worldId: string | null | undefined,
): string | null {
  if (!token) return null;
  if (token.assetId && worldId) {
    return `/plugin-data/${encodeURIComponent(worldId)}/assets/${encodeURIComponent(token.assetId)}`;
  }
  if (token.imageUrl) return token.imageUrl;
  return null;
}
