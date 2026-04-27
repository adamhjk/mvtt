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
