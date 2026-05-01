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

import { type EntityId, type World } from "@vtt/substrate";
import { defineLinkKind, type LinkSuggestion } from "@vtt/notes/shared";
import { Asset } from "./traits.js";
import { AssetRegistered, AssetRenamed, AssetDeleted } from "./events.js";

interface AssetRef {
  readonly assetId: EntityId;
}

/**
 * `[[asset:<id>]]` and `![[asset:<id>]]`. Polymorphic by mime —
 * `embed` (called by the markdown renderer) returns a placeholder
 * descriptor that the UI plugin renders as `<img>`, `<video>`, or
 * `<audio>` based on `Asset.mime`. The link kind itself stays UI-free
 * so it can ship in shared/.
 */
export const assetLinkKind = defineLinkKind<AssetRef>({
  name: "asset",
  parse: (body, _anchor, world) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return null;
    if (!world.has(trimmed as EntityId)) return null;
    const asset = world.get(trimmed as EntityId, [Asset]);
    if (!asset) return null;
    return { assetId: trimmed as EntityId };
  },
  display: (ref, world) => {
    const got = world.get(ref.assetId, [Asset]) as
      | { Asset: { filename: string | null; mime: string } }
      | undefined;
    if (!got) return "(missing asset)";
    return got.Asset.filename ?? `${got.Asset.mime} asset`;
  },
  target: (ref) => ({ entityId: ref.assetId }),
  activate: () => ({
    type: "peek",
    render: () => null, // UI plugin replaces with the actual preview
  }),
  autocomplete: (query, world) => {
    const needle = query.trim().toLowerCase();
    const out: LinkSuggestion[] = [];
    for (const row of world.query([Asset])) {
      const v = row.values.Asset as {
        filename: string | null;
        mime: string;
      };
      const display = v.filename ?? `${v.mime} asset`;
      if (needle.length > 0 && !display.toLowerCase().includes(needle)) {
        continue;
      }
      out.push({
        kind: "asset",
        body: row.id,
        display,
        badge: v.mime.split("/")[0] ?? "asset",
      });
    }
    return out;
  },
  indexEvents: [AssetRegistered.name, AssetRenamed.name, AssetDeleted.name],
});
