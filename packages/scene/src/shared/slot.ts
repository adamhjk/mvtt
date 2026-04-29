import {
  defineSlot,
  type EntityId,
  type QualifiedName,
  QualifiedNameSchema,
  z,
} from "@vtt/substrate";

/**
 * Per-render arguments passed to a SceneOverlayTab's `render`. The
 * `sceneId` is whichever Scene this dock is attached to — passed in
 * rather than re-resolved by every tab so the tab doesn't have to know
 * about the multi-scene shape (which the scene plugin will grow when
 * named-scene-switching lands).
 */
export interface SceneOverlayTabRenderArgs {
  readonly sceneId: EntityId;
}

/**
 * One tab in the scene's bottom dock. Plugins fill the slot to add
 * tabs alongside the built-in `Config` and `Tokens` tabs. Same
 * permissive-on-functions pattern as `@vtt/comms/chat-input-handlers`
 * (Zod can't usefully validate a render function shape; the type
 * below is the load-bearing constraint at fill sites).
 */
export type SceneOverlayTab = {
  /**
   * Plugin-namespaced id, e.g. `@vtt/scene/dock/tokens`. Used as a key
   * in the dock's URL/uiState so the active tab survives tab-swap and
   * reload.
   */
  id: QualifiedName;
  label: string;
  /**
   * Single character or short symbol shown next to the label in the
   * tab strip. Optional — labels stand on their own.
   */
  icon?: string;
  /**
   * Higher priority sorts to the left of the tab strip. Built-ins use
   * 100 (Config) and 80 (Tokens). External plugins should pick lower
   * priorities so the built-ins stay anchored.
   */
  priority?: number;
  render: (args: SceneOverlayTabRenderArgs) => unknown;
};

const SceneOverlayTabSchema = z.object({
  id: QualifiedNameSchema,
  label: z.string().min(1),
  icon: z.string().optional(),
  priority: z.number().optional(),
  render: z.any(),
});

export const SceneOverlayTabsSlot = defineSlot({
  name: "@vtt/scene/overlay-tabs",
  schema: SceneOverlayTabSchema,
  description:
    "Tabs that appear in the scene's bottom dock. Built-ins: Config (rename / dimensions / background), Tokens (icon picker). Plugins fill this for additional projections (effects, ruler, fog, etc).",
});

/**
 * Per-token under-sprite decorator. Game-system plugins fill this slot
 * with imperative Pixi rendering callbacks — e.g. system-simple draws
 * an HP bar beneath each token whose linked character has Vitals/MaxHp.
 *
 * The scene canvas calls `mount` once per (tokenId × decorator) when
 * the sprite enters the world, passing a Pixi Container positioned at
 * the token's centre that the decorator may add children to. The
 * decorator owns its own world.subscribe lifetime; the returned
 * cleanup function is invoked when the token is removed (or the canvas
 * is unmounted) so listeners and Pixi resources don't leak.
 *
 * The container's `position` is kept in sync with the sprite's by the
 * canvas — decorators draw in container-local coordinates (treat
 * (0,0) as the token's centre).
 *
 * Schema is `z.any()` because the contract is function-shaped; the
 * type-level constraint at fill sites is the load-bearing one.
 */
export type TokenUnderlay = {
  id: QualifiedName;
  /**
   * Higher priority sorts to a HIGHER z-index within the underlay
   * stack (last drawn = on top of other underlays, but all underlays
   * draw beneath the sprite). Optional; default 0.
   */
  priority?: number;
  mount: (args: TokenUnderlayMountArgs) => () => void;
};

export interface TokenUnderlayMountArgs {
  /** The token entity this decorator is attached to. */
  readonly tokenId: EntityId;
  /**
   * The Pixi Container positioned at the token's centre. The
   * decorator may `addChild` graphics; the canvas owns the parent's
   * position and z-order.
   *
   * Typed as `unknown` here so the slot module doesn't pull in the
   * full `pixi.js` typing on the server bundle. Decorators cast to
   * `Container` from `pixi.js` at the fill site.
   */
  readonly container: unknown;
  /**
   * The substrate world. Decorators subscribe via `world.subscribe`
   * and read traits via `world.get` to react to state changes.
   *
   * Typed as `unknown` for the same reason — keeps this module free
   * of the substrate's runtime-only types in the manifest seam.
   */
  readonly world: unknown;
  /**
   * Initial token size (pixels, square). The decorator should also
   * subscribe if it needs to react to subsequent size changes.
   */
  readonly initialSize: number;
}

export const TokenUnderlaysSlot = defineSlot({
  name: "@vtt/scene/token-underlays",
  schema: z.any(),
  description:
    "Per-token decorators drawn under the sprite. Game-system plugins fill this for HP bars, status auras, etc.; the scene canvas wires each decorator's mount/cleanup to token spawn/despawn.",
});
