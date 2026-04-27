import { defineTrait, EntityId, z } from "@vtt/substrate";

/**
 * Marks an entity as a Scene — the canvas-shaped state for a battle map.
 * v0 expects exactly one Scene in the World at a time; the renderer
 * grabs the first match. Multi-scene + ActiveScene selection lands when
 * the campaign-management UI does.
 */
export const Scene = defineTrait({
  name: "@vtt/scene/Scene",
  schema: z.object({
    name: z.string().min(1).max(120),
    /** Grid cell size in scene units (px). 70 is a common default. */
    gridSize: z.number().int().min(1).max(512).default(70),
    /**
     * Playable extent in PIXELS (not cells). Cell count is derived as
     * `floor(widthPx / gridSize)` when needed. Auto-set to the natural
     * size of the uploaded background image; can be tuned by hand in
     * the Config tab. Defaults match the historical 30×20 cells × 70 px
     * grid so existing behaviour is preserved when there's no image.
     */
    widthPx: z.number().int().min(1).max(16384).default(2100),
    heightPx: z.number().int().min(1).max(16384).default(1400),
    /** Hex string with leading #, e.g. "#1a1a1a". */
    backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#1a1a1a"),
    /** Color of the grid lines drawn over the background. */
    gridColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2a2a2a"),
    /**
     * URL of a background image to render beneath the grid, or null if
     * the scene uses only the solid `backgroundColor`. Must be served
     * from the substrate's `/plugin-data/@vtt/scene/scenes/<sceneId>/`
     * mount — uploaded via `POST /api/plugin-data/...` (GM-only). The
     * URL may include a `?v=<bytes>` cache-bust suffix the upload
     * endpoint stamps on so the browser re-fetches when the GM
     * replaces the image.
     */
    backgroundImage: z.string().nullable().default(null),
  }),
});

/**
 * Spatial state. Persistent (survives reload). The renderer mutates Pixi
 * sprite x/y from these values reactively via the world subscriber.
 */
export const Position = defineTrait({
  name: "@vtt/scene/Position",
  schema: z.object({
    sceneId: EntityId,
    /** World-space coordinates in scene units (px). */
    x: z.number(),
    y: z.number(),
    /** Rotation in radians. */
    rotation: z.number().default(0),
    /**
     * Server-assigned monotonic timestamp at last move. Used by MoveToken's
     * CAS check: a client sends `causalState.lastSeenMovedAt`; if the
     * authoritative position has a newer movedAt the command is rejected.
     */
    movedAt: z.number().default(0),
  }),
});

/**
 * Visual state for an entity rendered as a sprite on the canvas. The
 * `iconSlug` references an entry in the server's icon manifest; the
 * renderer fetches `/icons/<iconSlug>.svg` once per slug. `tint` is a
 * 0xRRGGBB number applied as Pixi multiplicative tint — colours the
 * icon's white pixels without re-baking the asset.
 */
export const Sprite = defineTrait({
  name: "@vtt/scene/Sprite",
  schema: z.object({
    iconSlug: z.string().min(1),
    tint: z.number().int().min(0).max(0xffffff).default(0xffffff),
    /** Base pixel size (square; one cell on the grid by default). */
    size: z.number().int().min(8).max(512).default(64),
  }),
});

/**
 * Marker for "this entity is a player- or GM-controlled creature/object
 * on the map," as opposed to bare scenery sprites. Tokens are the things
 * players drag, attack, and own.
 */
export const Token = defineTrait({
  name: "@vtt/scene/Token",
  schema: z.object({
    label: z.string().min(1).max(80),
    kind: z.enum(["creature", "object"]).default("creature"),
  }),
});
