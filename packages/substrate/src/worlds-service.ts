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

import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { PersistenceAdapter } from "./persistence.js";
import type {
  MembershipRecord,
  WorldRecord,
  WorldRole,
  WorldsRepository,
} from "./worlds-repository.js";
import { type WorldId } from "./schema.js";

export interface WorldsServiceOptions {
  readonly worldsRepo: WorldsRepository;
  readonly persistence: PersistenceAdapter;
  /**
   * Absolute path that holds per-world plugin-data subdirectories. Hard
   * delete recursively removes `${pluginDataRoot}/${worldId}`. May be
   * omitted in tests that don't exercise the plugin-data cleanup path.
   */
  readonly pluginDataRoot?: string;
}

/**
 * Orchestrator for the worlds aggregate. Sits on top of the
 * `WorldsRepository` (out-of-World metadata + memberships) and the
 * event-log `PersistenceAdapter` (in-World event/snapshot history) and
 * coordinates lifecycle operations that span both stores plus the
 * filesystem (per-world plugin-data dir).
 *
 * Authorization is the caller's responsibility for HTTP endpoints — the
 * service exposes pure data operations and one capability check
 * (`canAccess`); world creation has no built-in role check because the
 * "only global GMs may create" rule is enforced at the HTTP layer where
 * the auth session is in scope.
 */
export class WorldsService {
  constructor(private readonly opts: WorldsServiceOptions) {}

  list(opts?: { includeArchived?: boolean }): Promise<WorldRecord[]> {
    return this.opts.worldsRepo.list(opts);
  }

  get(id: WorldId): Promise<WorldRecord | null> {
    return this.opts.worldsRepo.get(id);
  }

  /**
   * Worlds the user can access: owned + member-of, archived excluded.
   * The global-GM status does NOT auto-grant access — a global GM still
   * has to own a world or be added as a member to see it.
   */
  worldsForUser(userId: string): Promise<WorldRecord[]> {
    return this.opts.worldsRepo.worldsForUser(userId);
  }

  /**
   * Create a new world. Generates an id from the provided name plus a
   * random suffix. Caller is responsible for verifying the requesting
   * user is allowed to create worlds (v1: must be the global GM).
   */
  async create(input: {
    name: string;
    gameSystemPlugin: string;
    ownerUserId: string;
  }): Promise<WorldRecord> {
    const id = generateWorldId(input.name);
    return this.opts.worldsRepo.insert({
      id,
      name: input.name.trim(),
      gameSystemPlugin: input.gameSystemPlugin,
      ownerUserId: input.ownerUserId,
    });
  }

  archive(id: WorldId): Promise<void> {
    return this.opts.worldsRepo.archive(id);
  }

  unarchive(id: WorldId): Promise<void> {
    return this.opts.worldsRepo.unarchive(id);
  }

  /**
   * Permanently destroy a world. Drops the worlds-index row and every
   * membership row, drops every event + snapshot row, and removes the
   * per-world plugin-data subdirectory from disk. Idempotent — calling
   * twice is harmless.
   */
  async hardDelete(id: WorldId): Promise<void> {
    await this.opts.worldsRepo.hardDelete(id);
    await this.opts.persistence.hardDeleteWorld(id);
    if (this.opts.pluginDataRoot) {
      const dir = resolve(this.opts.pluginDataRoot, id);
      // Defensive: never let a bogus worldId escape its parent. resolve
      // strips traversal already, but verify anyway.
      const parent = resolve(this.opts.pluginDataRoot);
      if (dir === parent || !dir.startsWith(parent + "/")) return;
      await rm(dir, { recursive: true, force: true });
    }
  }

  addMember(input: { worldId: WorldId; userId: string; role: WorldRole }): Promise<void> {
    return this.opts.worldsRepo.addMembership(input);
  }

  removeMember(worldId: WorldId, userId: string): Promise<void> {
    return this.opts.worldsRepo.removeMembership(worldId, userId);
  }

  listMembers(worldId: WorldId): Promise<MembershipRecord[]> {
    return this.opts.worldsRepo.listMemberships(worldId);
  }

  /**
   * Can `userId` connect to `worldId`? True iff they own it or have a
   * membership row. Returns false for archived worlds — archived worlds
   * are read-only-after-the-fact and don't accept live connections.
   */
  async canAccess(worldId: WorldId, userId: string): Promise<boolean> {
    const world = await this.opts.worldsRepo.get(worldId);
    if (!world || world.archivedAt !== null) return false;
    if (world.ownerUserId === userId) return true;
    const memberships = await this.opts.worldsRepo.listMemberships(worldId);
    return memberships.some((m) => m.userId === userId);
  }

  /**
   * Per-world role for `userId` on `worldId`. Owners get 'gm'; member
   * rows return their stored role; everyone else gets null. Plugins
   * read this via the per-world session synthesized at WS upgrade.
   */
  async roleFor(worldId: WorldId, userId: string): Promise<WorldRole | null> {
    const world = await this.opts.worldsRepo.get(worldId);
    if (!world || world.archivedAt !== null) return null;
    if (world.ownerUserId === userId) return "gm";
    const memberships = await this.opts.worldsRepo.listMemberships(worldId);
    const m = memberships.find((x) => x.userId === userId);
    return m ? m.role : null;
  }
}

/**
 * Build a worldId from a human name plus a random suffix. The name slug
 * keeps URLs readable; the suffix prevents collisions across "Greyhawk"
 * + "Greyhawk" runs by the same GM.
 */
function generateWorldId(name: string): WorldId {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "world";
  const suffix = randomBytes(3).toString("hex");
  return `${slug}-${suffix}` as WorldId;
}
