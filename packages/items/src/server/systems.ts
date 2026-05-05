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

import { defineSystem, type TraitName } from "@vtt/substrate";
import {
  ItemBundleJoined,
  ItemBundleSplit,
  ItemCreated,
  ItemDestroyed,
  ItemFieldChanged,
  ItemFieldLocked,
  ItemFieldReverted,
  ItemForked,
  ItemTraitRemoved,
  ItemTraitSet,
} from "../shared/events.js";
import { ItemBundle, ItemDerivedFrom } from "../shared/traits.js";
import {
  applyEditedField,
  copyShareableTraits,
  findTraitByShortName,
} from "../shared/field-paths.js";

/**
 * ItemCreated → spawn the item entity at the server-allocated id.
 * Universal mirror — runs on every side. Trait values are parsed
 * against their registered schemas as they're attached.
 */
export const ItemSpawningSystem = defineSystem({
  name: "ItemSpawning",
  on: ItemCreated,
  reads: [],
  writes: [],
  run: ({ event, world, registry }) => {
    const traits: Array<{ name: TraitName; value: unknown }> = [];
    for (const [shortName, raw] of Object.entries(event.traits)) {
      const def = findTraitByShortName(registry, shortName);
      if (!def) continue; // Validate already covered this; defensive.
      traits.push({ name: def.name, value: def.schema.parse(raw) });
    }
    world.spawnAt(event.itemId, traits);
    return [];
  },
});

/**
 * ItemForked → allocate the fork entity, copy every shareable trait
 * from source. The server-side authority on the source's traits is
 * the world; mirror systems on every side perform the same copy
 * once the event lands. The substrate's `share: false` flag
 * controls which traits are excluded.
 */
export const ItemForkSystem = defineSystem({
  name: "ItemFork",
  on: ItemForked,
  reads: [],
  writes: [],
  run: ({ event, world, registry }) => {
    if (!world.has(event.sourceItemId)) return [];
    if (world.has(event.newItemId)) return [];
    world.spawnAt(event.newItemId, []);
    copyShareableTraits({
      world,
      registry,
      sourceId: event.sourceItemId,
      destId: event.newItemId,
    });
    return [];
  },
});

/**
 * ItemFieldChanged → write the new value to the named trait field
 * AND record the path on ItemDerivedFrom.overrides (so re-seed
 * leaves it alone). Items without ItemDerivedFrom skip the override
 * step — they're not catalog-derived.
 */
export const ItemFieldEditSystem = defineSystem({
  name: "ItemFieldEdit",
  on: ItemFieldChanged,
  reads: [ItemDerivedFrom],
  writes: [ItemDerivedFrom],
  run: ({ event, world, registry }) => {
    if (!world.has(event.itemId)) return [];
    try {
      applyEditedField({
        world,
        registry,
        itemId: event.itemId,
        path: event.path,
        value: event.value,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[items] failed to apply field edit ${event.path} on ${event.itemId}:`,
        (err as Error).message,
      );
      return [];
    }
    recordOverride(world, event.itemId, event.path);
    return [];
  },
});

/**
 * ItemFieldReverted → drop the path from overrides. The next
 * re-seed will adopt the catalog's value. The trait value is
 * NOT touched here; the catalog merge does that on next boot.
 */
export const ItemFieldRevertSystem = defineSystem({
  name: "ItemFieldRevert",
  on: ItemFieldReverted,
  reads: [ItemDerivedFrom],
  writes: [ItemDerivedFrom],
  run: ({ event, world }) => {
    if (!world.has(event.itemId)) return [];
    const got = world.get(event.itemId, [ItemDerivedFrom]) as
      | {
          ItemDerivedFrom: {
            templateId: string;
            pluginName: string;
            overrides: string[];
            deprecated?: boolean;
          };
        }
      | undefined;
    if (!got) return [];
    const overrides = got.ItemDerivedFrom.overrides.filter((p) => p !== event.path);
    world.set(event.itemId, ItemDerivedFrom, {
      ...got.ItemDerivedFrom,
      overrides,
    });
    return [];
  },
});

/**
 * ItemFieldLocked → record the path on overrides without changing
 * the trait value. Useful when the GM wants to pin a current value
 * before any upstream change can flow in.
 */
export const ItemFieldLockSystem = defineSystem({
  name: "ItemFieldLock",
  on: ItemFieldLocked,
  reads: [ItemDerivedFrom],
  writes: [ItemDerivedFrom],
  run: ({ event, world }) => {
    if (!world.has(event.itemId)) return [];
    recordOverride(world, event.itemId, event.path);
    return [];
  },
});

/**
 * ItemTraitSet → set the named trait wholesale. Used by the "Add
 * Subtype" / "Replace Subtype" affordance in the items workbench
 * page so a brand-new item can grow Weapon/Armor/Supply/etc.
 * shape on demand.
 */
export const ItemTraitSetSystem = defineSystem({
  name: "ItemTraitSet",
  on: ItemTraitSet,
  reads: [],
  writes: [],
  run: ({ event, world, registry }) => {
    if (!world.has(event.itemId)) return [];
    const def = findTraitByShortName(registry, event.traitShortName);
    if (!def) return [];
    try {
      world.set(event.itemId, def, event.value);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[items] failed to set trait ${event.traitShortName} on ${event.itemId}:`,
        (err as Error).message,
      );
    }
    return [];
  },
});

/**
 * ItemTraitRemoved → strip the named trait off the item entity.
 * Also clears any `ItemDerivedFrom.overrides` paths under that
 * trait so future re-seed treats it as freshly absent rather than
 * locked-empty.
 */
export const ItemTraitRemoveSystem = defineSystem({
  name: "ItemTraitRemove",
  on: ItemTraitRemoved,
  reads: [ItemDerivedFrom],
  writes: [ItemDerivedFrom],
  run: ({ event, world, registry }) => {
    if (!world.has(event.itemId)) return [];
    const def = findTraitByShortName(registry, event.traitShortName);
    if (!def) return [];
    world.remove(event.itemId, def);
    // Clear any overrides under this trait's prefix.
    const got = world.get(event.itemId, [ItemDerivedFrom]) as
      | {
          ItemDerivedFrom: {
            templateId: string;
            pluginName: string;
            overrides: string[];
            deprecated?: boolean;
          };
        }
      | undefined;
    if (got) {
      const prefix = `${event.traitShortName}.`;
      const next = got.ItemDerivedFrom.overrides.filter(
        (p) => p !== event.traitShortName && !p.startsWith(prefix),
      );
      if (next.length !== got.ItemDerivedFrom.overrides.length) {
        world.set(event.itemId, ItemDerivedFrom, {
          ...got.ItemDerivedFrom,
          overrides: next,
        });
      }
    }
    return [];
  },
});

/**
 * ItemBundleSplit → spawn the new fork by copying the source's
 * shareable traits, then write `ItemBundle.count` on both sides.
 * Universal mirror — runs on every side. Idempotent: skips if the
 * new id is already present.
 */
export const ItemBundleSplitSystem = defineSystem({
  name: "ItemBundleSplit",
  on: ItemBundleSplit,
  reads: [ItemBundle],
  writes: [ItemBundle],
  run: ({ event, world, registry }) => {
    if (!world.has(event.sourceId)) return [];
    if (world.has(event.newItemId)) return [];
    world.spawnAt(event.newItemId, []);
    copyShareableTraits({
      world,
      registry,
      sourceId: event.sourceId,
      destId: event.newItemId,
    });
    const srcGot = world.get(event.sourceId, [ItemBundle]) as
      | { ItemBundle: { count: number; capacity: number } }
      | undefined;
    if (srcGot) {
      world.set(event.sourceId, ItemBundle, {
        ...srcGot.ItemBundle,
        count: event.sourceFinalCount,
      });
    }
    const newGot = world.get(event.newItemId, [ItemBundle]) as
      | { ItemBundle: { count: number; capacity: number } }
      | undefined;
    if (newGot) {
      world.set(event.newItemId, ItemBundle, {
        ...newGot.ItemBundle,
        count: event.newCount,
      });
    }
    return [];
  },
});

/**
 * ItemBundleJoined → set `ItemBundle.count` on the destination and
 * either despawn or update the source. Holder-side cleanup (e.g.
 * removing a TbCarries entry that pointed at a now-destroyed src)
 * is the game-system's responsibility — this system only touches
 * the items themselves.
 */
export const ItemBundleJoinSystem = defineSystem({
  name: "ItemBundleJoin",
  on: ItemBundleJoined,
  reads: [ItemBundle],
  writes: [ItemBundle],
  run: ({ event, world }) => {
    if (!world.has(event.destId)) return [];
    const destGot = world.get(event.destId, [ItemBundle]) as
      | { ItemBundle: { count: number; capacity: number } }
      | undefined;
    if (destGot) {
      world.set(event.destId, ItemBundle, {
        ...destGot.ItemBundle,
        count: event.destFinalCount,
      });
    }
    if (event.srcDestroyed) {
      if (world.has(event.srcId)) world.despawn(event.srcId);
    } else if (world.has(event.srcId)) {
      const srcGot = world.get(event.srcId, [ItemBundle]) as
        | { ItemBundle: { count: number; capacity: number } }
        | undefined;
      if (srcGot) {
        world.set(event.srcId, ItemBundle, {
          ...srcGot.ItemBundle,
          count: event.srcRemainingCount,
        });
      }
    }
    return [];
  },
});

/**
 * ItemDestroyed → despawn the entity on every side.
 */
export const ItemDestroySystem = defineSystem({
  name: "ItemDestroy",
  on: ItemDestroyed,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    world.despawn(event.itemId);
    return [];
  },
});

function recordOverride(
  world: import("@vtt/substrate").World,
  itemId: string,
  path: string,
): void {
  const got = world.get(itemId as never, [ItemDerivedFrom]) as
    | {
        ItemDerivedFrom: {
          templateId: string;
          pluginName: string;
          overrides: string[];
          deprecated?: boolean;
        };
      }
    | undefined;
  if (!got) return;
  if (got.ItemDerivedFrom.overrides.includes(path)) return;
  world.set(itemId as never, ItemDerivedFrom, {
    ...got.ItemDerivedFrom,
    overrides: [...got.ItemDerivedFrom.overrides, path],
  });
}
