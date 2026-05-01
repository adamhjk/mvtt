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
import { LinkKindsSlot } from "@vtt/notes/shared";
import { Book } from "./shared/traits.js";
import { bookLinkKind } from "./shared/book-link-kind.js";
import {
  BookCreated,
  BookRemoved,
  BookUpdated,
} from "./shared/events.js";
import {
  CreateBook,
  RemoveBook,
  UpdateBook,
} from "./shared/commands.js";
import {
  BooksUiState,
  BooksUiStateChanged,
  BooksUiStateMirror,
  SetBooksUiState,
} from "./shared/ui-state.js";
import { BookCanvasSurface } from "./shared/surfaces.js";
import { BookConfigSectionsSlot, BookOverlayTabsSlot } from "./shared/slot.js";
import {
  BookSpawningSystem,
  BookRemovalSystem,
  BookUpdateSystem,
} from "./server/systems.js";
import {
  BooksPageProvider,
  ConfigOverlayTab,
  BookCanvasFallbackView,
} from "./client/index.js";

export const books = definePlugin({
  name: "@vtt/books",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    "@vtt/shell-workbench@^0",
    "@vtt/notes@^0",
  ],
  traits: [Book, BooksUiState],
  events: [BookCreated, BookRemoved, BookUpdated, BooksUiStateChanged],
  commands: [CreateBook, RemoveBook, UpdateBook, SetBooksUiState],
  systems: [
    BookSpawningSystem,
    BookRemovalSystem,
    BookUpdateSystem,
    BooksUiStateMirror,
  ],
  surfaces: [BookCanvasSurface],
  slots: [BookOverlayTabsSlot, BookConfigSectionsSlot],
  views: [BookCanvasFallbackView],
  fills: {
    [PagesSlot.name]: [BooksPageProvider],
    [BookOverlayTabsSlot.name]: [ConfigOverlayTab],
    [LinkKindsSlot.name]: [bookLinkKind],
  },
});

export default books;
