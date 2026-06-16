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
import { Scene } from "./traits.js";
import { SceneCreated, SceneRemoved, SceneUpdated } from "./events.js";

interface SceneRef {
  readonly sceneId: EntityId;
}

/**
 * Scene link kind. Resolves `[[scene:Throne Room]]` or
 * `[[scene:e10]]`. Click navigates to the scene tab targeting this
 * entity; cmd-click opens it in a new tab (handled by the consumer).
 */
export const sceneLinkKind = defineLinkKind<SceneRef>({
  name: "scene",
  parse: (body, _anchor, world) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return null;
    if (/^e\d+$/.test(trimmed) && world.has(trimmed as EntityId)) {
      const got = world.get(trimmed as EntityId, [Scene]);
      if (got) return { sceneId: trimmed as EntityId };
    }
    const needle = trimmed.toLowerCase();
    for (const row of world.query([Scene])) {
      const v = row.values.Scene as { name: string };
      if (v.name.toLowerCase() === needle) {
        return { sceneId: row.id };
      }
    }
    return null;
  },
  display: (ref, world) => {
    const got = world.get(ref.sceneId, [Scene]) as { Scene: { name: string } } | undefined;
    return got?.Scene.name ?? "(missing scene)";
  },
  target: (ref) => ({ entityId: ref.sceneId }),
  activate: (ref) => ({
    type: "navigate",
    pageKind: "@vtt/scene/scenes",
    entityId: ref.sceneId,
  }),
  autocomplete: (query, world) => {
    const needle = query.trim().toLowerCase();
    const out: LinkSuggestion[] = [];
    for (const row of world.query([Scene])) {
      const v = row.values.Scene as { name: string };
      if (needle.length > 0 && !v.name.toLowerCase().includes(needle)) continue;
      out.push({
        kind: "scene",
        body: v.name,
        display: v.name,
        badge: "Scene",
      });
    }
    return out;
  },
  indexEvents: [SceneCreated.name, SceneRemoved.name, SceneUpdated.name],
});
