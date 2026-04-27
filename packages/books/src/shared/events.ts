import { defineEvent, EntityId, z } from "@vtt/substrate";

/**
 * Book-level events. BookCreated carries no bookId — the recording
 * system spawns the entity in lockstep on every side, so server and all
 * clients agree on the resulting EntityId without round-tripping a
 * server-chosen one through `apply`. Subsequent commands carry the id
 * directly.
 */
export const BookCreated = defineEvent({
  name: "@vtt/books/BookCreated",
  schema: z.object({
    name: z.string(),
    createdByUserId: z.string(),
  }),
});

export const BookRemoved = defineEvent({
  name: "@vtt/books/BookRemoved",
  schema: z.object({
    bookId: EntityId,
  }),
});

/**
 * The GM edited one or more fields of an existing book. Each field is
 * optional; the BookUpdate system merges the supplied values over the
 * current Book trait. v0 only has `name`; future fields (cover image,
 * summary, tags) plug in here without a new event.
 */
export const BookUpdated = defineEvent({
  name: "@vtt/books/BookUpdated",
  schema: z.object({
    bookId: EntityId,
    name: z.string().min(1).max(160).optional(),
  }),
});
