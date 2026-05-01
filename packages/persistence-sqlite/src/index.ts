// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import Database from "better-sqlite3";
import type {
  PersistedEvent,
  PersistedSnapshot,
  PersistenceAdapter,
  WorldId,
  WorldState,
} from "@vtt/substrate";

export interface SqlitePersistenceOptions {
  /**
   * Either an open better-sqlite3 Database instance (preferred — lets the
   * persistence adapter share one DB file with auth) or a path to a SQLite
   * file (the adapter opens and owns it).
   */
  db: Database.Database | string;
  /**
   * Apply WAL when the adapter owns the connection. Has no effect if `db`
   * is an existing handle (the owner is responsible for pragmas).
   */
  enableWAL?: boolean;
}

/**
 * SQLite-backed PersistenceAdapter. Stores events and snapshots in two
 * worldId-scoped tables; the same database file is intended to be shared
 * with auth (one file per deployment, smaller backup story).
 */
export class SqlitePersistence implements PersistenceAdapter {
  private readonly db: Database.Database;
  private readonly ownsConnection: boolean;

  constructor(opts: SqlitePersistenceOptions) {
    if (typeof opts.db === "string") {
      this.db = new Database(opts.db);
      this.ownsConnection = true;
      if (opts.enableWAL ?? true) {
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("foreign_keys = ON");
      }
    } else {
      this.db = opts.db;
      this.ownsConnection = false;
    }
  }

  async migrate(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS world_event (
        worldId        TEXT    NOT NULL,
        seq            INTEGER NOT NULL,
        type           TEXT    NOT NULL,
        payloadVersion INTEGER NOT NULL DEFAULT 1,
        payload        TEXT    NOT NULL,
        visibility     TEXT,
        at             INTEGER NOT NULL,
        PRIMARY KEY (worldId, seq)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_world_event_at
        ON world_event(worldId, at);

      CREATE TABLE IF NOT EXISTS world_snapshot (
        worldId   TEXT    NOT NULL,
        atSeq     INTEGER NOT NULL,
        state     TEXT    NOT NULL,
        takenAt   INTEGER NOT NULL,
        PRIMARY KEY (worldId, atSeq)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_world_snapshot_taken
        ON world_snapshot(worldId, takenAt);
    `);
    // Forward-compat: pre-existing databases from before the visibility
    // column was added. ALTER TABLE ADD COLUMN is no-op on STRICT tables
    // when the column already exists, so we wrap in a try/catch and ignore
    // the duplicate-column error.
    try {
      this.db.exec(`ALTER TABLE world_event ADD COLUMN visibility TEXT`);
    } catch (e) {
      const msg = (e as Error).message;
      if (!/duplicate column/i.test(msg)) throw e;
    }
  }

  async appendEvents(worldId: WorldId, events: ReadonlyArray<PersistedEvent>): Promise<void> {
    if (events.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO world_event (worldId, seq, type, payloadVersion, payload, visibility, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = this.db.transaction((rows: ReadonlyArray<PersistedEvent>) => {
      for (const ev of rows) {
        stmt.run(
          ev.worldId,
          ev.seq,
          ev.type,
          ev.payloadVersion,
          JSON.stringify(ev.payload),
          ev.visibility ? JSON.stringify(ev.visibility) : null,
          ev.at,
        );
      }
    });
    // Defensive: every event in a batch must be for the requested world.
    for (const ev of events) {
      if (ev.worldId !== worldId) {
        throw new Error(
          `event worldId mismatch: batch is for ${worldId} but event ${ev.seq} is for ${ev.worldId}`,
        );
      }
    }
    tx(events);
  }

  async readEventsSince(worldId: WorldId, sinceSeq: number): Promise<PersistedEvent[]> {
    const rows = this.db
      .prepare(
        `SELECT worldId, seq, type, payloadVersion, payload, visibility, at
         FROM world_event
         WHERE worldId = ? AND seq > ?
         ORDER BY seq ASC`,
      )
      .all(worldId, sinceSeq) as Array<{
        worldId: string;
        seq: number;
        type: string;
        payloadVersion: number;
        payload: string;
        visibility: string | null;
        at: number;
      }>;
    return rows.map((r) => ({
      worldId: r.worldId,
      seq: r.seq,
      type: r.type,
      payloadVersion: r.payloadVersion,
      payload: JSON.parse(r.payload),
      visibility: r.visibility ? JSON.parse(r.visibility) : null,
      at: r.at,
    }));
  }

  async highestSeq(worldId: WorldId): Promise<number> {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(seq), 0) AS s FROM world_event WHERE worldId = ?`,
      )
      .get(worldId) as { s: number };
    return row.s;
  }

  async loadLatestSnapshot(worldId: WorldId): Promise<PersistedSnapshot | null> {
    const row = this.db
      .prepare(
        `SELECT worldId, atSeq, state, takenAt
         FROM world_snapshot
         WHERE worldId = ?
         ORDER BY atSeq DESC
         LIMIT 1`,
      )
      .get(worldId) as
      | { worldId: string; atSeq: number; state: string; takenAt: number }
      | undefined;
    if (!row) return null;
    return {
      worldId: row.worldId,
      atSeq: row.atSeq,
      state: JSON.parse(row.state) as WorldState,
      takenAt: row.takenAt,
    };
  }

  async writeSnapshot(snapshot: PersistedSnapshot): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO world_snapshot (worldId, atSeq, state, takenAt)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        snapshot.worldId,
        snapshot.atSeq,
        JSON.stringify(snapshot.state),
        snapshot.takenAt,
      );
  }

  async hardDeleteWorld(worldId: WorldId): Promise<void> {
    const tx = this.db.transaction((id: WorldId) => {
      this.db.prepare(`DELETE FROM world_event WHERE worldId = ?`).run(id);
      this.db.prepare(`DELETE FROM world_snapshot WHERE worldId = ?`).run(id);
    });
    tx(worldId);
  }

  async pruneSnapshots(worldId: WorldId, keepMostRecent: number): Promise<void> {
    const keep = Math.max(1, keepMostRecent);
    this.db
      .prepare(
        `DELETE FROM world_snapshot
         WHERE worldId = ?
           AND atSeq NOT IN (
             SELECT atSeq FROM world_snapshot
             WHERE worldId = ?
             ORDER BY atSeq DESC
             LIMIT ?
           )`,
      )
      .run(worldId, worldId, keep);
  }

  async close(): Promise<void> {
    if (this.ownsConnection) this.db.close();
  }
}

export { SqliteWorldsRepository } from "./worlds.js";
