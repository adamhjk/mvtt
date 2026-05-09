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

// Quick-lookup palette verbs for the NPC catalog. One verb per
// `TbNpcTemplate`: typing a denizen's name in ⌘K surfaces a
// "Spawn <Name>" entry that dispatches `CreateNpcFromCatalog`, waits
// for the `NpcCreated` event, and opens the freshly-spawned NPC on
// the NPCs page.
//
// Mirrors `spawn-monster-palette.ts` exactly so the two surfaces stay
// patternable. GM-only via `visibleTo`.

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
  CreateNpcFromCatalog,
  TB_NPC_TEMPLATES,
} from "../shared/npcs.js";
import { NpcCreated } from "../shared/npc-events.js";
import { TbNpc } from "../shared/npc-traits.js";

const NPCS_KIND = qualifiedName("@vtt/system-torchbearer/npcs");

/**
 * Pull the last `/`-delimited segment of a templateId. The catalog
 * uses ids like `tb/npc/alchemist`; the qualified-name format the
 * palette commands expect (`@scope/plugin/Type`) only allows
 * `[A-Za-z0-9_-]+` per segment, so we collapse the templateId to its
 * unique slug.
 */
function lastSegment(templateId: string): string {
  const idx = templateId.lastIndexOf("/");
  return idx === -1 ? templateId : templateId.slice(idx + 1);
}

export const TB_SPAWN_NPC_PALETTE_COMMANDS: ReadonlyArray<PaletteCommand> =
  TB_NPC_TEMPLATES.map((tmpl) => ({
    id: qualifiedName(
      `@vtt/system-torchbearer/spawn-npc-${lastSegment(tmpl.id)}`,
    ) as PaletteCommand["id"],
    label: `Spawn ${tmpl.name}`,
    hint: `NPC · ${tmpl.sourceBook}${
      tmpl.sourcePage !== null ? ` p.${tmpl.sourcePage}` : ""
    }`,
    visibleTo: (ctx) => ctx.role === "gm",
    run: (ctx) => {
      const { client } = ctx;
      const beforeIds = new Set(
        client.world.query([Character, TbNpc]).map((r) => r.id as string),
      );
      const off = client.bus.on(NpcCreated.name, () => {
        off();
        const fresh = client.world
          .query([Character, TbNpc])
          .find((r) => !beforeIds.has(r.id as string));
        if (!fresh) return;
        client.dispatch(
          OpenPageInNewTab({
            pageKind: NPCS_KIND,
            entityId: fresh.id as EntityId,
          }) as CommandInstance,
        );
      });
      client.dispatch(
        CreateNpcFromCatalog({ templateId: tmpl.id }) as CommandInstance,
      );
      return null;
    },
  }));
