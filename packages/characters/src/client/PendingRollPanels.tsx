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

import type { EntityId } from "@vtt/substrate";
import { useClient, useQuery } from "@vtt/substrate/client";
import { createMemo, For, Show, type JSX } from "solid-js";
import { PendingRoll } from "../shared/pending.js";
import {
  PendingRollEditorsSlot,
  type PendingRollEditor,
} from "../shared/atelier.js";

/**
 * Stacked-list rendering of every active PendingRoll. Mounts one editor
 * per pending roll using the highest-priority matching
 * `PendingRollEditorsSlot` fill. Used by surfaces that show every roll
 * at once — primarily the mobile shell's bottom sheet, where a master/
 * detail rail wouldn't fit the viewport.
 *
 * On desktop the Roll Atelier owns this surface; on mobile we keep the
 * vertical-stack pattern because the screen real estate doesn't support
 * a side-by-side rail + editor.
 */
export function PendingRollPanels(): JSX.Element {
  const client = useClient();
  const rolls = useQuery([PendingRoll]);

  const editors = createMemo<PendingRollEditor[]>(() => {
    const fills = client.registry.fillsForSlot(
      PendingRollEditorsSlot,
    ) as PendingRollEditor[];
    return [...fills].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  });

  const editorFor = (rollableName: string): PendingRollEditor | null => {
    for (const f of editors()) {
      if (!f.rollablePrefix || rollableName.startsWith(f.rollablePrefix)) {
        return f;
      }
    }
    return null;
  };

  return (
    <Show when={rolls().length > 0}>
      <div class="flex flex-col gap-3" data-testid="pending-roll-panels">
        <For each={rolls()}>
          {(row) => {
            const v = row.values.PendingRoll as { rollableName: string };
            const f = editorFor(v.rollableName);
            if (!f) return null;
            return (
              <article
                class="rounded-(--radius-card) border border-accent/40 bg-surface-elevated p-3"
                data-testid="pending-roll-panel"
              >
                {f.render({ rollId: row.id as EntityId }) as JSX.Element}
              </article>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
