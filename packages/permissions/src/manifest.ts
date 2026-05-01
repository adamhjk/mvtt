// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { definePlugin, type Visibility } from "@vtt/substrate";
import { EntityVisibility, OwnedBy } from "./shared/traits.js";

/**
 * Permissions is the *contract* plugin — visibility builders, ownership
 * traits, and the entity-visibility resolver that the substrate uses for
 * per-recipient snapshot filtering. The substrate stays trait-agnostic:
 * it just runs the resolver permissions registers below to translate
 * `EntityVisibility{visibility}` into the substrate's union shape.
 */
export const permissions = definePlugin({
  name: "@vtt/permissions",
  version: "0.1.0",
  dependsOn: ["@vtt/substrate@^0", "@vtt/auth@^0", "@vtt/identity@^0"],
  traits: [OwnedBy, EntityVisibility],
  entityVisibility: (traits) => {
    const ev = traits[EntityVisibility.name] as
      | { visibility: Visibility }
      | undefined;
    return ev?.visibility ?? null;
  },
});

export default permissions;
