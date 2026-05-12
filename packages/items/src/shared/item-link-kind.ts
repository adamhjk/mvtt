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

import { type EntityId } from "@vtt/substrate";
import { defineLinkKind, type LinkSuggestion } from "@vtt/notes/shared";
import { ItemIdentity } from "./traits.js";
import { ItemCreated, ItemDestroyed, ItemFieldChanged } from "./events.js";

export interface ItemRef {
  readonly itemId: EntityId;
}

/**
 * Wiki-link kind for items. `[[item:Sword]]` or `[[item:<entityId>]]`
 * resolves to a catalog item entity, lets carries reference it from
 * a character / monster / loot block, and offers autocomplete from
 * every `ItemIdentity`-bearing entity in the world.
 *
 * Resolution accepts either the entity id (any string `world.has(id)`)
 * or a case-insensitive name match against `ItemIdentity.name`. Names
 * are not guaranteed unique in TB (two scrolls of "Light", e.g.); the
 * first match wins. Authors who care can disambiguate by entity id
 * (which the autocomplete picker inserts post-normalisation).
 *
 * activate(): peek popover by default. Cmd-click could later route
 * to an item-details tab; for v1 a peek is enough.
 */
export const itemLinkKind = defineLinkKind<ItemRef>({
  name: "item",
  parse: (body, _anchor, world) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return null;
    if (world.has(trimmed as EntityId)) {
      const got = world.get(trimmed as EntityId, [ItemIdentity]);
      if (got) return { itemId: trimmed as EntityId };
    }
    const needle = trimmed.toLowerCase();
    for (const row of world.query([ItemIdentity])) {
      const v = row.values.ItemIdentity as { name: string };
      if (v.name.toLowerCase() === needle) return { itemId: row.id };
    }
    return null;
  },
  display: (ref, world) => {
    const got = world.get(ref.itemId, [ItemIdentity]) as
      | { ItemIdentity: { name: string } }
      | undefined;
    return got?.ItemIdentity.name ?? "(missing item)";
  },
  target: (ref) => ({ entityId: ref.itemId }),
  activate: (ref) => ({
    // Peek shows a minimal item card. Full item-detail tab can be a
    // later page-kind registration; for now the peek is enough to
    // confirm the GM picked the right thing.
    type: "peek",
    render: () => `Item ${ref.itemId}`,
  }),
  autocomplete: (query, world) => {
    const needle = query.trim().toLowerCase();
    const out: LinkSuggestion[] = [];
    for (const row of world.query([ItemIdentity])) {
      const v = row.values.ItemIdentity as { name: string };
      if (needle.length > 0 && !v.name.toLowerCase().includes(needle)) continue;
      out.push({
        kind: "item",
        body: row.id,
        display: v.name,
        badge: "Item",
      });
      if (out.length >= 50) break;
    }
    return out;
  },
  indexEvents: [
    ItemCreated.name,
    ItemDestroyed.name,
    ItemFieldChanged.name,
  ],
});
