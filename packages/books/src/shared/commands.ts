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

import {
  defineCommand,
  EntityId,
  fail,
  ok,
  z,
} from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { requireRole } from "@vtt/permissions/shared";
import {
  BookCreated,
  BookRemoved,
  BookUpdated,
} from "./events.js";

/**
 * GM-only: create a new book. Recording system spawns the Book entity
 * in lockstep on every side; subsequent commands reference the id
 * directly.
 */
export const CreateBook = defineCommand({
  name: "@vtt/books/CreateBook",
  schema: z.object({
    name: z.string().min(1).max(160),
  }),
  validate: (ctx) => requireRole(ctx, "gm"),
  apply: ({ cmd, session, world }) => {
    const auth = requireSession({ session })!;
    return [
      BookCreated({
        bookId: world.allocateId(),
        name: cmd.name,
        createdByUserId: auth.userId,
      }),
    ];
  },
});

/**
 * GM-only: delete a book. Tabs still pointing at the removed bookId
 * silently fall back to the empty state (mirrors RemoveScene's
 * behaviour). Projection plugins (e.g. @vtt/pdf-book) react to
 * BookRemoved in their own systems to despawn associated content
 * traits — books don't reach across plugin boundaries.
 */
export const RemoveBook = defineCommand({
  name: "@vtt/books/RemoveBook",
  schema: z.object({
    bookId: EntityId,
  }),
  validate: (ctx) => {
    const role = requireRole(ctx, "gm");
    if (!role.ok) return role;
    if (!ctx.world.has(ctx.cmd.bookId)) {
      return fail(`book ${ctx.cmd.bookId} does not exist`);
    }
    return ok();
  },
  apply: ({ cmd }) => [BookRemoved({ bookId: cmd.bookId })],
});

/**
 * GM-only: rename (or otherwise edit) an existing book. Used by the
 * Config dock tab.
 */
export const UpdateBook = defineCommand({
  name: "@vtt/books/UpdateBook",
  schema: z.object({
    bookId: EntityId,
    name: z.string().min(1).max(160).optional(),
  }),
  validate: (ctx) => {
    const role = requireRole(ctx, "gm");
    if (!role.ok) return role;
    if (!ctx.world.has(ctx.cmd.bookId)) {
      return fail(`book ${ctx.cmd.bookId} does not exist`);
    }
    return ok();
  },
  apply: ({ cmd }) => {
    const payload: { bookId: typeof cmd.bookId; name?: string } = {
      bookId: cmd.bookId,
    };
    if (cmd.name !== undefined) payload.name = cmd.name;
    return [BookUpdated(payload)];
  },
});
