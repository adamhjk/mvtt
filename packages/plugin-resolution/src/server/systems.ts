import { defineSystem, type Visibility } from "@vtt/substrate";
import { EntityVisibility, actors, everyone, gmOnly } from "@vtt/permissions/shared";
import { Formula, RollResult, RolledBy } from "../shared/traits.js";
import { RollResolved } from "../shared/events.js";

/**
 * Map a roll's user-facing visibility setting onto the substrate's
 * Visibility union — the same logic the command's `apply` uses to attach
 * event-level visibility for the live broadcast filter. Re-derived here
 * so the system has a single source for entity-level visibility, sourced
 * from data on the event (not a closed-over auth context).
 */
function entityVisibilityFor(
  mode: "public" | "gm-only" | "private",
  rolledByUserId: string,
): Visibility {
  if (mode === "gm-only") return gmOnly();
  if (mode === "private") return actors([rolledByUserId]);
  return everyone();
}

/**
 * Universal mirror system: runs on the server and on every client that
 * receives the event. (The live broadcast filter ensures non-GMs never
 * see a `gm-only` RollResolved at all, so this only fires on their side
 * for events they're allowed to see — which means their local World
 * never gets the secret entity. The same EntityVisibility trait makes
 * the *server's* World filter properly when a fresh player connects:
 * permissions' resolver picks the trait up at snapshot time.)
 */
export const RollRecordingSystem = defineSystem({
  name: "RollRecording",
  on: RollResolved,
  reads: [],
  writes: [Formula, RollResult, RolledBy, EntityVisibility],
  run: ({ event, world }) => {
    world.spawn([
      Formula({ notation: event.notation, reason: event.reason }),
      RollResult({
        total: event.total,
        output: event.output,
        rolledAt: event.rolledAt,
      }),
      RolledBy({
        userId: event.rolledByUserId,
        displayName: event.rolledByName,
      }),
      EntityVisibility({
        visibility: entityVisibilityFor(event.visibility, event.rolledByUserId),
      }),
    ]);
    return [];
  },
});
