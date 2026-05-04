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
import { PermissionsChanged } from "../shared/events.js";
import { Permissions } from "../shared/traits.js";

/**
 * Universal mirror: write the new `read` / `write` Visibility values
 * into the entity's `Permissions` trait. Partial events (only one
 * axis set) preserve the other axis's current value.
 *
 * No-op when the entity has been despawned between dispatch and apply.
 */
export const PermissionsChangeSystem = defineSystem({
  name: "PermissionsChange",
  on: PermissionsChanged,
  reads: [Permissions],
  writes: [Permissions],
  run: ({ event, world }) => {
    if (!world.has(event.entityId)) return [];
    const cur = world.get(event.entityId, [Permissions]) as
      | { Permissions: { read: Visibility; write: Visibility } }
      | undefined;
    if (!cur) return [];
    world.set(event.entityId, Permissions, {
      read: event.read ?? cur.Permissions.read,
      write: event.write ?? cur.Permissions.write,
    });
    return [];
  },
});
