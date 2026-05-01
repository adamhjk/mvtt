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
