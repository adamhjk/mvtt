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

import {
  defineCommand,
  EntityId,
  fail,
  z,
} from "@vtt/substrate";
import { requireWrite } from "@vtt/permissions/shared";
import { requireSession } from "@vtt/identity/shared";
import { Book } from "@vtt/books/shared";
import { Asset } from "@vtt/assets/shared";
import { PdfDocumentSet } from "./events.js";

/**
 * GM-only: bind (or replace) the PDF asset that backs a Book. v0 has
 * no separate "clear" command — the GM either binds a different asset
 * or removes the whole Book. Validates that the bookId points at an
 * actual Book and that the assetId points at an Asset whose mime is
 * `application/pdf`.
 *
 * The asset bytes are stored, deduped, and visibility-resolved by
 * `@vtt/assets`; this command only links a Book to an existing asset.
 * Uploads happen out-of-band via the assets HTTP route.
 */
export const SetPdfDocument = defineCommand({
  name: "@vtt/pdf-book/SetPdfDocument",
  schema: z.object({
    bookId: EntityId,
    assetId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.bookId)) {
      return fail(`book ${ctx.cmd.bookId} does not exist`);
    }
    const bookGot = ctx.world.get(ctx.cmd.bookId, [Book]);
    if (!bookGot) {
      return fail(`entity ${ctx.cmd.bookId} is not a Book`);
    }
    if (!ctx.world.has(ctx.cmd.assetId)) {
      return fail(`asset ${ctx.cmd.assetId} does not exist`);
    }
    const assetGot = ctx.world.get(ctx.cmd.assetId, [Asset]) as
      | { Asset: { mime: string } }
      | undefined;
    if (!assetGot) {
      return fail(`entity ${ctx.cmd.assetId} is not an Asset`);
    }
    if (assetGot.Asset.mime !== "application/pdf") {
      return fail(
        `asset ${ctx.cmd.assetId} has mime ${assetGot.Asset.mime}, expected application/pdf`,
      );
    }
    return requireWrite(ctx, ctx.cmd.bookId);
  },
  apply: ({ cmd }) => [
    PdfDocumentSet({ bookId: cmd.bookId, assetId: cmd.assetId }),
  ],
});
