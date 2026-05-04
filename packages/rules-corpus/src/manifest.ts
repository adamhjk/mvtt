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
import { RulesLibrary, RulesCorpus } from "./shared/traits.js";
import { RulesPageProvider } from "./client/index.js";
import {
  RulesIndexingStarted,
  RulesIndexingCompleted,
  RulesIndexingFailed,
  RulesCorpusRemoved,
} from "./shared/events.js";
import {
  IndexRules,
  MarkRulesIndexingCompleted,
  MarkRulesIndexingFailed,
  RemoveRulesCorpus,
} from "./shared/commands.js";
import {
  CorpusSpawningSystem,
  CorpusStatusMirror,
  CorpusFailureMirror,
  CorpusDespawnSystem,
} from "./server/systems.js";

/**
 * Rules corpus plugin: extracts rule text from PDF assets,
 * indexes chunks via SQLite FTS5, and exposes search to both the
 * runtime UI (HTTP route) and the dev-time `rules-lookup` skill.
 *
 * Server-only extraction work (subprocess invocation, FTS5 inserts,
 * disk cleanup) lives outside the universal manifest — see
 * `@vtt/rules-corpus/server` for the wiring surface that
 * `@vtt/server` plugs into the world runtime.
 */
export const rulesCorpus = definePlugin({
  name: "@vtt/rules-corpus",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    "@vtt/assets@^0",
    "@vtt/shell-workbench@^0",
  ],
  traits: [RulesLibrary, RulesCorpus],
  events: [
    RulesIndexingStarted,
    RulesIndexingCompleted,
    RulesIndexingFailed,
    RulesCorpusRemoved,
  ],
  commands: [
    IndexRules,
    RemoveRulesCorpus,
    MarkRulesIndexingCompleted,
    MarkRulesIndexingFailed,
  ],
  systems: [
    CorpusSpawningSystem,
    CorpusStatusMirror,
    CorpusFailureMirror,
    CorpusDespawnSystem,
  ],
  fills: {
    [PagesSlot.name]: [RulesPageProvider],
  },
});

export default rulesCorpus;
