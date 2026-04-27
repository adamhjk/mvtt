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
  SceneCreated,
  SceneRemoved,
  SceneUpdated,
  TokenCreated,
  TokenMoved,
  TokenRemoved,
} from "./events.js";
import { Position } from "./traits.js";

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
  apply: ({ cmd, session }) => {
    const auth = requireSession({ session })!; // validate already enforced
    return [
      SceneCreated({
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
  apply: ({ cmd, session }) => {
    const auth = requireSession({ session })!;
    return [
      TokenCreated({
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
function isBackgroundUrlForScene(url: string, sceneId: string): boolean {
  const expectedPrefix = `/plugin-data/@vtt/scene/scenes/${sceneId}/`;
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
      !isBackgroundUrlForScene(ctx.cmd.backgroundImage, ctx.cmd.sceneId)
    ) {
      return fail(
        `backgroundImage URL must start with /plugin-data/@vtt/scene/scenes/${ctx.cmd.sceneId}/`,
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
