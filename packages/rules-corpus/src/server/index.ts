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

export { RulesSearchIndex } from "./search-index.js";
export type { RulesChunkRow, RulesSearchHit } from "./search-index.js";
export {
  CorpusSpawningSystem,
  CorpusStatusMirror,
  CorpusFailureMirror,
  CorpusDespawnSystem,
} from "./systems.js";
export { RulesExtractRunner } from "./extract-runner.js";
export { handleRulesSearch } from "./routes.js";
export type { RulesSearchDeps, AuthenticateForWorld } from "./routes.js";
