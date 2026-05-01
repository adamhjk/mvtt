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

import { defineEvent, EntityId, z } from "@vtt/substrate";

/**
 * The GM uploaded (or replaced) a PDF for a Book. The recording
 * system attaches the PdfDocument trait to the Book entity. v0 has no
 * explicit "clear" event — the GM removes the document by uploading a
 * replacement. Removing the entire Book despawns the entity (and its
 * PdfDocument trait along with it).
 */
export const PdfDocumentSet = defineEvent({
  name: "@vtt/pdf-book/PdfDocumentSet",
  schema: z.object({
    bookId: EntityId,
    /** URL under /plugin-data/@vtt/pdf-book/books/<bookId>/. */
    url: z.string().min(1),
  }),
});
