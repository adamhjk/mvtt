import { defineCommand, fail, ok, withVisibility, z } from "@vtt/substrate";
import { DiceRoll } from "@dice-roller/rpg-dice-roller";
import { requireSession } from "@vtt/identity/shared";
import { actors, everyone, gmOnly } from "@vtt/permissions/shared";
import { RollResolved } from "./events.js";

export const RequestRoll = defineCommand({
  name: "@vtt/resolution/RequestRoll",
  schema: z.object({
    notation: z.string().min(1).max(120),
    reason: z.string().max(80).optional(),
    visibility: z.enum(["public", "gm-only", "private"]).default("public"),
  }),
  validate: ({ cmd, session }) => {
    if (!requireSession({ session })) return fail("not authenticated");
    try {
      // Construct without rolling-side-effects: this throws on syntax errors,
      // which is the only thing we can validate before performing the roll.
      // eslint-disable-next-line no-new
      new DiceRoll(cmd.notation);
      return ok();
    } catch (e) {
      return fail(
        `invalid notation ${JSON.stringify(cmd.notation)}: ${(e as Error).message}`,
      );
    }
  },
  apply: ({ cmd, session }) => {
    // apply may have non-deterministic side effects (rolling dice) but must
    // not read or write the world. The full result lives in the event so
    // every client can mirror state without re-rolling. The rolling user's
    // userId + displayName are denormalized into the event so the roll card
    // attributes correctly even after they disconnect. Per-recipient
    // visibility decides which clients receive the broadcast at all.
    const auth = requireSession({ session });
    if (!auth) {
      // validate already rejected this; defensive — should never reach apply.
      throw new Error("RequestRoll.apply called without a valid session");
    }
    const roll = new DiceRoll(cmd.notation);
    const visibility =
      cmd.visibility === "gm-only"
        ? gmOnly()
        : cmd.visibility === "private"
          ? // "private" rolls go to the rolling user only — typical use is
            // GM rolling for themselves; for player private rolls the GM
            // would also be in the recipient set when permissions adds a
            // GM-resolution lookup.
            actors([auth.userId])
          : everyone();
    return [
      withVisibility(
        RollResolved({
          notation: roll.notation,
          reason: cmd.reason,
          visibility: cmd.visibility,
          total: roll.total,
          output: roll.output,
          rolledAt: Date.now(),
          rolledByUserId: auth.userId,
          rolledByName: auth.name,
        }),
        visibility,
      ),
    ];
  },
});
