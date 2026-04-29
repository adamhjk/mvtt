import { defineTrait, EntityId, z } from "@vtt/substrate";

export const Formula = defineTrait({
  name: "@vtt/resolution/Formula",
  schema: z.object({
    notation: z.string().min(1),
    reason: z.string().optional(),
  }),
});

/**
 * Who initiated the roll. We capture both `userId` (stable across sessions
 * and reconnects) and `displayName` (the name at the moment the roll
 * happened — denormalized so the card still reads correctly after the
 * player disconnects).
 *
 * When the roll was made through the chat composer / dice tray's
 * "speak as" dropdown, `displayName` is the character's name (resolved
 * by `RollRecordingSystem`) and `speakingAsCharacterId` is the entity
 * — renderers can use that to e.g. open the sheet on click. With no
 * speak-as selection it's just the rolling user's display name, same
 * as before.
 */
export const RolledBy = defineTrait({
  name: "@vtt/resolution/RolledBy",
  schema: z.object({
    userId: z.string().min(1),
    displayName: z.string().min(1),
    speakingAsCharacterId: EntityId.optional(),
  }),
});

export const RollResult = defineTrait({
  name: "@vtt/resolution/RollResult",
  schema: z.object({
    total: z.number(),
    output: z.string(),
    rolledAt: z.number(),
  }),
});
