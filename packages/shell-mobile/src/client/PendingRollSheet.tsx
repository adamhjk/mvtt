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

import { useQuery } from "@vtt/substrate/client";
import { PendingRoll } from "@vtt/characters/shared";
import { PendingRollPanels } from "@vtt/characters/client";
import { createEffect, createMemo, createSignal, on, Show, type JSX } from "solid-js";

type SheetState = "hidden" | "peek" | "full";

/**
 * Bottom sheet overlay for pending rolls. Slides up when a PendingRoll
 * entity exists, auto-presents at full viewport height so the roll
 * panel (and its Roll button at the bottom) is always reachable —
 * mid-height didn't leave enough room on small screens. User can tap
 * the handle at the top to collapse to a peek tab, freeing the screen
 * to interact with the character sheet underneath.
 *
 * States:
 *   hidden — no pending rolls, sheet fully off-screen
 *   peek   — small header bar visible at bottom (user collapsed)
 *   full   — sheet covers the viewport, content scrolls within
 */
export function PendingRollSheet(): JSX.Element {
  const rolls = useQuery([PendingRoll]);
  const hasRolls = createMemo(() => rolls().length > 0);

  const [state, setState] = createSignal<SheetState>("hidden");

  // Auto-present when a new PendingRoll appears; auto-hide when all
  // resolve. Use `on()` to track only the boolean transition, not
  // every re-render of the query.
  createEffect(
    on(hasRolls, (has, prev) => {
      if (has && !prev) {
        setState("full");
      } else if (!has && prev) {
        setState("hidden");
      }
    }),
  );

  const translateY = createMemo(() => {
    switch (state()) {
      case "hidden":
        return "100%";
      case "peek":
        return "calc(100% - 3rem)";
      case "full":
        return "0%";
    }
  });

  const toggle = () => {
    const s = state();
    if (s === "peek") setState("full");
    else if (s === "full") setState("peek");
  };

  return (
    <Show when={state() !== "hidden"}>
      {/* Sheet — pinned to the full viewport so the content area can
          scroll to the Roll button at the bottom. translateY slides it
          off-screen for `peek` / `hidden`. */}
      <div
        class="fixed inset-x-0 top-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-accent/40 bg-surface-elevated shadow-xl transition-transform duration-300 ease-out"
        style={{
          transform: `translateY(${translateY()})`,
        }}
        data-testid="pending-roll-sheet"
        data-state={state()}
      >
        {/* Drag handle / header — sticky at top of the sheet, tap to
            toggle between full and peek. */}
        <button
          type="button"
          onClick={toggle}
          class="flex w-full shrink-0 flex-col items-center gap-1.5 px-4 py-3"
          aria-label={state() === "peek" ? "Expand pending roll" : "Collapse pending roll"}
        >
          <span class="h-1 w-10 rounded-full bg-fg-subtle/40" />
          <span class="font-display text-[0.65rem] uppercase tracking-[0.16em] text-fg-muted">
            Pending roll
          </span>
        </button>

        {/* Scrollable content. `min-h-0` lets the flex child actually
            shrink so `overflow-y-auto` engages instead of growing the
            parent past viewport. */}
        <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <PendingRollPanels />
        </div>
      </div>
    </Show>
  );
}
