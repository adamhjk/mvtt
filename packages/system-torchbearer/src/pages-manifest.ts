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
import { ConflictPageProvider } from "./conflict/client/index.js";
import { ArcanePageProvider } from "./client/arcane-page.js";
import { MonstersPageProvider } from "./client/monsters-page.js";
import { InvocationsPageProvider } from "./client/invocations-page.js";
import { NpcsPageProvider } from "./client/npcs-page.js";

/**
 * Sibling plugin that fills the workbench's PagesSlot with the
 * Torchbearer Conflict (Reference Board) page provider. Kept
 * separate from `@vtt/system-torchbearer` so unit / harness tests
 * can load the rule traits, commands, events, and systems without
 * dragging shell-workbench (and its transitive UI deps) into every
 * test environment.
 *
 * Worlds whose game system is `@vtt/system-torchbearer` get this
 * plugin loaded too via the active-plugin resolver — see
 * @vtt/server's main.ts for the full activeServerPlugins list.
 */
export const systemTorchbearerPages = definePlugin({
  name: "@vtt/system-torchbearer-pages",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/system-torchbearer@^0",
    "@vtt/shell-workbench@^0",
  ],
  fills: {
    [PagesSlot.name]: [
      ConflictPageProvider,
      MonstersPageProvider,
      NpcsPageProvider,
      ArcanePageProvider,
      InvocationsPageProvider,
    ],
  },
});

export default systemTorchbearerPages;
