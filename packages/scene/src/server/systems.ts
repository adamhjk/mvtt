import { defineSystem, type EntityId } from "@vtt/substrate";
import { OwnedBy } from "@vtt/permissions/shared";
import {
  SceneCreated,
  SceneRemoved,
  SceneUpdated,
  TokenCreated,
  TokenMoved,
  TokenRemoved,
} from "../shared/events.js";
import { Position, Scene, Sprite, Token } from "../shared/traits.js";

/**
 * Universal mirror system: spawns the Scene entity on every side
 * (server and every client). All sides spawn in lockstep on the same
 * event order, so the resulting EntityId matches across worlds — that's
 * what lets `TokenCreated.sceneId` reference an id everyone agrees on.
 */
export const SceneSpawningSystem = defineSystem({
  name: "SceneSpawning",
  on: SceneCreated,
  reads: [],
  writes: [Scene],
  run: ({ event, world }) => {
    world.spawn([
      Scene({
        name: event.name,
        gridSize: event.gridSize,
        widthPx: event.widthPx,
        heightPx: event.heightPx,
        backgroundColor: event.backgroundColor,
        gridColor: event.gridColor,
      }),
    ]);
    return [];
  },
});

/**
 * Universal mirror: spawns a Token entity carrying Token + Sprite +
 * Position + OwnedBy. The OwnedBy trait lets requireOwnerOrGm gate
 * future MoveToken/RemoveToken without scene-specific permission code.
 */
export const TokenSpawningSystem = defineSystem({
  name: "TokenSpawning",
  on: TokenCreated,
  reads: [],
  writes: [Token, Sprite, Position, OwnedBy],
  run: ({ event, world }) => {
    world.spawn([
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
      OwnedBy({ userId: event.ownerUserId }),
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
            backgroundImage: string | null;
          };
        }
      | undefined;
    if (!got) return [];
    world.set(event.sceneId, Scene, {
      name: event.name ?? got.Scene.name,
      gridSize: event.gridSize ?? got.Scene.gridSize,
      widthPx: event.widthPx ?? got.Scene.widthPx,
      heightPx: event.heightPx ?? got.Scene.heightPx,
      backgroundColor: event.backgroundColor ?? got.Scene.backgroundColor,
      gridColor: event.gridColor ?? got.Scene.gridColor,
      // event.backgroundImage may be `null` to explicitly clear; we
      // distinguish that from `undefined` (leave unchanged) by checking
      // for `undefined` only.
      backgroundImage:
        event.backgroundImage !== undefined
          ? event.backgroundImage
          : got.Scene.backgroundImage,
    });
    return [];
  },
});
