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

import { type CommandInstance, type EntityId } from "@vtt/substrate";
import { useClient, useQuery } from "@vtt/substrate/client";
import { OpenPage } from "@vtt/shell-workbench/shared";
import { createEffect, type JSX } from "solid-js";
import { PendingRoll } from "../shared/pending.js";
import { ROLL_ATELIER_KIND } from "../shared/atelier.js";
import { useMe } from "./use-me.js";

/**
 * Long-lived shell-mounted side effect: when a PendingRoll spawns whose
 * `initiatorUserId` matches the current user, dispatch
 * `OpenPage({ pageKind: ROLL_ATELIER_KIND })` so the Atelier tab opens
 * (or focuses if already open).
 *
 * Mounted as a `ChatRailWidget` whose `render` returns nothing — the
 * widget exists purely to anchor the Solid effect inside the long-lived
 * shell. The effect is view-layer (not an ECS system) because:
 *   (a) the side effect targets workbench UI state, dispatching the
 *       canonical `OpenPage` verb — exactly the same dispatch a button
 *       click would make. CLAUDE.md's anti-pattern list forbids systems
 *       from dispatching commands; this is a view-side effect, not a
 *       domain mutation.
 *   (b) the trigger is "a tracked entity appeared in my reactive query
 *       set", which is read off `useQuery(PendingRoll)` — never directly
 *       off the event bus.
 *
 * Dedupe: a Set tracks every roll id we've already focused for. Repeated
 * re-emissions of the same entity (snapshot replay, reconnects, etc.) are
 * silently ignored; a freshly spawned roll dispatches exactly once.
 */
export function AtelierAutoFocusMount(): JSX.Element {
  const client = useClient();
  const me = useMe();
  const rolls = useQuery([PendingRoll]);
  const focused = new Set<string>();

  createEffect(() => {
    const m = me();
    if (!m) return;
    for (const row of rolls()) {
      if (focused.has(row.id)) continue;
      const v = row.values.PendingRoll as { initiatorUserId: string };
      if (v.initiatorUserId !== m.userId) {
        // Still register the id so we don't focus on a future event that
        // re-emits this same row.
        focused.add(row.id);
        continue;
      }
      focused.add(row.id);
      client.dispatch(
        OpenPage({
          pageKind: ROLL_ATELIER_KIND as Parameters<typeof OpenPage>[0]["pageKind"],
          entityId: row.id as EntityId,
        }) as CommandInstance,
      );
    }
  });

  // Render-nothing widget — see file header.
  return null;
}
