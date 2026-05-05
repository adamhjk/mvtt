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
  ItemCreated,
  ItemDestroyed,
  ItemFieldChanged,
  ItemFieldLocked,
  ItemFieldReverted,
  ItemForked,
} from "./events.js";
import { ItemDerivedFrom } from "./traits.js";
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
 */
export const CustomizeItem = defineCommand({
  name: "@vtt/items/CustomizeItem",
  schema: z.object({
    sourceItemId: EntityId,
  }),
  validate: ({ cmd, world }) => {
    if (!world.has(cmd.sourceItemId)) {
      return fail(`unknown source item ${cmd.sourceItemId}`);
    }
    return ok();
  },
  apply: ({ cmd, world }) => [
    ItemForked({
      sourceItemId: cmd.sourceItemId,
      newItemId: world.allocateId(),
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
