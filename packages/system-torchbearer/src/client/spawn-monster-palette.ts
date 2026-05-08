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

// Quick-lookup palette verbs for the bestiary. One verb per
// `TbMonsterTemplate`: typing a monster's name in ⌘K surfaces a
// "Spawn <Name>" entry that, on commit, dispatches
// `CreateMonsterFromCatalog`, waits for the `MonsterCreated` event to
// learn the server-allocated id, and dispatches `OpenPageInNewTab`
// so the freshly-spawned creature opens in a focused new tab on the
// bestiary page (existing entities the player typed for are surfaced
// separately by the `BestiaryPageProvider.list` rows).
//
// GM-only: the verbs are hidden from non-GM sessions via `visibleTo`.

import {
  qualifiedName,
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import { Character } from "@vtt/characters/shared";
import {
  OpenPageInNewTab,
  type PaletteCommand,
} from "@vtt/shell-workbench/shared";
import {
  CreateMonsterFromCatalog,
  TB_MONSTER_TEMPLATES,
} from "../shared/monsters.js";
import { MonsterCreated } from "../shared/monster-events.js";
import { TbMonster } from "../shared/monster-traits.js";

const BESTIARY_KIND = qualifiedName("@vtt/system-torchbearer/bestiary");

/**
 * Pull the last `/`-delimited segment of a templateId. The catalog
 * uses ids like `tb/monster/barrow-wight`; the qualified-name format
 * the palette commands expect (`@scope/plugin/Type`) only allows
 * `[A-Za-z0-9_-]+` per segment, so we collapse the templateId to its
 * unique slug.
 */
function lastSegment(templateId: string): string {
  const idx = templateId.lastIndexOf("/");
  return idx === -1 ? templateId : templateId.slice(idx + 1);
}

/**
 * Build one PaletteCommand per monster template. Each verb labels as
 * "Spawn <Name>"; clicking dispatches the spawn command and a
 * follow-up `OpenPageInNewTab` once the server-allocated monster id
 * lands on the bus.
 */
export const TB_SPAWN_MONSTER_PALETTE_COMMANDS: ReadonlyArray<PaletteCommand> =
  TB_MONSTER_TEMPLATES.map((tmpl) => ({
    // Qualified name segments must each match `[A-Za-z0-9_-]+` — no
    // slashes. The template's last path segment is unique per
    // catalog row (e.g. "barrow-wight", "black-dragon"); we prefix
    // with `spawn-` so the verb id reads as a clear action label.
    id: qualifiedName(
      `@vtt/system-torchbearer/spawn-${lastSegment(tmpl.id)}`,
    ) as PaletteCommand["id"],
    label: `Spawn ${tmpl.name}`,
    hint: `Bestiary · ${tmpl.sourceBook}${
      tmpl.sourcePage !== null ? ` p.${tmpl.sourcePage}` : ""
    }`,
    visibleTo: (ctx) => ctx.role === "gm",
    run: (ctx) => {
      const { client } = ctx;
      // Snapshot existing monster ids so we can identify the new
      // one when MonsterCreated lands. The command's apply allocates
      // the id server-side; we never predict it client-side.
      const beforeIds = new Set(
        client.world.query([Character, TbMonster]).map((r) => r.id as string),
      );
      // Subscribe BEFORE dispatching so a fast server can't echo the
      // event before the listener attaches.
      const off = client.bus.on(MonsterCreated.name, () => {
        off();
        const fresh = client.world
          .query([Character, TbMonster])
          .find((r) => !beforeIds.has(r.id as string));
        if (!fresh) return;
        // Open the new monster in a focused new tab on the bestiary
        // page. OpenPageInNewTab sets `pane.activeTabId` to the new
        // tab so the user lands on the spawn immediately rather than
        // having to switch tabs by hand.
        client.dispatch(
          OpenPageInNewTab({
            pageKind: BESTIARY_KIND,
            entityId: fresh.id as EntityId,
          }) as CommandInstance,
        );
      });
      // Returning null tells the palette we've handled the dispatch
      // ourselves — it must not also dispatch a CommandInstance.
      client.dispatch(
        CreateMonsterFromCatalog({ templateId: tmpl.id }) as CommandInstance,
      );
      return null;
    },
  }));
