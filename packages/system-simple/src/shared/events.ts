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

import { defineEvent, EntityId, z } from "@vtt/substrate";

/**
 * Emitted when the MaxHp derivation recomputes a new value. Other
 * systems can react (e.g., a hypothetical "you gained max HP" feed)
 * by listening for this event.
 */
export const MaxHpChanged = defineEvent({
  name: "@vtt/system-simple/MaxHpChanged",
  schema: z.object({
    entityId: EntityId,
    value: z.number().int(),
  }),
});
