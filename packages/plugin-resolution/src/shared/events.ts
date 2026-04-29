import { defineEvent, EntityId, z } from "@vtt/substrate";

/**
 * Per-die outcome inside a `RollResolved` event. `sides` is the die's
 * face count for ordinary numerics (4, 6, 8, 10, 12, 20, 100); the
 * literal `"F"` marks Fudge / Fate dice (`-1 | 0 | +1`). `value` is the
 * server-rolled face. Animations consume this to land predetermined
 * dice on specific faces; chat consumers ignore it (they read `output`).
 */
const DieOutcomeSchema = z.object({
  sides: z.union([z.number().int().positive(), z.literal("F")]),
  value: z.number().int(),
});
export type DieOutcome = z.infer<typeof DieOutcomeSchema>;

/**
 * Server-authoritative roll outcome. The command's `apply` runs the dice
 * roller (a non-deterministic side effect) and emits this event with the full
 * result. Clients never re-roll — they apply the trait values from the event
 * payload, which is what keeps server and client worlds in sync without
 * trusting client-side randomness.
 *
 * The `dice` field carries each individual die's face for downstream
 * animation (the dice tray plugin uses it to land 3D meshes on specific
 * faces). Optional and additive — older clients/snapshots that lacked
 * the field continue to validate, and chat-style consumers can ignore
 * it without change.
 */
export const RollResolved = defineEvent({
  name: "@vtt/resolution/RollResolved",
  schema: z.object({
    rollId: EntityId,
    notation: z.string(),
    reason: z.string().optional(),
    visibility: z.enum(["public", "gm-only", "private"]),
    total: z.number(),
    output: z.string(),
    rolledAt: z.number(),
    rolledByUserId: z.string(),
    rolledByName: z.string(),
    /**
     * Flat list of every individual die rolled, in display order. Empty
     * for notations that didn't roll any dice (a bare modifier like
     * `4` — degenerate but accepted by the parser).
     */
    dice: z.array(DieOutcomeSchema).default([]),
    /**
     * Optional Character entity the roller was speaking as. Resolved
     * to the character's current name by RollRecordingSystem when the
     * RolledBy trait is written.
     */
    speakingAsCharacterId: EntityId.optional(),
  }),
});
