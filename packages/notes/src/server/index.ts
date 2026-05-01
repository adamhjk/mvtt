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

export {
  EditBeginSystem,
  EditEndSystem,
  EditExtendSystem,
  LockReleaseSystem,
  NoteDeleteSystem,
  NoteRenameSystem,
  NoteSpawnSystem,
  NoteVisibilityChangeSystem,
  PageBodyMirrorSystem,
  PageDraftMirrorSystem,
  PageHeadingsSystem,
  PageHistoryAppendSystem,
  PageRemoveSystem,
  PageRenameSystem,
  PageReorderSystem,
  PageSpawnSystem,
  PageVisibilityChangeSystem,
} from "./systems.js";
export { NotesSearchIndex } from "./search.js";
export type { SearchHit } from "./search.js";
export { attachNotesSearchBridge } from "./search-bridge.js";
export { handleNotesSearch } from "./search-routes.js";
export type {
  AuthenticateForWorld as NotesAuthenticateForWorld,
  NotesSearchDeps,
} from "./search-routes.js";
