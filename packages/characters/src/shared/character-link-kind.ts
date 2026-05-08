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

import {
  type EntityId,
  type Registry,
  type TraitMeta,
  type World,
} from "@vtt/substrate";
import { defineLinkKind, type LinkSuggestion } from "@vtt/notes/shared";
import { Character } from "./traits.js";
import { CharacterListExclusionSlot } from "./slot.js";
import {
  CharacterCreated,
  CharacterRenamed,
  CharacterRemoved,
} from "./events.js";

interface CharacterRef {
  readonly characterId: EntityId;
}

/**
 * Read the same exclusion-trait list the Characters page uses to hide
 * monsters / NPCs / etc. from its hub list. Game-system plugins fill
 * `CharacterListExclusionSlot` with the trait that marks their
 * archetype (e.g. torchbearer registers `TbMonster`); the `@`-link
 * kind defined here treats those archetypes as out-of-scope so they
 * neither autocomplete as `@`-characters nor parse to one — they get
 * their own link kinds with their own destinations (e.g.
 * `monsterLinkKind` → bestiary).
 */
function exclusionTraits(registry: Registry | undefined): TraitMeta[] {
  if (!registry) return [];
  const fills = (registry.fillsForSlot(CharacterListExclusionSlot) ??
    []) as ReadonlyArray<{ matchTrait: TraitMeta }>;
  return fills.map((f) => f.matchTrait);
}

function isExcluded(
  world: World,
  characterId: EntityId,
  excluded: ReadonlyArray<TraitMeta>,
): boolean {
  for (const trait of excluded) {
    if (world.get(characterId, [trait])) return true;
  }
  return false;
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
  parse: (body, _anchor, world, registry) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return null;
    const excluded = exclusionTraits(registry);
    if (/^e\d+$/.test(trimmed) && world.has(trimmed as EntityId)) {
      const got = world.get(trimmed as EntityId, [Character]);
      if (got && !isExcluded(world, trimmed as EntityId, excluded)) {
        return { characterId: trimmed as EntityId };
      }
    }
    const needle = trimmed.toLowerCase();
    for (const row of world.query([Character])) {
      if (isExcluded(world, row.id, excluded)) continue;
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
  autocomplete: (query, world, registry) => {
    const needle = query.trim().toLowerCase();
    const excluded = exclusionTraits(registry);
    const out: LinkSuggestion[] = [];
    for (const row of world.query([Character])) {
      if (isExcluded(world, row.id, excluded)) continue;
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
