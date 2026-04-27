import { defineSurface, EntityId, z } from "@vtt/substrate";

/**
 * The book's main content area. `single` because exactly one
 * projection at a time renders the book — a PDF viewer, a markdown
 * reader, etc. Higher-priority views replace lower-priority ones.
 *
 * Context: `bookId` — the entity id of the Book being rendered.
 * Required so each workbench tab (which may target a different book)
 * renders its own content rather than always defaulting to "the first
 * Book in the world."
 *
 * If no projection plugin is loaded, the surface is empty and the
 * Books page renders its own "no projection registered" hint.
 */
export const BookCanvasSurface = defineSurface({
  name: "@vtt/books/canvas",
  kind: "single",
  context: z.object({ bookId: EntityId }),
  description:
    "The main content pane for one book. Exactly one renderer view fills this — typically a projection plugin (PDF, markdown, etc.). Parameterised by the bookId in the surface's context.",
});
