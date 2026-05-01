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
import type {
  MembershipRecord,
  WorldRecord,
  WorldRole,
  WorldsRepository,
  WorldId,
} from "@vtt/substrate";

/**
 * SQLite-backed WorldsRepository. Lives in the same DB file as auth and
 * the event-sourced spine — one file per deployment, one backup story.
 * The connection is supplied by the caller (typically the auth package's
 * Database handle, threaded through main.ts).
 */
export class SqliteWorldsRepository implements WorldsRepository {
  constructor(private readonly db: Database.Database) {}

  async migrate(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS world (
        id               TEXT    NOT NULL PRIMARY KEY,
        name             TEXT    NOT NULL,
        gameSystemPlugin TEXT    NOT NULL,
        ownerUserId      TEXT    NOT NULL,
        createdAt        INTEGER NOT NULL,
        archivedAt       INTEGER
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_world_owner
        ON world(ownerUserId);

      CREATE TABLE IF NOT EXISTS world_membership (
        worldId TEXT    NOT NULL,
        userId  TEXT    NOT NULL,
        role    TEXT    NOT NULL,
        addedAt INTEGER NOT NULL,
        PRIMARY KEY (worldId, userId)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_world_membership_user
        ON world_membership(userId);
    `);
  }

  async list(opts?: { includeArchived?: boolean }): Promise<WorldRecord[]> {
    const rows = (opts?.includeArchived
      ? this.db.prepare(`SELECT * FROM world ORDER BY createdAt ASC`).all()
      : this.db
          .prepare(`SELECT * FROM world WHERE archivedAt IS NULL ORDER BY createdAt ASC`)
          .all()) as WorldRow[];
    return rows.map(rowToRecord);
  }

  async get(id: WorldId): Promise<WorldRecord | null> {
    const row = this.db.prepare(`SELECT * FROM world WHERE id = ?`).get(id) as
      | WorldRow
      | undefined;
    return row ? rowToRecord(row) : null;
  }

  async insert(input: {
    id: WorldId;
    name: string;
    gameSystemPlugin: string;
    ownerUserId: string;
  }): Promise<WorldRecord> {
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO world (id, name, gameSystemPlugin, ownerUserId, createdAt, archivedAt)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        input.id,
        input.name,
        input.gameSystemPlugin,
        input.ownerUserId,
        createdAt,
      );
    return {
      id: input.id,
      name: input.name,
      gameSystemPlugin: input.gameSystemPlugin,
      ownerUserId: input.ownerUserId,
      createdAt,
      archivedAt: null,
    };
  }

  async archive(id: WorldId): Promise<void> {
    this.db
      .prepare(`UPDATE world SET archivedAt = ? WHERE id = ?`)
      .run(Date.now(), id);
  }

  async unarchive(id: WorldId): Promise<void> {
    this.db.prepare(`UPDATE world SET archivedAt = NULL WHERE id = ?`).run(id);
  }

  async hardDelete(id: WorldId): Promise<void> {
    const tx = this.db.transaction((worldId: WorldId) => {
      this.db.prepare(`DELETE FROM world_membership WHERE worldId = ?`).run(worldId);
      this.db.prepare(`DELETE FROM world WHERE id = ?`).run(worldId);
    });
    tx(id);
  }

  async addMembership(input: {
    worldId: WorldId;
    userId: string;
    role: WorldRole;
  }): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO world_membership (worldId, userId, role, addedAt)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.worldId, input.userId, input.role, Date.now());
  }

  async removeMembership(worldId: WorldId, userId: string): Promise<void> {
    this.db
      .prepare(`DELETE FROM world_membership WHERE worldId = ? AND userId = ?`)
      .run(worldId, userId);
  }

  async listMemberships(worldId: WorldId): Promise<MembershipRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT worldId, userId, role, addedAt
         FROM world_membership
         WHERE worldId = ?
         ORDER BY addedAt ASC`,
      )
      .all(worldId) as Array<{
        worldId: string;
        userId: string;
        role: string;
        addedAt: number;
      }>;
    return rows.map((r) => ({
      worldId: r.worldId,
      userId: r.userId,
      role: r.role as WorldRole,
      addedAt: r.addedAt,
    }));
  }

  async worldsForUser(userId: string): Promise<WorldRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT w.*
         FROM world w
         LEFT JOIN world_membership m ON m.worldId = w.id
         WHERE w.archivedAt IS NULL
           AND (w.ownerUserId = ? OR m.userId = ?)
         ORDER BY w.createdAt ASC`,
      )
      .all(userId, userId) as WorldRow[];
    return rows.map(rowToRecord);
  }
}

interface WorldRow {
  id: string;
  name: string;
  gameSystemPlugin: string;
  ownerUserId: string;
  createdAt: number;
  archivedAt: number | null;
}

function rowToRecord(r: WorldRow): WorldRecord {
  return {
    id: r.id,
    name: r.name,
    gameSystemPlugin: r.gameSystemPlugin,
    ownerUserId: r.ownerUserId,
    createdAt: r.createdAt,
    archivedAt: r.archivedAt,
  };
}
