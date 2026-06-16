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

import { defineCommand, EntityId, fail, ok, z, type EventInstance } from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { requireWrite } from "@vtt/permissions/shared";
import { ItemCatalogIndex } from "@vtt/items/shared";
import { TB_NPC_TEMPLATES } from "../data/tb-npcs.generated.js";
import type { TbNpcTemplate } from "../data/npc-catalog-types.js";
import { NpcCreated, NpcRemoved } from "./npc-events.js";

const TB_PLUGIN_NAME = "@vtt/system-torchbearer";

/**
 * Resolve a TB items-catalog templateId to its world entity id by
 * walking `ItemCatalogIndex` sentinels. Returns null when the catalog
 * hasn't been seeded yet OR the template is missing — callers proceed
 * without that gear entry rather than failing the spawn (the GM can
 * equip later via the inventory UI).
 */
function resolveCatalogItemId(
  world: import("@vtt/substrate").World,
  itemTemplateId: string,
): string | null {
  for (const row of world.query([ItemCatalogIndex])) {
    const v = row.values.ItemCatalogIndex as {
      pluginName: string;
      entries: Record<string, string>;
    };
    if (v.pluginName !== TB_PLUGIN_NAME) continue;
    const eid = v.entries[itemTemplateId];
    if (eid && world.has(eid as never)) return eid;
  }
  return null;
}

/**
 * Look up an NPC template by id. Linear scan — TB has at most a few
 * dozen NPC templates and the catalog is built once at module load.
 * If runtime cost ever matters this becomes a Map.
 */
export function npcTemplateById(templateId: string): TbNpcTemplate | undefined {
  return TB_NPC_TEMPLATES.find((t) => t.id === templateId);
}

export type { TbNpcTemplate };
export { TB_NPC_TEMPLATES };

/**
 * Spawn an NPC entity from a catalog template. GM-only — players
 * can't conjure their own denizens. The command resolves the
 * template at validate time and emits an NpcCreated event with the
 * resolved data inline.
 */
export const CreateNpcFromCatalog = defineCommand({
  name: "@vtt/system-torchbearer/CreateNpcFromCatalog",
  schema: z.object({
    templateId: z.string().min(1).max(240),
    /** Override the printed name on this instance (e.g. "Bran the Bandit"). */
    name: z.string().min(1).max(120).optional(),
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") {
      return fail("only a GM can spawn an NPC");
    }
    const tmpl = npcTemplateById(ctx.cmd.templateId);
    if (!tmpl) return fail(`unknown NPC template: ${ctx.cmd.templateId}`);
    return ok();
  },
  apply: ({ cmd, session, world }) => {
    const auth = requireSession({ session })!;
    const tmpl = npcTemplateById(cmd.templateId)!;
    const npcId = world.allocateId();
    // Resolve every gear template-id against the items catalog. Drop
    // entries the catalog doesn't know about (race during world boot,
    // or a bad template id) — same lenient policy as the monster
    // spawn pipeline.
    const gearItemIds: string[] = [];
    const gearSlots: string[] = [];
    for (const g of tmpl.gear) {
      const id = resolveCatalogItemId(world, g.itemTemplateId);
      if (id === null) continue;
      gearItemIds.push(id);
      gearSlots.push(g.slot);
    }
    const events: EventInstance[] = [
      NpcCreated({
        npcId,
        templateId: tmpl.id,
        name: cmd.name ?? tmpl.name,
        role: tmpl.role,
        // Canon NPCs carry a deep-link to the rulebook; the sheet
        // renders <BookCitation> next to the prose-bearing sections.
        // The free-text description stays empty so the GM doesn't see
        // a paraphrased blurb — they click through to the book
        // instead. Homebrew NPCs (CreateBlankNpc) get null pageRef
        // and writeable description.
        description: "",
        gearItemIds,
        gearSlots,
        pageRef: { canonicalId: tmpl.pageRef.canonicalId, page: tmpl.pageRef.page },
        nature: {
          rating: tmpl.nature.rating,
          descriptors: [...tmpl.nature.descriptors],
        },
        will: tmpl.will,
        health: tmpl.health,
        resources: tmpl.resources,
        circles: tmpl.circles,
        might: tmpl.might,
        precedence: tmpl.precedence,
        skills: tmpl.skills.map((s) => ({ skillId: s.skillId, rating: s.rating })),
        wises: [...tmpl.wises],
        traits: tmpl.traits.map((t) => ({ name: t.name, level: t.level })),
        createdByUserId: auth.userId,
      }),
    ];
    return events;
  },
});

/**
 * Spawn a "blank" NPC — a minimal stat block the GM fills in by
 * editing the sheet (Will/Health/Nature 3, Resources/Circles 2,
 * Might 2, Precedence 0, no skills, no wises, no traits). Same
 * NpcCreated event shape so the spawn system code path is shared
 * with catalog spawning; the difference is the empty payload + null
 * templateId.
 *
 * Used for one-off folk and "I'm prototyping a new role" workflows.
 * The catalog dropdown stays canonical for canon denizens; this is
 * the escape hatch.
 */
export const CreateBlankNpc = defineCommand({
  name: "@vtt/system-torchbearer/CreateBlankNpc",
  schema: z.object({
    name: z.string().min(1).max(120),
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") {
      return fail("only a GM can spawn an NPC");
    }
    return ok();
  },
  apply: ({ cmd, session, world }) => {
    const auth = requireSession({ session })!;
    const npcId = world.allocateId();
    return [
      NpcCreated({
        npcId,
        templateId: null,
        name: cmd.name,
        role: "Folk",
        description: "",
        gearItemIds: [],
        gearSlots: [],
        // Homebrew NPC — no rulebook reference. The GM fills in
        // description / role / gear directly on the sheet.
        pageRef: null,
        nature: { rating: 3, descriptors: [] },
        will: 3,
        health: 3,
        resources: 2,
        circles: 2,
        might: 2,
        precedence: 0,
        skills: [],
        wises: [],
        traits: [],
        createdByUserId: auth.userId,
      }),
    ];
  },
});

/**
 * Despawn an NPC. Mirrors RemoveMonster on its own NpcRemoved event
 * so the NPCs page provider can react without conflating with PC or
 * monster removals.
 */
export const RemoveNpc = defineCommand({
  name: "@vtt/system-torchbearer/RemoveNpc",
  schema: z.object({
    npcId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.npcId)) {
      return fail(`unknown NPC ${ctx.cmd.npcId}`);
    }
    return requireWrite(ctx, ctx.cmd.npcId);
  },
  apply: ({ cmd }) => [NpcRemoved({ npcId: cmd.npcId })],
});
