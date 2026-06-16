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

import { definePlugin } from "@vtt/substrate";
import { PagesSlot } from "@vtt/shell-workbench/shared";
import { LinkKindsSlot } from "@vtt/notes/shared";
import { itemLinkKind } from "./shared/item-link-kind.js";
import {
  CreateItem,
  CustomizeItem,
  DestroyItem,
  EditItemField,
  ItemBundle,
  ItemBundleJoined,
  ItemBundleSplit,
  ItemCatalogIndex,
  ItemCreated,
  ItemDerivedFrom,
  ItemDestroyed,
  ItemDetailSectionsSlot,
  ItemEconomics,
  ItemFieldChanged,
  ItemFieldLocked,
  ItemFieldReverted,
  ItemForked,
  ItemIdentity,
  ItemTraitRemoved,
  ItemTraitSet,
  JoinItemBundles,
  LockItemField,
  RemoveItemTrait,
  RevertItemField,
  SetItemTrait,
  SplitItemBundle,
} from "./shared/index.js";
import {
  ItemBundleJoinSystem,
  ItemBundleSplitSystem,
  ItemDestroySystem,
  ItemFieldEditSystem,
  ItemFieldLockSystem,
  ItemFieldRevertSystem,
  ItemForkSystem,
  ItemSpawningSystem,
  ItemTraitRemoveSystem,
  ItemTraitSetSystem,
} from "./server/index.js";

/**
 * Generic items plugin. Provides:
 *   - ItemIdentity / ItemEconomics / ItemDerivedFrom / ItemCatalogIndex
 *     traits.
 *   - CreateItem / CustomizeItem / EditItemField / RevertItemField /
 *     LockItemField / DestroyItem commands.
 *   - Mirror systems that materialise events across the wire.
 *   - The catalog merge engine, exposed for game-system plugins to
 *     call from their `seed` hook (see `runCatalogMerge` in shared).
 *
 * Slot vocabulary, body capacity, weapon stats, container behaviour:
 * those all live in game-system plugins (e.g.
 * @vtt/system-torchbearer). This plugin owns *only* the item entity
 * itself + the customize/edit/destroy machinery + the merge engine.
 *
 * No surfaces, slots, or views — all UI lives in the game-system
 * layer (which knows what the actual inventory looks like).
 */
export const items = definePlugin({
  name: "@vtt/items",
  version: "0.1.0",
  dependsOn: ["@vtt/substrate@^0"],
  traits: [ItemIdentity, ItemEconomics, ItemDerivedFrom, ItemBundle, ItemCatalogIndex],
  events: [
    ItemCreated,
    ItemForked,
    ItemFieldChanged,
    ItemFieldReverted,
    ItemFieldLocked,
    ItemTraitSet,
    ItemTraitRemoved,
    ItemBundleSplit,
    ItemBundleJoined,
    ItemDestroyed,
  ],
  commands: [
    CreateItem,
    CustomizeItem,
    EditItemField,
    RevertItemField,
    LockItemField,
    SetItemTrait,
    RemoveItemTrait,
    SplitItemBundle,
    JoinItemBundles,
    DestroyItem,
  ],
  systems: [
    ItemSpawningSystem,
    ItemForkSystem,
    ItemFieldEditSystem,
    ItemFieldRevertSystem,
    ItemFieldLockSystem,
    ItemTraitSetSystem,
    ItemTraitRemoveSystem,
    ItemBundleSplitSystem,
    ItemBundleJoinSystem,
    ItemDestroySystem,
  ],
  slots: [ItemDetailSectionsSlot],
});

// `itemLinkKind` is exported from `./shared` for system plugins to
// fill `LinkKindsSlot` with. Items deliberately doesn't fill it
// here — that would force every test loading items to also load
// notes (which owns the slot). The TB manifest does the fill.
void LinkKindsSlot;
void itemLinkKind;

// PagesSlot is filled by the sibling `itemsPages` plugin so that
// downstream consumers can pick up the workbench tab without
// pulling shell-workbench into every test that touches items.
void PagesSlot;

export default items;
