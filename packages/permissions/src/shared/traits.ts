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

import { defineTrait, z } from "@vtt/substrate";
import { VisibilityShape } from "./visibility.js";

/**
 * The single permission record carried on every gate-able entity.
 *
 *   read  — who sees the entity at all (drives the per-recipient
 *           snapshot filter; entities whose `read` doesn't match a
 *           recipient are stripped from their snapshot).
 *   write — who may mutate the entity (commands gate via `requireWrite`).
 *
 * Both fields are the substrate's `Visibility` union — `everyone`,
 * `role`, or an explicit list of `userIds`. **GM is universal:** the
 * substrate's snapshot filter and `requireWrite` both bypass the
 * structural check when the actor's role is `gm`. So a player's
 * `users:[me]` note is *also* visible to the GM, and a GM can write
 * any entity regardless of who's named.
 *
 * Replaces the older `OwnedBy` / `EntityVisibility` pair: ownership is
 * just `write: { kind: "users", userIds: [creator] }`, and a GM-only
 * note is `read: gmOnly(), write: gmOnly()`.
 *
 * `share: false` because the value is identity-bound — copying it onto
 * another entity (or another user's entity) misattributes access.
 * Whole-entity replication paths (workbench tab sharing, future
 * entity-duplicate verbs) skip this and write a fresh value on the
 * destination.
 */
export const Permissions = defineTrait({
  name: "@vtt/permissions/Permissions",
  schema: z.object({
    read: VisibilityShape,
    write: VisibilityShape,
  }),
  share: false,
});
