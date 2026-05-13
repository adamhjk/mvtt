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
  BlockParseSystem,
  PageBlocksMirrorSystem,
  blockEntityId,
  runBlockParse,
} from "./block-parse-system.js";
export {
  buildBundle,
  bundleFromJson,
  bundleToJson,
  computeReferenceClosure,
  importBundle,
  sha256Hex,
  BundleManifestSchema,
  type AdventureBundle,
  type BundleManifest,
  type BuildBundleOptions,
  type ReferenceClosure,
} from "./bundle.js";
export {
  applyUpdateResolution,
  computeUpdateDiff,
  type BlockDiff,
  type NoteDiff,
  type NoteDiffKind,
  type NoteResolution,
  type UpdateDiff,
} from "./update-diff.js";
export { bundleToZip, zipToBundle } from "./zip.js";
// `buildBundleFromDir` lives at `@vtt/adventures/server/build-from-dir`
// because it pulls in node-only modules (fs, crypto, path). Importing
// it from the main `./server` export would leak `node:*` into every
// downstream package that uses adventures server-side, breaking
// `noUncheckedIndexedAccess`-strict typechecks in plugins that don't
// install `@types/node`.
// Note: routes (which use `node:http`) are NOT re-exported here.
// Import them via `@vtt/adventures/routes` instead. Keeping the
// server/index.ts free of node-only types means system plugins can
// pull in `@vtt/adventures` for trait/event/system shapes without
// dragging in @types/node.
