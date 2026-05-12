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
import { SpellIdentity } from "./spells/spell-traits.js";
import {
  SpellCreated,
  SpellFieldEdited,
  SpellRemoved,
} from "./spells/spell-events.js";

interface SpellRef {
  readonly spellId: EntityId;
}

/**
 * Wiki-link kind for spells. `[[spell:Wayfinder's Friend]]` resolves
 * to the catalog spell entity by name; `[[spell:e123]]` resolves by
 * id. Click routes to the Arcane workbench page targeting the spell.
 *
 * Spells are seeded at world boot via `runSpellCatalogMerge` and
 * carry the universal `SpellIdentity` trait (name + circle + school).
 * The autocomplete enumerates every SpellIdentity-carrying entity so
 * homebrew spells (forked via `SpellForked`) appear alongside canon.
 *
 * Index events: refresh on create / remove (changes the autocomplete
 * surface) and on field-edit (the printed name is read from
 * `SpellIdentity.name`, so a rename has to repaint every reference).
 */
export const spellLinkKind = defineLinkKind<SpellRef>({
  name: "spell",
  parse: (body, _anchor, world) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return null;
    if (world.has(trimmed as EntityId)) {
      const got = world.get(trimmed as EntityId, [SpellIdentity]);
      if (got) return { spellId: trimmed as EntityId };
    }
    const needle = trimmed.toLowerCase();
    for (const row of world.query([SpellIdentity])) {
      const v = row.values.SpellIdentity as { name: string };
      if (v.name.toLowerCase() === needle) return { spellId: row.id };
    }
    return null;
  },
  display: (ref, world) => {
    const got = world.get(ref.spellId, [SpellIdentity]) as
      | { SpellIdentity: { name: string } }
      | undefined;
    return got?.SpellIdentity.name ?? "(missing spell)";
  },
  target: (ref) => ({ entityId: ref.spellId }),
  activate: (ref) => ({
    type: "navigate",
    pageKind: "@vtt/system-torchbearer/arcane",
    entityId: ref.spellId,
  }),
  autocomplete: (query, world) => {
    const needle = query.trim().toLowerCase();
    const out: LinkSuggestion[] = [];
    for (const row of world.query([SpellIdentity])) {
      const v = row.values.SpellIdentity as { name: string };
      if (needle.length > 0 && !v.name.toLowerCase().includes(needle)) continue;
      out.push({
        kind: "spell",
        body: row.id,
        display: v.name,
        badge: "Spell",
      });
    }
    return out;
  },
  indexEvents: [
    SpellCreated.name,
    SpellRemoved.name,
    SpellFieldEdited.name,
  ],
});
