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

import { type EntityId } from "@vtt/substrate";
import { defineLinkKind, type LinkSuggestion } from "@vtt/notes/shared";
import { Book, BookCanonical } from "./traits.js";
import { BookCanonicalChanged, BookCreated, BookRemoved, BookUpdated } from "./events.js";
import { publishBookNav } from "./pending-nav.js";

/**
 * A resolved book reference. The optional `page` and `tocTitle` hints
 * come from the wiki-link's anchor: `[[book:Name#42]]` resolves with
 * `page=42`, `[[book:Name#Chapter 1]]` resolves with `tocTitle="Chapter 1"`.
 * The two are mutually exclusive — the parser picks page when the anchor
 * is a bare integer, otherwise tocTitle.
 */
interface BookRef {
  readonly bookId: EntityId;
  readonly page?: number;
  readonly tocTitle?: string;
}

const BOOKS_PAGE_KIND = "@vtt/books/books";

/**
 * Book link kind. Resolves `[[book:Player's Handbook]]` (entity-id and
 * canonical-id bodies are also accepted) and supports two anchor forms:
 *
 *   - `[[book:Name#42]]` — open the book at page 42.
 *   - `[[book:Name#Chapter 1]]` — open the book and jump to the TOC
 *     entry whose title matches "Chapter 1" (case-insensitive). Falls
 *     through silently if the PDF has no embedded outline or no
 *     matching entry.
 *
 * Body resolution tries three forms in order:
 *
 *   1. Entity id (`e123`) — direct lookup. Stable inside a world but
 *      doesn't survive a bundle round-trip into another world.
 *   2. Canonical id (`tb/book/scholars-guide`) — looks up the Book
 *      entity currently bound to that canonical role via the
 *      `BookCanonical` trait. This is the portable form — adventure
 *      bundles, catalog seeds, and plugin content cite the canonical
 *      id so the same content resolves in any world where the GM has
 *      uploaded and bound the rulebook.
 *   3. Case-insensitive name match against `Book.name` — the form a
 *      GM types into `[[`-autocomplete.
 *
 * Click semantics: navigate. The notes dispatcher routes a navigate
 * activation to OpenPage (focus an existing tab pointing at this book
 * or open a fresh one). The page/TOC hint is published as a session-
 * local signal (`pendingBookNav`) which the projection view consumes
 * once the doc — and, for TOC nav, the outline — is ready. The hint
 * is transient (published, consumed, cleared) so it lives in a
 * session signal rather than a trait — see `pending-nav.ts`.
 */
export const bookLinkKind = defineLinkKind<BookRef>({
  name: "book",
  parse: (body, anchor, world) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return null;
    let bookId: EntityId | null = null;
    if (/^e\d+$/.test(trimmed) && world.has(trimmed as EntityId)) {
      const got = world.get(trimmed as EntityId, [Book]);
      if (got) bookId = trimmed as EntityId;
    }
    // Canonical-id form. A `/` in the body is the cheap discriminator
    // — display names virtually never contain one, plugin canonical
    // ids always do (e.g. `tb/book/scholars-guide`).
    if (bookId === null && trimmed.includes("/")) {
      for (const row of world.query([Book, BookCanonical])) {
        const v = row.values.BookCanonical as { canonicalId: string };
        if (v.canonicalId === trimmed) {
          bookId = row.id;
          break;
        }
      }
    }
    if (bookId === null) {
      const needle = trimmed.toLowerCase();
      for (const row of world.query([Book])) {
        const v = row.values.Book as { name: string };
        if (v.name.toLowerCase() === needle) {
          bookId = row.id;
          break;
        }
      }
    }
    if (bookId === null) return null;

    if (anchor === null || anchor.trim().length === 0) {
      return { bookId };
    }
    const a = anchor.trim();
    const asInt = /^\d+$/.test(a) ? Number.parseInt(a, 10) : null;
    if (asInt !== null && asInt >= 1) {
      return { bookId, page: asInt };
    }
    return { bookId, tocTitle: a };
  },
  display: (ref, world) => {
    const got = world.get(ref.bookId, [Book]) as { Book: { name: string } } | undefined;
    const base = got?.Book.name ?? "(missing book)";
    if (ref.page !== undefined) return `${base} · p${ref.page}`;
    if (ref.tocTitle !== undefined) return `${base} · ${ref.tocTitle}`;
    return base;
  },
  target: (ref) => ({ entityId: ref.bookId }),
  activate: (ref) => {
    if (ref.page !== undefined || ref.tocTitle !== undefined) {
      // Side effect: publish before the dispatcher fires OpenPage.
      // The projection view (already mounted, or freshly mounted by
      // OpenPage creating a tab) reads the signal in a createEffect
      // and applies the navigation as soon as the doc is ready.
      publishBookNav({
        bookId: ref.bookId,
        ...(ref.page !== undefined ? { page: ref.page } : {}),
        ...(ref.tocTitle !== undefined ? { tocTitle: ref.tocTitle } : {}),
      });
    }
    return {
      type: "navigate",
      pageKind: BOOKS_PAGE_KIND,
      entityId: ref.bookId,
    };
  },
  autocomplete: (query, world) => {
    const needle = query.trim().toLowerCase();
    const out: LinkSuggestion[] = [];
    for (const row of world.query([Book])) {
      const v = row.values.Book as { name: string };
      if (needle.length > 0 && !v.name.toLowerCase().includes(needle)) continue;
      out.push({
        kind: "book",
        body: v.name,
        display: v.name,
        badge: "Book",
      });
    }
    return out;
  },
  indexEvents: [BookCreated.name, BookRemoved.name, BookUpdated.name, BookCanonicalChanged.name],
});
