// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { defineEvent, EntityId, z } from "@vtt/substrate";

/**
 * Book-level events. `bookId` is allocated by the server's command
 * `apply` (via `world.allocateId()`) and embedded in the event so every
 * recipient spawns at the same id via `spawnAt`.
 */
export const BookCreated = defineEvent({
  name: "@vtt/books/BookCreated",
  schema: z.object({
    bookId: EntityId,
    name: z.string(),
    createdByUserId: z.string(),
  }),
});

export const BookRemoved = defineEvent({
  name: "@vtt/books/BookRemoved",
  schema: z.object({
    bookId: EntityId,
  }),
});

/**
 * The GM edited one or more fields of an existing book. Each field is
 * optional; the BookUpdate system merges the supplied values over the
 * current Book trait. v0 only has `name`; future fields (cover image,
 * summary, tags) plug in here without a new event.
 */
export const BookUpdated = defineEvent({
  name: "@vtt/books/BookUpdated",
  schema: z.object({
    bookId: EntityId,
    name: z.string().min(1).max(160).optional(),
  }),
});
