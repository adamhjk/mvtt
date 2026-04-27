import {
  defineCommand,
  EntityId,
  fail,
  ok,
  z,
} from "@vtt/substrate";
import { requireRole } from "@vtt/permissions/shared";
import { Book } from "@vtt/books/shared";
import { PdfDocumentSet } from "./events.js";

/**
 * Loose validation that the URL belongs to *this* book's pdf-book
 * plugin-data prefix. Stops a malicious client from pointing the
 * trait at an arbitrary external URL — the upload endpoint already
 * restricts writes to GMs and the .pdf extension, but this keeps the
 * trait pointing where the upload landed.
 *
 * Cache-bust suffixes (`?v=<bytes>`) are accepted; the upload
 * endpoint stamps them on so the browser re-fetches after a
 * replacement.
 */
function isPdfUrlForBook(url: string, bookId: string): boolean {
  const expectedPrefix = `/plugin-data/@vtt/pdf-book/books/${bookId}/`;
  if (!url.startsWith(expectedPrefix)) return false;
  if (url.includes("..")) return false;
  return true;
}

/**
 * GM-only: set (or replace) the uploaded PDF for a Book. v0 has no
 * separate "clear" command — the GM either uploads a replacement or
 * removes the whole Book. Validates that the bookId points at an
 * actual Book and that the URL lives in this plugin's data prefix.
 */
export const SetPdfDocument = defineCommand({
  name: "@vtt/pdf-book/SetPdfDocument",
  schema: z.object({
    bookId: EntityId,
    url: z.string().min(1),
  }),
  validate: (ctx) => {
    const role = requireRole(ctx, "gm");
    if (!role.ok) return role;
    if (!ctx.world.has(ctx.cmd.bookId)) {
      return fail(`book ${ctx.cmd.bookId} does not exist`);
    }
    const got = ctx.world.get(ctx.cmd.bookId, [Book]);
    if (!got) {
      return fail(`entity ${ctx.cmd.bookId} is not a Book`);
    }
    if (!isPdfUrlForBook(ctx.cmd.url, ctx.cmd.bookId)) {
      return fail(
        `url must start with /plugin-data/@vtt/pdf-book/books/${ctx.cmd.bookId}/`,
      );
    }
    return ok();
  },
  apply: ({ cmd }) => [
    PdfDocumentSet({ bookId: cmd.bookId, url: cmd.url }),
  ],
});
