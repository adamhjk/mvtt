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

import type Database from "better-sqlite3";
import type { EntityId, WorldId } from "@vtt/substrate";

/**
 * SQLite FTS5-backed full-text search over rules-corpus chunks.
 * Mirrors the shape of `@vtt/notes`'s `NotesSearchIndex` so the two
 * plugins share a body of patterns.
 *
 * One virtual table for the whole deployment, scoped per row by
 * `worldId` + `corpusId`. Storage cost is tens of MB per indexed
 * rulebook; rebuilding from `chunks.jsonl` on disk is cheap so we
 * never have to worry about the FTS5 table going stale — `chunks.jsonl`
 * is the canonical source.
 *
 * Visibility filtering happens *after* FTS5 — the caller intersects
 * the candidate `corpusId` results with the recipient's
 * `EntityVisibility` resolution against the corpus entity's
 * `Permissions` trait.
 */
export class RulesSearchIndex {
  constructor(private readonly db: Database.Database) {}

  /**
   * Idempotent. Creates the FTS5 virtual table if it doesn't exist.
   * Tokenizer matches the notes plugin: `porter unicode61` for
   * stem-aware unicode-friendly recall.
   *
   * Page numbers are stored as text so we can carry Roman numerals
   * (`vii`) and appendix prefixes (`A-12`) for `printedPage`.
   * `pdfPage` and `pdfPageEnd` are integers stored as text in FTS5
   * (UNINDEXED columns are just stored verbatim — we cast on read).
   */
  migrate(): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS rules_chunks_fts USING fts5(
        worldId UNINDEXED,
        corpusId UNINDEXED,
        chunkId UNINDEXED,
        pdfPage UNINDEXED,
        pdfPageEnd UNINDEXED,
        printedPage UNINDEXED,
        printedPageEnd UNINDEXED,
        headingPath UNINDEXED,
        body,
        tokenize = 'porter unicode61'
      );
    `);
  }

  /**
   * Bulk insert chunks for a freshly-extracted corpus. Wraps in one
   * transaction; FTS5 handles index maintenance internally.
   */
  insertChunks(args: {
    worldId: WorldId;
    corpusId: EntityId;
    chunks: ReadonlyArray<RulesChunkRow>;
  }): void {
    const tx = this.db.transaction(() => {
      // Drop any prior rows for this corpus first — the call site
      // expects insert-or-replace semantics.
      this.db
        .prepare(
          `DELETE FROM rules_chunks_fts WHERE worldId = ? AND corpusId = ?`,
        )
        .run(args.worldId, args.corpusId);
      const stmt = this.db.prepare(
        `INSERT INTO rules_chunks_fts (
           worldId, corpusId, chunkId, pdfPage, pdfPageEnd,
           printedPage, printedPageEnd, headingPath, body
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const c of args.chunks) {
        stmt.run(
          args.worldId,
          args.corpusId,
          c.chunkId,
          String(c.pdfPage),
          c.pdfPageEnd === null ? null : String(c.pdfPageEnd),
          c.printedPage === null ? null : String(c.printedPage),
          c.printedPageEnd === null ? null : String(c.printedPageEnd),
          c.headingPath.join(" › "),
          c.body,
        );
      }
    });
    tx();
  }

  /**
   * Search a single corpus. Returns up to `limit` candidate hits
   * ordered by BM25 rank. The caller is responsible for visibility
   * filtering before returning results to a user.
   */
  query(args: {
    worldId: WorldId;
    corpusId: EntityId;
    q: string;
    limit?: number;
  }): RulesSearchHit[] {
    const trimmed = args.q.trim();
    if (trimmed.length === 0) return [];
    if (trimmed.length > 256) return [];
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const matchExpr = isPlain(trimmed) ? toPrefixPhrase(trimmed) : trimmed;
    try {
      const rows = this.db
        .prepare(
          `SELECT chunkId, pdfPage, pdfPageEnd, printedPage, printedPageEnd, headingPath,
                  snippet(rules_chunks_fts, 8, '<mark>', '</mark>', '…', 16) AS snippet,
                  bm25(rules_chunks_fts) AS score
           FROM rules_chunks_fts
           WHERE worldId = ? AND corpusId = ? AND rules_chunks_fts MATCH ?
           ORDER BY score
           LIMIT ?`,
        )
        .all(args.worldId, args.corpusId, matchExpr, limit) as Array<{
        chunkId: string;
        pdfPage: string;
        pdfPageEnd: string | null;
        printedPage: string | null;
        printedPageEnd: string | null;
        headingPath: string;
        snippet: string;
        score: number;
      }>;
      return rows.map((r) => ({
        corpusId: args.corpusId,
        chunkId: r.chunkId,
        pdfPage: Number(r.pdfPage),
        pdfPageEnd: r.pdfPageEnd === null ? null : Number(r.pdfPageEnd),
        printedPage: parsePrinted(r.printedPage),
        printedPageEnd: parsePrinted(r.printedPageEnd),
        headingPath: r.headingPath.split(" › "),
        snippet: r.snippet,
        score: r.score,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Cross-corpus search across every corpus indexed for `worldId`.
   * Returns up to `limit` candidate hits ordered by BM25 rank, each
   * carrying its `corpusId` so the caller can post-filter on per-corpus
   * visibility and route deep-link clicks back to the right book.
   */
  queryAll(args: {
    worldId: WorldId;
    q: string;
    limit?: number;
  }): RulesSearchHit[] {
    const trimmed = args.q.trim();
    if (trimmed.length === 0) return [];
    if (trimmed.length > 256) return [];
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const matchExpr = isPlain(trimmed) ? toPrefixPhrase(trimmed) : trimmed;
    try {
      const rows = this.db
        .prepare(
          `SELECT corpusId, chunkId, pdfPage, pdfPageEnd, printedPage, printedPageEnd, headingPath,
                  snippet(rules_chunks_fts, 8, '<mark>', '</mark>', '…', 16) AS snippet,
                  bm25(rules_chunks_fts) AS score
           FROM rules_chunks_fts
           WHERE worldId = ? AND rules_chunks_fts MATCH ?
           ORDER BY score
           LIMIT ?`,
        )
        .all(args.worldId, matchExpr, limit) as Array<{
        corpusId: string;
        chunkId: string;
        pdfPage: string;
        pdfPageEnd: string | null;
        printedPage: string | null;
        printedPageEnd: string | null;
        headingPath: string;
        snippet: string;
        score: number;
      }>;
      return rows.map((r) => ({
        corpusId: r.corpusId as EntityId,
        chunkId: r.chunkId,
        pdfPage: Number(r.pdfPage),
        pdfPageEnd: r.pdfPageEnd === null ? null : Number(r.pdfPageEnd),
        printedPage: parsePrinted(r.printedPage),
        printedPageEnd: parsePrinted(r.printedPageEnd),
        headingPath: r.headingPath.split(" › "),
        snippet: r.snippet,
        score: r.score,
      }));
    } catch {
      return [];
    }
  }

  /** Drop every row for a corpus (used on RulesCorpusRemoved). */
  removeCorpus(worldId: WorldId, corpusId: EntityId): void {
    this.db
      .prepare(
        `DELETE FROM rules_chunks_fts WHERE worldId = ? AND corpusId = ?`,
      )
      .run(worldId, corpusId);
  }

  /** Drop every row for a world (used when a world is hard-deleted). */
  removeWorld(worldId: WorldId): void {
    this.db
      .prepare(`DELETE FROM rules_chunks_fts WHERE worldId = ?`)
      .run(worldId);
  }

  /**
   * Surface the unique corpora indexed in a world. Useful for the
   * `rules-lookup` skill's discovery path and for diagnostics.
   */
  listCorpora(worldId: WorldId): Array<{ corpusId: EntityId; chunkCount: number }> {
    const rows = this.db
      .prepare(
        `SELECT corpusId, COUNT(*) AS chunkCount
         FROM rules_chunks_fts WHERE worldId = ?
         GROUP BY corpusId`,
      )
      .all(worldId) as Array<{ corpusId: string; chunkCount: number }>;
    return rows.map((r) => ({
      corpusId: r.corpusId as EntityId,
      chunkCount: r.chunkCount,
    }));
  }
}

export interface RulesChunkRow {
  readonly chunkId: string;
  readonly pdfPage: number;
  readonly pdfPageEnd: number | null;
  readonly printedPage: string | number | null;
  readonly printedPageEnd: string | number | null;
  readonly headingPath: ReadonlyArray<string>;
  readonly body: string;
}

export interface RulesSearchHit {
  /** Corpus the hit belongs to. Carried on every hit so cross-corpus
   * searches can route the click target without a second lookup. */
  readonly corpusId: EntityId;
  readonly chunkId: string;
  readonly pdfPage: number;
  readonly pdfPageEnd: number | null;
  readonly printedPage: string | number | null;
  readonly printedPageEnd: string | number | null;
  readonly headingPath: ReadonlyArray<string>;
  /** HTML-marked snippet with `<mark>`/`</mark>` highlights. */
  readonly snippet: string;
  /** BM25 score; lower = more relevant in FTS5's convention. */
  readonly score: number;
}

function isPlain(q: string): boolean {
  return !/["*:()^$~\-]/.test(q);
}

function toPrefixPhrase(q: string): string {
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.map((p) => `"${p.replace(/"/g, '""')}"*`).join(" ");
}

/**
 * Parse a stored printed-page back to its original number-or-string
 * shape. Plain integer strings become numbers; anything else (Roman,
 * letter-prefixed) stays a string. `null` round-trips faithfully.
 */
function parsePrinted(raw: string | null): string | number | null {
  if (raw === null) return null;
  // Empty-string round-trip safety — shouldn't happen, but if the
  // chunker ever stores an empty printedPage that's still "no answer".
  if (raw.length === 0) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}
