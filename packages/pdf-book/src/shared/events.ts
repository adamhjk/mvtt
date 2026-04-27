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
