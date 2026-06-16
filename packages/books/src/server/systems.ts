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

import { defineSystem } from "@vtt/substrate";
import { ownedBy, Permissions } from "@vtt/permissions/shared";
import { BookCanonicalChanged, BookCreated, BookRemoved, BookUpdated } from "../shared/events.js";
import { Book, BookCanonical } from "../shared/traits.js";

/**
 * Universal mirror system: spawns the Book entity on every side
 * (server and every client) on BookCreated. All sides spawn in
 * lockstep on the same event order, so the resulting EntityId matches
 * across worlds.
 *
 * Default Permissions: `read: everyone, write: users:[creator]`. The
 * chrome PermissionsMenu can flip read to gmOnly() / users:[…] later.
 */
export const BookSpawningSystem = defineSystem({
  name: "BookSpawning",
  on: BookCreated,
  reads: [],
  writes: [Book, Permissions],
  run: ({ event, world }) => {
    world.spawnAt(event.bookId, [
      Book({ name: event.name }),
      Permissions(ownedBy(event.createdByUserId)),
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
    const got = world.get(event.bookId, [Book]) as { Book: { name: string } } | undefined;
    if (!got) return [];
    world.set(event.bookId, Book, {
      name: event.name ?? got.Book.name,
    });
    return [];
  },
});

/**
 * Universal mirror: adds, replaces, or removes the BookCanonical trait
 * on the bound Book entity. The validate step in SetBookCanonical
 * already enforces uniqueness, so a single set/remove call is enough —
 * any prior holder of the same canonicalId would have been unbound
 * first by a prior command.
 *
 * No-op if the book id has been despawned between dispatch and
 * application (the BookCanonical trait simply never gets attached).
 */
export const BookCanonicalSystem = defineSystem({
  name: "BookCanonical",
  on: BookCanonicalChanged,
  reads: [],
  writes: [BookCanonical],
  run: ({ event, world }) => {
    if (!world.has(event.bookId)) return [];
    if (event.canonicalId === null) {
      if (world.get(event.bookId, [BookCanonical])) {
        world.remove(event.bookId, BookCanonical);
      }
      return [];
    }
    world.set(event.bookId, BookCanonical, {
      canonicalId: event.canonicalId,
    });
    return [];
  },
});
