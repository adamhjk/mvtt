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
import { Character } from "@vtt/characters/shared";
import { NpcCreated, NpcRemoved } from "./npc-events.js";
import { TbNpc } from "./npc-traits.js";

interface NpcRef {
  readonly npcId: EntityId;
}

/**
 * NPC link kind — `[[npc:Skarra]]` resolves to an entity that has both
 * `Character` and `TbNpc`. Distinct from `character:` (which excludes
 * `TbNpc`-bearing entities via the `CharacterListExclusionSlot`),
 * because the conceptual entity types are different in the UI: NPCs
 * live on the NPCs page, PCs live on the Characters page, and the
 * sheets render differently.
 *
 * Resolution mirrors `characterLinkKind`: entity id first, then
 * case-insensitive name match. Click activates the NPCs tab pointed
 * at the entity — same workflow as clicking an NPC row on the NPCs
 * page directly.
 *
 * No sigil — `@` is owned by `characterLinkKind`. NPCs are typed by
 * `npc:` prefix only, which is fine: an author who knows the entity
 * is an NPC reaches for `[[npc:` directly; an author who isn't sure
 * uses `[[@` and the autocomplete steers them to the right kind.
 */
export const npcLinkKind = defineLinkKind<NpcRef>({
  name: "npc",
  parse: (body, _anchor, world) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return null;
    if (world.has(trimmed as EntityId)) {
      const got = world.get(trimmed as EntityId, [Character, TbNpc]);
      if (got) return { npcId: trimmed as EntityId };
    }
    const needle = trimmed.toLowerCase();
    for (const row of world.query([Character, TbNpc])) {
      const v = row.values.Character as { name: string };
      if (v.name.toLowerCase() === needle) return { npcId: row.id };
    }
    return null;
  },
  display: (ref, world) => {
    const got = world.get(ref.npcId, [Character, TbNpc]) as
      | { Character: { name: string }; TbNpc: { role: string } }
      | undefined;
    if (!got) return "(missing npc)";
    return got.Character.name;
  },
  target: (ref) => ({ entityId: ref.npcId }),
  activate: (ref) => ({
    type: "navigate",
    pageKind: "@vtt/system-torchbearer/npcs",
    entityId: ref.npcId,
  }),
  autocomplete: (query, world) => {
    const needle = query.trim().toLowerCase();
    const out: LinkSuggestion[] = [];
    for (const row of world.query([Character, TbNpc])) {
      const v = row.values.Character as { name: string };
      const role = (row.values.TbNpc as { role: string }).role;
      if (needle.length > 0 && !v.name.toLowerCase().includes(needle)) continue;
      out.push({
        kind: "npc",
        body: row.id,
        display: v.name,
        badge: role || "NPC",
      });
    }
    return out;
  },
  indexEvents: [NpcCreated.name, NpcRemoved.name],
});
