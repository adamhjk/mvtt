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
import { VisibilityShape } from "./visibility.js";

/**
 * Emitted by `SetPermissions.apply`. Either or both of `read` / `write`
 * may be present — the partial form lets the workbench UI flip just one
 * axis without restating the other.
 */
export const PermissionsChanged = defineEvent({
  name: "@vtt/permissions/PermissionsChanged",
  schema: z.object({
    entityId: EntityId,
    read: VisibilityShape.optional(),
    write: VisibilityShape.optional(),
  }),
});
