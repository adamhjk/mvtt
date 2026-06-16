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

export {
  defineBlockKind,
  buildBlockKindIndex,
  buildBlockKindIndexFromPlugins,
  BlockKindsSlot,
  type AnyBlockKindDef,
  type BlockKindContext,
  type BlockKindDef,
  type BlockKindIndex,
  type BlockAction,
  type EntityProjection,
} from "./block-kinds.js";
export { wikiLink, dice, readBrand } from "./brands.js";
export { schemaToFields, describeType } from "./schema-to-fields.js";
export { blockReferenceProvider, buildBlockReferenceSections } from "./block-reference-provider.js";
export {
  AdventureProvenance,
  BLOCK_ENTITY_INDEX_ID,
  BlockEntityIndex,
  EncounterTemplate,
  LootParcel,
  PageBlocks,
  Tombstoned,
} from "./traits.js";
export { BlockEntityTombstoned, BlockEntityUpserted, PageBlocksParsed } from "./events.js";
export { scanFencedBlocks, slugifyInfo, type FencedBlock } from "./parse-blocks.js";
export { prepareYaml, restoreWikiLinks, type WikiLinkTable } from "./yaml-wikilinks.js";
