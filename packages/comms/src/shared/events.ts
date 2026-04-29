import { defineEvent, EntityId, z } from "@vtt/substrate";

export const MessageSent = defineEvent({
  name: "@vtt/comms/MessageSent",
  schema: z.object({
    messageId: EntityId,
    authorUserId: z.string().min(1),
    authorName: z.string().min(1),
    body: z.string().min(1).max(2000),
    sentAt: z.number(),
    whisperTo: z.array(z.string()).optional(),
    /**
     * Optional Character entity the sender is speaking as. The
     * MessageRecordingSystem resolves the character's current name and
     * uses it as the recorded `authorName` on the spawned ChatMessage.
     */
    speakingAsCharacterId: EntityId.optional(),
    /**
     * Visibility chosen at send time. `gm-only` rides the same role-based
     * filter that gm-only rolls use; renderers can also use it to badge
     * the message in chat.
     */
    visibility: z.enum(["public", "gm-only"]).default("public"),
  }),
});
