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

import type { EntityId, QualifiedName } from "@vtt/substrate";
import { useClient } from "@vtt/substrate/client";
import { useFollowLink } from "@vtt/shell-workbench/client";
import { TbMonster, TbNpc } from "../../shared/index.js";

// Page-provider kinds the conflict surface routes to. Kept inline
// (not imported) because the providers live in unrelated packages
// and the kind strings are stable substrate-wide identifiers.
const CHARACTERS_PAGE_KIND = "@vtt/characters/characters" as QualifiedName;
const MONSTERS_PAGE_KIND = "@vtt/system-torchbearer/monsters" as QualifiedName;
const NPCS_PAGE_KIND = "@vtt/system-torchbearer/npcs" as QualifiedName;

/**
 * Returns a click handler that follows a deep link to a character /
 * monsters / NPCs entry. Monsters (entities carrying `TbMonster`)
 * route to the Monsters page; NPCs (entities carrying `TbNpc`) route
 * to the NPCs page; everything else to the Characters page.
 *
 * Powered by `useFollowLink`, so it inherits the canonical wikilink
 * behavior:
 *
 *   - plain click → smart retarget (focus exact match if any, else
 *                   flip the best same-kind tab to this entity, else
 *                   open new in the active pane).
 *   - Cmd/Ctrl    → always open new tab in the active pane.
 *   - Shift       → always open in a new split (target lands beside).
 *
 * Pass the click event so modifiers are honored. Multi-spawn rosters
 * (Barrow Wight 1/2/3) all share one `characterId`, so every variant
 * resolves to the single shared monsters entry.
 */
export function useOpenCharacterSheet(): (
  characterId: EntityId,
  e?: MouseEvent | KeyboardEvent,
) => void {
  const client = useClient();
  const follow = useFollowLink();
  return (characterId, e) => {
    const isMonster = client.world.get(characterId, [TbMonster]) !== undefined;
    const isNpc = client.world.get(characterId, [TbNpc]) !== undefined;
    const pageKind = isMonster ? MONSTERS_PAGE_KIND : isNpc ? NPCS_PAGE_KIND : CHARACTERS_PAGE_KIND;
    follow(
      {
        pageKind,
        entityId: characterId,
      },
      e,
    );
  };
}
