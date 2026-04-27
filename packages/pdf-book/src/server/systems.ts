import { defineSystem } from "@vtt/substrate";
import { PdfDocumentSet } from "../shared/events.js";
import { PdfDocument } from "../shared/traits.js";

/**
 * Universal mirror: attach (or replace) the PdfDocument trait on the
 * target Book entity. `world.set` creates the trait if not present,
 * so the same system handles both first-upload and replace flows.
 *
 * No-op if the Book entity has been despawned between dispatch and
 * apply (e.g. RemoveBook arrived first in the queue) — the validator
 * already checks existence, but events from a stale snapshot replay
 * could land here against a missing id.
 */
export const PdfDocumentSetSystem = defineSystem({
  name: "PdfDocumentSet",
  on: PdfDocumentSet,
  reads: [],
  writes: [PdfDocument],
  run: ({ event, world }) => {
    if (!world.has(event.bookId)) return [];
    world.set(event.bookId, PdfDocument, { url: event.url });
    return [];
  },
});
