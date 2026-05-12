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
import {
  EditorCompletionSourcesSlot,
  MarkdownPostRenderSlot,
  NotesReferenceSlot,
} from "@vtt/notes/shared";
import {
  AdventureProvenance,
  BlockEntityIndex,
  BlockEntityTombstoned,
  BlockEntityUpserted,
  blockReferenceProvider,
  BlockKindsSlot,
  EncounterTemplate,
  LootParcel,
  PageBlocks,
  PageBlocksParsed,
  Tombstoned,
} from "./shared/index.js";
import { BlockParseSystem, PageBlocksMirrorSystem } from "./server/index.js";
import { blockWidgetPostRender } from "./client/block-widget.js";
import { yamlBlockCompletionFactory } from "./client/yaml-block-completion.js";

/**
 * `@vtt/adventures` — universal-infrastructure plugin that turns
 * fenced markdown blocks into real entities.
 *
 * Loads on every world (gameSystem-agnostic). Game-system plugins
 * (e.g. `@vtt/system-torchbearer`) contribute fenced-block kinds via
 * `BlockKindsSlot`; the parse system materialises them into entities
 * the moment a note is saved.
 *
 * See `design/adventures.md` for the full architecture.
 */
export const adventures = definePlugin({
  name: "@vtt/adventures",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/notes@^0",
    "@vtt/permissions@^0",
  ],
  traits: [
    AdventureProvenance,
    BlockEntityIndex,
    EncounterTemplate,
    LootParcel,
    PageBlocks,
    Tombstoned,
  ],
  events: [
    BlockEntityUpserted,
    BlockEntityTombstoned,
    PageBlocksParsed,
  ],
  commands: [],
  systems: [BlockParseSystem, PageBlocksMirrorSystem],
  slots: [BlockKindsSlot],
  fills: {
    [MarkdownPostRenderSlot.name]: [blockWidgetPostRender],
    [EditorCompletionSourcesSlot.name]: [yamlBlockCompletionFactory],
    [NotesReferenceSlot.name]: [blockReferenceProvider],
  },
});

export default adventures;
