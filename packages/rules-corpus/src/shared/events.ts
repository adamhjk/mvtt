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

import { defineEvent, EntityId, z } from "@vtt/substrate";

/**
 * GM dispatched IndexRules. The mirror system spawns the corpus
 * sentinel with `status: "pending"`; the server-only ExtractRunner
 * picks it up and starts the extraction subprocess.
 */
export const RulesIndexingStarted = defineEvent({
  name: "@vtt/rules-corpus/RulesIndexingStarted",
  schema: z.object({
    corpusId: EntityId,
    assetId: EntityId,
    tags: z.array(z.string()),
    /** Captured at dispatch for the manifest. */
    gameSystemPlugin: z.string().nullable(),
    /**
     * The GM who dispatched IndexRules. Captured from `ctx.session` in
     * `apply` and threaded through to the server-only ExtractRunner so
     * its follow-up `MarkRulesIndexing{Completed,Failed}` dispatches
     * run as the originating user, not a synthetic system actor.
     * Validator already gated `role === "gm"`, so the runner can
     * rebuild the session as GM without re-checking.
     */
    issuedBy: z.object({
      userId: z.string().min(1),
      email: z.string().email(),
      name: z.string().min(1),
    }),
  }),
});

/**
 * Extraction succeeded; chunks are in FTS5, manifest is complete on
 * disk. The mirror flips status to `"ready"` and updates metadata.
 */
export const RulesIndexingCompleted = defineEvent({
  name: "@vtt/rules-corpus/RulesIndexingCompleted",
  schema: z.object({
    corpusId: EntityId,
    pageCount: z.number().int(),
    title: z.string().nullable(),
    indexedAt: z.number().int(),
  }),
});

/**
 * Extraction failed. `error` is a human-readable summary (e.g.
 * "pdfimages not found", "PDF is encrypted", "chunker timed out").
 */
export const RulesIndexingFailed = defineEvent({
  name: "@vtt/rules-corpus/RulesIndexingFailed",
  schema: z.object({
    corpusId: EntityId,
    error: z.string(),
  }),
});

/**
 * GM dispatched RemoveRulesCorpus. The mirror despawns the corpus
 * entity; cleanup-on-server removes FTS5 rows and the on-disk corpus
 * directory.
 */
export const RulesCorpusRemoved = defineEvent({
  name: "@vtt/rules-corpus/RulesCorpusRemoved",
  schema: z.object({
    corpusId: EntityId,
    assetId: EntityId,
  }),
});
