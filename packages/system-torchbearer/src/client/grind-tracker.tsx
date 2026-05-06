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
  clientOnly,
  defineView,
  type CommandInstance,
} from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { createMemo, createSignal, Show, type JSX } from "solid-js";
import { Identity, Online, Name } from "@vtt/identity/shared";
import { WorkbenchChatRailSurface } from "@vtt/shell-workbench/shared";
import {
  GRIND_SENTINEL_ID,
  Grind,
  SetGrindExtreme,
  SetGrindTurn,
  tollCadence,
} from "../shared/grind.js";

/**
 * GM-only grind tracker for the chat rail. Shows the current
 * adventure-phase turn, a -/+ pair, and an inline manual input.
 * Hidden entirely from non-GM sessions (no need to wire up the
 * server to filter visibility — the grind itself is world-visible
 * since it determines public effects like light burnout, but the
 * controls are GM-only and the view simply doesn't render).
 *
 * Renders at priority 80 — between the player chips (90) and the
 * stream (50) — so it sits at the top of the rail just below the
 * presence area where the GM is most likely to glance.
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
      <section
        data-testid="grind-tracker"
        class="rounded-(--radius-card) border border-border-muted bg-surface-elevated px-3 py-2 text-sm flex items-center gap-2"
      >
        <span class="text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Grind
        </span>
        <span
          class="text-[0.7rem] text-fg-subtle"
          title="Adventure-phase turn — every fourth turn imposes a condition"
        >
          turn
        </span>
        <button
          type="button"
          onClick={rewind}
          disabled={turn() <= 0}
          data-testid="grind-rewind"
          class="rounded border border-border bg-surface px-2 py-0.5 text-xs disabled:opacity-50"
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
          class="w-14 rounded border border-border bg-surface px-1 py-0.5 text-center text-sm"
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
          class="rounded border border-border bg-surface px-2 py-0.5 text-xs"
          title="Tick the grind by one turn — lit lights decrement, every fourth turn imposes a condition"
        >
          +
        </button>
        <Show when={turn() > 0 && turn() % cadence() === 0}>
          <span
            class="text-[0.65rem] uppercase tracking-[0.14em] text-warning"
            title={`Every ${cadence()}th turn during the adventure phase, all characters earn a condition`}
          >
            tick
          </span>
        </Show>
        <label
          class="flex items-center gap-1 text-[0.65rem] uppercase tracking-[0.14em] text-fg-subtle"
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
      </section>
    </Show>
  );
}

export const GrindTrackerView = defineView({
  name: "GrindTracker",
  surface: WorkbenchChatRailSurface,
  priority: 80,
  render: clientOnly(() => GrindTracker()),
});
