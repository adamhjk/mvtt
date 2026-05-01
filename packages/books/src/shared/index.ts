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

export { Book } from "./traits.js";
export {
  BookCreated,
  BookRemoved,
  BookUpdated,
} from "./events.js";
export {
  CreateBook,
  RemoveBook,
  UpdateBook,
} from "./commands.js";
export {
  BooksUiState,
  BooksUiStateChanged,
  BooksUiStateMirror,
  SetBooksUiState,
} from "./ui-state.js";
export { BookCanvasSurface } from "./surfaces.js";
export {
  BookOverlayTabsSlot,
  type BookOverlayTab,
  type BookOverlayTabRenderArgs,
  BookConfigSectionsSlot,
  type BookConfigSection,
  type BookConfigSectionRenderArgs,
} from "./slot.js";
export { bookLinkKind } from "./book-link-kind.js";
export {
  pendingBookNav,
  publishBookNav,
  clearBookNav,
  type PendingBookNav,
  __resetPendingBookNavForTests,
} from "./pending-nav.js";
