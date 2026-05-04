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

import { defineSystem } from "@vtt/substrate";
import { Permissions, ownedBy } from "@vtt/permissions/shared";
import {
  RulesCorpusRemoved,
  RulesIndexingCompleted,
  RulesIndexingFailed,
  RulesIndexingStarted,
} from "../shared/events.js";
import { RulesCorpus, RulesLibrary, RULES_LIBRARY_SENTINEL_ID } from "../shared/traits.js";

/**
 * Universal mirror: spawn the corpus entity in `pending` state on
 * `RulesIndexingStarted`. Also lazily spawns the `RulesLibrary`
 * sentinel the first time any corpus is added — before that point
 * the world has no rules library and the GM-only `RulesLibraryView`
 * shows an empty state.
 *
 * Permissions: corpora default to `ownedBy(GM)` semantics inherited
 * from the dispatching session. Read defaults to everyone (so all
 * world members can search rules); write defaults to GM-only.
 */
export const CorpusSpawningSystem = defineSystem({
  name: "RulesCorpusSpawning",
  on: RulesIndexingStarted,
  reads: [],
  writes: [RulesLibrary, RulesCorpus, Permissions],
  run: ({ event, world }) => {
    // Lazily ensure the library sentinel exists at its deterministic
    // id. Spawning via `world.spawn()` here would be a universal-mirror
    // bug — server and client each consume their next counter id for
    // the sentinel, advancing `nextId` differently and silently
    // colliding with the next `spawnAt(corpusId)` call. Using a fixed
    // non-`e<n>` id keeps both sides in lockstep and out of the
    // counter space.
    if (!world.has(RULES_LIBRARY_SENTINEL_ID)) {
      world.spawnAt(RULES_LIBRARY_SENTINEL_ID, [RulesLibrary({})]);
    }
    world.spawnAt(event.corpusId, [
      RulesCorpus({
        assetId: event.assetId,
        status: "pending",
        error: null,
        tags: event.tags,
        indexedAt: null,
        pageCount: null,
        title: null,
        gameSystemPlugin: event.gameSystemPlugin,
      }),
      // Default: world-readable, GM-writable. The dispatching command
      // is GM-only, so the corpus owner is implicitly the GM session
      // when the universal mirror runs server-side. On the client, we
      // mirror with a placeholder owner — the trait shape just needs
      // to be present and the actual permissions get reconciled on
      // server-emitted events.
      Permissions(ownedBy("server")),
    ]);
    return [];
  },
});

/**
 * Universal mirror: status: "pending" → "indexing" → "ready" /
 * "failed". On success, fills in `pageCount`, `title`, `indexedAt`.
 * On failure, populates `error`. Never deletes the entity — the GM
 * has to RemoveRulesCorpus explicitly to make a failed extraction
 * disappear, which is intentional (failures should be visible).
 */
export const CorpusStatusMirror = defineSystem({
  name: "RulesCorpusStatusMirror",
  on: RulesIndexingCompleted,
  reads: [RulesCorpus],
  writes: [RulesCorpus],
  run: ({ event, world }) => {
    if (!world.has(event.corpusId)) return [];
    const got = world.get(event.corpusId, [RulesCorpus]) as
      | { RulesCorpus: { assetId: string; tags: string[]; gameSystemPlugin: string | null } }
      | undefined;
    if (!got) return [];
    world.set(event.corpusId, RulesCorpus, {
      assetId: got.RulesCorpus.assetId as never,
      status: "ready",
      error: null,
      tags: got.RulesCorpus.tags,
      indexedAt: event.indexedAt,
      pageCount: event.pageCount,
      title: event.title,
      gameSystemPlugin: got.RulesCorpus.gameSystemPlugin,
    });
    return [];
  },
});

export const CorpusFailureMirror = defineSystem({
  name: "RulesCorpusFailureMirror",
  on: RulesIndexingFailed,
  reads: [RulesCorpus],
  writes: [RulesCorpus],
  run: ({ event, world }) => {
    if (!world.has(event.corpusId)) return [];
    const got = world.get(event.corpusId, [RulesCorpus]) as
      | {
          RulesCorpus: {
            assetId: string;
            tags: string[];
            indexedAt: number | null;
            pageCount: number | null;
            title: string | null;
            gameSystemPlugin: string | null;
          };
        }
      | undefined;
    if (!got) return [];
    world.set(event.corpusId, RulesCorpus, {
      assetId: got.RulesCorpus.assetId as never,
      status: "failed",
      error: event.error,
      tags: got.RulesCorpus.tags ?? [],
      indexedAt: got.RulesCorpus.indexedAt,
      pageCount: got.RulesCorpus.pageCount,
      title: got.RulesCorpus.title,
      gameSystemPlugin: got.RulesCorpus.gameSystemPlugin,
    });
    return [];
  },
});

/**
 * Universal mirror: despawn on `RulesCorpusRemoved`. The server-only
 * cleanup hook (registered in `@vtt/server/main.ts`) handles the
 * SQL DELETE and the on-disk corpus directory; both run idempotently
 * so order doesn't matter.
 */
export const CorpusDespawnSystem = defineSystem({
  name: "RulesCorpusDespawn",
  on: RulesCorpusRemoved,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.corpusId)) world.despawn(event.corpusId);
    return [];
  },
});
