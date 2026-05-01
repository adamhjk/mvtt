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

import { createResource, type ResourceReturn } from "solid-js";
import { useClient } from "@vtt/substrate/client";

export interface WorldMember {
  userId: string;
  name: string;
  email: string;
  role: "gm" | "player";
}

export interface WorldMembers {
  owner: WorldMember;
  members: WorldMember[];
}

interface MembershipsResponse {
  owner: { userId: string; name: string; email: string };
  members: Array<{
    userId: string;
    name: string;
    email: string;
    role: "gm" | "player";
    addedAt: number;
  }>;
}

/**
 * Persistent membership list for the current world: owner + every
 * invited member, regardless of online status. Sourced from the
 * substrate's `/api/worlds/:id/memberships` HTTP route — these rows
 * outlive WebSocket connections, so they're the right basis for any
 * UI that needs to show "who can play here", not "who's online now".
 *
 * Used by the character sheet's player-assignment dropdown so a
 * character stays visibly assigned to its player even when that
 * player is logged out.
 */
export function useWorldMembers(): ResourceReturn<WorldMembers | null> {
  const client = useClient();
  return createResource(
    () => client.worldId(),
    async (worldId) => {
      if (!worldId) return null;
      const res = await fetch(
        `/api/worlds/${encodeURIComponent(worldId)}/memberships`,
        { credentials: "same-origin" },
      );
      if (!res.ok) throw new Error(`memberships → ${res.status}`);
      const body = (await res.json()) as MembershipsResponse;
      const result: WorldMembers = {
        owner: {
          userId: body.owner.userId,
          name: body.owner.name,
          email: body.owner.email,
          role: "gm",
        },
        members: body.members.map((m) => ({
          userId: m.userId,
          name: m.name,
          email: m.email,
          role: m.role,
        })),
      };
      return result;
    },
  );
}
