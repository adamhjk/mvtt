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

import {
  qualifiedName,
  type CommandInstance,
} from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { createMemo, createSignal, Show, type JSX } from "solid-js";
import { Identity, Online, Name } from "@vtt/identity/shared";
import { type WorkbenchStatusItem } from "@vtt/shell-workbench/shared";
import {
  GRIND_SENTINEL_ID,
  Grind,
  SetGrindExtreme,
  SetGrindTurn,
  tollCadence,
} from "../shared/grind.js";

/**
 * GM-only grind clock, pinned to the right of the bottom drawer strip
 * (next to the dice-tray tab). The whole control lives in the bar — turn
 * counter, −/+, manual input, tick warning, and the extreme toggle — so
 * the GM reads and adjusts it at a glance with nothing to pop open.
 * Hidden entirely from non-GM sessions (the grind itself is world-visible
 * since it drives public effects like light burnout, but the controls are
 * GM-only and the widget simply doesn't render).
 */
function GrindTracker(): JSX.Element {
  const client = useClient();
  const players = useQuery([Identity, Name, Online]);
  const isGm = createMemo(() => {
    const cid = client.clientId();
    if (!cid) return false;
    const me = players().find(
      (p) => (p.values.Online as { clientId: string }).clientId === cid,
    );
    if (!me) return false;
    return (me.values.Identity as { role: string }).role === "gm";
  });
  const grind = useTrait(GRIND_SENTINEL_ID, Grind) as () =>
    | { turn: number; extreme: boolean }
    | undefined;
  const turn = createMemo(() => grind()?.turn ?? 0);
  const extreme = createMemo(() => grind()?.extreme ?? false);
  const cadence = createMemo(() => tollCadence(extreme()));

  const toggleExtreme = (): void => {
    void client.dispatch(
      SetGrindExtreme({ extreme: !extreme() }) as CommandInstance,
    );
  };

  const setTo = (next: number): void => {
    const clamped = Math.max(0, Math.min(999, Math.floor(next)));
    if (clamped === turn()) return;
    void client.dispatch(
      SetGrindTurn({ to: clamped }) as CommandInstance,
    );
  };
  const advance = (): void => setTo(turn() + 1);
  const rewind = (): void => setTo(turn() - 1);

  // Editable inline number — uses a draft so the GM can type "12"
  // without each keystroke firing a dispatch.
  const [draft, setDraft] = createSignal<number>(turn());
  let lastSeen = turn();
  // Sync draft to the canonical value when something else moves it.
  const sync = (): void => {
    const cur = turn();
    if (cur !== lastSeen) {
      setDraft(cur);
      lastSeen = cur;
    }
  };
  sync();

  return (
    <Show when={isGm()}>
      <div
        data-testid="grind-tracker"
        class="flex items-center gap-1.5 text-xs"
      >
        <span
          class="font-display text-[0.6rem] uppercase tracking-[0.14em] text-fg-subtle"
          title="Adventure-phase turn — every fourth turn imposes a condition"
        >
          Grind
        </span>
        <button
          type="button"
          onClick={rewind}
          disabled={turn() <= 0}
          data-testid="grind-rewind"
          class="rounded-(--radius-control) border border-border bg-surface px-1.5 leading-5 text-xs disabled:opacity-50"
          title="Step back one turn (e.g. mistake-correction)"
        >
          −
        </button>
        <input
          type="number"
          min={0}
          max={999}
          value={draft()}
          data-testid="grind-input"
          class="h-6 w-11 rounded-(--radius-control) border border-border bg-surface px-1 text-center text-xs"
          onInput={(e) => {
            const n = Number(e.currentTarget.value);
            if (Number.isFinite(n)) setDraft(Math.max(0, Math.floor(n)));
          }}
          onChange={() => {
            setTo(draft());
            lastSeen = draft();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setTo(draft());
              lastSeen = draft();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
        <button
          type="button"
          onClick={advance}
          data-testid="grind-advance"
          class="rounded-(--radius-control) border border-border bg-surface px-1.5 leading-5 text-xs"
          title="Tick the grind by one turn — lit lights decrement, every fourth turn imposes a condition"
        >
          +
        </button>
        <Show when={turn() > 0 && turn() % cadence() === 0}>
          <span
            class="font-display text-[0.6rem] uppercase tracking-[0.14em] text-warning"
            title={`Every ${cadence()}th turn during the adventure phase, all characters earn a condition`}
          >
            tick
          </span>
        </Show>
        <label
          class="flex items-center gap-1 font-display text-[0.6rem] uppercase tracking-[0.14em] text-fg-subtle"
          title="Extreme grind: cadence drops from 4 to 3 turns (SG p.42)"
        >
          <input
            type="checkbox"
            checked={extreme()}
            onChange={toggleExtreme}
            data-testid="grind-extreme"
          />
          extreme
        </label>
      </div>
    </Show>
  );
}

/**
 * Status-strip fill — the grind clock pinned to the right of the bottom
 * drawer strip (alongside the dice tray), always visible for the GM.
 */
export const GrindTrackerStatusItem: WorkbenchStatusItem = {
  id: qualifiedName(
    "@vtt/system-torchbearer/grind-tracker",
  ) as WorkbenchStatusItem["id"],
  priority: 100,
  render: () => GrindTracker(),
};
