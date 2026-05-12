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

import {
  defineSystem,
  type EntityId,
  type TraitName,
} from "@vtt/substrate";
import { ownedBy, Permissions } from "@vtt/permissions/shared";
import {
  CharacterTokenPlaced,
  SceneCreated,
  SceneRemoved,
  SceneUpdated,
  TokenCreated,
  TokenMoved,
  TokenRemoved,
} from "../shared/events.js";
import {
  LinkedCharacter,
  Position,
  Scene,
  Sprite,
  Token,
  TokenImage,
} from "../shared/traits.js";

/**
 * Universal mirror system: spawns the Scene entity on every side
 * (server and every client). All sides spawn in lockstep on the same
 * event order, so the resulting EntityId matches across worlds — that's
 * what lets `TokenCreated.sceneId` reference an id everyone agrees on.
 *
 * Default Permissions: `read: everyone, write: users:[creator]`. The GM
 * who created the scene can edit/remove it; players see it but can't
 * mutate it. The chrome PermissionsMenu can flip this later.
 */
export const SceneSpawningSystem = defineSystem({
  name: "SceneSpawning",
  on: SceneCreated,
  reads: [],
  writes: [Scene, Permissions],
  run: ({ event, world }) => {
    world.spawnAt(event.sceneId, [
      Scene({
        name: event.name,
        gridSize: event.gridSize,
        widthPx: event.widthPx,
        heightPx: event.heightPx,
        backgroundColor: event.backgroundColor,
        gridColor: event.gridColor,
      }),
      Permissions(ownedBy(event.createdByUserId)),
    ]);
    return [];
  },
});

/**
 * Universal mirror: spawns a Token entity carrying Token + Sprite +
 * Position + Permissions. `requireWrite` against the token's
 * Permissions gates MoveToken / RemoveToken with no scene-specific
 * permission code.
 */
export const TokenSpawningSystem = defineSystem({
  name: "TokenSpawning",
  on: TokenCreated,
  reads: [],
  writes: [Token, Sprite, Position, Permissions],
  run: ({ event, world }) => {
    world.spawnAt(event.tokenId, [
      Token({ label: event.label, kind: event.kind }),
      Sprite({
        iconSlug: event.iconSlug,
        tint: event.tint,
        size: event.size,
      }),
      Position({
        sceneId: event.sceneId,
        x: event.x,
        y: event.y,
        rotation: 0,
        movedAt: 0,
      }),
      Permissions(ownedBy(event.ownerUserId)),
    ]);
    return [];
  },
});

/**
 * Universal mirror: replaces the Position trait on the moved token. Uses
 * `world.set` rather than `spawn` so subscribers fire targeted at the
 * moved entity — Pixi-side renderers see the per-trait notification and
 * mutate just the relevant sprite.
 */
export const TokenMovementSystem = defineSystem({
  name: "TokenMovement",
  on: TokenMoved,
  reads: [Position],
  writes: [Position],
  run: ({ event, world }) => {
    const got = world.get(event.tokenId, [Position]) as
      | { Position: { sceneId: EntityId; x: number; y: number; rotation: number } }
      | undefined;
    if (!got) return [];
    world.set(event.tokenId, Position, {
      sceneId: got.Position.sceneId,
      x: event.x,
      y: event.y,
      rotation: got.Position.rotation,
      movedAt: event.movedAt,
    });
    return [];
  },
});

/**
 * Universal mirror: spawn a token that's linked to a Character. Carries
 * the standard Token + Sprite + Position + Permissions plus
 * LinkedCharacter (back-link to the character entity) and, when an
 * image was uploaded, a TokenImage trait the canvas reads in
 * preference to iconSlug. The place-once invariant is enforced by
 * `PlaceCharacterToken`'s validator.
 *
 * The token's Permissions are *copied* from the character at place
 * time — every user who can write the character can write the token.
 * The values diverge after placement (workbench's PermissionsMenu
 * flips them independently); v1 doesn't auto-resync if the character's
 * permissions change later.
 */
export const CharacterTokenPlacementSystem = defineSystem({
  name: "CharacterTokenPlacement",
  on: CharacterTokenPlaced,
  reads: [Permissions],
  writes: [Token, Sprite, Position, Permissions, LinkedCharacter, TokenImage],
  run: ({ event, world }) => {
    const charPerm = world.get(event.characterId, [Permissions]) as
      | { Permissions: Parameters<typeof Permissions>[0] }
      | undefined;
    // Fall back to "everyone reads, no one writes" if the character
    // somehow lacks Permissions — a safe deny for write that lets the
    // token still render. In practice every character carries it.
    const perm =
      charPerm?.Permissions ?? {
        read: { kind: "everyone" as const },
        write: { kind: "users" as const, userIds: [] },
      };
    const traits: Array<{ name: TraitName; value: unknown }> = [
      Token({ label: event.label, kind: "creature" }),
      Sprite({
        iconSlug: event.iconSlug,
        tint: event.tint,
        size: event.size,
      }),
      Position({
        sceneId: event.sceneId,
        x: event.x,
        y: event.y,
        rotation: 0,
        movedAt: 0,
      }),
      Permissions(perm),
      LinkedCharacter({ characterId: event.characterId }),
    ];
    // Attach TokenImage when either the asset-first or legacy URL
    // field is set. Pre-refactor placements only carry `imageUrl`;
    // post-refactor placements carry `assetId`. Both never set
    // together (validator rejects).
    if (event.assetId !== null || event.imageUrl !== null) {
      traits.push(
        TokenImage({
          assetId: event.assetId,
          url: event.imageUrl,
        }),
      );
    }
    world.spawnAt(event.tokenId, traits);
    return [];
  },
});

/**
 * Universal mirror: despawns the entity. Pixi renderer's world subscriber
 * sees the trait-removed notifications and tears down the sprite.
 */
export const TokenRemovalSystem = defineSystem({
  name: "TokenRemoval",
  on: TokenRemoved,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.tokenId)) world.despawn(event.tokenId);
    return [];
  },
});

/**
 * Universal mirror: when a scene is removed, despawn the scene entity
 * AND every token whose Position lives in it. Tokens with Position
 * pointing at the removed sceneId would otherwise be orphaned in the
 * snapshot — they wouldn't render anywhere (no canvas binds to a
 * non-existent scene) but would still consume entity ids and disk
 * space.
 *
 * We don't emit per-token TokenRemoved events here — the World mirror
 * runs identically on every side, so each client computes the same
 * cascade locally from the same world state. Emitting one event per
 * cascaded token would just be redundant chatter.
 */
export const SceneRemovalSystem = defineSystem({
  name: "SceneRemoval",
  on: SceneRemoved,
  reads: [Position],
  writes: [],
  run: ({ event, world }) => {
    for (const row of world.query([Position])) {
      const p = row.values.Position as { sceneId: import("@vtt/substrate").EntityId };
      if (p.sceneId === event.sceneId) world.despawn(row.id);
    }
    if (world.has(event.sceneId)) world.despawn(event.sceneId);
    return [];
  },
});

/**
 * Universal mirror: merges supplied SceneUpdated fields over the
 * current Scene trait. Missing fields keep their existing value, so
 * the Config tab can dispatch UpdateScene with just one field changed
 * without clobbering the rest. No-op if the scene id has been despawned.
 */
export const SceneUpdateSystem = defineSystem({
  name: "SceneUpdate",
  on: SceneUpdated,
  reads: [Scene],
  writes: [Scene],
  run: ({ event, world }) => {
    const got = world.get(event.sceneId, [Scene]) as
      | {
          Scene: {
            name: string;
            gridSize: number;
            widthPx: number;
            heightPx: number;
            backgroundColor: string;
            gridColor: string;
            backgroundAssetId: string | null;
            backgroundImage: string | null;
          };
        }
      | undefined;
    if (!got) return [];
    // Background fields: `undefined` = leave unchanged, `null` = clear.
    // Setting one explicitly clears the other so the trait can't
    // accidentally hold both (which would let asset-first precedence
    // hide a stale legacy URL).
    let nextAssetId = got.Scene.backgroundAssetId ?? null;
    let nextImage = got.Scene.backgroundImage ?? null;
    if (event.backgroundAssetId !== undefined) {
      nextAssetId = event.backgroundAssetId;
      if (event.backgroundAssetId !== null) nextImage = null;
    }
    if (event.backgroundImage !== undefined) {
      nextImage = event.backgroundImage;
      if (event.backgroundImage !== null) nextAssetId = null;
    }
    world.set(event.sceneId, Scene, {
      name: event.name ?? got.Scene.name,
      gridSize: event.gridSize ?? got.Scene.gridSize,
      widthPx: event.widthPx ?? got.Scene.widthPx,
      heightPx: event.heightPx ?? got.Scene.heightPx,
      backgroundColor: event.backgroundColor ?? got.Scene.backgroundColor,
      gridColor: event.gridColor ?? got.Scene.gridColor,
      backgroundAssetId: nextAssetId,
      backgroundImage: nextImage,
    });
    return [];
  },
});
