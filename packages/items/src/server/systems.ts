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
  ItemCreated,
  ItemDestroyed,
  ItemFieldChanged,
  ItemFieldLocked,
  ItemFieldReverted,
  ItemForked,
} from "../shared/events.js";
import { ItemDerivedFrom } from "../shared/traits.js";
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
