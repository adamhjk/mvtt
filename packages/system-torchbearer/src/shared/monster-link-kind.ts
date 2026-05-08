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
import { Character, CharacterRenamed } from "@vtt/characters/shared";
import { TbMonster } from "./monster-traits.js";
import { MonsterCreated, MonsterRemoved } from "./monster-events.js";

interface MonsterRef {
  readonly characterId: EntityId;
}

/**
 * Wikilink kind for bestiary monsters. Sigil `!` so a danger-flavored
 * mention reads naturally — `[[!Barrow Wight]]`. Distinct from the
 * `@`-character kind so monsters:
 *
 *   1. don't pollute character autocomplete (the `@` kind already
 *      filters them via `CharacterListExclusionSlot`),
 *   2. activate to the **Bestiary** workbench page rather than the
 *      Characters page — clicking the link opens the monster sheet
 *      in the bestiary tab.
 *
 * A monster is a Character entity that *also* carries `TbMonster`.
 * Multi-spawn rosters in conflicts (Barrow Wight 1/2/3) all share the
 * single bestiary character entity, so a monster wikilink resolves to
 * the catalog entry — same target the conflict's per-row name button
 * resolves to.
 *
 * Index events: refresh on monster create / remove (changes the set
 * of valid targets) and on character rename (the printed bestiary
 * label is the underlying `Character.name`, so the autocomplete
 * display has to track renames).
 */
export const monsterLinkKind = defineLinkKind<MonsterRef>({
  name: "monster",
  sigil: "!",
  parse: (body, _anchor, world) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return null;
    const isMonster = (id: EntityId): boolean =>
      world.has(id) &&
      world.get(id, [Character]) !== undefined &&
      world.get(id, [TbMonster]) !== undefined;
    if (/^e\d+$/.test(trimmed)) {
      const id = trimmed as EntityId;
      if (isMonster(id)) return { characterId: id };
    }
    const needle = trimmed.toLowerCase();
    for (const row of world.query([Character, TbMonster])) {
      const v = row.values.Character as { name: string };
      if (v.name.toLowerCase() === needle) return { characterId: row.id };
    }
    return null;
  },
  display: (ref, world) => {
    const got = world.get(ref.characterId, [Character]) as
      | { Character: { name: string } }
      | undefined;
    return got?.Character.name ?? "(missing monster)";
  },
  target: (ref) => ({ entityId: ref.characterId }),
  activate: (ref) => ({
    type: "navigate",
    pageKind: "@vtt/system-torchbearer/bestiary",
    entityId: ref.characterId,
  }),
  autocomplete: (query, world) => {
    const needle = query.trim().toLowerCase();
    const out: LinkSuggestion[] = [];
    for (const row of world.query([Character, TbMonster])) {
      const v = row.values.Character as { name: string };
      if (needle.length > 0 && !v.name.toLowerCase().includes(needle)) continue;
      out.push({
        kind: "monster",
        body: row.id,
        display: v.name,
        badge: "Bestiary",
      });
    }
    return out;
  },
  // `MonsterCreated` / `MonsterRemoved` track the set of monsters;
  // `CharacterRenamed` keeps the printed label fresh (rename of the
  // shared catalog entry has to repaint every reference to it).
  indexEvents: [
    MonsterCreated.name,
    MonsterRemoved.name,
    CharacterRenamed.name,
  ],
});
