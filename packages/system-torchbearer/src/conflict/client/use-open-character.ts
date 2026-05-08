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

import type { CommandInstance, EntityId } from "@vtt/substrate";
import { useClient } from "@vtt/substrate/client";
import { OpenPage } from "@vtt/shell-workbench/shared";
import { TbMonster } from "../../shared/index.js";

// Page-provider kinds the conflict surface routes to. Kept inline
// (not imported) because the providers live in unrelated packages
// and the kind strings are stable substrate-wide identifiers.
const CHARACTERS_PAGE_KIND = "@vtt/characters/characters";
const BESTIARY_PAGE_KIND = "@vtt/system-torchbearer/bestiary";

/**
 * Returns a click handler that opens the right workbench page for a
 * character entity. Monsters (entities carrying `TbMonster`) route
 * to the Bestiary page; everything else to the Characters page.
 *
 * `OpenPage` reuses an existing tab for the same `(pageKind,
 * entityId)` if one's already open (focuses it + its pane);
 * otherwise it opens a new tab in the active pane. So the handler
 * matches the user's mental model of "click a name, focus that
 * sheet" without ever stranding duplicate tabs.
 */
export function useOpenCharacterSheet(): (characterId: EntityId) => void {
  const client = useClient();
  return (characterId: EntityId): void => {
    const isMonster = client.world.get(characterId, [TbMonster]) !== undefined;
    client.dispatch(
      OpenPage({
        pageKind: isMonster ? BESTIARY_PAGE_KIND : CHARACTERS_PAGE_KIND,
        entityId: characterId,
      }) as CommandInstance,
    );
  };
}
