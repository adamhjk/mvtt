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

import type { EntityId, World } from "@vtt/substrate";
import { Active } from "./traits.js";

/**
 * BC-friendly active check. Returns:
 *   - the stored `active` value when the trait is attached, OR
 *   - `true` when the trait is missing (legacy entities, plus any
 *     entity that has never had the toggle touched).
 *
 * Pickers should treat the negative case as "hide". Library pages
 * (Bestiary, NPCs) ignore this and show every entity.
 */
export function isActive(world: World, id: EntityId): boolean {
  const got = world.get(id, [Active]) as
    | { Active: { active: boolean } }
    | undefined;
  if (!got) return true;
  return got.Active.active !== false;
}

/**
 * Read the `active` flag verbatim. Returns `null` when the trait is
 * missing — useful for the toggle UI, which renders "default active"
 * subtly when the entity has never had the flag set explicitly so the
 * GM knows a write is needed to flip it.
 */
export function readActive(world: World, id: EntityId): boolean | null {
  const got = world.get(id, [Active]) as
    | { Active: { active: boolean } }
    | undefined;
  if (!got) return null;
  return got.Active.active !== false;
}
