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

import { defineTrait, z } from "@vtt/substrate";

/**
 * The uploaded PDF for one Book. Attached to the Book entity directly
 * (same trait-composition pattern that puts OwnedBy on Token entities
 * across plugin boundaries). Lazily attached: the trait only exists
 * once a PDF has been uploaded for that Book; no trait means "no PDF
 * yet" (the canvas view falls back to an upload-prompt state).
 *
 * `url` must be a path under `/plugin-data/@vtt/pdf-book/books/<bookId>/`
 * — the upload endpoint stamps a `?v=<bytes>` cache-bust suffix so the
 * browser re-fetches when the GM replaces the file. Server-side
 * validation in SetPdfDocument enforces the prefix to keep the trait
 * pointing at this plugin's own storage.
 */
export const PdfDocument = defineTrait({
  name: "@vtt/pdf-book/PdfDocument",
  schema: z.object({
    /** Public URL of the uploaded PDF (under /plugin-data/...). */
    url: z.string().min(1),
  }),
});
