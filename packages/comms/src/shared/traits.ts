import { defineTrait, EntityId, z } from "@vtt/substrate";

/**
 * One persisted chat message. Text-only at the protocol level — embedded
 * dice results, mentions, etc. are the *renderer's* concern, not the
 * stored shape's. The body is denormalised with the author's display
 * name at send-time so the message still attributes correctly after the
 * sender disconnects (same pattern as `RolledBy` in resolution).
 *
 * Per-message visibility is carried by an EntityVisibility trait
 * attached alongside this one — that's how whispers stay invisible to
 * non-recipients on snapshot replay as well as on live broadcast.
 */
export const ChatMessage = defineTrait({
  name: "@vtt/comms/ChatMessage",
  schema: z.object({
    authorUserId: z.string().min(1),
    authorName: z.string().min(1),
    body: z.string().min(1).max(2000),
    sentAt: z.number(),
    /**
     * Optional list of recipient userIds for whispers. Mostly informational
     * for the renderer (so we can show "Hero whispered to Aragorn"); the
     * actual filtering is done by the substrate via EntityVisibility.
     */
    whisperTo: z.array(z.string()).optional(),
    /**
     * Optional Character entity the sender was speaking as when this
     * message was recorded. Renderers can use it to show e.g. a small
     * "as Tarn (player: Hero)" suffix; the message's `authorName` is
     * already the resolved character name so plain renderers don't
     * need to do anything.
     */
    speakingAsCharacterId: EntityId.optional(),
    /**
     * Audience this message was published to. `gm-only` lets the
     * timeline visually badge GM-restricted messages; the underlying
     * EntityVisibility on the same entity is what actually keeps the
     * message out of non-GM snapshots.
     */
    visibility: z.enum(["public", "gm-only"]).default("public"),
  }),
});
