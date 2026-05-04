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

import { defineEvent, EntityId, z } from "@vtt/substrate";

/**
 * The GM bound a PDF asset to a Book (or replaced an existing one).
 * The mirror system attaches the PdfDocument trait to the Book entity.
 * v0 has no explicit "clear" event — the GM either binds a different
 * asset or removes the whole Book.
 */
export const PdfDocumentSet = defineEvent({
  name: "@vtt/pdf-book/PdfDocumentSet",
  schema: z.object({
    bookId: EntityId,
    /** Asset entity (from @vtt/assets) carrying the PDF bytes. */
    assetId: EntityId,
  }),
});
