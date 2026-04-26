import { defineTrait, z } from "@vtt/substrate";

export const Formula = defineTrait({
  name: "@vtt/resolution/Formula",
  schema: z.object({
    notation: z.string().min(1).max(120),
    reason: z.string().max(80).optional(),
  }),
});

/**
 * Who initiated the roll. We capture both `userId` (stable across sessions
 * and reconnects) and `displayName` (the name at the moment the roll
 * happened — denormalized so the card still reads correctly after the
 * player disconnects). This is intentionally just the *user identity*, not
 * a character or persona — character attribution is a future plugin's job.
 */
export const RolledBy = defineTrait({
  name: "@vtt/resolution/RolledBy",
  schema: z.object({
    userId: z.string().min(1),
    displayName: z.string().min(1),
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
