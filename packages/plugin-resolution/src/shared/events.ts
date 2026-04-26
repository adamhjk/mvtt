import { defineEvent, z } from "@vtt/substrate";

/**
 * Server-authoritative roll outcome. The command's `apply` runs the dice
 * roller (a non-deterministic side effect) and emits this event with the full
 * result. Clients never re-roll — they apply the trait values from the event
 * payload, which is what keeps server and client worlds in sync without
 * trusting client-side randomness.
 */
export const RollResolved = defineEvent({
  name: "@vtt/resolution/RollResolved",
  schema: z.object({
    notation: z.string(),
    reason: z.string().optional(),
    visibility: z.enum(["public", "gm-only", "private"]),
    total: z.number(),
    output: z.string(),
    rolledAt: z.number(),
    rolledByUserId: z.string(),
    rolledByName: z.string(),
  }),
});
