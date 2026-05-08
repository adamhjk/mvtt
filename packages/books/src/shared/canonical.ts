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

import type { EntityId, World } from "@vtt/substrate";
import { BookCanonical, CanonicalBookCatalog } from "./traits.js";

export interface CanonicalBookEntry {
  readonly id: string;
  readonly name: string;
}

/**
 * Plugin-side seed helper. Spawns (or replaces) the
 * CanonicalBookCatalog sentinel for `pluginName` with the given
 * entries. Idempotent: if a sentinel for this plugin already exists,
 * its `entries` field is replaced wholesale — re-running the seed with
 * a new entries list lets the plugin add or remove canonical book ids
 * across upgrades without leaking stale rows.
 *
 * Plugins call this from their own `definePlugin.seed`:
 *
 *   seed: (ctx) => {
 *     seedCanonicalBookCatalog(ctx.world, "@vtt/system-torchbearer", [
 *       { id: "tb/book/scholars-guide", name: "TB2: Scholar's Guide" },
 *       …
 *     ]);
 *   }
 *
 * No-op when entries is empty AND no sentinel exists yet (so plugins
 * that don't actually contribute any canonical books don't pollute
 * the world with empty sentinels).
 */
export function seedCanonicalBookCatalog(
  world: World,
  pluginName: string,
  entries: ReadonlyArray<CanonicalBookEntry>,
): void {
  const existing = findCanonicalBookCatalogId(world, pluginName);
  if (existing === null) {
    if (entries.length === 0) return;
    world.spawn([
      CanonicalBookCatalog({
        pluginName,
        entries: entries.map((e) => ({ id: e.id, name: e.name })),
      }),
    ]);
    return;
  }
  world.set(existing, CanonicalBookCatalog, {
    pluginName,
    entries: entries.map((e) => ({ id: e.id, name: e.name })),
  });
}

function findCanonicalBookCatalogId(
  world: World,
  pluginName: string,
): EntityId | null {
  for (const row of world.query([CanonicalBookCatalog])) {
    const v = row.values.CanonicalBookCatalog as { pluginName: string };
    if (v.pluginName === pluginName) return row.id;
  }
  return null;
}

/**
 * Resolve a canonicalId to the Book entity that currently holds it,
 * or null if no Book in this world is bound to that id.
 *
 * Linear scan over every BookCanonical-bearing entity. Worlds have a
 * small number of Books (~1–10) and citations are rendered at view
 * time, so this is fast enough — if it ever isn't, materialize a
 * sentinel `CanonicalBookIndex` map maintained by the same system that
 * writes the trait. Not done yet because the cost isn't justified.
 */
export function getCanonicalBook(
  world: World,
  canonicalId: string,
): EntityId | null {
  for (const row of world.query([BookCanonical])) {
    const v = row.values.BookCanonical as { canonicalId: string };
    if (v.canonicalId === canonicalId) return row.id;
  }
  return null;
}

/**
 * Read all registered catalog entries from every plugin's sentinel.
 * Returns a flat list of `{ pluginName, id, name }`. Used by the
 * Config-tab dropdown and any other "what canonical books can the GM
 * pick from?" surface.
 */
export function listCanonicalBookCatalogs(
  world: World,
): ReadonlyArray<CanonicalBookEntry & { pluginName: string }> {
  const out: Array<CanonicalBookEntry & { pluginName: string }> = [];
  for (const row of world.query([CanonicalBookCatalog])) {
    const v = row.values.CanonicalBookCatalog as {
      pluginName: string;
      entries: ReadonlyArray<{ id: string; name: string }>;
    };
    for (const e of v.entries) {
      out.push({ pluginName: v.pluginName, id: e.id, name: e.name });
    }
  }
  return out;
}

/**
 * Reverse lookup. Returns the canonicalId currently bound to a Book,
 * or null if it isn't bound to anything. Used by the Config-tab
 * dropdown to seed its current value.
 */
export function getBookCanonicalId(
  world: World,
  bookId: EntityId,
): string | null {
  const got = world.get(bookId, [BookCanonical]) as
    | { BookCanonical: { canonicalId: string } }
    | undefined;
  return got?.BookCanonical.canonicalId ?? null;
}
