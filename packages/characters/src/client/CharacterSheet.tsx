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

import { useTrait } from "@vtt/substrate/client";
import { Show, type JSX } from "solid-js";
import { Character } from "../shared/traits.js";
import { SheetShell } from "./SheetShell.js";

/**
 * Character sheet entry point. Resolves the character entity, then
 * mounts the responsive `<SheetShell>` which projects every game
 * system's contributions into the five named regions
 * (Identity / Vitals / Status / Tabs / Actions).
 *
 * The shell is rendered even with no game-system fills — players
 * still get the editable name + player-assignment via the default
 * Identity fill. Game systems with archetypes that need a different
 * layout (monsters, NPCs, vehicles) ship their own page provider
 * instead of fighting the shell.
 */
export function CharacterSheet(props: {
  characterId: string;
  /**
   * Workbench tab id hosting this sheet. Forwarded to `SheetShell` so
   * the active sub-tab persists across remounts via the per-tab
   * sentinel. Omit only in test contexts that mount the sheet outside
   * a workbench tab.
   */
  tabId?: string;
}): JSX.Element {
  const character = useTrait(props.characterId, Character);
  return (
    <Show
      when={character()}
      fallback={
        <div class="flex h-full items-center justify-center text-xs text-fg-subtle">
          character not found
        </div>
      }
    >
      <SheetShell characterId={props.characterId} tabId={props.tabId} />
    </Show>
  );
}
