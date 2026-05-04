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

import { defineCommand, EntityId, fail, z } from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { requireWrite } from "./checks.js";
import { PermissionsChanged } from "./events.js";
import { Permissions } from "./traits.js";
import { VisibilityShape } from "./visibility.js";

/**
 * The universal verb for changing access on any gate-able entity:
 * notes, characters, scene tokens, workbench tab sentinels, custom
 * plugin entities. The workbench's `<PermissionsMenu>` dispatches
 * this; plugins may also dispatch it from their own UI.
 *
 * Either or both of `read`/`write` may be set — partial. Empty (both
 * undefined) is rejected at the schema layer to surface mistakes early.
 *
 * Gated by `requireWrite(entityId)` — the dispatcher must already be
 * able to write the entity to flip permissions on it. GMs bypass
 * universally.
 */
export const SetPermissions = defineCommand({
  name: "@vtt/permissions/SetPermissions",
  schema: z
    .object({
      entityId: EntityId,
      read: VisibilityShape.optional(),
      write: VisibilityShape.optional(),
    })
    .refine((v) => v.read !== undefined || v.write !== undefined, {
      message: "SetPermissions requires at least one of read/write",
    }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.entityId)) {
      return fail(`entity ${ctx.cmd.entityId} does not exist`);
    }
    // The entity must already carry Permissions; this command flips
    // an existing record rather than creating one (creation is the
    // owning plugin's responsibility, at spawn time).
    const has = ctx.world.get(ctx.cmd.entityId, [Permissions]);
    if (!has) {
      return fail(
        `entity ${ctx.cmd.entityId} has no Permissions trait — only the spawning plugin may attach it`,
      );
    }
    return requireWrite(ctx, ctx.cmd.entityId);
  },
  apply: ({ cmd }) => [
    PermissionsChanged({
      entityId: cmd.entityId,
      read: cmd.read,
      write: cmd.write,
    }),
  ],
});
