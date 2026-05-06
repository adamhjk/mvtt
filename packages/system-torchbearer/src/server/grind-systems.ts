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

import { defineSystem } from "@vtt/substrate";
import { ItemCatalogIndex } from "@vtt/items/shared";
import {
  GRIND_SENTINEL_ID,
  Grind,
  GrindExtremeSet,
  GrindToll,
  GrindTollOpened,
  GrindTollRowApplied,
  GrindTurnSet,
  LightSourceWentOut,
  LightWentOutNotice,
  NoticeDismissed,
  type GrindCondition,
} from "../shared/grind.js";
import { Conditions } from "../shared/traits.js";
import { TbCarries } from "../shared/items/item-traits.js";

/**
 * GrindTickSystem — universal mirror for `GrindTurnSet`. Just
 * writes the new turn value. The decrement / burnout sweep
 * happens in `SetGrindTurn.apply` (the place where new entity
 * ids for the burnout-notice records can be safely allocated
 * server-authoritative); this system only persists the clock.
 */
export const GrindTickSystem = defineSystem({
  name: "GrindTick",
  on: GrindTurnSet,
  reads: [Grind],
  writes: [Grind],
  run: ({ event, world }) => {
    if (!world.has(GRIND_SENTINEL_ID)) return [];
    const cur = world.get(GRIND_SENTINEL_ID, [Grind]) as
      | { Grind: { turn: number; extreme: boolean } }
      | undefined;
    world.set(GRIND_SENTINEL_ID, Grind, {
      turn: event.to,
      extreme: cur?.Grind.extreme ?? false,
    });
    return [];
  },
});

/**
 * GrindExtremeToggleSystem — universal mirror for `GrindExtremeSet`.
 * Writes the new `extreme` flag onto the Grind sentinel. The turn
 * is preserved.
 */
export const GrindExtremeToggleSystem = defineSystem({
  name: "GrindExtremeToggle",
  on: GrindExtremeSet,
  reads: [Grind],
  writes: [Grind],
  run: ({ event, world }) => {
    if (!world.has(GRIND_SENTINEL_ID)) return [];
    const cur = world.get(GRIND_SENTINEL_ID, [Grind]) as
      | { Grind: { turn: number; extreme: boolean } }
      | undefined;
    world.set(GRIND_SENTINEL_ID, Grind, {
      turn: cur?.Grind.turn ?? 0,
      extreme: event.extreme,
    });
    return [];
  },
});

/**
 * LightWentOutSystem — universal mirror for `LightSourceWentOut`.
 * Spawns a persistent `LightWentOutNotice` entity at the id
 * carried in the event. The chat-timeline contributor queries
 * those entities to render the "X's torch goes out" cards.
 */
export const LightWentOutSystem = defineSystem({
  name: "LightWentOut",
  on: LightSourceWentOut,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.id)) return [];
    world.spawnAt(event.id, [
      {
        name: LightWentOutNotice.name,
        value: {
          holderId: event.holderId,
          holderName: event.holderName,
          itemId: event.itemId,
          itemName: event.itemName,
          turn: event.turn,
          sentAt: event.sentAt,
        },
      },
    ]);
    return [];
  },
});

/**
 * NoticeDismissSystem — universal mirror for `NoticeDismissed`.
 * Drops the holder's TbCarries entry that points at the burnt
 * item, despawns the notice entity, and despawns the item itself
 * UNLESS the item is a canonical catalog template (in which case
 * other characters may still hold their own copies and we leave
 * the master alone — same rule as the inventory Remove button).
 */
export const NoticeDismissSystem = defineSystem({
  name: "NoticeDismiss",
  on: NoticeDismissed,
  reads: [TbCarries, ItemCatalogIndex],
  writes: [TbCarries],
  run: ({ event, world }) => {
    // Drop the entry from the holder.
    const got = world.get(event.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<{ itemId: string }> } }
      | undefined;
    if (got) {
      const next = got.TbCarries.entries.filter((e) => e.itemId !== event.itemId);
      if (next.length !== got.TbCarries.entries.length) {
        world.set(event.holderId, TbCarries, { entries: next });
      }
    }
    // Despawn the notice entity so the chat card disappears.
    if (world.has(event.noticeId)) {
      world.despawn(event.noticeId);
    }
    // Despawn the burnt item entity unless it's a catalog template.
    if (world.has(event.itemId) && !isCatalogEntity(world, event.itemId)) {
      world.despawn(event.itemId);
    }
    return [];
  },
});

/**
 * GrindTollOpenedSystem — universal mirror for `GrindTollOpened`.
 * Spawns the toll entity at the server-allocated id with each row's
 * `applied: false`. The chat-timeline contributor queries
 * `GrindToll` entities and renders one card per toll.
 */
export const GrindTollOpenedSystem = defineSystem({
  name: "GrindTollOpened",
  on: GrindTollOpened,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.id)) return [];
    world.spawnAt(event.id, [
      {
        name: GrindToll.name,
        value: {
          turn: event.turn,
          sentAt: event.sentAt,
          rows: event.rows.map((r) => ({
            characterId: r.characterId,
            characterName: r.characterName,
            condition: r.condition,
            applied: false,
          })),
        },
      },
    ]);
    return [];
  },
});

/**
 * GrindTollRowAppliedSystem — universal mirror for one row of a
 * toll being resolved.
 *
 *   - Writes the imposed condition onto the character's
 *     Conditions trait (idempotent: if already set we leave it).
 *   - Flips the row's `applied: true` on the toll entity.
 *   - If every row of the toll is now applied, despawns the toll
 *     entity so the chat card disappears.
 *
 * Adding a condition also clears `fresh` (the trait keeps a
 * `fresh` boolean that's mutually exclusive with the rest).
 */
export const GrindTollRowAppliedSystem = defineSystem({
  name: "GrindTollRowApplied",
  on: GrindTollRowApplied,
  reads: [Conditions, GrindToll],
  writes: [Conditions, GrindToll],
  run: ({ event, world }) => {
    // Apply the condition to the character.
    if (world.has(event.characterId)) {
      const c = world.get(event.characterId, [Conditions]) as
        | { Conditions: Record<GrindCondition | "fresh", boolean> }
        | undefined;
      const before = c?.Conditions ?? {
        fresh: true,
        hungryThirsty: false,
        exhausted: false,
        angry: false,
        afraid: false,
        injured: false,
        sick: false,
      };
      const next = {
        ...before,
        fresh: false,
        [event.condition]: true,
      };
      world.set(event.characterId, Conditions, next);
    }
    // Flip the row + check completion.
    if (!world.has(event.tollId)) return [];
    const got = world.get(event.tollId, [GrindToll]) as
      | {
          GrindToll: {
            turn: number;
            sentAt: number;
            rows: Array<{
              characterId: string;
              characterName: string;
              condition: GrindCondition;
              applied: boolean;
            }>;
          };
        }
      | undefined;
    if (!got) return [];
    const rows = got.GrindToll.rows.slice();
    const row = rows[event.rowIndex];
    if (!row) return [];
    rows[event.rowIndex] = { ...row, applied: true };
    world.set(event.tollId, GrindToll, {
      ...got.GrindToll,
      rows,
    });
    if (rows.every((r) => r.applied)) {
      world.despawn(event.tollId);
    }
    return [];
  },
});

function isCatalogEntity(
  world: import("@vtt/substrate").World,
  itemId: string,
): boolean {
  for (const row of world.query([ItemCatalogIndex])) {
    const v = row.values.ItemCatalogIndex as { entries: Record<string, string> };
    for (const id of Object.values(v.entries)) {
      if (id === itemId) return true;
    }
  }
  return false;
}
