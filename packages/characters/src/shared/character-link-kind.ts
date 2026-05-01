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

import { type EntityId, type World } from "@vtt/substrate";
import { defineLinkKind, type LinkSuggestion } from "@vtt/notes/shared";
import { Character } from "./traits.js";
import {
  CharacterCreated,
  CharacterRenamed,
  CharacterRemoved,
} from "./events.js";

interface CharacterRef {
  readonly characterId: EntityId;
}

/**
 * Character link kind. Sigil `@` so chat-style mentions like
 * `[[@Krell]]` work everywhere wiki-links are parsed (chat composer,
 * note bodies, scene descriptions, …).
 *
 * Resolution: a typed body is treated as either an entity id (`e\d+`)
 * or a character name (case-insensitive exact match). Display reads
 * `Character.name` reactively, so renames propagate to every chip.
 *
 * Click semantics: navigate to the Characters tab targeting this
 * entity. The notes dispatcher uses OpenPage semantics, so a click
 * focuses an already-open Characters tab pointed at this character,
 * or opens a new one in the active pane if none exists.
 */
export const characterLinkKind = defineLinkKind<CharacterRef>({
  name: "character",
  sigil: "@",
  parse: (body, _anchor, world) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return null;
    if (/^e\d+$/.test(trimmed) && world.has(trimmed as EntityId)) {
      const got = world.get(trimmed as EntityId, [Character]);
      if (got) return { characterId: trimmed as EntityId };
    }
    const needle = trimmed.toLowerCase();
    for (const row of world.query([Character])) {
      const v = row.values.Character as { name: string };
      if (v.name.toLowerCase() === needle) {
        return { characterId: row.id };
      }
    }
    return null;
  },
  display: (ref, world) => {
    const got = world.get(ref.characterId, [Character]) as
      | { Character: { name: string } }
      | undefined;
    return got?.Character.name ?? "(missing character)";
  },
  target: (ref) => ({ entityId: ref.characterId }),
  activate: (ref) => ({
    type: "navigate",
    pageKind: "@vtt/characters/characters",
    entityId: ref.characterId,
  }),
  autocomplete: (query, world) => {
    const needle = query.trim().toLowerCase();
    const out: LinkSuggestion[] = [];
    for (const row of world.query([Character])) {
      const v = row.values.Character as { name: string };
      if (needle.length > 0 && !v.name.toLowerCase().includes(needle)) continue;
      out.push({
        kind: "character",
        body: row.id,
        display: v.name,
        badge: "Character",
      });
    }
    return out;
  },
  indexEvents: [
    CharacterCreated.name,
    CharacterRenamed.name,
    CharacterRemoved.name,
  ],
});
