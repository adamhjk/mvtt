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

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  matches,
  type Recipient,
  type WorldId,
  type WorldsRegistry,
  type WorldRuntime,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import type { NotesSearchIndex, SearchHit } from "./search.js";

export type AuthenticateForWorld = (
  req: IncomingMessage,
  worldId: WorldId,
) => Promise<AuthSession | null>;

export interface NotesSearchDeps {
  registry: WorldsRegistry;
  index: NotesSearchIndex;
  authenticate: AuthenticateForWorld;
}

/**
 * GET /api/worlds/:id/notes/search?q=…&limit=25
 *
 * Runs the FTS5 query, then post-filters hits by per-recipient
 * EntityVisibility on each candidate page entity. Returns at most
 * `limit` survivors with snippet + page/note titles.
 */
export async function handleNotesSearch(
  req: IncomingMessage,
  res: ServerResponse,
  worldId: WorldId,
  q: string,
  limit: number,
  deps: NotesSearchDeps,
): Promise<void> {
  const session = await deps.authenticate(req, worldId);
  if (!session) {
    sendJson(res, 401, { error: "not authenticated or not a world member" });
    return;
  }

  let runtime: WorldRuntime;
  try {
    runtime = await deps.registry.acquire(worldId);
  } catch (err) {
    sendJson(res, 404, { error: (err as Error).message });
    return;
  }

  const recipient: Recipient = {
    userId: session.userId,
    role: session.role,
  };
  const candidates = deps.index.query({ worldId, q, limit: limit * 2 });
  const allowed: SearchHit[] = [];
  for (const hit of candidates) {
    if (allowed.length >= limit) break;
    if (!visiblePage(runtime, hit.pageId, hit.noteId, recipient)) continue;
    allowed.push(hit);
  }
  sendJson(res, 200, { hits: allowed });
}

function visiblePage(
  runtime: WorldRuntime,
  pageId: string,
  noteId: string,
  recipient: Recipient,
): boolean {
  // Both note and page get checked — the substrate's resolver returns
  // a Visibility per entity when the trait is present, null otherwise.
  // Either denying = denied.
  if (!entityVisible(runtime, noteId, recipient)) return false;
  if (!entityVisible(runtime, pageId, recipient)) return false;
  return true;
}

function entityVisible(
  runtime: WorldRuntime,
  entityId: string,
  recipient: Recipient,
): boolean {
  if (!runtime.world.has(entityId)) return false;
  // Collect the entity's traits as the resolver expects.
  const out: Record<string, unknown> = {};
  for (const [name, def] of runtime.registry.traits) {
    const got = runtime.world.get(entityId, [def]);
    if (got !== undefined) {
      const short = name.split("/").pop() ?? name;
      const v = (got as Record<string, unknown>)[short];
      if (v !== undefined) out[name] = v;
    }
  }
  // GM bypass mirrors the snapshot filter — GMs see every entity.
  if (recipient.role === "gm") return true;
  const vis = runtime.registry.resolveEntityVisibility(out);
  if (vis === null) return true;
  return matches(vis, recipient);
}

function sendJson(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
