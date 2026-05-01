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

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * URL → filesystem map for the dice-tray's vendored mesh + texture
 * assets (originally from @3d-dice/dice-box, MIT — see ../../NOTICE.md
 * and the LICENSE alongside the assets).
 *
 * Mounted at `/dice-tray-assets/` by the server entry point so the
 * client's Babylon SceneLoader can load `default.json` (mesh data
 * for d4..d100 + their colliderFaceMap) and the diffuse / normal /
 * specular texture files referenced inside it.
 *
 * Returned from a function so resolution touches the filesystem
 * lazily — same pattern as @vtt/pdf-book's pdfBookAssetRoots.
 */
export function diceTrayAssetRoots(): Record<string, string> {
  const here = dirname(fileURLToPath(import.meta.url));
  // From src/server/asset-roots.ts → up to package root → assets/dice-box/
  const assetsRoot = resolve(here, "..", "..", "assets", "dice-box");
  return {
    "/dice-tray-assets/": assetsRoot,
  };
}
