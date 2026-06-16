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

import { defineCommand, EntityId, fail, ok, z } from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { requireWrite } from "@vtt/permissions/shared";
import { BookCanonicalChanged, BookCreated, BookRemoved, BookUpdated } from "./events.js";
import { BookCanonical, CanonicalBookCatalog } from "./traits.js";

/**
 * Any authenticated user may create a book. Recording system spawns
 * the Book entity in lockstep with `Permissions(ownedBy(creator))` —
 * the creator is the sole writer until they share via the chrome's
 * PermissionsMenu. GMs always pass.
 */
export const CreateBook = defineCommand({
  name: "@vtt/books/CreateBook",
  schema: z.object({
    name: z.string().min(1).max(160),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    return ok();
  },
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
 * Editor-gated (`requireWrite`): delete a book. Tabs still pointing at
 * the removed bookId silently fall back to the empty state (mirrors
 * RemoveScene's behaviour). Projection plugins (e.g. @vtt/pdf-book)
 * react to BookRemoved in their own systems to despawn associated
 * content traits — books don't reach across plugin boundaries.
 */
export const RemoveBook = defineCommand({
  name: "@vtt/books/RemoveBook",
  schema: z.object({
    bookId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.bookId)) {
      return fail(`book ${ctx.cmd.bookId} does not exist`);
    }
    return requireWrite(ctx, ctx.cmd.bookId);
  },
  apply: ({ cmd }) => [BookRemoved({ bookId: cmd.bookId })],
});

/**
 * GM-only: bind (or unbind) a canonicalId to a Book entity. The
 * canonicalId is a plugin-namespaced shorthand a plugin's content uses
 * to deep-link into the GM's PDF (e.g. a TB monster's special-rule row
 * citing "tb/book/scholars-guide" page 178).
 *
 * Validation:
 *   - GM-only (canonicals are world-shaping, not per-Book ownership).
 *   - Book must exist.
 *   - When canonicalId is non-null:
 *     - It must be present in some plugin's CanonicalBookCatalog
 *       sentinel (no inventing arbitrary ids).
 *     - No other Book in the world may already hold the same id.
 *   - When canonicalId is null, the binding is cleared (the
 *     universal-mirror system removes the BookCanonical trait).
 *
 * Note: re-binding to the *same* id this Book already holds is a
 * no-op pass-through (the validate step skips the uniqueness scan
 * when the only holder is this Book).
 */
export const SetBookCanonical = defineCommand({
  name: "@vtt/books/SetBookCanonical",
  schema: z.object({
    bookId: EntityId,
    canonicalId: z.string().min(1).max(240).nullable(),
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") {
      return fail("only a GM can bind canonical books");
    }
    if (!ctx.world.has(ctx.cmd.bookId)) {
      return fail(`book ${ctx.cmd.bookId} does not exist`);
    }
    const next = ctx.cmd.canonicalId;
    if (next !== null) {
      let registered = false;
      for (const row of ctx.world.query([CanonicalBookCatalog])) {
        const v = row.values.CanonicalBookCatalog as {
          entries: ReadonlyArray<{ id: string; name: string }>;
        };
        if (v.entries.some((e) => e.id === next)) {
          registered = true;
          break;
        }
      }
      if (!registered) {
        return fail(`unknown canonical book id: ${next}`);
      }
      for (const row of ctx.world.query([BookCanonical])) {
        if (row.id === ctx.cmd.bookId) continue;
        const v = row.values.BookCanonical as { canonicalId: string };
        if (v.canonicalId === next) {
          return fail(`canonical book ${next} is already bound to ${row.id}`);
        }
      }
    }
    return ok();
  },
  apply: ({ cmd }) => [
    BookCanonicalChanged({
      bookId: cmd.bookId,
      canonicalId: cmd.canonicalId,
    }),
  ],
});

/**
 * Editor-gated: rename (or otherwise edit) an existing book. Used by
 * the Config dock tab.
 */
export const UpdateBook = defineCommand({
  name: "@vtt/books/UpdateBook",
  schema: z.object({
    bookId: EntityId,
    name: z.string().min(1).max(160).optional(),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.bookId)) {
      return fail(`book ${ctx.cmd.bookId} does not exist`);
    }
    return requireWrite(ctx, ctx.cmd.bookId);
  },
  apply: ({ cmd }) => {
    const payload: { bookId: typeof cmd.bookId; name?: string } = {
      bookId: cmd.bookId,
    };
    if (cmd.name !== undefined) payload.name = cmd.name;
    return [BookUpdated(payload)];
  },
});
