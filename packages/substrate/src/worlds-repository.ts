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

import type { WorldId } from "./schema.js";

/**
 * Per-world membership role. v1 only writes 'player' rows here — the
 * world's owner (the global GM who created it) is implicitly GM and
 * doesn't need a membership row. The column exists for forward-compat
 * with co-GMs (a player promoted to a GM role on a specific world).
 */
export type WorldRole = "gm" | "player";

/**
 * One row in the substrate-level worlds index. The id is the value used
 * everywhere `worldId` appears: persistence, WS connection routing, and
 * the per-world plugin-data path. `gameSystemPlugin` is the qualified
 * plugin name (e.g. `@vtt/system-simple`) chosen at world creation; it
 * is immutable for the world's lifetime.
 */
export interface WorldRecord {
  readonly id: WorldId;
  readonly name: string;
  readonly gameSystemPlugin: string;
  readonly ownerUserId: string;
  readonly createdAt: number;
  /** Non-null = soft-deleted; rows stay in the table for audit / undelete. */
  readonly archivedAt: number | null;
}

/**
 * One (worldId, userId) tuple granting access. Owners do not need a
 * membership row — they're implicitly GMs of worlds they own.
 */
export interface MembershipRecord {
  readonly worldId: WorldId;
  readonly userId: string;
  readonly role: WorldRole;
  readonly addedAt: number;
}

/**
 * Storage for the worlds aggregate (out-of-World metadata: which worlds
 * exist, who owns them, who's allowed in). Lives next to the event-log
 * `PersistenceAdapter` but is a separate concern: events describe state
 * changes inside one world, this repository describes the set of worlds
 * the server hosts and who can connect to each.
 */
export interface WorldsRepository {
  /**
   * Run any schema migrations. Idempotent. Called once during server
   * startup before any other method.
   */
  migrate(): Promise<void>;

  /** All worlds, optionally including soft-archived ones. */
  list(opts?: { includeArchived?: boolean }): Promise<WorldRecord[]>;

  get(id: WorldId): Promise<WorldRecord | null>;

  insert(input: {
    id: WorldId;
    name: string;
    gameSystemPlugin: string;
    ownerUserId: string;
  }): Promise<WorldRecord>;

  /** Mark archived. Reversible via `unarchive`. */
  archive(id: WorldId): Promise<void>;
  unarchive(id: WorldId): Promise<void>;

  /**
   * Delete the world row + every membership row for it. Does NOT touch
   * the event log or snapshots — that's the PersistenceAdapter's job
   * (`hardDeleteWorld`). The orchestrating WorldsService calls both.
   */
  hardDelete(id: WorldId): Promise<void>;

  addMembership(input: { worldId: WorldId; userId: string; role: WorldRole }): Promise<void>;
  removeMembership(worldId: WorldId, userId: string): Promise<void>;
  listMemberships(worldId: WorldId): Promise<MembershipRecord[]>;

  /**
   * Worlds the user can access: ones they own OR have a membership row
   * for. Excludes archived worlds.
   */
  worldsForUser(userId: string): Promise<WorldRecord[]>;
}
