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

import { defineTrait, z } from "@vtt/substrate";

/**
 * ItemIdentity — the universal "what this item *is*" trait. Every item
 * entity carries one. Slot-vocabulary-agnostic; game-system-specific
 * subtype traits (TbWeapon, TbArmor, etc.) sit alongside it. The `img`
 * field references an icon in the project's free-icon set.
 */
export const ItemIdentity = defineTrait({
  name: "@vtt/items/ItemIdentity",
  schema: z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).default(""),
    img: z.string().max(240).default(""),
  }),
});

/**
 * ItemEconomics — purchase cost (game-system-specific units, e.g. TB
 * obstacles) plus optional treasure value used for in-system "what is
 * this loot worth?" calculations. Always intrinsic — per-instance
 * pricing variation belongs on a forked item, not on the holder's
 * inventory entry.
 */
export const ItemEconomics = defineTrait({
  name: "@vtt/items/ItemEconomics",
  schema: z.object({
    cost: z.number().int().nonnegative().optional(),
    value: z
      .object({
        dice: z.number().int().nonnegative(),
        negotiated: z.boolean(),
      })
      .optional(),
  }),
});

/**
 * ItemDerivedFrom — origin-tracking for items that came from a
 * catalog template. Carries the templateId so the seed hook can
 * find the entity again on subsequent boots, the pluginName that
 * owns the template (so multiple game systems can share one entity
 * pool without colliding), and the set of field paths the GM has
 * locally edited. Re-seed honours `overrides`: any field NOT in the
 * override set picks up the catalog's current value; anything in
 * the set is left alone.
 *
 * `deprecated: true` is set when re-seed finds a previously seeded
 * entity whose template has been removed from the catalog. The
 * entity stays — someone may be holding it — but views can flag it.
 *
 * Forked items (made via CustomizeItem) carry an ItemDerivedFrom
 * trait whose `templateId` matches the source's, but they're NOT
 * registered in the catalog index. The seed hook skips them on
 * re-seed because the index is the only thing it uses to find
 * "templated entities I own."
 */
export const ItemDerivedFrom = defineTrait({
  name: "@vtt/items/ItemDerivedFrom",
  schema: z.object({
    templateId: z.string().min(1).max(240),
    pluginName: z.string().min(1).max(120),
    overrides: z.array(z.string().min(1).max(120)).default([]),
    deprecated: z.boolean().optional(),
  }),
});

/**
 * ItemBundle — stack/bundle accounting for items that come in
 * fixed-size bundles per the rules (e.g. TB torches: pack 1 for
 * 4 torches; small sacks: pack 1 for 2 empty sacks). `count` is
 * the number of independent units currently in this stack;
 * `capacity` is the maximum the stack can hold (joining a smaller
 * stack into this one is capped at `capacity`). Splitting takes
 * N units off into a freshly forked entity that carries the same
 * traits — same name, same kind — but with `count = N`.
 *
 * Distinct from supplies-with-charges (TbSupply.turnsRemaining
 * for things like rations / bottles / lanterns): those track how
 * much of one consumable is left and are never split.
 */
export const ItemBundle = defineTrait({
  name: "@vtt/items/ItemBundle",
  schema: z.object({
    count: z.number().int().min(1).max(99),
    capacity: z.number().int().min(1).max(99),
  }),
});

/**
 * ItemCatalogIndex — sentinel trait carried by exactly one entity
 * per catalog plugin per world. Maps templateId → entityId so the
 * seed hook can find previously seeded entities on subsequent boots
 * and run the merge engine against them. The plugin field
 * disambiguates indexes from different game systems if (someday) a
 * world has more than one catalog plugin active.
 *
 * The substrate doesn't know about this trait; it's just a regular
 * trait used by item plugins as a convention.
 */
export const ItemCatalogIndex = defineTrait({
  name: "@vtt/items/ItemCatalogIndex",
  schema: z.object({
    pluginName: z.string().min(1).max(120),
    entries: z.record(z.string(), z.string()).default({}),
  }),
});
