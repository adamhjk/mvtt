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

import { defineSystem } from "@vtt/substrate";
import {
  BookCreated,
  BookRemoved,
  BookUpdated,
} from "../shared/events.js";
import { Book } from "../shared/traits.js";

/**
 * Universal mirror system: spawns the Book entity on every side
 * (server and every client) on BookCreated. All sides spawn in
 * lockstep on the same event order, so the resulting EntityId matches
 * across worlds.
 */
export const BookSpawningSystem = defineSystem({
  name: "BookSpawning",
  on: BookCreated,
  reads: [],
  writes: [Book],
  run: ({ event, world }) => {
    world.spawnAt(event.bookId, [
      Book({ name: event.name }),
    ]);
    return [];
  },
});

/**
 * Universal mirror: despawns the Book entity. Projection plugins
 * (e.g. @vtt/pdf-book) listen to BookRemoved separately and despawn
 * any sibling content traits keyed by bookId — this system doesn't
 * reach across plugin boundaries.
 */
export const BookRemovalSystem = defineSystem({
  name: "BookRemoval",
  on: BookRemoved,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.bookId)) world.despawn(event.bookId);
    return [];
  },
});

/**
 * Universal mirror: merges supplied BookUpdated fields over the
 * current Book trait. Missing fields keep their existing value, so
 * the Config tab can dispatch UpdateBook with just one field changed
 * without clobbering the rest. No-op if the book id has been
 * despawned.
 */
export const BookUpdateSystem = defineSystem({
  name: "BookUpdate",
  on: BookUpdated,
  reads: [Book],
  writes: [Book],
  run: ({ event, world }) => {
    const got = world.get(event.bookId, [Book]) as
      | { Book: { name: string } }
      | undefined;
    if (!got) return [];
    world.set(event.bookId, Book, {
      name: event.name ?? got.Book.name,
    });
    return [];
  },
});
