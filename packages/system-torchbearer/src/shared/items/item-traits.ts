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

import { defineTrait, EntityId, z } from "@vtt/substrate";
import { TbBodySlotSchema, TbEquipChannel } from "./body-slots.js";

/**
 * TbItemSlotOptions — *where* the item can go and how many slots
 * it consumes in each. Mirrors the Foundry pack data's
 * `slotOptions` field. Empty options means "the item is some
 * non-equippable thing" (rare; mostly trait-shaped or descriptive
 * items).
 */
export const TbItemSlotOptions = defineTrait({
  name: "@vtt/system-torchbearer/TbItemSlotOptions",
  schema: z.object({
    options: z.record(TbBodySlotSchema, z.number().int().positive()).default({}),
  }),
});

/**
 * TbWeapon — combat profile. `wield` is hands required to use
 * (1 = one-handed, 2 = two-handed). `conflictBonuses` carries
 * additive bonuses to each conflict-action pool.
 *
 * Foundry distinguishes "type: dice" / "type: rerolls" /
 * "type: success" — we capture the type but treat dice as the
 * default. The roll-modifier provider in phase 5 fans these out
 * into actual TbRollModifier values.
 */
export const TbWeapon = defineTrait({
  name: "@vtt/system-torchbearer/TbWeapon",
  schema: z.object({
    wield: z.union([z.literal(1), z.literal(2)]).default(1),
    conflictBonuses: z
      .object({
        attack: z.object({
          type: z.enum(["dice", "rerolls", "success"]).default("dice"),
          value: z.number().int().default(0),
        }),
        defend: z.object({
          type: z.enum(["dice", "rerolls", "success"]).default("dice"),
          value: z.number().int().default(0),
        }),
        feint: z.object({
          type: z.enum(["dice", "rerolls", "success"]).default("dice"),
          value: z.number().int().default(0),
        }),
        maneuver: z.object({
          type: z.enum(["dice", "rerolls", "success"]).default("dice"),
          value: z.number().int().default(0),
        }),
      })
      .default({
        attack: { type: "dice", value: 0 },
        defend: { type: "dice", value: 0 },
        feint: { type: "dice", value: 0 },
        maneuver: { type: "dice", value: 0 },
      }),
  }),
});

/**
 * TbArmor — armor profile. `armorType` chooses leather/chain/plate
 * (drives the in-fight degradation rules; LMM p.77). `absorbs` is
 * the passive damage soak.
 */
export const TbArmor = defineTrait({
  name: "@vtt/system-torchbearer/TbArmor",
  schema: z.object({
    armorType: z
      .enum(["leather", "chain", "plate", "helmet", "shield", "other"])
      .default("leather"),
    absorbs: z.number().int().min(0).default(1),
  }),
});

/**
 * TbSupply — consumables (rations, light sources, ammunition,
 * potions, oil flasks). `supplyType` drives the in-game-action
 * rules (food refills hungry, light starts a turn timer, etc.).
 * `turnsRemaining` and `lit` are runtime state and only meaningful
 * on a per-character entry; this trait records the *template
 * default*.
 */
export const TbSupply = defineTrait({
  name: "@vtt/system-torchbearer/TbSupply",
  schema: z.object({
    supplyType: z
      .enum(["food", "light", "ammunition", "sacramental", "spellMaterial", "other"])
      .default("other"),
    turnsRemaining: z.number().int().min(0).default(0),
    lit: z.boolean().default(false),
    nameSingular: z.string().max(120).default(""),
  }),
});

/**
 * TbContainer — pack, sack, pouch, quiver, satchel, chest.
 * `containerSlots` is the internal capacity. `containerType` is a
 * descriptive tag mirroring the Foundry data (backpack / smallSack /
 * largeSack / pouch / quiver / chestSmall / clayPot / bottle / cask /
 * etc.). Per-instance "lost" status lives on the holder's TbCarries
 * entry, NOT here, because shared catalog containers can't carry
 * per-character flags.
 */
export const TbContainer = defineTrait({
  name: "@vtt/system-torchbearer/TbContainer",
  schema: z.object({
    containerType: z.string().min(1).max(40),
    containerSlots: z.number().int().min(0).max(50).default(0),
  }),
});

/**
 * TbSkillBonuses — conditional skill bonuses an item grants while
 * equipped. The `condition` text is human-readable; the
 * roll-modifier provider in phase 5 surfaces these as suggested
 * modifiers the player toggles in the pending-roll panel. Bonus
 * values are typically small integers (+1D / +2D); larger values
 * are clamped at parse to keep wire payloads sane.
 */
export const TbSkillBonuses = defineTrait({
  name: "@vtt/system-torchbearer/TbSkillBonuses",
  schema: z.object({
    entries: z
      .array(
        z.object({
          skill: z.string().min(1).max(40),
          value: z.number().int().min(-3).max(5),
          condition: z.string().max(240).default(""),
        }),
      )
      .default([]),
  }),
});

/**
 * TbItemSpecialRules — free-text rules description (typically a
 * book + page citation, sometimes the rules text itself). Read
 * by the inventory UI, not parsed.
 */
export const TbItemSpecialRules = defineTrait({
  name: "@vtt/system-torchbearer/TbItemSpecialRules",
  schema: z.object({
    text: z.string().max(2000).default(""),
  }),
});

/**
 * ItemPosition — coordinates for a scene-bound item entity.
 * Stamped onto an item by ItemDropped and cleared by
 * ItemPickedUp. If scenes-with-floors lands as a substrate-level
 * concept, this trait migrates without changing TB consumers.
 */
export const ItemPosition = defineTrait({
  name: "@vtt/system-torchbearer/ItemPosition",
  schema: z.object({
    sceneId: EntityId,
    x: z.number(),
    y: z.number(),
  }),
});

/**
 * TbCarries — the inventory list on a *holder* entity. A holder is
 * any entity that can carry items: a Character, a scene-floor
 * entity (future), or a container item entity (Backpack carries
 * its own contents).
 *
 * Each entry references one item-entity id and pins it to a slot.
 * `slot` is either a base TB body slot ("torso"), a hand+channel
 * pair ("handR" or "handL", with `channel` selecting worn vs
 * carried), or an opaque `container:<containerEntityId>` for items
 * inside a container. `slotsConsumed` is the multiplicity from the
 * item's TbItemSlotOptions for the chosen slot.
 *
 * Per-character runtime state (damaged / dropped / lit / turns /
 * lost / quantity) lives on the entry — NOT on the item entity —
 * so a single shared catalog item can be referenced by multiple
 * holders without forcing a fork. Customizing the *intrinsic* item
 * (its name, its weapon stats) requires a fork via CustomizeItem.
 */
export const TbCarries = defineTrait({
  name: "@vtt/system-torchbearer/TbCarries",
  schema: z.object({
    entries: z
      .array(
        z.object({
          slot: TbBodySlotSchema,
          slotIndex: z.number().int().min(0).default(0),
          channel: TbEquipChannel,
          slotsConsumed: z.number().int().min(1).max(20).default(1),
          itemId: EntityId,
          quantity: z.number().int().min(0).default(1),
          /**
           * Optional per-entry display label. When the same item
           * entity is carried more than once (two backpacks, three
           * waterskins) we want to be able to call them apart in
           * the UI. The label overrides `ItemIdentity.name` for
           * this entry only — the underlying item entity is
           * unchanged. Empty string means "use the entity's name."
           */
          label: z.string().max(120).optional(),
          state: z
            .object({
              damaged: z.boolean().optional(),
              dropped: z.boolean().optional(),
              lit: z.boolean().optional(),
              turnsRemaining: z.number().int().min(0).optional(),
              spent: z.boolean().optional(),
              lost: z.boolean().optional(),
            })
            .optional(),
        }),
      )
      .default([]),
  }),
});
