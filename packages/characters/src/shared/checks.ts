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

import { fail, ok, type Result, type World } from "@vtt/substrate";
import { parseAuthSession } from "@vtt/auth";
import { OwnedBy } from "@vtt/permissions/shared";
import { Character } from "./traits.js";

/**
 * Pass when the actor is a GM, the character's `OwnedBy.userId`, or
 * the character's currently-assigned `Character.playerUserId`. The
 * third branch is the wider envelope characters need versus a generic
 * asset: a GM may create a character and assign it to a player; that
 * player is then the *editor*, so they can rename, set fields, roll,
 * place tokens, and re-assign without the GM transferring ownership.
 *
 * Returns fail when there's no session, the entity isn't a Character,
 * or the actor matches none of the three branches.
 */
export function requireCharacterEditor(
  ctx: { session?: unknown; world: World },
  characterId: string,
): Result {
  const s = parseAuthSession(ctx.session);
  if (!s) return fail("not authenticated");
  if (s.role === "gm") return ok();
  const character = ctx.world.get(characterId, [Character]) as
    | { Character: { name: string; playerUserId?: string } }
    | undefined;
  if (!character) return fail(`entity ${characterId} is not a character`);
  if (character.Character.playerUserId === s.userId) return ok();
  const owned = ctx.world.get(characterId, [OwnedBy]) as
    | { OwnedBy: { userId: string } }
    | undefined;
  if (owned && owned.OwnedBy.userId === s.userId) return ok();
  return fail(`character ${characterId} is not assigned to or owned by you`);
}
