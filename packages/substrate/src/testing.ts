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

import type {
  MembershipRecord,
  WorldRecord,
  WorldRole,
  WorldsRepository,
} from "./worlds-repository.js";
import type { WorldId } from "./schema.js";

/**
 * Plain in-memory implementation of `WorldsRepository` for tests and
 * smoke harnesses. Not for production — there is no persistence.
 */
export class InMemoryWorldsRepository implements WorldsRepository {
  private readonly worlds = new Map<WorldId, WorldRecord>();
  private memberships: MembershipRecord[] = [];

  async migrate(): Promise<void> {}

  async list(opts?: { includeArchived?: boolean }): Promise<WorldRecord[]> {
    return [...this.worlds.values()].filter(
      (w) => opts?.includeArchived || w.archivedAt === null,
    );
  }

  async get(id: WorldId): Promise<WorldRecord | null> {
    return this.worlds.get(id) ?? null;
  }

  async insert(input: {
    id: WorldId;
    name: string;
    gameSystemPlugin: string;
    ownerUserId: string;
  }): Promise<WorldRecord> {
    const w: WorldRecord = {
      id: input.id,
      name: input.name,
      gameSystemPlugin: input.gameSystemPlugin,
      ownerUserId: input.ownerUserId,
      createdAt: Date.now(),
      archivedAt: null,
    };
    this.worlds.set(input.id, w);
    return w;
  }

  async archive(id: WorldId): Promise<void> {
    const w = this.worlds.get(id);
    if (w) this.worlds.set(id, { ...w, archivedAt: Date.now() });
  }

  async unarchive(id: WorldId): Promise<void> {
    const w = this.worlds.get(id);
    if (w) this.worlds.set(id, { ...w, archivedAt: null });
  }

  async hardDelete(id: WorldId): Promise<void> {
    this.worlds.delete(id);
    this.memberships = this.memberships.filter((m) => m.worldId !== id);
  }

  async addMembership(input: {
    worldId: WorldId;
    userId: string;
    role: WorldRole;
  }): Promise<void> {
    this.memberships = this.memberships.filter(
      (m) => !(m.worldId === input.worldId && m.userId === input.userId),
    );
    this.memberships.push({ ...input, addedAt: Date.now() });
  }

  async removeMembership(worldId: WorldId, userId: string): Promise<void> {
    this.memberships = this.memberships.filter(
      (m) => !(m.worldId === worldId && m.userId === userId),
    );
  }

  async listMemberships(worldId: WorldId): Promise<MembershipRecord[]> {
    return this.memberships.filter((m) => m.worldId === worldId);
  }

  async worldsForUser(userId: string): Promise<WorldRecord[]> {
    const memberWorldIds = new Set(
      this.memberships.filter((m) => m.userId === userId).map((m) => m.worldId),
    );
    const out: WorldRecord[] = [];
    for (const w of this.worlds.values()) {
      if (w.archivedAt !== null) continue;
      if (w.ownerUserId === userId || memberWorldIds.has(w.id)) out.push(w);
    }
    return out;
  }
}
