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

import { type EntityId } from "@vtt/substrate";
import { defineLinkKind, type LinkSuggestion } from "@vtt/notes/shared";
import { InvocationIdentity } from "./invocations/invocation-traits.js";
import {
  InvocationCreated,
  InvocationFieldEdited,
  InvocationRemoved,
} from "./invocations/invocation-events.js";

interface InvocationRef {
  readonly invocationId: EntityId;
}

/**
 * Wiki-link kind for invocations (Urðr). `[[invocation:Stone of
 * Strength]]` resolves to the catalog invocation entity by name;
 * `[[invocation:e123]]` resolves by id. Click routes to the
 * Invocations workbench page targeting the invocation — same
 * page-routing pattern the spell, monster, npc, and character link
 * kinds use.
 */
export const invocationLinkKind = defineLinkKind<InvocationRef>({
  name: "invocation",
  parse: (body, _anchor, world) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return null;
    if (world.has(trimmed as EntityId)) {
      const got = world.get(trimmed as EntityId, [InvocationIdentity]);
      if (got) return { invocationId: trimmed as EntityId };
    }
    const needle = trimmed.toLowerCase();
    for (const row of world.query([InvocationIdentity])) {
      const v = row.values.InvocationIdentity as { name: string };
      if (v.name.toLowerCase() === needle) return { invocationId: row.id };
    }
    return null;
  },
  display: (ref, world) => {
    const got = world.get(ref.invocationId, [InvocationIdentity]) as
      | { InvocationIdentity: { name: string } }
      | undefined;
    return got?.InvocationIdentity.name ?? "(missing invocation)";
  },
  target: (ref) => ({ entityId: ref.invocationId }),
  activate: (ref) => ({
    type: "navigate",
    pageKind: "@vtt/system-torchbearer/invocations",
    entityId: ref.invocationId,
  }),
  autocomplete: (query, world) => {
    const needle = query.trim().toLowerCase();
    const out: LinkSuggestion[] = [];
    for (const row of world.query([InvocationIdentity])) {
      const v = row.values.InvocationIdentity as { name: string };
      if (needle.length > 0 && !v.name.toLowerCase().includes(needle)) continue;
      out.push({
        kind: "invocation",
        body: v.name,
        display: v.name,
        badge: "Invocation",
      });
    }
    return out;
  },
  indexEvents: [InvocationCreated.name, InvocationRemoved.name, InvocationFieldEdited.name],
});
