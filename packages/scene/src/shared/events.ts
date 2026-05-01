// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { defineEvent, EntityId, z } from "@vtt/substrate";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * Scene-level events. Creation events carry the server-allocated entity
 * id (allocated in the command's `apply` via `world.allocateId()`) so
 * every recipient spawns at the same id via `spawnAt` — the substrate's
 * answer to the brittle "every side independently auto-increments and
 * prays the counters match" pattern.
 */
export const SceneCreated = defineEvent({
  name: "@vtt/scene/SceneCreated",
  schema: z.object({
    sceneId: EntityId,
    name: z.string(),
    gridSize: z.number().int(),
    widthPx: z.number().int(),
    heightPx: z.number().int(),
    backgroundColor: Color,
    gridColor: Color,
    createdByUserId: z.string(),
  }),
});

export const TokenCreated = defineEvent({
  name: "@vtt/scene/TokenCreated",
  schema: z.object({
    tokenId: EntityId,
    sceneId: EntityId,
    iconSlug: z.string(),
    tint: z.number().int(),
    size: z.number().int(),
    label: z.string(),
    kind: z.enum(["creature", "object"]),
    x: z.number(),
    y: z.number(),
    /** userId of the player who owns the token. */
    ownerUserId: z.string(),
  }),
});

export const TokenMoved = defineEvent({
  name: "@vtt/scene/TokenMoved",
  schema: z.object({
    tokenId: EntityId,
    x: z.number(),
    y: z.number(),
    movedAt: z.number(),
    movedByUserId: z.string(),
  }),
});

export const TokenRemoved = defineEvent({
  name: "@vtt/scene/TokenRemoved",
  schema: z.object({
    tokenId: EntityId,
  }),
});

/**
 * A character was placed on the scene as a linked token. The recording
 * system spawns the token entity carrying Token + Sprite + Position +
 * OwnedBy + LinkedCharacter (and TokenImage when `imageUrl` is set).
 * Carries the server-allocated tokenId so every recipient spawns at
 * the same id via `spawnAt`.
 *
 * Distinct from `TokenCreated` (raw icon-picker drop) because the
 * spawn shape is different (extra LinkedCharacter trait, optional
 * TokenImage); merging the two would mean every plain token carries
 * a useless LinkedCharacter slot.
 */
export const CharacterTokenPlaced = defineEvent({
  name: "@vtt/scene/CharacterTokenPlaced",
  schema: z.object({
    tokenId: EntityId,
    sceneId: EntityId,
    characterId: EntityId,
    iconSlug: z.string(),
    imageUrl: z.string().nullable(),
    tint: z.number().int(),
    size: z.number().int(),
    label: z.string(),
    x: z.number(),
    y: z.number(),
    ownerUserId: z.string(),
  }),
});

/**
 * The GM removed a scene. The recording system despawns the scene
 * entity AND cascades through every token whose Position lives in
 * that scene — orphaned tokens render nowhere and would leak into
 * future snapshots, so we drop them in lockstep on every side.
 *
 * Tabs still pointing at a removed sceneId render their empty-state
 * (the canvas's useTrait returns undefined). The user can pick
 * another scene from the picker or close the tab.
 */
export const SceneRemoved = defineEvent({
  name: "@vtt/scene/SceneRemoved",
  schema: z.object({
    sceneId: EntityId,
  }),
});

/**
 * The GM edited one or more fields of an existing scene. Each field is
 * optional in the payload; the SceneUpdate system merges the supplied
 * values over the current Scene trait. Used by the Config dock tab to
 * rename, resize, or recolor without spawning a new entity.
 */
export const SceneUpdated = defineEvent({
  name: "@vtt/scene/SceneUpdated",
  schema: z.object({
    sceneId: EntityId,
    name: z.string().min(1).max(120).optional(),
    gridSize: z.number().int().min(1).max(512).optional(),
    widthPx: z.number().int().min(1).max(16384).optional(),
    heightPx: z.number().int().min(1).max(16384).optional(),
    backgroundColor: Color.optional(),
    gridColor: Color.optional(),
    /**
     * URL of the new background image, or null to clear it. Optional —
     * omit to leave unchanged. The system merges this onto the trait;
     * see Scene.backgroundImage for the URL contract.
     */
    backgroundImage: z.string().nullable().optional(),
  }),
});
