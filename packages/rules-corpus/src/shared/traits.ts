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

import { defineTrait, EntityId, z } from "@vtt/substrate";

/**
 * Deterministic id for the per-world rules library sentinel. Using a
 * fixed string id (rather than counter-based allocation via `spawn()`)
 * ensures server and client converge on the same entity without an
 * id-bearing event — the universal mirror just calls `spawnAt` against
 * this constant, gated on `!world.has(...)`. The leading non-`e` prefix
 * also keeps it out of the `e<n>` counter space so it never collides
 * with allocated corpus ids.
 */
export const RULES_LIBRARY_SENTINEL_ID = "rules-library" as EntityId;

/**
 * Sentinel-marker trait for the per-world rules library. Carries no
 * data; its purpose is to identify the singleton entity whose children
 * are `RulesCorpus` entities (one per indexed PDF). Spawned lazily on
 * first `IndexRules` dispatch at `RULES_LIBRARY_SENTINEL_ID`; never
 * destroyed.
 */
export const RulesLibrary = defineTrait({
  name: "@vtt/rules-corpus/RulesLibrary",
  schema: z.object({}),
});

/**
 * Per-corpus state. One entity per indexed PDF asset. The same
 * `assetId` is never indexed twice within a world — `IndexRules`
 * rejects re-indexing of an already-bound asset (the GM removes the
 * existing corpus first if they want to re-extract).
 *
 * Status transitions: `pending` (just dispatched) → `indexing`
 * (extract-runner kicked off) → `ready` (chunks in FTS5, manifest
 * complete) or `failed` (extraction error; `error` populated). The
 * universal mirror writes status and metadata; the extract-runner
 * sits in `server-only` and emits the events that drive the mirror.
 */
export const RulesCorpus = defineTrait({
  name: "@vtt/rules-corpus/RulesCorpus",
  schema: z.object({
    /** The Asset entity whose bytes back this corpus. */
    assetId: EntityId,
    status: z.enum(["pending", "indexing", "ready", "failed"]),
    /** Populated when `status === "failed"`. */
    error: z.string().nullable(),
    /** Free-form tags for skill-side aliasing (`["torchbearer", "tb"]`). */
    tags: z.array(z.string()),
    /** Wall-clock millis of last successful index completion. */
    indexedAt: z.number().int().nullable(),
    /** Total PDF page count. Populated post-extraction. */
    pageCount: z.number().int().nullable(),
    /** Display title from the PDF metadata or the original filename. */
    title: z.string().nullable(),
    /**
     * Game-system plugin name in effect when this corpus was indexed.
     * Captured for diagnostic / "did the profile change?" purposes.
     */
    gameSystemPlugin: z.string().nullable(),
  }),
});
