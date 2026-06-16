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
  type EntityId,
  type Recipient,
  type WorldId,
  type WorldsRegistry,
  type WorldRuntime,
} from "@vtt/substrate";
import type { AuthSession } from "@vtt/auth";
import { RulesCorpus } from "../shared/index.js";
import type { RulesSearchHit, RulesSearchIndex } from "./search-index.js";

export type AuthenticateForWorld = (
  req: IncomingMessage,
  worldId: WorldId,
) => Promise<AuthSession | null>;

export interface RulesSearchDeps {
  registry: WorldsRegistry;
  index: RulesSearchIndex;
  authenticate: AuthenticateForWorld;
}

/**
 * GET /api/worlds/:worldId/rules/search?q=…&corpusId=…&limit=25
 *
 * Mirrors the notes-search route shape: FTS5 query → post-filter by
 * per-recipient EntityVisibility on each candidate corpus → return at
 * most `limit` survivors with snippet + page numbers + headingPath +
 * corpusId.
 *
 * `corpusId` is optional. When omitted, the search runs across every
 * corpus in the world; per-corpus visibility is then enforced by
 * dropping hits whose corpus the recipient can't read. When provided,
 * the legacy single-corpus path is taken (cheaper, used only by per-
 * corpus admin views).
 */
export async function handleRulesSearch(
  req: IncomingMessage,
  res: ServerResponse,
  worldId: WorldId,
  q: string,
  corpusId: EntityId | null,
  limit: number,
  deps: RulesSearchDeps,
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

  if (corpusId !== null) {
    if (!runtime.world.has(corpusId)) {
      sendJson(res, 404, { error: "corpus not found" });
      return;
    }
    const got = runtime.world.get(corpusId, [RulesCorpus]) as
      | { RulesCorpus: { status: string } }
      | undefined;
    if (!got) {
      sendJson(res, 404, { error: "entity is not a RulesCorpus" });
      return;
    }
    if (got.RulesCorpus.status !== "ready") {
      sendJson(res, 409, { error: `corpus is ${got.RulesCorpus.status}` });
      return;
    }
    if (!corpusVisible(runtime, corpusId, recipient)) {
      sendJson(res, 403, { error: "not authorised for this corpus" });
      return;
    }
    const hits = deps.index.query({ worldId, corpusId, q, limit });
    sendJson(res, 200, {
      hits: hits.map(serialiseHit),
      queryEcho: q,
    });
    return;
  }

  // Cross-corpus path: fetch with a generous slack so we can drop
  // visibility-filtered hits without losing the requested limit, then
  // truncate.
  const fetchLimit = Math.min(Math.max(limit * 2, limit + 10), 100);
  const raw = deps.index.queryAll({ worldId, q, limit: fetchLimit });
  // Cache visibility decisions per corpus so the per-row filter is O(N)
  // in candidates, not O(N × corpora).
  const cache = new Map<string, boolean>();
  const visible = (id: EntityId): boolean => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    if (!runtime.world.has(id)) {
      cache.set(id, false);
      return false;
    }
    const got = runtime.world.get(id, [RulesCorpus]) as
      | { RulesCorpus: { status: string } }
      | undefined;
    if (!got || got.RulesCorpus.status !== "ready") {
      cache.set(id, false);
      return false;
    }
    const ok = corpusVisible(runtime, id, recipient);
    cache.set(id, ok);
    return ok;
  };
  const hits: typeof raw = [];
  for (const hit of raw) {
    if (!visible(hit.corpusId)) continue;
    hits.push(hit);
    if (hits.length >= limit) break;
  }
  sendJson(res, 200, {
    hits: hits.map(serialiseHit),
    queryEcho: q,
  });
}

function corpusVisible(runtime: WorldRuntime, corpusId: EntityId, recipient: Recipient): boolean {
  if (recipient.role === "gm") return true;
  const out: Record<string, unknown> = {};
  for (const [name, def] of runtime.registry.traits) {
    const got = runtime.world.get(corpusId, [def]);
    if (got !== undefined) {
      const short = name.split("/").pop() ?? name;
      const v = (got as Record<string, unknown>)[short];
      if (v !== undefined) out[name] = v;
    }
  }
  const vis = runtime.registry.resolveEntityVisibility(out);
  if (vis === null) return true;
  return matches(vis, recipient);
}

/**
 * Stable JSON shape for the wire. We strip the BM25 score (it's
 * relative, not meaningful to the UI) and keep everything else.
 */
function serialiseHit(hit: RulesSearchHit): {
  corpusId: EntityId;
  chunkId: string;
  pdfPage: number;
  pdfPageEnd: number | null;
  printedPage: string | number | null;
  printedPageEnd: string | number | null;
  headingPath: string[];
  snippet: string;
} {
  return {
    corpusId: hit.corpusId,
    chunkId: hit.chunkId,
    pdfPage: hit.pdfPage,
    pdfPageEnd: hit.pdfPageEnd,
    printedPage: hit.printedPage,
    printedPageEnd: hit.printedPageEnd,
    headingPath: [...hit.headingPath],
    snippet: hit.snippet,
  };
}

function sendJson(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
