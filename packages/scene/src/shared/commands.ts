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

import {
  defineCommand,
  EntityId,
  fail,
  ok,
  z,
} from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import {
  requireOwnerOrGm,
  requireRole,
} from "@vtt/permissions/shared";
import {
  CharacterTokenPlaced,
  SceneCreated,
  SceneRemoved,
  SceneUpdated,
  TokenCreated,
  TokenMoved,
  TokenRemoved,
} from "./events.js";
import { LinkedCharacter, Position } from "./traits.js";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * GM-only: create a new scene. v0 expects exactly one Scene at a time;
 * issuing this when another exists is currently a no-op at the renderer
 * (it'll just pick the first match) — multi-scene management lands later.
 */
export const CreateScene = defineCommand({
  name: "@vtt/scene/CreateScene",
  schema: z.object({
    name: z.string().min(1).max(120),
    gridSize: z.number().int().min(1).max(512).default(70),
    /** Playable extent in pixels. See Scene trait for the rationale. */
    widthPx: z.number().int().min(1).max(16384).default(2100),
    heightPx: z.number().int().min(1).max(16384).default(1400),
    backgroundColor: Color.default("#1a1a1a"),
    gridColor: Color.default("#2a2a2a"),
  }),
  validate: (ctx) => requireRole(ctx, "gm"),
  apply: ({ cmd, session, world }) => {
    const auth = requireSession({ session })!; // validate already enforced
    return [
      SceneCreated({
        sceneId: world.allocateId(),
        name: cmd.name,
        gridSize: cmd.gridSize,
        widthPx: cmd.widthPx,
        heightPx: cmd.heightPx,
        backgroundColor: cmd.backgroundColor,
        gridColor: cmd.gridColor,
        createdByUserId: auth.userId,
      }),
    ];
  },
});

/**
 * GM-only: drop a new token onto the named scene at the given world
 * coordinates. The token's owner is whoever the GM specifies (a player's
 * userId), or the GM themselves by default. The recording system
 * attaches a Position with `movedAt: 0` — the first MoveToken bumps it.
 */
export const CreateToken = defineCommand({
  name: "@vtt/scene/CreateToken",
  schema: z.object({
    sceneId: EntityId,
    iconSlug: z.string().min(1),
    tint: z.number().int().min(0).max(0xffffff).default(0xffffff),
    size: z.number().int().min(8).max(512).default(64),
    label: z.string().min(1).max(80),
    kind: z.enum(["creature", "object"]).default("creature"),
    x: z.number(),
    y: z.number(),
    ownerUserId: z.string().optional(),
  }),
  validate: (ctx) => {
    const role = requireRole(ctx, "gm");
    if (!role.ok) return role;
    if (!ctx.world.has(ctx.cmd.sceneId)) {
      return fail(`scene ${ctx.cmd.sceneId} does not exist`);
    }
    return ok();
  },
  apply: ({ cmd, session, world }) => {
    const auth = requireSession({ session })!;
    return [
      TokenCreated({
        tokenId: world.allocateId(),
        sceneId: cmd.sceneId,
        iconSlug: cmd.iconSlug,
        tint: cmd.tint,
        size: cmd.size,
        label: cmd.label,
        kind: cmd.kind,
        x: cmd.x,
        y: cmd.y,
        ownerUserId: cmd.ownerUserId ?? auth.userId,
      }),
    ];
  },
});

/**
 * Move a token. Anyone who owns the token (or any GM) can dispatch this.
 * The optional `causalState.lastSeenMovedAt` carries the client's
 * last-known `Position.movedAt` — the validator rejects the command if
 * the authoritative position has moved since, so two clients grabbing
 * the same token at the same moment are arbitrated by "first writer
 * wins." v0 doesn't ship optimistic prediction; the second mover sees a
 * fail ack and snaps back via the next TokenMoved broadcast.
 */
export const MoveToken = defineCommand({
  name: "@vtt/scene/MoveToken",
  schema: z.object({
    tokenId: EntityId,
    x: z.number(),
    y: z.number(),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.tokenId)) {
      return fail(`token ${ctx.cmd.tokenId} does not exist`);
    }
    const owner = requireOwnerOrGm(ctx, ctx.cmd.tokenId);
    if (!owner.ok) return owner;

    const causal = ctx.causalState as { lastSeenMovedAt?: number } | undefined;
    if (causal && typeof causal.lastSeenMovedAt === "number") {
      const got = ctx.world.get(ctx.cmd.tokenId, [Position]) as
        | { Position: { movedAt: number } }
        | undefined;
      if (got && got.Position.movedAt > causal.lastSeenMovedAt) {
        return fail("token has moved since you last saw it");
      }
    }
    return ok();
  },
  apply: ({ cmd, session }) => {
    const auth = requireSession({ session })!;
    return [
      TokenMoved({
        tokenId: cmd.tokenId,
        x: cmd.x,
        y: cmd.y,
        movedAt: Date.now(),
        movedByUserId: auth.userId,
      }),
    ];
  },
});

export const RemoveToken = defineCommand({
  name: "@vtt/scene/RemoveToken",
  schema: z.object({
    tokenId: EntityId,
  }),
  validate: (ctx) => {
    const role = requireRole(ctx, "gm");
    if (!role.ok) return role;
    if (!ctx.world.has(ctx.cmd.tokenId)) {
      return fail(`token ${ctx.cmd.tokenId} does not exist`);
    }
    return ok();
  },
  apply: ({ cmd }) => [TokenRemoved({ tokenId: cmd.tokenId })],
});

/**
 * GM-only: delete a scene. The recording system cascades through
 * tokens that live on the scene (Position.sceneId === sceneId) and
 * despawns them too — see SceneRemovalSystem for the rationale.
 *
 * Open tabs pointing at the removed sceneId silently fall back to the
 * "no scene loaded" empty state; the user can pick another via the
 * tab's picker or close the tab. We don't try to retarget those tabs
 * here — that would require reaching into another plugin's state and
 * making assumptions about which scene to switch to.
 */
export const RemoveScene = defineCommand({
  name: "@vtt/scene/RemoveScene",
  schema: z.object({
    sceneId: EntityId,
  }),
  validate: (ctx) => {
    const role = requireRole(ctx, "gm");
    if (!role.ok) return role;
    if (!ctx.world.has(ctx.cmd.sceneId)) {
      return fail(`scene ${ctx.cmd.sceneId} does not exist`);
    }
    return ok();
  },
  apply: ({ cmd }) => [SceneRemoved({ sceneId: cmd.sceneId })],
});

/**
 * GM-only: edit one or more fields of an existing scene. Every field
 * besides `sceneId` is optional — the apply step only emits fields that
 * were actually supplied, and the recording system merges the result
 * over the current trait. Used by the dock's Config tab for rename +
 * dimension + background-color edits.
 */
/**
 * Loose validation that a backgroundImage URL belongs to *this* scene's
 * plugin-data prefix. Stops a malicious client from pointing the trait
 * at an arbitrary external URL (which the canvas would dutifully load
 * as a Pixi texture, opening the door to embedded-image-based mischief
 * and surprise CORS issues). The upload endpoint already restricts
 * writes to GMs and to the allowed extension list — this just keeps
 * the trait pointing where the upload landed.
 *
 * Cache-bust suffixes (`?v=<bytes>`) are accepted; the upload endpoint
 * stamps them on so the browser re-fetches after a replacement.
 */
function isBackgroundUrlForScene(
  url: string,
  worldId: string,
  sceneId: string,
): boolean {
  const expectedPrefix = `/plugin-data/${worldId}/@vtt/scene/scenes/${sceneId}/`;
  if (!url.startsWith(expectedPrefix)) return false;
  // Disallow path-traversal in the trait URL too — the upload endpoint
  // catches it on writes, but the trait could be set independently
  // (e.g. via a future "import scene" command).
  if (url.includes("..")) return false;
  return true;
}

export const UpdateScene = defineCommand({
  name: "@vtt/scene/UpdateScene",
  schema: z.object({
    sceneId: EntityId,
    name: z.string().min(1).max(120).optional(),
    gridSize: z.number().int().min(1).max(512).optional(),
    widthPx: z.number().int().min(1).max(16384).optional(),
    heightPx: z.number().int().min(1).max(16384).optional(),
    backgroundColor: Color.optional(),
    gridColor: Color.optional(),
    /**
     * URL of the new background image, or null to clear it.
     * Validated to start with this scene's plugin-data prefix so the
     * trait can't be pointed at an arbitrary URL.
     */
    backgroundImage: z.string().nullable().optional(),
  }),
  validate: (ctx) => {
    const role = requireRole(ctx, "gm");
    if (!role.ok) return role;
    if (!ctx.world.has(ctx.cmd.sceneId)) {
      return fail(`scene ${ctx.cmd.sceneId} does not exist`);
    }
    if (
      ctx.cmd.backgroundImage !== undefined &&
      ctx.cmd.backgroundImage !== null &&
      !isBackgroundUrlForScene(
        ctx.cmd.backgroundImage,
        ctx.world.worldId,
        ctx.cmd.sceneId,
      )
    ) {
      return fail(
        `backgroundImage URL must start with /plugin-data/${ctx.world.worldId}/@vtt/scene/scenes/${ctx.cmd.sceneId}/`,
      );
    }
    return ok();
  },
  apply: ({ cmd }) => {
    const payload: {
      sceneId: typeof cmd.sceneId;
      name?: string;
      gridSize?: number;
      widthPx?: number;
      heightPx?: number;
      backgroundColor?: string;
      gridColor?: string;
      backgroundImage?: string | null;
    } = { sceneId: cmd.sceneId };
    if (cmd.name !== undefined) payload.name = cmd.name;
    if (cmd.gridSize !== undefined) payload.gridSize = cmd.gridSize;
    if (cmd.widthPx !== undefined) payload.widthPx = cmd.widthPx;
    if (cmd.heightPx !== undefined) payload.heightPx = cmd.heightPx;
    if (cmd.backgroundColor !== undefined) {
      payload.backgroundColor = cmd.backgroundColor;
    }
    if (cmd.gridColor !== undefined) payload.gridColor = cmd.gridColor;
    if (cmd.backgroundImage !== undefined) {
      payload.backgroundImage = cmd.backgroundImage;
    }
    return [SceneUpdated(payload)];
  },
});

/**
 * Loose validation that an `imageUrl` for a placed character token
 * lives under `/plugin-data/<worldId>/`. The character plugin's own
 * upload endpoint already gates writes; this just keeps the trait
 * pointing at a same-world plugin-data path so a malicious client
 * can't have us load arbitrary external textures into Pixi.
 */
function isWorldPluginDataUrl(url: string, worldId: string): boolean {
  const expectedPrefix = `/plugin-data/${worldId}/`;
  if (!url.startsWith(expectedPrefix)) return false;
  if (url.includes("..")) return false;
  return true;
}

/**
 * Place a character on a scene as a linked token. Permission is
 * owner-or-GM of the character (a player can drop their own character
 * on the active scene; a GM can drop any character). The "place once"
 * rule is enforced here: a character that already has a token in the
 * scene cannot be placed again — the validator queries the world for
 * existing tokens with `LinkedCharacter.characterId === cmd.characterId`
 * AND `Position.sceneId === cmd.sceneId`.
 *
 * The client passes pre-resolved `label`, `iconSlug`, `imageUrl`,
 * `ownerUserId` because they're all readable from the character's own
 * traits client-side; revalidating them here would force scene to
 * import every character-side trait. (Adversarial values are caught
 * by URL prefix validation + the scene's own bounded range/size
 * checks; the worst a malicious client can do is set a wrong label
 * on their own placement, which doesn't affect anyone else's state.)
 */
export const PlaceCharacterToken = defineCommand({
  name: "@vtt/scene/PlaceCharacterToken",
  schema: z.object({
    sceneId: EntityId,
    characterId: EntityId,
    iconSlug: z.string().min(1),
    /** Public URL of the character's uploaded portrait, or null for icon fallback. */
    imageUrl: z.string().nullable(),
    tint: z.number().int().min(0).max(0xffffff).default(0xffffff),
    size: z.number().int().min(8).max(512).default(64),
    label: z.string().min(1).max(80),
    x: z.number(),
    y: z.number(),
    ownerUserId: z.string().min(1),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.sceneId)) {
      return fail(`scene ${ctx.cmd.sceneId} does not exist`);
    }
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`character ${ctx.cmd.characterId} does not exist`);
    }
    // Owner-or-GM of the character. The character carries OwnedBy via
    // characters' CharacterSpawningSystem, so requireOwnerOrGm works.
    const owner = requireOwnerOrGm(ctx, ctx.cmd.characterId);
    if (!owner.ok) return owner;

    if (
      ctx.cmd.imageUrl !== null &&
      !isWorldPluginDataUrl(ctx.cmd.imageUrl, ctx.world.worldId)
    ) {
      return fail(
        `imageUrl must start with /plugin-data/${ctx.world.worldId}/`,
      );
    }

    // Place-once: a character may have at most one token per scene.
    // We can't import LinkedCharacter's host plugin here without a
    // cycle — but the trait is owned by THIS plugin, so a direct query
    // is fine. Queries only return entities where every requested
    // trait is present, so unrelated tokens (without LinkedCharacter)
    // are skipped automatically.
    const placed = ctx.world.query([LinkedCharacter, Position]);
    for (const row of placed) {
      const lc = row.values.LinkedCharacter as { characterId: EntityId };
      const pos = row.values.Position as { sceneId: EntityId };
      if (
        lc.characterId === ctx.cmd.characterId &&
        pos.sceneId === ctx.cmd.sceneId
      ) {
        return fail(
          `character ${ctx.cmd.characterId} is already placed on this scene`,
        );
      }
    }
    return ok();
  },
  apply: ({ cmd, world }) => [
    CharacterTokenPlaced({
      tokenId: world.allocateId(),
      sceneId: cmd.sceneId,
      characterId: cmd.characterId,
      iconSlug: cmd.iconSlug,
      imageUrl: cmd.imageUrl,
      tint: cmd.tint,
      size: cmd.size,
      label: cmd.label,
      x: cmd.x,
      y: cmd.y,
      ownerUserId: cmd.ownerUserId,
    }),
  ],
});
