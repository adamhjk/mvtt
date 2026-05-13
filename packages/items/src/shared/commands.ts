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

import { defineCommand, EntityId, fail, ok, z } from "@vtt/substrate";
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
} from "./events.js";
import { ItemBundle, ItemDerivedFrom, ItemIdentity } from "./traits.js";
import { findTraitByShortName } from "./field-paths.js";

/**
 * CreateItem — spawn a new item entity from a caller-supplied trait
 * bag. The bag is opaque (record of trait-name → value) so this
 * command serves any item subtype: a TB sword, a 5e potion, anything
 * else a future game system needs. Validation of trait values
 * happens against the registered trait schemas at apply-time, when
 * each value is parsed before being stored.
 *
 * Used by:
 *   - Game-system "add item to my inventory" UI flows that need a
 *     fresh entity (e.g. spawning loot a player has just been awarded
 *     that doesn't correspond to a catalog entry).
 *   - Tests that want a real item entity without going through the
 *     catalog seed.
 *
 * NOT used by the catalog seed hook — seeds spawn directly through
 * `world.spawn` to keep deterministic content out of the event log.
 */
export const CreateItem = defineCommand({
  name: "@vtt/items/CreateItem",
  schema: z.object({
    traits: z.record(z.string(), z.unknown()),
  }),
  validate: ({ cmd, registry }) => {
    // Trait keys in the bag are *short* names (e.g. "ItemIdentity") so
    // callers don't have to repeat plugin namespaces. The mirror
    // system resolves short → full at apply-time.
    for (const shortName of Object.keys(cmd.traits)) {
      if (!findTraitByShortName(registry, shortName)) {
        return fail(`unknown trait on CreateItem: ${shortName}`);
      }
    }
    return ok();
  },
  apply: ({ cmd, world }) => [
    ItemCreated({
      itemId: world.allocateId(),
      traits: cmd.traits,
    }),
  ],
});

/**
 * CustomizeItem — fork an item entity. Allocates a new id, copies
 * every shareable trait from `sourceItemId` onto it (the substrate's
 * trait `share` flag controls which traits travel), and fires
 * `ItemForked`. Holder-side machinery (per-game-system) listens for
 * the event and rewrites whatever inventory entry pointed at the
 * source so it now points at the fork.
 *
 * Symmetric: works whether the source is a catalog-derived entity
 * or an already-forked one. Forking again creates yet another fork.
 *
 * Optional `holderId` + `entryIndex` — pass these when the caller is
 * "fork the thing my character is currently carrying at entry N." The
 * fields ride along on `ItemForked` so a holder-side system can
 * rewrite the exact carry entry. Omitting them is the "ad-hoc fork"
 * shape used by the workbench's Items page (where there's no holder
 * involved).
 */
export const CustomizeItem = defineCommand({
  name: "@vtt/items/CustomizeItem",
  schema: z.object({
    sourceItemId: EntityId,
    holderId: EntityId.optional(),
    entryIndex: z.number().int().min(0).optional(),
  }),
  validate: ({ cmd, world }) => {
    if (!world.has(cmd.sourceItemId)) {
      return fail(`unknown source item ${cmd.sourceItemId}`);
    }
    if (cmd.holderId !== undefined && !world.has(cmd.holderId)) {
      return fail(`unknown holder ${cmd.holderId}`);
    }
    return ok();
  },
  apply: ({ cmd, world }) => [
    ItemForked({
      sourceItemId: cmd.sourceItemId,
      newItemId: world.allocateId(),
      ...(cmd.holderId !== undefined ? { holderId: cmd.holderId } : {}),
      ...(cmd.entryIndex !== undefined ? { entryIndex: cmd.entryIndex } : {}),
    }),
  ],
});

/**
 * EditItemField — set a field on a trait of an item, recording the
 * path as an override on `ItemDerivedFrom` so re-seed won't clobber
 * it. The path is "<TraitShortName>.<keypath>"; the receiving system
 * splits it, reads the trait's current value, deep-sets the
 * sub-path, and writes the result back through `world.set` (so trait
 * subscribers refresh).
 *
 * Validation only checks that the entity exists; the path-split and
 * trait-shape validation happens in the system, where the actual
 * value is parsed against the trait schema before being stored.
 */
export const EditItemField = defineCommand({
  name: "@vtt/items/EditItemField",
  schema: z.object({
    itemId: EntityId,
    path: z.string().min(1).max(240),
    value: z.unknown(),
  }),
  validate: ({ cmd, world }) => {
    if (!world.has(cmd.itemId)) {
      return fail(`unknown item ${cmd.itemId}`);
    }
    return ok();
  },
  apply: ({ cmd }) => [
    ItemFieldChanged({
      itemId: cmd.itemId,
      path: cmd.path,
      value: cmd.value,
    }),
  ],
});

/**
 * RevertItemField — drop a previously-recorded override so the next
 * re-seed adopts the catalog's value for the field. No-op for items
 * that don't carry `ItemDerivedFrom` (nothing to revert from).
 */
export const RevertItemField = defineCommand({
  name: "@vtt/items/RevertItemField",
  schema: z.object({
    itemId: EntityId,
    path: z.string().min(1).max(240),
  }),
  validate: ({ cmd, world }) => {
    if (!world.has(cmd.itemId)) {
      return fail(`unknown item ${cmd.itemId}`);
    }
    return ok();
  },
  apply: ({ cmd }) => [
    ItemFieldReverted({
      itemId: cmd.itemId,
      path: cmd.path,
    }),
  ],
});

/**
 * LockItemField — explicitly lock a field at its current value so
 * the next re-seed leaves it alone. Useful when the GM wants to
 * pin a value to its present catalog default before any upstream
 * change can flow in. Adds the path to `ItemDerivedFrom.overrides`.
 */
export const LockItemField = defineCommand({
  name: "@vtt/items/LockItemField",
  schema: z.object({
    itemId: EntityId,
    path: z.string().min(1).max(240),
  }),
  validate: ({ cmd, world }) => {
    if (!world.has(cmd.itemId)) {
      return fail(`unknown item ${cmd.itemId}`);
    }
    const got = world.get(cmd.itemId, [ItemDerivedFrom]);
    if (!got) {
      return fail(`item ${cmd.itemId} is not catalog-derived; nothing to lock`);
    }
    return ok();
  },
  apply: ({ cmd }) => [
    ItemFieldLocked({
      itemId: cmd.itemId,
      path: cmd.path,
    }),
  ],
});

/**
 * SetItemTrait — add or replace a trait on an existing item. The
 * `traitShortName` is the segment after the final "/" in the
 * trait's plugin-namespaced name (e.g. "TbWeapon"). The value is
 * parsed against the trait's schema before being stored, so
 * malformed payloads land as a validate-time fail rather than a
 * server-side throw.
 *
 * Differs from `EditItemField` in that it operates on the WHOLE
 * trait — useful for "Add Subtype" affordances where the trait
 * doesn't yet exist on the item, or for wholesale replacement.
 */
export const SetItemTrait = defineCommand({
  name: "@vtt/items/SetItemTrait",
  schema: z.object({
    itemId: EntityId,
    traitShortName: z.string().min(1).max(120),
    value: z.unknown(),
  }),
  validate: ({ cmd, world, registry }) => {
    if (!world.has(cmd.itemId)) return fail(`unknown item ${cmd.itemId}`);
    const def = findTraitByShortName(registry, cmd.traitShortName);
    if (!def) return fail(`unknown trait ${cmd.traitShortName}`);
    try {
      def.schema.parse(cmd.value);
    } catch (err) {
      return fail(`invalid trait value: ${(err as Error).message}`);
    }
    return ok();
  },
  apply: ({ cmd }) => [
    ItemTraitSet({
      itemId: cmd.itemId,
      traitShortName: cmd.traitShortName,
      value: cmd.value,
    }),
  ],
});

/**
 * RemoveItemTrait — strip a single trait off an item. The item
 * entity stays; only that trait's data is wiped. The receiver
 * also drops the trait's path prefix from any
 * ItemDerivedFrom.overrides so future re-seed treats the trait
 * as freshly absent.
 */
export const RemoveItemTrait = defineCommand({
  name: "@vtt/items/RemoveItemTrait",
  schema: z.object({
    itemId: EntityId,
    traitShortName: z.string().min(1).max(120),
  }),
  validate: ({ cmd, world }) => {
    if (!world.has(cmd.itemId)) return fail(`unknown item ${cmd.itemId}`);
    return ok();
  },
  apply: ({ cmd }) => [
    ItemTraitRemoved({
      itemId: cmd.itemId,
      traitShortName: cmd.traitShortName,
    }),
  ],
});

/**
 * SplitItemBundle — peel `count` units off an existing bundle into
 * a freshly forked entity. The new entity inherits every shareable
 * trait (so its kind, slot options, weapon/armor/etc. data all
 * match the source) and gets its own `ItemBundle.count = count`.
 * The source's `ItemBundle.count` decreases by `count`.
 *
 * Constraints:
 *   - `itemId` must have an ItemBundle trait.
 *   - `count >= 1` and `count < bundle.count` (must leave at least
 *     1 unit on the source — if you wanted to give the whole stack
 *     away, transfer the entity itself, don't split-then-destroy).
 *   - The source must NOT be a catalog-master (template entity in
 *     the catalog index). Catalog masters are shared by reference;
 *     split would mutate everyone's stack. Game-system EquipItem
 *     (or equivalent) auto-forks bundleable catalog items on
 *     pickup so a caller's source is always a private fork by the
 *     time they reach SplitItemBundle.
 *
 * Holder-side bookkeeping (e.g. equipping the new fork next to
 * the source on a TbCarries entry) lives in the game-system plugin
 * — it subscribes to ItemBundleSplit and adds the new id wherever
 * the source was.
 */
export const SplitItemBundle = defineCommand({
  name: "@vtt/items/SplitItemBundle",
  schema: z.object({
    itemId: EntityId,
    count: z.number().int().min(1).max(99),
  }),
  validate: ({ cmd, world }) => {
    if (!world.has(cmd.itemId)) return fail(`unknown item ${cmd.itemId}`);
    const got = world.get(cmd.itemId, [ItemBundle]) as
      | { ItemBundle: { count: number; capacity: number } }
      | undefined;
    if (!got) return fail(`item ${cmd.itemId} has no ItemBundle`);
    if (cmd.count >= got.ItemBundle.count) {
      return fail(
        `cannot split ${cmd.count} from a stack of ${got.ItemBundle.count}; would leave the source empty`,
      );
    }
    return ok();
  },
  apply: ({ cmd, world }) => {
    const got = world.get(cmd.itemId, [ItemBundle]) as {
      ItemBundle: { count: number; capacity: number };
    };
    return [
      ItemBundleSplit({
        sourceId: cmd.itemId,
        newItemId: world.allocateId(),
        sourceFinalCount: got.ItemBundle.count - cmd.count,
        newCount: cmd.count,
      }),
    ];
  },
});

/**
 * JoinItemBundles — pour `srcId`'s units into `destId`. The amount
 * actually transferred is capped at `dest.capacity - dest.count`,
 * so combining a partial src into a near-full dest can leave src
 * with leftovers. If the entire src is absorbed, the src entity
 * is despawned; otherwise its count is decremented.
 *
 * Compatibility check: both items must look like the same "kind"
 * of thing — either both carry an ItemDerivedFrom whose templateId
 * matches, or both lack ItemDerivedFrom and have matching
 * ItemIdentity.name. This is intentionally loose: a torch the GM
 * has tweaked still merges with a stock torch (the dest's overrides
 * win; src's data is discarded along with the entity).
 */
export const JoinItemBundles = defineCommand({
  name: "@vtt/items/JoinItemBundles",
  schema: z.object({
    srcId: EntityId,
    destId: EntityId,
  }),
  validate: ({ cmd, world }) => {
    if (cmd.srcId === cmd.destId) return fail("cannot join an item with itself");
    if (!world.has(cmd.srcId)) return fail(`unknown src ${cmd.srcId}`);
    if (!world.has(cmd.destId)) return fail(`unknown dest ${cmd.destId}`);
    const src = world.get(cmd.srcId, [ItemBundle]) as
      | { ItemBundle: { count: number; capacity: number } }
      | undefined;
    const dest = world.get(cmd.destId, [ItemBundle]) as
      | { ItemBundle: { count: number; capacity: number } }
      | undefined;
    if (!src) return fail(`src ${cmd.srcId} has no ItemBundle`);
    if (!dest) return fail(`dest ${cmd.destId} has no ItemBundle`);
    if (dest.ItemBundle.count >= dest.ItemBundle.capacity) {
      return fail(
        `dest is already at capacity (${dest.ItemBundle.capacity})`,
      );
    }
    if (!bundlesAreCompatible(world, cmd.srcId, cmd.destId)) {
      return fail("src and dest are not the same kind of item");
    }
    return ok();
  },
  apply: ({ cmd, world }) => {
    const src = world.get(cmd.srcId, [ItemBundle]) as {
      ItemBundle: { count: number; capacity: number };
    };
    const dest = world.get(cmd.destId, [ItemBundle]) as {
      ItemBundle: { count: number; capacity: number };
    };
    const room = dest.ItemBundle.capacity - dest.ItemBundle.count;
    const transfer = Math.min(src.ItemBundle.count, room);
    const srcRemaining = src.ItemBundle.count - transfer;
    return [
      ItemBundleJoined({
        srcId: cmd.srcId,
        destId: cmd.destId,
        destFinalCount: dest.ItemBundle.count + transfer,
        srcRemainingCount: srcRemaining,
        srcDestroyed: srcRemaining === 0,
      }),
    ];
  },
});

function bundlesAreCompatible(
  world: import("@vtt/substrate").World,
  a: import("@vtt/substrate").EntityId,
  b: import("@vtt/substrate").EntityId,
): boolean {
  const aDerived = world.get(a, [ItemDerivedFrom]) as
    | { ItemDerivedFrom: { templateId: string } }
    | undefined;
  const bDerived = world.get(b, [ItemDerivedFrom]) as
    | { ItemDerivedFrom: { templateId: string } }
    | undefined;
  if (aDerived && bDerived) {
    return aDerived.ItemDerivedFrom.templateId === bDerived.ItemDerivedFrom.templateId;
  }
  if (aDerived || bDerived) return false;
  const aIdent = world.get(a, [ItemIdentity]) as
    | { ItemIdentity: { name: string } }
    | undefined;
  const bIdent = world.get(b, [ItemIdentity]) as
    | { ItemIdentity: { name: string } }
    | undefined;
  if (!aIdent || !bIdent) return false;
  return aIdent.ItemIdentity.name === bIdent.ItemIdentity.name;
}

/**
 * DestroyItem — remove an item entity from the world. Callers are
 * responsible for removing any holder-side references first;
 * destroying an item that's still referenced from a TbCarries entry
 * leaves the entry pointing at a dead id (which the inventory view
 * will skip but is still a bug).
 */
export const DestroyItem = defineCommand({
  name: "@vtt/items/DestroyItem",
  schema: z.object({
    itemId: EntityId,
  }),
  validate: ({ cmd, world }) => {
    if (!world.has(cmd.itemId)) {
      return fail(`unknown item ${cmd.itemId}`);
    }
    return ok();
  },
  apply: ({ cmd }) => [ItemDestroyed({ itemId: cmd.itemId })],
});
