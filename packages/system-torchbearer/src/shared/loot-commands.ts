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

import {
  defineCommand,
  defineEvent,
  defineSystem,
  EntityId,
  fail,
  ok,
  z,
  type TraitName,
} from "@vtt/substrate";
import { LootParcel } from "@vtt/adventures/shared";
import { requireSession } from "@vtt/identity/shared";
import { Character } from "@vtt/characters/shared";
import { ItemDerivedFrom, ItemEconomics, ItemIdentity } from "@vtt/items/shared";
import {
  ItemPosition,
  TbCarries,
  TbItemSlotOptions,
  TbItemSpecialRules,
  TbSkillBonuses,
} from "./items/item-traits.js";

/**
 * AwardLoot — grant a `LootParcel`'s contents to a holder. GM-only.
 *
 * Per design/adventures.md § "loot block": items are appended to the
 * holder's `TbCarries` directly (NOT via PickUpItem, which requires
 * the item to be on a scene floor first). Cash currently records to
 * the event payload only — TB resources don't have a "coin pouch"
 * trait to credit yet; a follow-up can wire this through `TbResources`
 * once the cash-on-character story lands.
 *
 * Item references are resolved at apply time by scanning `Character`
 * names against `ItemIdentity.name` — same lookup pattern
 * StartEncounter uses. Items not present in the world are silently
 * skipped and reported in the event's `missing` field.
 */
export const AwardLoot = defineCommand({
  name: "@vtt/system-torchbearer/AwardLoot",
  schema: z.object({
    parcelId: EntityId,
    holderId: EntityId,
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") return fail("only a GM can award loot");
    if (!ctx.world.has(ctx.cmd.parcelId)) {
      return fail(`unknown loot parcel ${ctx.cmd.parcelId}`);
    }
    if (!ctx.world.get(ctx.cmd.parcelId, [LootParcel])) {
      return fail(`entity ${ctx.cmd.parcelId} is not a LootParcel`);
    }
    if (!ctx.world.has(ctx.cmd.holderId)) {
      return fail(`unknown holder ${ctx.cmd.holderId}`);
    }
    return ok();
  },
  apply: ({ cmd, world }) => {
    const parcel = world.get(cmd.parcelId, [LootParcel]) as
      | {
          LootParcel: {
            items: ReadonlyArray<{ kind: string; body: string; quantity: number }>;
            cash: { copper: number; silver: number; gold: number };
          };
        }
      | undefined;
    if (!parcel) return [];
    const resolved: Array<{ itemId: EntityId; quantity: number }> = [];
    const missing: Array<{ kind: string; body: string }> = [];
    for (const it of parcel.LootParcel.items) {
      // Items don't carry Character; we walk all entities looking for
      // ItemIdentity.name match (case-insensitive).
      const target = it.body.toLowerCase().trim();
      let found: EntityId | null = null;
      for (const row of world.query([ItemIdentity])) {
        const v = row.values.ItemIdentity as { name: string };
        if (v.name.toLowerCase() === target) {
          found = row.id;
          break;
        }
      }
      if (found) {
        resolved.push({ itemId: found, quantity: it.quantity });
      } else {
        missing.push({ kind: it.kind, body: it.body });
      }
    }
    return [
      LootAwarded({
        parcelId: cmd.parcelId,
        holderId: cmd.holderId,
        items: resolved,
        cash: parcel.LootParcel.cash,
        missing,
      }),
    ];
  },
});

/** Emitted by AwardLoot once references are resolved. */
export const LootAwarded = defineEvent({
  name: "@vtt/system-torchbearer/LootAwarded",
  schema: z.object({
    parcelId: EntityId,
    holderId: EntityId,
    items: z.array(
      z.object({
        itemId: EntityId,
        quantity: z.number().int().min(1).max(99),
      }),
    ),
    cash: z.object({
      copper: z.number().int().min(0),
      silver: z.number().int().min(0),
      gold: z.number().int().min(0),
    }),
    missing: z.array(
      z.object({
        kind: z.string().min(1).max(60),
        body: z.string().min(1).max(240),
      }),
    ),
  }),
});

/**
 * PlaceLootInScene — drop the parcel's contents on a scene floor at
 * (x, y) so the players can pick them up via the existing
 * PickUpItem flow. GM-only.
 *
 * The most useful flow after a conflict — way more idiomatic than
 * "award to a single character". Each item is *forked* from the
 * catalog into a fresh entity so the catalog reference doesn't end
 * up tagged with a Position (catalog items are shared by reference;
 * giving them a Position would put every wielder of the same Sword
 * "on the floor" too). The fork is a one-shot copy of every authored
 * trait + a fresh ItemPosition.
 *
 * Cash on the parcel is recorded in the event's payload only — TB
 * has no canonical "coin pile on the floor" trait yet; a future
 * iteration can mint a TbCashPile entity at the same position.
 */
export const PlaceLootInScene = defineCommand({
  name: "@vtt/system-torchbearer/PlaceLootInScene",
  schema: z.object({
    parcelId: EntityId,
    sceneId: EntityId,
    x: z.number(),
    y: z.number(),
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") return fail("only a GM can place loot");
    if (!ctx.world.has(ctx.cmd.parcelId)) {
      return fail(`unknown loot parcel ${ctx.cmd.parcelId}`);
    }
    if (!ctx.world.get(ctx.cmd.parcelId, [LootParcel])) {
      return fail(`entity ${ctx.cmd.parcelId} is not a LootParcel`);
    }
    return ok();
  },
  apply: ({ cmd, world }) => {
    const parcel = world.get(cmd.parcelId, [LootParcel]) as
      | {
          LootParcel: {
            items: ReadonlyArray<{ kind: string; body: string; quantity: number }>;
            cash: { copper: number; silver: number; gold: number };
          };
        }
      | undefined;
    if (!parcel) return [];
    const placements: Array<{
      copyId: EntityId;
      sourceItemId: EntityId;
      quantity: number;
    }> = [];
    const missing: Array<{ kind: string; body: string }> = [];
    for (const it of parcel.LootParcel.items) {
      const target = it.body.toLowerCase().trim();
      let found: EntityId | null = null;
      for (const row of world.query([ItemIdentity])) {
        const v = row.values.ItemIdentity as { name: string };
        if (v.name.toLowerCase() === target) {
          found = row.id;
          break;
        }
      }
      if (!found) {
        missing.push({ kind: it.kind, body: it.body });
        continue;
      }
      placements.push({
        copyId: world.allocateId(),
        sourceItemId: found,
        quantity: it.quantity,
      });
    }
    return [
      LootPlacedInScene({
        parcelId: cmd.parcelId,
        sceneId: cmd.sceneId,
        x: cmd.x,
        y: cmd.y,
        placements,
        cash: parcel.LootParcel.cash,
        missing,
      }),
    ];
  },
});

/** Emitted by PlaceLootInScene with one placement entry per item. */
export const LootPlacedInScene = defineEvent({
  name: "@vtt/system-torchbearer/LootPlacedInScene",
  schema: z.object({
    parcelId: EntityId,
    sceneId: EntityId,
    x: z.number(),
    y: z.number(),
    placements: z.array(
      z.object({
        copyId: EntityId,
        sourceItemId: EntityId,
        quantity: z.number().int().min(1).max(99),
      }),
    ),
    cash: z.object({
      copper: z.number().int().min(0),
      silver: z.number().int().min(0),
      gold: z.number().int().min(0),
    }),
    missing: z.array(
      z.object({
        kind: z.string().min(1).max(60),
        body: z.string().min(1).max(240),
      }),
    ),
  }),
});

/**
 * Universal-mirror system: clone each placement's source item into a
 * fresh entity at the server-allocated copyId, give it `ItemPosition`
 * pointing at the scene + (x, y), and stamp a fresh `ItemDerivedFrom`
 * pointing at the source item. Players use the existing PickUpItem
 * flow to grab them.
 */
export const LootPlacementSystem = defineSystem({
  name: "LootPlacement",
  on: LootPlacedInScene,
  reads: [
    ItemIdentity,
    ItemEconomics,
    TbItemSlotOptions,
    TbSkillBonuses,
    TbItemSpecialRules,
    ItemDerivedFrom,
  ],
  writes: [
    ItemIdentity,
    ItemEconomics,
    TbItemSlotOptions,
    TbSkillBonuses,
    TbItemSpecialRules,
    ItemDerivedFrom,
    ItemPosition,
  ],
  run: ({ event, world }) => {
    for (const p of event.placements) {
      if (!world.has(p.sourceItemId)) continue;
      // Clone every authored trait. We don't deep-introspect the
      // source's full trait set (the substrate's `traitsOn` is the
      // tool, but we pick the well-known item ones here so the clone
      // is predictable and doesn't accidentally pull a per-instance
      // state trait the source happens to carry).
      const factories: Array<{ name: TraitName; value: unknown }> = [];
      const ident = world.get(p.sourceItemId, [ItemIdentity]) as
        | { ItemIdentity: unknown }
        | undefined;
      if (ident) factories.push(ItemIdentity(ident.ItemIdentity as never));
      const econ = world.get(p.sourceItemId, [ItemEconomics]) as
        | { ItemEconomics: unknown }
        | undefined;
      if (econ) factories.push(ItemEconomics(econ.ItemEconomics as never));
      const slots = world.get(p.sourceItemId, [TbItemSlotOptions]) as
        | { TbItemSlotOptions: unknown }
        | undefined;
      if (slots) {
        factories.push(TbItemSlotOptions(slots.TbItemSlotOptions as never));
      }
      const bonuses = world.get(p.sourceItemId, [TbSkillBonuses]) as
        | { TbSkillBonuses: unknown }
        | undefined;
      if (bonuses) {
        factories.push(TbSkillBonuses(bonuses.TbSkillBonuses as never));
      }
      const rules = world.get(p.sourceItemId, [TbItemSpecialRules]) as
        | { TbItemSpecialRules: unknown }
        | undefined;
      if (rules) {
        factories.push(TbItemSpecialRules(rules.TbItemSpecialRules as never));
      }
      // Mark provenance so the GM can later trace "this was placed
      // from loot parcel X." pluginName matches the source's
      // pluginName when known; default to "@vtt/system-torchbearer".
      const sourceDerived = world.get(p.sourceItemId, [ItemDerivedFrom]) as
        | { ItemDerivedFrom: { pluginName: string; templateId: string } }
        | undefined;
      factories.push(
        ItemDerivedFrom({
          templateId: sourceDerived?.ItemDerivedFrom.templateId ?? p.sourceItemId,
          pluginName: sourceDerived?.ItemDerivedFrom.pluginName ?? "@vtt/system-torchbearer",
          overrides: [],
        }),
      );
      factories.push(ItemPosition({ sceneId: event.sceneId, x: event.x, y: event.y }));
      world.spawnAt(p.copyId, factories);
      void p.quantity; // v1 ignores quantity at place-time; one entity
      // per placement for simplicity. A future "bundle
      // join" flow can collapse stacks.
    }
    return [];
  },
});

/**
 * Universal-mirror system: react to `LootAwarded` by appending entries
 * to the holder's `TbCarries`. Each item lands in a `loose:N` slot —
 * the GM (or the player) can re-equip them via the inventory UI's
 * existing `MoveItem` flow.
 */
export const LootAwardSystem = defineSystem({
  name: "LootAward",
  on: LootAwarded,
  reads: [TbCarries, Character],
  writes: [TbCarries],
  run: ({ event, world }) => {
    if (!world.has(event.holderId)) return [];
    const existing = world.get(event.holderId, [TbCarries]) as
      | {
          TbCarries: {
            entries: Array<{
              slot: string;
              slotIndex: number;
              channel: "default" | "carried" | "worn";
              slotsConsumed: number;
              itemId: EntityId;
              quantity: number;
            }>;
          };
        }
      | undefined;
    const entries = existing ? existing.TbCarries.entries.map((e) => ({ ...e })) : [];
    let nextLoose = entries.reduce((acc, e) => {
      const m = e.slot.match(/^loose:(\d+)$/);
      if (m) return Math.max(acc, parseInt(m[1]!, 10) + 1);
      return acc;
    }, 0);
    for (const it of event.items) {
      entries.push({
        slot: `loose:${nextLoose}`,
        slotIndex: 0,
        channel: "default",
        slotsConsumed: 1,
        itemId: it.itemId,
        quantity: it.quantity,
      });
      nextLoose += 1;
    }
    world.set(event.holderId, TbCarries, { entries });
    return [];
  },
});
