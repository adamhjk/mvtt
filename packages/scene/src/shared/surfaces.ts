import { defineSurface, EntityId, z } from "@vtt/substrate";

/**
 * The canvas itself. `single` because there can only be one Pixi
 * Application backing the live scene at a time — future plugins that
 * want a different renderer (e.g. a Three.js 3D table) ship a
 * higher-priority view that takes the slot. Layered effects (fog,
 * ruler, AoE templates) belong on a separate overlay surface.
 *
 * Context: `sceneId` — the entity id of the Scene this canvas should
 * render. Required so each workbench tab (which may target a different
 * scene) renders the right one rather than always defaulting to "the
 * first Scene in the world."
 *
 * The toolbar surface that used to sit alongside the canvas was
 * replaced by the bottom dock + `SceneOverlayTabsSlot`. Tools are now
 * tab fills, not surface views.
 */
export const SceneCanvasSurface = defineSurface({
  name: "@vtt/scene/canvas",
  kind: "single",
  context: z.object({ sceneId: EntityId }),
  description:
    "The 2D battle map canvas for one scene. Exactly one renderer view fills this surface, parameterised by the sceneId in the surface's context.",
});
