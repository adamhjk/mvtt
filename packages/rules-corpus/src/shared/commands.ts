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

import { defineCommand, EntityId, fail, ok, z } from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { Asset } from "@vtt/assets/shared";
import {
  RulesCorpusRemoved,
  RulesIndexingCompleted,
  RulesIndexingFailed,
  RulesIndexingStarted,
} from "./events.js";
import { RulesCorpus } from "./traits.js";

/**
 * GM-only: kick off rules extraction for an existing PDF asset. The
 * actual extraction runs in a server-only subprocess; this command
 * just spawns the corpus sentinel with `status: "pending"`.
 *
 * Validates: caller is GM; asset exists and is `application/pdf`;
 * no existing corpus already wraps this asset.
 */
export const IndexRules = defineCommand({
  name: "@vtt/rules-corpus/IndexRules",
  schema: z.object({
    assetId: EntityId,
    tags: z.array(z.string()).default([]),
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") return fail("only the GM may index rules");
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
    // Reject re-indexing the same asset.
    for (const row of ctx.world.query([RulesCorpus])) {
      const v = row.values.RulesCorpus as { assetId: EntityId };
      if (v.assetId === ctx.cmd.assetId) {
        return fail(
          `asset ${ctx.cmd.assetId} is already indexed (corpus ${row.id}); remove the corpus first to re-index`,
        );
      }
    }
    return ok();
  },
  apply: (ctx) => {
    // Validator already required a GM session; non-null here is invariant.
    const session = requireSession(ctx)!;
    return [
      RulesIndexingStarted({
        corpusId: ctx.world.allocateId(),
        assetId: ctx.cmd.assetId,
        tags: ctx.cmd.tags,
        gameSystemPlugin: null,
        issuedBy: {
          userId: session.userId,
          email: session.email,
          name: session.name,
        },
      }),
    ];
  },
});

/**
 * GM-only: remove a corpus. Despawns the entity; the server-only
 * cleanup system removes FTS5 rows and the on-disk corpus directory.
 * Does NOT touch the underlying Asset entity — the GM may keep the
 * PDF available for reading even after un-indexing.
 */
export const RemoveRulesCorpus = defineCommand({
  name: "@vtt/rules-corpus/RemoveRulesCorpus",
  schema: z.object({
    corpusId: EntityId,
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") return fail("only the GM may remove a corpus");
    if (!ctx.world.has(ctx.cmd.corpusId)) {
      return fail(`corpus ${ctx.cmd.corpusId} does not exist`);
    }
    const got = ctx.world.get(ctx.cmd.corpusId, [RulesCorpus]) as
      | { RulesCorpus: { assetId: EntityId } }
      | undefined;
    if (!got) {
      return fail(`entity ${ctx.cmd.corpusId} is not a RulesCorpus`);
    }
    return ok();
  },
  apply: ({ cmd, world }) => {
    const got = world.get(cmd.corpusId, [RulesCorpus]) as
      | { RulesCorpus: { assetId: EntityId } }
      | undefined;
    return [
      RulesCorpusRemoved({
        corpusId: cmd.corpusId,
        // Validate guarantees the trait exists, but be safe.
        assetId: (got?.RulesCorpus.assetId ?? "") as EntityId,
      }),
    ];
  },
});

/**
 * Server-only: announce that an extraction subprocess has finished
 * successfully. Dispatched by `RulesExtractRunner` via a synthetic
 * server session. The validator gates on a session being present and
 * the corpus existing in `pending`/`indexing` state — clients dispatching
 * this directly can at worst flip status without populating FTS5,
 * which produces empty search results (harmless, fixed by `RemoveRulesCorpus`
 * + retry).
 */
export const MarkRulesIndexingCompleted = defineCommand({
  name: "@vtt/rules-corpus/MarkRulesIndexingCompleted",
  schema: z.object({
    corpusId: EntityId,
    pageCount: z.number().int(),
    title: z.string().nullable(),
    indexedAt: z.number().int(),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.corpusId)) {
      return fail(`corpus ${ctx.cmd.corpusId} does not exist`);
    }
    const got = ctx.world.get(ctx.cmd.corpusId, [RulesCorpus]) as
      | { RulesCorpus: { status: string } }
      | undefined;
    if (!got) return fail(`entity ${ctx.cmd.corpusId} is not a RulesCorpus`);
    if (got.RulesCorpus.status === "ready") {
      return fail(`corpus ${ctx.cmd.corpusId} is already ready`);
    }
    return ok();
  },
  apply: ({ cmd }) => [
    RulesIndexingCompleted({
      corpusId: cmd.corpusId,
      pageCount: cmd.pageCount,
      title: cmd.title,
      indexedAt: cmd.indexedAt,
    }),
  ],
});

/**
 * Server-only counterpart of MarkRulesIndexingCompleted for the
 * failure path. Same trust model.
 */
export const MarkRulesIndexingFailed = defineCommand({
  name: "@vtt/rules-corpus/MarkRulesIndexingFailed",
  schema: z.object({
    corpusId: EntityId,
    error: z.string(),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.corpusId)) {
      return fail(`corpus ${ctx.cmd.corpusId} does not exist`);
    }
    return ok();
  },
  apply: ({ cmd }) => [
    RulesIndexingFailed({
      corpusId: cmd.corpusId,
      error: cmd.error,
    }),
  ],
});
