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

import { definePlugin, type Visibility } from "@vtt/substrate";
import { Permissions } from "./shared/traits.js";
import { PermissionsChanged } from "./shared/events.js";
import { SetPermissions } from "./shared/commands.js";
import { PermissionsChangeSystem } from "./server/systems.js";

/**
 * Permissions is the *contract* plugin — the one `Permissions` trait,
 * the universal `SetPermissions` command, and the entity-visibility
 * resolver that the substrate uses for per-recipient snapshot
 * filtering.
 *
 * The substrate stays trait-agnostic: it just runs the resolver
 * registered below to translate `Permissions.read` into the substrate's
 * `Visibility` union. GM bypass is applied by the substrate's snapshot
 * filter (in `dumpForRecipient`), not by this resolver — so the
 * resolver remains a pure mapping from traits to Visibility.
 */
export const permissions = definePlugin({
  name: "@vtt/permissions",
  version: "0.1.0",
  dependsOn: ["@vtt/substrate@^0", "@vtt/auth@^0", "@vtt/identity@^0"],
  traits: [Permissions],
  events: [PermissionsChanged],
  commands: [SetPermissions],
  systems: [PermissionsChangeSystem],
  entityVisibility: (traits) => {
    const p = traits[Permissions.name] as
      | { read: Visibility; write: Visibility }
      | undefined;
    return p?.read ?? null;
  },
});

export default permissions;
