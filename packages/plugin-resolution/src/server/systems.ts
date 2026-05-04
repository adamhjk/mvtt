// mvtt, an RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of mvtt.
//
// mvtt is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// mvtt is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with mvtt.  If not, see <https://www.gnu.org/licenses/>.

import { defineSystem, type Visibility } from "@vtt/substrate";
import { actors, everyone, gmOnly, Permissions } from "@vtt/permissions/shared";
import { Character } from "@vtt/characters/shared";
import { Formula, RollResult, RolledBy } from "../shared/traits.js";
import { RollResolved } from "../shared/events.js";

/**
 * Map a roll's user-facing visibility setting onto the substrate's
 * Visibility union — the same logic the command's `apply` uses to attach
 * event-level visibility for the live broadcast filter. Re-derived here
 * so the system has a single source for entity-level visibility, sourced
 * from data on the event (not a closed-over auth context).
 */
function readVisibilityFor(
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
 * never gets the secret entity. The same `Permissions.read` makes
 * the *server's* World filter properly when a fresh player connects:
 * permissions' resolver picks the trait up at snapshot time.)
 *
 * `write` is GM-only — roll records are immutable.
 */
export const RollRecordingSystem = defineSystem({
  name: "RollRecording",
  on: RollResolved,
  reads: [Character],
  writes: [Formula, RollResult, RolledBy, Permissions],
  run: ({ event, world }) => {
    let displayName = event.rolledByName;
    if (
      event.speakingAsCharacterId &&
      world.has(event.speakingAsCharacterId)
    ) {
      const got = world.get(event.speakingAsCharacterId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      if (got) displayName = got.Character.name;
    }
    world.spawnAt(event.rollId, [
      Formula({ notation: event.notation, reason: event.reason }),
      RollResult({
        total: event.total,
        output: event.output,
        rolledAt: event.rolledAt,
      }),
      RolledBy({
        userId: event.rolledByUserId,
        displayName,
        speakingAsCharacterId: event.speakingAsCharacterId,
      }),
      Permissions({
        read: readVisibilityFor(event.visibility, event.rolledByUserId),
        write: gmOnly(),
      }),
    ]);
    return [];
  },
});
