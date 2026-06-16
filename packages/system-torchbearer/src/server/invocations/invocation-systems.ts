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
import { Relics } from "../../shared/traits.js";
import { TbCarries } from "../../shared/items/index.js";
import {
  InvocationCreated,
  InvocationFieldEdited,
  InvocationPerformConsumeLogged,
  InvocationRemoved,
  RelicAcquired,
  RelicLost,
} from "../../shared/invocations/invocation-events.js";
import {
  InvocationIdentity,
  InvocationPerformConsumed,
  TbInvocationHomebrewProse,
  TbInvocationPerforming,
  TbInvocationRelicLink,
  TbInvocationRelics,
} from "../../shared/invocations/invocation-traits.js";

/* -------------------------------------------------------------------------
 * Relic mutations
 * ----------------------------------------------------------------------- */

/**
 * Default carry placement for a freshly-acquired relic — the staged
 * "loose" slot that the Inventory tab's Loose panel renders (see
 * `TbBodySlotSchema`'s `loose:<n>` clause and `LoosePanel`'s filter).
 * The slot key is suffixed with the item id so multiple relics
 * coexist as distinct entries; the player can move the row to a real
 * body slot (worn/neck, belt, pack-inside-backpack, etc.) from the
 * Inventory tab once it appears. The rule-book slot annotation
 * ("[worn/neck or pocket]") stays purely descriptive on
 * `TbInvocationPerforming.relicSlot`.
 */
function defaultRelicCarryEntry(itemId: string): {
  slot: string;
  slotIndex: number;
  channel: "carried";
  slotsConsumed: number;
  itemId: string;
  quantity: number;
} {
  return {
    slot: `loose:${itemId}`,
    slotIndex: 0,
    channel: "carried",
    slotsConsumed: 1,
    itemId,
    quantity: 1,
  };
}

/**
 * Find the catalog relic-item entity whose `TbInvocationRelicLink`
 * back-references the given invocation. Returns null when no relic
 * has been seeded for the invocation (homebrew invocations without a
 * `relicName`, or invocations created at runtime via
 * `CreateBlankInvocation`).
 */
function findRelicItemForInvocation(
  world: import("@vtt/substrate").World,
  invocationId: string,
): string | null {
  for (const row of world.query([TbInvocationRelicLink])) {
    const v = row.values.TbInvocationRelicLink as { invocationId: string };
    if (v.invocationId === invocationId) return row.id;
  }
  return null;
}

export const TbRelicAcquiredSystem = defineSystem({
  name: "TbRelicAcquired",
  on: RelicAcquired,
  reads: [TbInvocationRelics, TbInvocationRelicLink, TbCarries],
  writes: [TbInvocationRelics, TbCarries],
  run: ({ event, world }) => {
    const flagGot = world.get(event.characterId, [TbInvocationRelics]) as
      | { TbInvocationRelics: { invocationIds: string[] } }
      | undefined;
    const flag = flagGot?.TbInvocationRelics ?? { invocationIds: [] };
    if (flag.invocationIds.includes(event.invocationId)) {
      // Already-held guard for replay / late-mirror: leave the
      // existing inventory entry alone.
      return [];
    }

    // The relic item is a real catalog entity, seeded once per world
    // alongside every other item. Look it up by back-link and add a
    // carries entry pointing at it. (No spawn — the entity already
    // exists.)
    const relicItemId = findRelicItemForInvocation(world, event.invocationId);
    if (relicItemId) {
      const carriesGot = world.get(event.characterId, [TbCarries]) as
        | {
            TbCarries: {
              entries: ReadonlyArray<{ itemId: string }>;
            };
          }
        | undefined;
      const currentEntries = carriesGot?.TbCarries.entries ?? [];
      const alreadyCarried = currentEntries.some((e) => e.itemId === relicItemId);
      if (!alreadyCarried) {
        world.set(event.characterId, TbCarries, {
          entries: [...currentEntries, defaultRelicCarryEntry(relicItemId)],
        });
      }
    }

    // Stamp the held-relics flag last so a half-applied state never
    // shows the chip without the inventory item.
    world.set(event.characterId, TbInvocationRelics, {
      invocationIds: [...flag.invocationIds, event.invocationId],
    });
    return [];
  },
});

export const TbRelicLostSystem = defineSystem({
  name: "TbRelicLost",
  on: RelicLost,
  reads: [TbInvocationRelics, TbCarries, TbInvocationRelicLink],
  writes: [TbInvocationRelics, TbCarries],
  run: ({ event, world }) => {
    // Drop every TbCarries entry whose item back-references this
    // invocation. The relic item entity itself is a shared catalog
    // record — leave it spawned so other characters who hold the
    // same relic don't lose theirs.
    const carriesGot = world.get(event.characterId, [TbCarries]) as
      | {
          TbCarries: {
            entries: ReadonlyArray<{ itemId: string }>;
          };
        }
      | undefined;
    const entries = carriesGot?.TbCarries.entries ?? [];
    const remainingEntries = entries.filter((e) => {
      const link = world.get(e.itemId, [TbInvocationRelicLink]) as
        | { TbInvocationRelicLink: { invocationId: string } }
        | undefined;
      return link?.TbInvocationRelicLink.invocationId !== event.invocationId;
    });
    if (carriesGot && remainingEntries.length !== entries.length) {
      world.set(event.characterId, TbCarries, { entries: remainingEntries });
    }

    const flagGot = world.get(event.characterId, [TbInvocationRelics]) as
      | { TbInvocationRelics: { invocationIds: string[] } }
      | undefined;
    if (flagGot) {
      world.set(event.characterId, TbInvocationRelics, {
        invocationIds: flagGot.TbInvocationRelics.invocationIds.filter(
          (id) => id !== event.invocationId,
        ),
      });
    }
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Perform commit — stamp the marker, increment the character's burden
 * ----------------------------------------------------------------------- */

/**
 * Mirrors `TbSpellCastConsumeLoggedSystem`: stamps
 * `InvocationPerformConsumed` on the Roll entity and bumps the
 * character's `Relics.burden` counter (DH p.100). The chat row's
 * `[Apply burden]` button is gated on the marker's absence so it can
 * only be clicked once per roll.
 */
export const TbInvocationPerformConsumeLoggedSystem = defineSystem({
  name: "TbInvocationPerformConsumeLogged",
  on: InvocationPerformConsumeLogged,
  reads: [Relics],
  writes: [InvocationPerformConsumed, Relics],
  run: ({ event, world }) => {
    if (!world.has(event.rollId)) return [];
    world.set(event.rollId, InvocationPerformConsumed, {
      characterId: event.characterId,
      invocationId: event.invocationId,
      burdenAdded: event.burdenAdded,
      consumedAt: event.consumedAt,
    });
    const got = world.get(event.characterId, [Relics]) as
      | {
          Relics: {
            entries: Array<{ relic: string; inventory: string; invocation: string }>;
            urdr: number;
            burden: number;
          };
        }
      | undefined;
    const current = got?.Relics ?? { entries: [], urdr: 1, burden: 0 };
    const nextBurden = Math.min(6, current.burden + event.burdenAdded);
    world.set(event.characterId, Relics, {
      ...current,
      burden: nextBurden,
    });
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Catalog management — create / remove / field-edit (homebrew)
 * ----------------------------------------------------------------------- */

export const TbInvocationCreatedSystem = defineSystem({
  name: "TbInvocationCreated",
  on: InvocationCreated,
  reads: [],
  writes: [InvocationIdentity, TbInvocationPerforming, TbInvocationHomebrewProse],
  run: ({ event, world }) => {
    if (!world.has(event.invocationId)) {
      world.spawnAt(event.invocationId, [
        InvocationIdentity({
          name: event.name,
          circle: 1,
          traditions: [],
          pageRef: null,
        }),
        TbInvocationPerforming({
          ritualKind: "fixed",
          fixedOb: null,
          versusAgainst: null,
          invocationTime: { noRelic: 1, withRelic: 0 },
          duration: "",
          immortalBurden: { noRelic: 2, withRelic: 1 },
          relicName: "",
          relicSlot: "",
          sacramental: "",
        }),
        TbInvocationHomebrewProse({ effect: "", ritual: "" }),
      ]);
    }
    return [];
  },
});

export const TbInvocationRemovedSystem = defineSystem({
  name: "TbInvocationRemoved",
  on: InvocationRemoved,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.invocationId)) {
      world.despawn(event.invocationId);
    }
    return [];
  },
});

const INVOCATION_TRAITS_BY_NAME = {
  InvocationIdentity,
  TbInvocationPerforming,
  TbInvocationHomebrewProse,
} as const;
type EditableInvocationTrait = keyof typeof INVOCATION_TRAITS_BY_NAME;

function setAtPath(root: unknown, path: ReadonlyArray<string>, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const obj = (
    root && typeof root === "object" ? { ...(root as Record<string, unknown>) } : {}
  ) as Record<string, unknown>;
  obj[head!] = setAtPath(obj[head!], rest, value);
  return obj;
}

export const TbInvocationFieldEditedSystem = defineSystem({
  name: "TbInvocationFieldEdited",
  on: InvocationFieldEdited,
  reads: [InvocationIdentity, TbInvocationPerforming, TbInvocationHomebrewProse],
  writes: [InvocationIdentity, TbInvocationPerforming, TbInvocationHomebrewProse],
  run: ({ event, world }) => {
    if (!world.has(event.invocationId)) return [];
    const traitName = event.trait as EditableInvocationTrait;
    const trait = INVOCATION_TRAITS_BY_NAME[traitName];
    const got = world.get(event.invocationId, [trait]) as Record<string, unknown> | undefined;
    const shortName = trait.name.split("/").pop()!;
    const current = (got?.[shortName] ?? {}) as unknown;
    const next = setAtPath(current, event.path, event.value);
    try {
      world.set(event.invocationId, trait, next as never);
    } catch {
      // Schema parse rejected the new value — drop it.
    }
    return [];
  },
});

export const TB_INVOCATION_SYSTEMS = [
  TbRelicAcquiredSystem,
  TbRelicLostSystem,
  TbInvocationPerformConsumeLoggedSystem,
  TbInvocationCreatedSystem,
  TbInvocationRemovedSystem,
  TbInvocationFieldEditedSystem,
] as const;
