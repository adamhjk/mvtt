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
