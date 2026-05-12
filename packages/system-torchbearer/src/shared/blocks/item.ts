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

import { z } from "@vtt/substrate";
import { defineBlockKind, type EntityProjection } from "@vtt/adventures/shared";
import {
  ItemBundle,
  ItemDerivedFrom,
  ItemEconomics,
  ItemIdentity,
} from "@vtt/items/shared";
import {
  TbArmor,
  TbContainer,
  TbItemSlotOptions,
  TbItemSpecialRules,
  TbSkillBonuses,
  TbSupply,
  TbWeapon,
} from "../items/item-traits.js";
import { ALL_SKILLS } from "../skills.js";

/**
 * TB body slots the GM is expected to author against.
 *
 * The underlying data model has separate `handR` / `handL` slots
 * because characters have two physical hands and the equip system
 * tracks each independently. Most catalog items go in "either hand"
 * — historically that's authored as `slots: { handR: 1, handL: 1 }`,
 * which is verbose and confusing for the common case.
 *
 * The `hand` shorthand here is an *authoring-only* virtual slot —
 * `projectItem` expands it to `{ handR: N, handL: N }` so the
 * authored block reads cleanly while the underlying TbItemSlotOptions
 * stays in the canonical handR/handL vocabulary the equip pipeline
 * understands. Authors who need a one-hand-specific item (rare —
 * signet ring on the left ring finger, etc.) can still name handR or
 * handL explicitly.
 */
const TB_BODY_SLOTS_AUTHORING = [
  "head",
  "neck",
  "hand",
  "handR",
  "handL",
  "torso",
  "belt",
  "feet",
  "pocket",
] as const;

const TB_CONTAINER_TYPES = [
  "backpack",
  "framePack",
  "satchel",
  "smallSack",
  "largeSack",
  "pouch",
  "purse",
  "quiver",
  "chestSmall",
  "seaChest",
  "barrel",
  "cask",
  "clayPot",
  "jug",
  "bottle",
  "waterskin",
  "woodenCanteen",
] as const;

const ConflictBonus = z
  .object({
    type: z.enum(["dice", "rerolls", "success"]).default("dice"),
    value: z.number().int().default(0),
  })
  .or(z.number().int())
  .transform((v) =>
    typeof v === "number" ? { type: "dice" as const, value: v } : v,
  );

/**
 * Schema for the body of an `item` fenced block.
 *
 * The fence info-string carries the item name (e.g. "longsword").
 * Body covers the catalog data the GM would otherwise edit through
 * the inventory UI's customize-item flow.
 *
 * Subtype data lives under one of {weapon, armor, supply, container};
 * `type` selects which is read.
 */
export const ItemBlockSchema = z
  .object({
    /** Subtype discriminator — drives which optional sub-block applies. */
    type: z
      .enum(["weapon", "armor", "supply", "container", "gear"])
      .default("gear"),
    /**
     * Single-slot shorthand for the most common case: the item fits in
     * exactly one body slot at a cost of 1 slot. Use the `slots:` map
     * for anything richer (multiple placement options, or a single slot
     * that consumes more than one slot count).
     */
    slot: z.enum(TB_BODY_SLOTS_AUTHORING).optional(),
    /**
     * Multi-option / non-1-cost placement. Each entry maps body-slot →
     * how many slots that placement consumes. Examples:
     *   slots: { torso: 1, pack: 2 }   — cloak, wear or pack
     *   slots: { torso: 2 }            — bulky breastplate
     *
     * Keys are free strings (Zod 4's `record(enum, _)` requires every
     * enum key to be present, which isn't what we want here); the
     * autocomplete provider's `complete()` hook suggests the canonical
     * TB body slots from this kind's def.
     */
    slots: z
      .record(z.string().min(1).max(40), z.number().int().min(1).max(20))
      .optional(),
    /** Free-text description shown in the inventory + on the chip. */
    description: z.string().max(2000).default(""),
    /** Image URL or asset wiki-link. */
    img: z.string().max(480).default(""),
    /** Free-form tags (e.g. ["martial", "common"]); informational. */
    tags: z.array(z.string().min(1).max(40)).default([]),
    /** Cost in coins (a flat integer; full coin breakdown comes later). */
    cost: z.number().int().min(0).max(99999).optional(),

    weapon: z
      .object({
        // YAML parses `wield: 1` as a number; keep the union of
        // numeric literals. Autocomplete suggests `1` / `2` via the
        // union-of-literals handler in computeBlockCompletions.
        wield: z.union([z.literal(1), z.literal(2)]).default(1),
        attack: ConflictBonus.optional(),
        defend: ConflictBonus.optional(),
        feint: ConflictBonus.optional(),
        maneuver: ConflictBonus.optional(),
      })
      .optional(),
    armor: z
      .object({
        armorType: z
          .enum(["leather", "chain", "plate", "helmet", "shield", "other"])
          .default("leather"),
        absorbs: z.number().int().min(0).max(10).default(1),
      })
      .optional(),
    supply: z
      .object({
        supplyType: z
          .enum([
            "food",
            "light",
            "ammunition",
            "sacramental",
            "spellMaterial",
            "other",
          ])
          .default("other"),
        turnsRemaining: z.number().int().min(0).max(99).default(0),
        lit: z.boolean().default(false),
        nameSingular: z.string().max(120).default(""),
      })
      .optional(),
    container: z
      .object({
        containerType: z.enum(TB_CONTAINER_TYPES).default("backpack"),
        containerSlots: z.number().int().min(0).max(50).default(0),
      })
      .optional(),
    /**
     * Bundleable supply (rations, arrows, oil flasks). `count` is the
     * current pile size; `capacity` is the max before it splits into
     * a second bundle. Drives the existing items pipeline's
     * BundleSplit / BundleJoin flows.
     */
    bundle: z
      .object({
        count: z.number().int().min(1).max(99).default(1),
        capacity: z.number().int().min(1).max(99).default(1),
      })
      .optional(),
    /** Optional skill bonuses while equipped. */
    skillBonuses: z
      .array(
        z.object({
          skill: z.string().min(1).max(40),
          value: z.number().int().min(-3).max(5),
          condition: z.string().max(240).default(""),
        }),
      )
      .default([]),
    specialRules: z.string().max(2000).default(""),
  });

export type ItemBlockParsed = z.infer<typeof ItemBlockSchema>;

/**
 * Project a parsed `item` block to the trait writes its entity will
 * carry. Mirrors the items catalog's `templateToTraitBag` shape so a
 * block-authored item is structurally identical to a system-seeded
 * one and the existing items pipeline (equip, customize, drop, …)
 * works without special-casing.
 */
function projectItem(parsed: ItemBlockParsed, info: string): EntityProjection {
  const slotOptions: Record<string, number> = {};
  // Expand the `hand` virtual slot to both physical hands. `hand: N`
  // becomes `{ handR: N, handL: N }`. Authors who specifically want
  // one hand only use `handR` / `handL` directly.
  const expand = (slot: string, count: number): void => {
    if (slot === "hand") {
      slotOptions.handR = count;
      slotOptions.handL = count;
    } else {
      slotOptions[slot] = count;
    }
  };
  if (parsed.slots) {
    for (const [k, v] of Object.entries(parsed.slots)) expand(k, v);
  } else if (parsed.slot) {
    expand(parsed.slot, 1);
  }

  const traits: Array<{ trait: import("@vtt/substrate").TraitMeta; value: unknown }> = [
    {
      trait: ItemIdentity,
      value: {
        name: info,
        description: parsed.description,
        img: parsed.img,
      },
    },
    {
      trait: ItemEconomics,
      value: parsed.cost !== undefined ? { cost: parsed.cost } : {},
    },
    { trait: TbItemSlotOptions, value: { options: slotOptions } },
    {
      trait: TbSkillBonuses,
      value: { entries: parsed.skillBonuses.map((sb) => ({ ...sb })) },
    },
    { trait: TbItemSpecialRules, value: { text: parsed.specialRules } },
    {
      trait: ItemDerivedFrom,
      // The block parse uses the deterministic block-entity id as the
      // templateId so a re-author or upstream-merge can find it again.
      // pluginName "@vtt/adventures" distinguishes block-authored items
      // from system-seeded ones (whose pluginName is the system plugin).
      value: {
        templateId: `block:${info}`,
        pluginName: "@vtt/adventures",
        overrides: [],
      },
    },
  ];

  if (parsed.type === "weapon" && parsed.weapon) {
    const wb = parsed.weapon;
    traits.push({
      trait: TbWeapon,
      value: {
        wield: wb.wield,
        conflictBonuses: {
          attack: wb.attack ?? { type: "dice", value: 0 },
          defend: wb.defend ?? { type: "dice", value: 0 },
          feint: wb.feint ?? { type: "dice", value: 0 },
          maneuver: wb.maneuver ?? { type: "dice", value: 0 },
        },
      },
    });
  } else if (parsed.type === "armor" && parsed.armor) {
    traits.push({
      trait: TbArmor,
      value: { armorType: parsed.armor.armorType, absorbs: parsed.armor.absorbs },
    });
  } else if (parsed.type === "supply" && parsed.supply) {
    traits.push({ trait: TbSupply, value: { ...parsed.supply } });
  } else if (parsed.type === "container" && parsed.container) {
    traits.push({ trait: TbContainer, value: { ...parsed.container } });
  }

  if (parsed.bundle) {
    traits.push({
      trait: ItemBundle,
      value: { count: parsed.bundle.count, capacity: parsed.bundle.capacity },
    });
  }

  return { traits };
}

/**
 * The `item` block kind — registered into `BlockKindsSlot` by the TB
 * manifest. Authors a TB catalog item via a fenced markdown block:
 *
 *   ```item longsword
 *   type: weapon
 *   slot: handR
 *   weapon:
 *     attack: 1
 *     defend: 1
 *   ```
 */
export const itemBlockKind = defineBlockKind<ItemBlockParsed>({
  name: "item",
  description: "TB catalog item — weapon / armor / supply / container / gear",
  schema: ItemBlockSchema,
  // The fence info-string IS the canonical item name — `\`\`\`item
  // longsword\`\`\`` projects to ItemIdentity.name = "longsword".
  // Falls back to "Unnamed Item" if the editor invoked project()
  // without info (autocomplete preview path).
  project: (parsed, ctx) => projectItem(parsed, ctx.info ?? "Unnamed Item"),
  // Dynamic key suggestions for the few record/free-string slots the
  // schema can't enumerate up front:
  //   - `slots` record keys: TB body slots (canonical authoring vocab)
  //   - `skillBonuses[N].skill`: any registered TB skill id
  complete: (path) => {
    if (path.length === 1 && path[0] === "slots") {
      return TB_BODY_SLOTS_AUTHORING.map((s) => ({ value: s }));
    }
    if (
      path.length >= 2 &&
      path[0] === "skillBonuses" &&
      path[path.length - 1] === "skill"
    ) {
      return ALL_SKILLS.map((s) => ({ value: s.id, detail: s.name }));
    }
    return [];
  },
  display: (entityId, world) => {
    const got = world.get(entityId, [ItemIdentity]) as
      | { ItemIdentity: { name: string } }
      | undefined;
    return got?.ItemIdentity.name ?? "(unnamed item)";
  },
  snippet: () => `\${1:name}
type: \${2|weapon,armor,supply,container,gear|}
slot: \${3|hand,torso,head,neck,belt,feet,pocket,handR,handL|}
description: |
  \${0}`,
});
