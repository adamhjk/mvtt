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
import { PdfDocumentSet } from "../shared/events.js";
import { PdfDocument } from "../shared/traits.js";

/**
 * Universal mirror: attach (or replace) the PdfDocument trait on the
 * target Book entity. `world.set` creates the trait if not present,
 * so the same system handles both first-bind and replace flows.
 *
 * No-op if the Book entity has been despawned between dispatch and
 * apply (e.g. RemoveBook arrived first in the queue).
 */
export const PdfDocumentSetSystem = defineSystem({
  name: "PdfDocumentSet",
  on: PdfDocumentSet,
  reads: [],
  writes: [PdfDocument],
  run: ({ event, world }) => {
    if (!world.has(event.bookId)) return [];
    world.set(event.bookId, PdfDocument, { assetId: event.assetId });
    return [];
  },
});
