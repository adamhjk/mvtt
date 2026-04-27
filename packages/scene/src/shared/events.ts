import { defineEvent, EntityId, z } from "@vtt/substrate";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * Scene-level events. We don't put `sceneId` / `tokenId` on creation
 * events because the recording system spawns the entity and we want
 * server and every client to compute the same id by spawning in
 * lockstep — embedding a server-chosen id would diverge when re-running
 * during cold-boot replay (since `apply` doesn't have access to
 * `world.spawn` here). Subsequent commands (MoveToken, RemoveToken)
 * supply the id from the dispatching client's local World, which all
 * clients agree on because the same events spawned the same entities in
 * the same order.
 */
export const SceneCreated = defineEvent({
  name: "@vtt/scene/SceneCreated",
  schema: z.object({
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
