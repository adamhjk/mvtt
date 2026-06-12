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
import {
  createEffect,
  createMemo,
  Match,
  Show,
  Switch,
  type Accessor,
  type JSX,
} from "solid-js";
import { PendingRoll, type PendingRollValue } from "../shared/pending.js";
import {
  PendingRollEditorsSlot,
  QuickRollComposerSlot,
  ResolvedRollFeedSlot,
  RollAtelierUiState,
  SetRollAtelierUiState,
  type PendingRollEditor,
  type QuickRollComposer,
  type ResolvedRollEntry,
  type ResolvedRollFeed,
} from "../shared/atelier.js";
import { RollAtelierRail } from "./RollAtelierRail.jsx";
import { RollAtelierEmpty } from "./RollAtelierEmpty.jsx";

/** Discriminated selection — the rail (and the right pane) carry both
 * live PendingRolls and committed Roll entities now. */
type Selection =
  | { kind: "pending"; id: EntityId }
  | { kind: "resolved"; id: EntityId };

/**
 * The Atelier shell. Owns a roll's whole lifecycle:
 *   • the rail — pending rolls (needing input) above a "Recent" section
 *     of resolved rolls (delegated to RollAtelierRail)
 *   • per-tab selection state on the per-tab sentinel
 *     (RollAtelierUiState, via createOptimisticTrait)
 *   • the right pane — a pending roll's editor, a resolved roll's card,
 *     or the freeform quick-roll composer.
 *
 * Resolved rolls reach the Atelier through `ResolvedRollFeedSlot` fills
 * (resolution for plain rolls, game systems for their own) because
 * `@vtt/characters` can't read the resolution traits directly. The same
 * mechanism keeps a just-committed roll selected: the commit stamps
 * `Formula.meta.originPendingRollId` (see `tagRollWithOrigin`), the feed
 * surfaces it as `entry.originPendingRollId`, and when the selected
 * PendingRoll despawns on commit the shell redirects selection to the
 * resolved entry that names it. No more "empty Atelier after rolling."
 */
export function RollAtelier(props: {
  tabId: string;
  initialSelection: EntityId | null;
}): JSX.Element {
  const client = useClient();
  const sentinelId = useTabSentinel(props.tabId);
  const [ui, setUi] = createOptimisticTrait(sentinelId, RollAtelierUiState, {
    write: (value) => SetRollAtelierUiState({ entityId: sentinelId, value }),
    initial: {
      selectedRollId: props.initialSelection,
      railCollapsed: false,
      quickRollOpen: false,
    },
  });

  // Select the roll the Atelier was opened *for*. The workbench keys the
  // page on `(tabId, pageKind, entityId)`, so requesting a new roll
  // (OpenPage with that roll's id — what the sheet click and the ⌘K
  // "roll" entry both do) remounts this component with a fresh
  // `initialSelection`. Honour it unconditionally so we land on the roll
  // just requested, not whatever was selected last. A plain tab open
  // (entityId null) leaves the persisted selection alone.
  createEffect(() => {
    if (props.initialSelection) {
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

  // Snapshot resolved-roll feeds once and bind each feed's reactive
  // accessor — Solid hooks must run a stable count per component
  // lifetime, so we read the slot a single time (fills are immutable
  // after registry validation).
  const feeds = client.registry.fillsForSlot(
    ResolvedRollFeedSlot,
  ) as ResolvedRollFeed[];
  const feedAccessors: Accessor<ResolvedRollEntry[]>[] = feeds.map(
    (f) => f.useEntries() as Accessor<ResolvedRollEntry[]>,
  );
  const resolved = createMemo<ResolvedRollEntry[]>(() => {
    const out: ResolvedRollEntry[] = [];
    for (const acc of feedAccessors) for (const e of acc()) out.push(e);
    // Newest first — the rail's Recent section reads top-down.
    out.sort((a, b) => b.sortKey - a.sortKey);
    return out;
  });

  /**
   * Effective selection. Precedence:
   *   1. the stored id, if it still resolves to a live pending roll
   *   2. the stored id, if it resolves to a resolved roll
   *   3. the resolved roll the stored (now-committed) pending roll
   *      produced — matched by `originPendingRollId`
   *   4. fall back to the most-recently-opened pending roll
   *   5. else the most-recent resolved roll
   *   6. null only when there's nothing at all
   */
  const effectiveSelection = createMemo<Selection | null>(() => {
    const stored = ui.selectedRollId;
    const pendings = rolls();
    const res = resolved();
    if (stored) {
      if (pendings.some((r) => r.id === stored))
        return { kind: "pending", id: stored };
      if (res.some((e) => e.id === stored))
        return { kind: "resolved", id: stored as EntityId };
      const byOrigin = res.find((e) => e.originPendingRollId === stored);
      if (byOrigin) return { kind: "resolved", id: byOrigin.id as EntityId };
    }
    const newestPending = [...pendings].sort(
      (a, b) => b.values.PendingRoll.openedAt - a.values.PendingRoll.openedAt,
    )[0];
    if (newestPending) return { kind: "pending", id: newestPending.id };
    const newestResolved = res[0];
    if (newestResolved)
      return { kind: "resolved", id: newestResolved.id as EntityId };
    return null;
  });

  // Persist a *redirect* — when the stored selection went stale (the
  // pending roll committed/cancelled) and we landed somewhere else, write
  // the new id back so it sticks across later rolls arriving. We only
  // persist when something was already stored, preserving the prior
  // behaviour of not pinning the default auto-selection.
  createEffect(() => {
    const sel = effectiveSelection();
    const stored = ui.selectedRollId;
    if (stored !== null && sel && sel.id !== stored) {
      setUi("selectedRollId", sel.id);
    }
  });

  const select = (id: EntityId) => {
    setUi("quickRollOpen", false);
    setUi("selectedRollId", id);
  };

  /* — right-pane: pending editor — */
  const editorsBySlot = createMemo<PendingRollEditor[]>(() => {
    const fills = client.registry.fillsForSlot(
      PendingRollEditorsSlot,
    ) as PendingRollEditor[];
    return [...fills].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  });
  const selectedPendingRow = createMemo(() => {
    const sel = effectiveSelection();
    if (!sel || sel.kind !== "pending") return null;
    return rolls().find((r) => r.id === sel.id) ?? null;
  });
  const editorFor = createMemo<PendingRollEditor | null>(() => {
    const row = selectedPendingRow();
    if (!row) return null;
    const name = row.values.PendingRoll.rollableName;
    for (const f of editorsBySlot()) {
      if (!f.rollablePrefix || name.startsWith(f.rollablePrefix)) return f;
    }
    return null;
  });

  /* — right-pane: resolved card — */
  const selectedResolvedEntry = createMemo<ResolvedRollEntry | null>(() => {
    const sel = effectiveSelection();
    if (!sel || sel.kind !== "resolved") return null;
    return resolved().find((e) => e.id === sel.id) ?? null;
  });

  /* — right-pane: quick roll — */
  const quickComposer = createMemo<QuickRollComposer | null>(() => {
    const fills = client.registry.fillsForSlot(
      QuickRollComposerSlot,
    ) as QuickRollComposer[];
    return (
      [...fills].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0] ?? null
    );
  });
  const closeQuickRoll = () => {
    setUi("quickRollOpen", false);
    // Clear selection so the freshly-rolled result (newest resolved) is
    // what the right pane lands on once it arrives.
    setUi("selectedRollId", null);
  };

  return (
    <div
      class="grid h-full"
      style={{ "grid-template-columns": "minmax(180px, 14rem) 1fr" }}
      data-testid="roll-atelier-shell"
    >
      <RollAtelierRail
        rolls={rolls()}
        resolved={resolved()}
        selectedRollId={
          effectiveSelection() ? effectiveSelection()!.id : null
        }
        onSelect={select}
        onQuickRoll={
          quickComposer() ? () => setUi("quickRollOpen", true) : undefined
        }
        quickRollActive={ui.quickRollOpen}
      />
      <main class="overflow-y-auto p-4" data-testid="roll-atelier-pane">
        <Show
          when={ui.quickRollOpen && quickComposer()}
          fallback={
            <Switch fallback={<RollAtelierEmpty />}>
              <Match when={selectedPendingRow() && editorFor()}>
                {(editor) => (
                  <>
                    {editor().render({
                      rollId: selectedPendingRow()!.id,
                    }) as JSX.Element}
                  </>
                )}
              </Match>
              <Match when={selectedResolvedEntry()}>
                {(entry) => <>{entry().render() as JSX.Element}</>}
              </Match>
            </Switch>
          }
        >
          {(qc) => (
            <>{qc().render({ onClose: closeQuickRoll }) as JSX.Element}</>
          )}
        </Show>
      </main>
    </div>
  );
}
