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

import { defineEvent, EntityId, z } from "@vtt/substrate";

/**
 * An item entity has been spawned. Carries the full trait bag the
 * server-side mirror system uses to call `world.spawnAt(itemId, ...)`
 * — every side ends up with the same entity. `traits` is an opaque
 * map keyed by trait name (the universal-mirror system fans it out
 * by looking up each trait def in the registry).
 */
export const ItemCreated = defineEvent({
  name: "@vtt/items/ItemCreated",
  schema: z.object({
    itemId: EntityId,
    traits: z.record(z.string(), z.unknown()),
  }),
});

/**
 * An existing item has been forked. The mirror system spawns a new
 * entity at `newItemId`, copies every shareable trait from the source
 * over (the substrate's `share: false` flag controls which traits
 * skip the copy), then fires the original "you customized this"
 * machinery against the new id. The source entity is unchanged.
 */
export const ItemForked = defineEvent({
  name: "@vtt/items/ItemForked",
  schema: z.object({
    sourceItemId: EntityId,
    newItemId: EntityId,
  }),
});

/**
 * A field on an item has been edited. The path uses dot notation
 * scoped under a trait name (e.g. "ItemIdentity.name",
 * "TbWeapon.conflictBonuses.attack.value"). The receiving system
 * applies the field to the trait's current value AND adds the path
 * to that item's `ItemDerivedFrom.overrides` so re-seed leaves it
 * alone. Items with no `ItemDerivedFrom` trait skip the override
 * tracking step (they're not catalog-derived).
 */
export const ItemFieldChanged = defineEvent({
  name: "@vtt/items/ItemFieldChanged",
  schema: z.object({
    itemId: EntityId,
    path: z.string().min(1).max(240),
    value: z.unknown(),
  }),
});

/**
 * An item's override on a field has been cleared. Removes the path
 * from `ItemDerivedFrom.overrides`; the next re-seed will adopt the
 * catalog's value for that field. Items that aren't catalog-derived
 * cannot be reverted (there's nothing to revert to).
 */
export const ItemFieldReverted = defineEvent({
  name: "@vtt/items/ItemFieldReverted",
  schema: z.object({
    itemId: EntityId,
    path: z.string().min(1).max(240),
  }),
});

/**
 * An item's override on a field has been explicitly locked even
 * though the GM hasn't edited it yet. Prevents the next re-seed
 * from clobbering a value the GM is intentionally keeping at the
 * current catalog value.
 */
export const ItemFieldLocked = defineEvent({
  name: "@vtt/items/ItemFieldLocked",
  schema: z.object({
    itemId: EntityId,
    path: z.string().min(1).max(240),
  }),
});

/**
 * An item entity has been destroyed. The mirror system calls
 * `world.despawn(itemId)` on every side. Callers are responsible
 * for removing any holder-side references (e.g. TbCarries entries)
 * before issuing this; the substrate doesn't enforce referential
 * integrity.
 */
export const ItemDestroyed = defineEvent({
  name: "@vtt/items/ItemDestroyed",
  schema: z.object({
    itemId: EntityId,
  }),
});

/**
 * A whole trait was set or replaced on an item — used by the "Add
 * Subtype" affordance in the items workbench page so a brand-new
 * item can pick up Weapon/Armor/Supply/Container/etc. shape on
 * demand. The receiver parses the value against the trait schema
 * and writes it via `world.set`. If the item didn't carry the
 * trait before, it will after.
 */
export const ItemTraitSet = defineEvent({
  name: "@vtt/items/ItemTraitSet",
  schema: z.object({
    itemId: EntityId,
    traitShortName: z.string().min(1).max(120),
    value: z.unknown(),
  }),
});

/**
 * A whole trait was removed from an item — clears subtype data the
 * GM no longer wants. Used by the "Remove this subtype" button
 * next to each editable section.
 */
export const ItemTraitRemoved = defineEvent({
  name: "@vtt/items/ItemTraitRemoved",
  schema: z.object({
    itemId: EntityId,
    traitShortName: z.string().min(1).max(120),
  }),
});

/**
 * A bundleable item has been split. The receiver allocates the new
 * entity by copying every shareable trait from `sourceId`, then
 * sets the two `ItemBundle.count` values (`sourceFinalCount` on the
 * source, `newCount` on `newItemId`). Holder-side machinery (per-
 * game-system) listens for the event to add the new fork into the
 * appropriate carries entry; that holder-side wiring is
 * intentionally not part of this generic event.
 */
export const ItemBundleSplit = defineEvent({
  name: "@vtt/items/ItemBundleSplit",
  schema: z.object({
    sourceId: EntityId,
    newItemId: EntityId,
    sourceFinalCount: z.number().int().min(1).max(99),
    newCount: z.number().int().min(1).max(99),
  }),
});

/**
 * Two bundleable items have been merged. The receiver sets
 * `destFinalCount` on `destId`. If `srcDestroyed`, it despawns
 * `srcId`; otherwise it sets `srcRemainingCount` on `srcId`. Holder-
 * side machinery (per-game-system) is responsible for clearing any
 * inventory entry pointing at a destroyed source.
 */
export const ItemBundleJoined = defineEvent({
  name: "@vtt/items/ItemBundleJoined",
  schema: z.object({
    srcId: EntityId,
    destId: EntityId,
    destFinalCount: z.number().int().min(1).max(99),
    srcRemainingCount: z.number().int().min(0).max(99),
    srcDestroyed: z.boolean(),
  }),
});
