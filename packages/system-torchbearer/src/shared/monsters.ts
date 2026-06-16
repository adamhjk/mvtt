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
import { ItemCatalogIndex } from "@vtt/items/shared";
import { requireSession } from "@vtt/identity/shared";
import { requireWrite } from "@vtt/permissions/shared";
import { TB_MONSTER_TEMPLATES } from "../data/tb-monsters.generated.js";
import type { TbMonsterTemplate, TbMonsterWeaponTemplate } from "../data/monster-catalog-types.js";
import { MonsterCreated, MonsterRemoved } from "./monster-events.js";

const TB_PLUGIN_NAME = "@vtt/system-torchbearer";

/**
 * Look up a monster template by id. Linear scan — TB has at most a
 * few dozen monsters and the catalog is built once at module load.
 * If runtime cost ever matters this becomes a Map.
 */
export function monsterTemplateById(templateId: string): TbMonsterTemplate | undefined {
  return TB_MONSTER_TEMPLATES.find((t) => t.id === templateId);
}

/**
 * Resolve a TB items-catalog templateId to its world entity id by
 * walking ItemCatalogIndex sentinels. Returns null when the catalog
 * hasn't been seeded yet OR the template is missing — callers proceed
 * without an equipped armor entry rather than failing the spawn (the
 * GM can equip later via the inventory UI).
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

export type { TbMonsterTemplate, TbMonsterWeaponTemplate };
export { TB_MONSTER_TEMPLATES };

/**
 * Spawn a monster entity from a catalog template. GM-only — players
 * can't conjure their own catalog entries. The command resolves the
 * template's referenced armor item against the items catalog index
 * inside `apply` (read-only read of the world is allowed alongside
 * the world.allocateId() write — see the EquipItem command for the
 * same pattern), then emits a MonsterCreated event with the resolved
 * data inline.
 */
export const CreateMonsterFromCatalog = defineCommand({
  name: "@vtt/system-torchbearer/CreateMonsterFromCatalog",
  schema: z.object({
    templateId: z.string().min(1).max(240),
    /** Override the printed name on this instance (e.g. "Vasilescu, Vampire Lord"). */
    name: z.string().min(1).max(120).optional(),
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") {
      return fail("only a GM can spawn a monster");
    }
    const tmpl = monsterTemplateById(ctx.cmd.templateId);
    if (!tmpl) return fail(`unknown monster template: ${ctx.cmd.templateId}`);
    return ok();
  },
  apply: ({ cmd, session, world }) => {
    const auth = requireSession({ session })!;
    const tmpl = monsterTemplateById(cmd.templateId)!;
    const monsterId = world.allocateId();
    const armorItemId = tmpl.armorItemTemplateId
      ? resolveCatalogItemId(world, tmpl.armorItemTemplateId)
      : null;
    // One server-allocated id per monstrous-weapon entry. The spawn
    // system materialises an item entity at each so the disposition
    // weapon picker can offer them like any catalog resource (no
    // special-case TbMonsterWeapons read on the picker side).
    const weaponItemIds = tmpl.weapons.map(() => world.allocateId());
    const events: EventInstance[] = [
      MonsterCreated({
        monsterId,
        templateId: tmpl.id,
        name: cmd.name ?? tmpl.name,
        type: tmpl.type,
        // Canon monsters carry a deep-link to the rulebook; the sheet
        // renders <BookCitation> next to the prose-bearing sections.
        // The free-text instinct/armorDescription stay empty so the
        // GM doesn't see a paraphrased blurb — they click through to
        // the book instead. Homebrew monsters (CreateBlankMonster)
        // get null pageRef and writeable prose fields.
        instinct: "",
        armorDescription: "",
        nature: {
          rating: tmpl.nature.rating,
          descriptors: [...tmpl.nature.descriptors],
        },
        might: tmpl.might,
        precedence: tmpl.precedence,
        dispositions: tmpl.dispositions.map((d) => ({ ...d })),
        weapons: tmpl.weapons.map((w) => ({
          name: w.name,
          conflicts: [...w.conflicts],
          bonuses: {
            attack: { ...w.bonuses.attack },
            defend: { ...w.bonuses.defend },
            feint: { ...w.bonuses.feint },
            maneuver: { ...w.bonuses.maneuver },
          },
        })),
        weaponItemIds,
        specialRules: tmpl.specialRules.map((r) => ({
          name: r.name,
          text: "",
          pageRef: { canonicalId: r.pageRef.canonicalId, page: r.pageRef.page },
        })),
        pageRef: { canonicalId: tmpl.pageRef.canonicalId, page: tmpl.pageRef.page },
        armorItemId,
        createdByUserId: auth.userId,
      }),
    ];
    return events;
  },
});

/**
 * Spawn a "blank" monster — a minimal stat block the GM fills in by
 * editing the sheet (Nature 1, Might 1, Precedence 0, no weapons, no
 * special rules, no dispositions). Same MonsterCreated event shape so
 * the spawn system code path is shared with catalog spawning; the
 * difference is the empty payload + null templateId.
 *
 * Used for one-off creatures and "I'm prototyping a homebrew
 * Cinderclaw" workflows. The catalog dropdown stays canonical for
 * canon monsters; this is the escape hatch.
 */
export const CreateBlankMonster = defineCommand({
  name: "@vtt/system-torchbearer/CreateBlankMonster",
  schema: z.object({
    name: z.string().min(1).max(120),
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") {
      return fail("only a GM can spawn a monster");
    }
    return ok();
  },
  apply: ({ cmd, session, world }) => {
    const auth = requireSession({ session })!;
    const monsterId = world.allocateId();
    return [
      MonsterCreated({
        monsterId,
        templateId: null,
        name: cmd.name,
        type: "beast",
        instinct: "",
        armorDescription: "",
        nature: { rating: 1, descriptors: [] },
        might: 1,
        precedence: 0,
        dispositions: [],
        weapons: [],
        weaponItemIds: [],
        specialRules: [],
        // Homebrew monster — no rulebook reference. The GM fills
        // in instinct/armorDescription/special-rule text directly
        // on the sheet.
        pageRef: null,
        armorItemId: null,
        createdByUserId: auth.userId,
      }),
    ];
  },
});

/**
 * Despawn a monster. Mirrors RemoveCharacter but on the
 * MonsterRemoved event so the monsters page provider can react
 * without conflating with PC removals (and so any future "graveyard"
 * archive can pick this up specifically).
 */
export const RemoveMonster = defineCommand({
  name: "@vtt/system-torchbearer/RemoveMonster",
  schema: z.object({
    monsterId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.monsterId)) {
      return fail(`unknown monster ${ctx.cmd.monsterId}`);
    }
    return requireWrite(ctx, ctx.cmd.monsterId);
  },
  apply: ({ cmd }) => [MonsterRemoved({ monsterId: cmd.monsterId })],
});
