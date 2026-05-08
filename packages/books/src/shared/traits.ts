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

import { defineTrait, z } from "@vtt/substrate";

/**
 * A Book is a slot for a chunk of long-form content (a PDF, a markdown
 * file, a stat block list — whichever projection plugin claims the
 * BookCanvasSurface). The trait itself only carries human-facing
 * metadata; the actual content lives in a sibling trait owned by a
 * projection plugin (e.g. @vtt/pdf-book's PdfDocument trait, keyed by
 * bookId).
 *
 * Books are the "Scenes for reference material." Each Book becomes one
 * tab in the workbench's Books page. v0 ships no built-in projection;
 * load @vtt/pdf-book (or any other projection plugin) to fill the
 * canvas surface.
 */
export const Book = defineTrait({
  name: "@vtt/books/Book",
  schema: z.object({
    name: z.string().min(1).max(160),
  }),
});

/**
 * Lazily attached to a Book entity once the GM declares "this is *the*
 * Loremaster's Manual for this world" (or whichever canonical book id
 * a plugin has registered). At most one Book per world may carry any
 * given canonicalId — uniqueness is enforced by SetBookCanonical's
 * validate step.
 *
 * `canonicalId` is a plugin-namespaced shorthand like
 * "tb/book/scholars-guide". The space of valid ids is contributed by
 * plugin manifests via `seedCanonicalBookCatalog` (a sentinel trait
 * the dropdown reads at config time). Plugin content (a monster, a
 * spell, a class ability) references the canonicalId as a constant in
 * code; resolution to a concrete Book entity happens at view time so
 * the same content survives a different GM uploading the same
 * rulebook in a different world.
 */
export const BookCanonical = defineTrait({
  name: "@vtt/books/BookCanonical",
  schema: z.object({
    canonicalId: z.string().min(1).max(240),
  }),
});

/**
 * Sentinel trait — exactly one entity per registering plugin per
 * world — listing the canonical book ids that plugin contributes.
 * Drives the Config-tab dropdown (entries the GM may pick from) and
 * SetBookCanonical's validate step (rejects ids that no plugin has
 * registered).
 *
 * The trait is intentionally inert metadata: spawning the sentinel is
 * the responsibility of each plugin's `seed` (or any other write
 * path), via `seedCanonicalBookCatalog`. Mirroring `ItemCatalogIndex`,
 * this trait is plain world data — no substrate-level support
 * required.
 */
export const CanonicalBookCatalog = defineTrait({
  name: "@vtt/books/CanonicalBookCatalog",
  schema: z.object({
    pluginName: z.string().min(1).max(120),
    entries: z
      .array(
        z.object({
          id: z.string().min(1).max(240),
          name: z.string().min(1).max(240),
        }),
      )
      .default([]),
  }),
});
