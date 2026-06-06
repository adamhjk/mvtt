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
import {
  createOptimisticTrait,
  useClient,
  useQuery,
} from "@vtt/substrate/client";
import { useTabSentinel } from "@vtt/shell-workbench/client";
import { createEffect, createMemo, Show, type JSX } from "solid-js";
import { PendingRoll, type PendingRollValue } from "../shared/pending.js";
import {
  PendingRollEditorsSlot,
  RollAtelierUiState,
  SetRollAtelierUiState,
  type PendingRollEditor,
} from "../shared/atelier.js";
import { RollAtelierRail } from "./RollAtelierRail.jsx";
import { RollAtelierEmpty } from "./RollAtelierEmpty.jsx";

/**
 * The Atelier shell. Owns:
 *   • the rail of pills (delegated to RollAtelierRail)
 *   • per-tab selection state on the per-tab sentinel
 *     (RollAtelierUiState.selectedRollId, via createOptimisticTrait)
 *   • the right pane — mounts the highest-priority matching
 *     PendingRollEditor fill for the selected roll.
 *
 * Selection fallback: if `selectedRollId` no longer matches an active
 * PendingRoll (committed, cancelled, or vanished), fall back to the
 * most-recently-opened. Persists across the right pane remounting (the
 * sentinel survives for the tab's lifetime).
 */
export function RollAtelier(props: {
  tabId: string;
  initialSelection: EntityId | null;
}): JSX.Element {
  const client = useClient();
  const sentinelId = useTabSentinel(props.tabId);
  const [ui, setUi] = createOptimisticTrait(sentinelId, RollAtelierUiState, {
    write: (value) =>
      SetRollAtelierUiState({ entityId: sentinelId, value }),
    initial: {
      selectedRollId: props.initialSelection,
      railCollapsed: false,
    },
  });

  // Seed initial selection from the page provider's entityId on first
  // mount — when the user opens the Atelier via "open this specific
  // pending roll" (e.g. via the TabPicker), we honour that intent.
  createEffect(() => {
    if (
      props.initialSelection &&
      ui.selectedRollId === null
    ) {
      setUi("selectedRollId", props.initialSelection);
    }
  });

  const rollsRows = useQuery([PendingRoll]);
  const rolls = createMemo(() =>
    rollsRows().map((r) => ({
      id: r.id as EntityId,
      values: {
        PendingRoll: r.values.PendingRoll as PendingRollValue,
      },
    })),
  );

  /**
   * Effective selection — prefer the stored id if it still resolves to
   * a live PendingRoll, otherwise fall back to the most-recent (highest
   * openedAt). Returns null only when there are no pending rolls.
   */
  const effectiveSelectedId = createMemo<EntityId | null>(() => {
    const stored = ui.selectedRollId;
    if (stored) {
      if (rolls().some((r) => r.id === stored)) return stored;
    }
    const sorted = [...rolls()].sort(
      (a, b) => b.values.PendingRoll.openedAt - a.values.PendingRoll.openedAt,
    );
    return (sorted[0]?.id as EntityId) ?? null;
  });

  const selectedRow = createMemo(() => {
    const id = effectiveSelectedId();
    if (!id) return null;
    return rolls().find((r) => r.id === id) ?? null;
  });

  const editorsBySlot = createMemo<PendingRollEditor[]>(() => {
    const fills = client.registry.fillsForSlot(
      PendingRollEditorsSlot,
    ) as PendingRollEditor[];
    return [...fills].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  });

  const editorFor = createMemo<PendingRollEditor | null>(() => {
    const row = selectedRow();
    if (!row) return null;
    const name = row.values.PendingRoll.rollableName;
    for (const f of editorsBySlot()) {
      if (!f.rollablePrefix || name.startsWith(f.rollablePrefix)) return f;
    }
    return null;
  });

  return (
    <div
      class="grid h-full"
      style={{ "grid-template-columns": "minmax(180px, 14rem) 1fr" }}
      data-testid="roll-atelier-shell"
    >
      <RollAtelierRail
        rolls={rolls()}
        selectedRollId={effectiveSelectedId()}
        onSelect={(id) => setUi("selectedRollId", id)}
      />
      <main class="overflow-y-auto p-4">
        <Show when={selectedRow()} fallback={<RollAtelierEmpty />}>
          {(_row) => (
            <Show when={editorFor()}>
              {(editor) => (
                <>
                  {editor().render({
                    rollId: effectiveSelectedId() as EntityId,
                  }) as JSX.Element}
                </>
              )}
            </Show>
          )}
        </Show>
      </main>
    </div>
  );
}
