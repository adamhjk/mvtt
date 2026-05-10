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
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  Show,
  type JSX,
} from "solid-js";

type SheetState = "hidden" | "peek" | "open" | "full";

/**
 * Bottom sheet overlay for pending rolls. Slides up when a PendingRoll
 * entity exists, auto-presents at ~45% viewport height. User can tap
 * the peek header to expand, or tap outside to collapse.
 *
 * States:
 *   hidden — no pending rolls, sheet fully off-screen
 *   peek   — small header bar visible at bottom (user dismissed)
 *   open   — default 45% height
 *   full   — expanded to near-full height
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
        setState("open");
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
      case "open":
        return "55%";
      case "full":
        return "3rem";
    }
  });

  const toggleExpand = () => {
    const s = state();
    if (s === "peek") setState("open");
    else if (s === "open") setState("full");
    else if (s === "full") setState("open");
  };

  const dismiss = () => {
    if (hasRolls()) {
      setState("peek");
    } else {
      setState("hidden");
    }
  };

  return (
    <Show when={state() !== "hidden"}>
      {/* Scrim — tap to collapse to peek */}
      <Show when={state() === "open" || state() === "full"}>
        <div
          class="fixed inset-0 z-40"
          style={{ "background-color": "var(--color-scrim)" }}
          onClick={dismiss}
        />
      </Show>

      {/* Sheet */}
      <div
        class="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-accent/40 bg-surface-elevated shadow-xl transition-transform duration-300 ease-out"
        style={{
          height: "100%",
          transform: `translateY(${translateY()})`,
        }}
        data-testid="pending-roll-sheet"
      >
        {/* Drag handle / header */}
        <button
          type="button"
          onClick={toggleExpand}
          class="flex w-full flex-col items-center gap-1.5 px-4 py-3"
          aria-label={
            state() === "peek"
              ? "Expand pending roll"
              : "Collapse pending roll"
          }
        >
          <span class="h-1 w-10 rounded-full bg-fg-subtle/40" />
          <span class="font-display text-[0.65rem] uppercase tracking-[0.16em] text-fg-muted">
            Pending roll
          </span>
        </button>

        {/* Content */}
        <div class="flex-1 overflow-y-auto px-4 pb-6">
          <PendingRollPanels />
        </div>
      </div>
    </Show>
  );
}
