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
import { LinkKindsSlot } from "@vtt/notes/shared";
import { PagesSlot } from "@vtt/shell-workbench/shared";
import { Asset } from "./shared/traits.js";
import { assetLinkKind } from "./shared/asset-link-kind.js";
import { AssetsPageProvider } from "./client/AssetsPage.jsx";
import {
  AssetDeleted,
  AssetRegistered,
  AssetRenamed,
  AssetVisibilityChanged,
} from "./shared/events.js";
import {
  DeleteAsset,
  RegisterAsset,
  RenameAsset,
  SetAssetVisibility,
} from "./shared/commands.js";
import {
  AssetDespawnSystem,
  AssetRenameSystem,
  AssetSpawningSystem,
  AssetVisibilityChangeSystem,
} from "./server/systems.js";

/**
 * `@vtt/assets` is the world-scoped byte-blob plugin. Other plugins
 * (notes, characters, scenes, …) embed assets via the `asset` link
 * kind; the upload route + fetch route + visibility enforcement live
 * here once for everyone.
 *
 * v0 ships the entity + commands + systems. The HTTP upload/fetch
 * routes are wired in `packages/server/src/main.ts` (alongside the
 * existing plugin-data routes); the asset link kind registration
 * lands once `@vtt/notes` ships the `defineLinkKind` API.
 */
export const assets = definePlugin({
  name: "@vtt/assets",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    "@vtt/notes@^0",
    "@vtt/shell-workbench@^0",
  ],
  traits: [Asset],
  events: [
    AssetRegistered,
    AssetRenamed,
    AssetVisibilityChanged,
    AssetDeleted,
  ],
  commands: [
    RegisterAsset,
    RenameAsset,
    SetAssetVisibility,
    DeleteAsset,
  ],
  systems: [
    AssetSpawningSystem,
    AssetRenameSystem,
    AssetVisibilityChangeSystem,
    AssetDespawnSystem,
  ],
  fills: {
    [LinkKindsSlot.name]: [assetLinkKind],
    [PagesSlot.name]: [AssetsPageProvider],
  },
});

export default assets;
