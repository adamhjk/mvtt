// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import type Database from "better-sqlite3";
import type { EntityId, WorldId } from "@vtt/substrate";

/**
 * SQLite FTS5-backed full-text search over note pages.
 *
 * One virtual table for the whole deployment, scoped per row by
 * `worldId`. Because it's `external content` would tighten things up,
 * but for v1 we go simple and store everything inline — the index
 * grows with content, not separately, and rebuilding is just
 * `DELETE FROM notes_fts WHERE worldId = ?` followed by re-indexing.
 *
 * Maintenance is event-driven from a server-only subscriber on each
 * world runtime's bus (see `@vtt/notes/server/search-bridge.ts`).
 *
 * Visibility filtering happens *after* FTS — we get candidate ids back
 * and the caller intersects them with the recipient's
 * `EntityVisibility` resolution.
 */
export class NotesSearchIndex {
  constructor(private readonly db: Database.Database) {}

  /**
   * Idempotent. Creates the FTS5 virtual table if it doesn't exist.
   * Uses `tokenize = 'porter unicode61'` for stem-aware unicode-friendly
   * matching — better recall than the default for notes-style prose.
   */
  migrate(): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        worldId UNINDEXED,
        noteId UNINDEXED,
        pageId UNINDEXED,
        noteTitle,
        pageTitle,
        body,
        tokenize = 'porter unicode61'
      );
    `);
  }

  /**
   * Insert-or-replace the row for one (worldId, pageId). FTS5 doesn't
   * have a primary key per se, so we manually delete-then-insert.
   * Cheap; FTS5 handles internal index maintenance.
   */
  indexPage(args: {
    worldId: WorldId;
    noteId: EntityId;
    pageId: EntityId;
    noteTitle: string;
    pageTitle: string;
    body: string;
  }): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM notes_fts WHERE worldId = ? AND pageId = ?`)
        .run(args.worldId, args.pageId);
      this.db
        .prepare(
          `INSERT INTO notes_fts (worldId, noteId, pageId, noteTitle, pageTitle, body)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          args.worldId,
          args.noteId,
          args.pageId,
          args.noteTitle,
          args.pageTitle,
          args.body,
        );
    });
    tx();
  }

  removePage(worldId: WorldId, pageId: EntityId): void {
    this.db
      .prepare(`DELETE FROM notes_fts WHERE worldId = ? AND pageId = ?`)
      .run(worldId, pageId);
  }

  removeNote(worldId: WorldId, noteId: EntityId): void {
    this.db
      .prepare(`DELETE FROM notes_fts WHERE worldId = ? AND noteId = ?`)
      .run(worldId, noteId);
  }

  /**
   * Update the noteTitle for every page belonging to a note. Cheaper
   * than re-indexing each page from scratch; for the rename case we
   * just touch the one column.
   */
  retitleNote(worldId: WorldId, noteId: EntityId, noteTitle: string): void {
    // FTS5 supports UPDATE on content columns directly when the table
    // is contentless; here we delete-and-re-insert at the row level
    // because UPDATE on FTS5 is column-set-only.
    const rows = this.db
      .prepare(
        `SELECT pageId, pageTitle, body FROM notes_fts WHERE worldId = ? AND noteId = ?`,
      )
      .all(worldId, noteId) as Array<{
      pageId: string;
      pageTitle: string;
      body: string;
    }>;
    const tx = this.db.transaction(() => {
      for (const r of rows) {
        this.indexPage({
          worldId,
          noteId,
          pageId: r.pageId as EntityId,
          noteTitle,
          pageTitle: r.pageTitle,
          body: r.body,
        });
      }
    });
    tx();
  }

  /**
   * Update only pageTitle for a single page; mirrors retitleNote. We
   * fetch and re-insert because FTS5 doesn't support partial UPDATEs.
   */
  retitlePage(worldId: WorldId, pageId: EntityId, pageTitle: string): void {
    const row = this.db
      .prepare(
        `SELECT noteId, noteTitle, body FROM notes_fts WHERE worldId = ? AND pageId = ?`,
      )
      .get(worldId, pageId) as
      | { noteId: string; noteTitle: string; body: string }
      | undefined;
    if (!row) return;
    this.indexPage({
      worldId,
      noteId: row.noteId as EntityId,
      pageId,
      noteTitle: row.noteTitle,
      pageTitle,
      body: row.body,
    });
  }

  /**
   * Run an FTS5 query, return up to `limit` candidate hits ordered by
   * BM25 rank. The caller is responsible for visibility-filtering the
   * results before returning them to the user.
   *
   * The query string is passed verbatim to FTS5's MATCH operator —
   * supports phrase queries, prefix `*`, OR/AND/NOT, etc. We sanitise
   * the obvious denial-of-service shapes (extreme length, empty after
   * trim) but otherwise trust FTS5's parser.
   */
  query(args: {
    worldId: WorldId;
    q: string;
    limit?: number;
  }): SearchHit[] {
    const trimmed = args.q.trim();
    if (trimmed.length === 0) return [];
    if (trimmed.length > 256) return [];
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    // Wrap the user's query in quotes if they didn't already use any
    // FTS5 operators — this protects against accidental syntax errors
    // for plain-text queries containing `:` or other operator chars.
    const matchExpr = isPlain(trimmed) ? toPrefixPhrase(trimmed) : trimmed;
    try {
      const rows = this.db
        .prepare(
          `SELECT noteId, pageId, noteTitle, pageTitle,
                  snippet(notes_fts, 5, '<mark>', '</mark>', '…', 12) AS snippet,
                  bm25(notes_fts) AS score
           FROM notes_fts
           WHERE worldId = ? AND notes_fts MATCH ?
           ORDER BY score
           LIMIT ?`,
        )
        .all(args.worldId, matchExpr, limit) as Array<{
        noteId: string;
        pageId: string;
        noteTitle: string;
        pageTitle: string;
        snippet: string;
        score: number;
      }>;
      return rows.map((r) => ({
        noteId: r.noteId as EntityId,
        pageId: r.pageId as EntityId,
        noteTitle: r.noteTitle,
        pageTitle: r.pageTitle,
        snippet: r.snippet,
        score: r.score,
      }));
    } catch {
      // Malformed FTS5 query — return empty rather than 500.
      return [];
    }
  }

  /** Drop every row for a world (used when a world is hard-deleted). */
  removeWorld(worldId: WorldId): void {
    this.db.prepare(`DELETE FROM notes_fts WHERE worldId = ?`).run(worldId);
  }
}

export interface SearchHit {
  readonly noteId: EntityId;
  readonly pageId: EntityId;
  readonly noteTitle: string;
  readonly pageTitle: string;
  /** HTML-marked snippet with `<mark>`/`</mark>` highlights. */
  readonly snippet: string;
  /** BM25 score; lower = more relevant in FTS5's convention. */
  readonly score: number;
}

/** Plain query = no FTS5 syntactic chars. */
function isPlain(q: string): boolean {
  return !/["*:()^$~\-]/.test(q);
}

/**
 * Turn a multi-word plain query into a quoted phrase plus a final
 * prefix wildcard. Matches "goblin tactics" as "goblin* tactics*"-ish
 * — better UX for as-you-type search.
 */
function toPrefixPhrase(q: string): string {
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.map((p) => `"${p.replace(/"/g, '""')}"*`).join(" ");
}
