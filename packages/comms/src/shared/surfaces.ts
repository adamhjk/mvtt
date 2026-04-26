import { defineSurface, EntityId, z } from "@vtt/substrate";

/**
 * Per-message render surface. The chat stream view fans this out via the
 * substrate's per-entity Surface mechanism, rendering each registered
 * view once for every entity carrying ChatMessage. Letting future plugins
 * register their own message-row views (e.g. an inline dice-result card
 * for messages whose body contains a roll reference) is the same
 * extensibility story as @vtt/resolution's RollEntrySurface.
 */
export const ChatStreamSurface = defineSurface({
  name: "@vtt/comms/chat-stream",
  kind: "per-entity",
  context: z.object({ entityId: EntityId }),
  description: "Renders one row per chat message entity.",
});
