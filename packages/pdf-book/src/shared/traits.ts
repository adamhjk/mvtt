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

import { defineTrait, EntityId, z } from "@vtt/substrate";

/**
 * The uploaded PDF for one Book. Attached to the Book entity directly
 * (same trait-composition pattern that puts OwnedBy on Token entities
 * across plugin boundaries). Lazily attached: the trait only exists
 * once a PDF has been bound for that Book; no trait means "no PDF
 * yet" (the canvas view falls back to an upload-prompt state).
 *
 * `assetId` references an Asset entity from `@vtt/assets`. The viewer
 * derives the fetch URL via `/plugin-data/<worldId>/assets/<assetId>`,
 * which is content-addressed and immutable post-upload — no cache-bust
 * suffix needed; replacing the PDF means binding a different assetId.
 */
export const PdfDocument = defineTrait({
  name: "@vtt/pdf-book/PdfDocument",
  schema: z.object({
    /** Asset entity carrying the PDF bytes. */
    assetId: EntityId,
  }),
});
