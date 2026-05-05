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

import { definePlugin } from "@vtt/substrate";
import { PagesSlot } from "@vtt/shell-workbench/shared";
import { ItemsPageProvider } from "./client/index.js";

/**
 * Sibling plugin for `@vtt/items` that fills the workbench's
 * PagesSlot with the Items page provider. Kept separate from the
 * core `items` plugin so test fixtures can load the trait/event/
 * command/system surface without dragging shell-workbench (and its
 * auth/identity/permissions transitive deps) into every unit test
 * that touches an item.
 *
 * Game systems that want the Items workbench tab in their world
 * should add `@vtt/items-pages@^0` to their `dependsOn`. The server
 * loads it as an optional plugin so the active-plugin resolver can
 * pull it in transitively.
 */
export const itemsPages = definePlugin({
  name: "@vtt/items-pages",
  version: "0.1.0",
  dependsOn: ["@vtt/substrate@^0", "@vtt/items@^0", "@vtt/shell-workbench@^0"],
  fills: {
    [PagesSlot.name]: [ItemsPageProvider],
  },
});

export default itemsPages;
