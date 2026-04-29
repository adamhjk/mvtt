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
