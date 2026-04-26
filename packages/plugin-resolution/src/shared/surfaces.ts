import { defineSurface, EntityId, z } from "@vtt/substrate";

/**
 * Per-entity surface: the substrate fans this out, rendering each registered
 * view once for every entity that satisfies the view's `requires`. A custom
 * roll renderer (e.g. an attack-roll view from a game-system plugin) can
 * register against this surface with its own `requires` set, and only its
 * matching rolls will render through it.
 */
export const RollEntrySurface = defineSurface({
  name: "@vtt/resolution/roll-entry",
  kind: "per-entity",
  context: z.object({ entityId: EntityId }),
  description: "Renders one card per resolved roll entity.",
});
