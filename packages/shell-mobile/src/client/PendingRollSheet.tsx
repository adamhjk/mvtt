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
  onCleanup,
  Show,
  type JSX,
} from "solid-js";

type SheetState = "hidden" | "peek" | "open" | "full";

/** Ordered states from most-expanded to most-collapsed. */
const STATES_ORDER: SheetState[] = ["full", "open", "peek"];

/** Velocity threshold for fast-swipe detection (px/ms). */
const SWIPE_VELOCITY = 0.3;

/** Convert a sheet state to its translateY in pixels. */
function stateToPixels(s: SheetState): number {
  const vh = window.innerHeight;
  switch (s) {
    case "hidden":
      return vh;
    case "peek":
      return vh - 48; // 3rem ≈ 48px
    case "open":
      return vh * 0.55;
    case "full":
      return 48; // 3rem from top
  }
}

/** Find the nearest visible state for a given Y position. */
function nearestState(y: number): SheetState {
  const vh = window.innerHeight;
  const thresholds: [SheetState, number][] = [
    ["full", 48],
    ["open", vh * 0.55],
    ["peek", vh - 48],
  ];
  return thresholds.reduce<[SheetState, number]>(
    (closest, curr) =>
      Math.abs(y - curr[1]) < Math.abs(y - closest[1]) ? curr : closest,
    thresholds[0]!,
  )[0];
}

/**
 * Bottom sheet overlay for pending rolls. Slides up when a PendingRoll
 * entity exists, auto-presents at ~45% viewport height. User can tap
 * the peek header to expand, or tap outside to collapse.
 *
 * Supports touch gesture dragging on the handle area: during an active
 * drag the CSS transition is disabled and translateY tracks the finger
 * in real-time. On release, the sheet snaps to the nearest state (or
 * one step expanded/collapsed for fast swipes).
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

  // --- Gesture state ---
  const [dragging, setDragging] = createSignal(false);
  const [dragTranslateY, setDragTranslateY] = createSignal(0);

  // Non-reactive bookkeeping for gesture math
  let dragStartY = 0;
  let dragStartTranslateY = 0;
  let prevTouchY = 0;
  let prevTouchTime = 0;

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
    if (dragging()) return `${dragTranslateY()}px`;
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
    // Ignore taps that were actually drags (finger moved significantly)
    if (dragging()) return;
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

  // --- Touch gesture handlers (on the drag handle) ---

  const onTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    dragStartY = touch.clientY;
    dragStartTranslateY = stateToPixels(state());
    prevTouchY = touch.clientY;
    prevTouchTime = Date.now();
    setDragTranslateY(dragStartTranslateY);
    setDragging(true);
    document.body.style.overflow = "hidden";
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!dragging()) return;
    const touch = e.touches[0];
    if (!touch) return;
    const delta = touch.clientY - dragStartY;
    const vh = window.innerHeight;
    const clamped = Math.max(
      48,
      Math.min(vh - 48, dragStartTranslateY + delta),
    );
    setDragTranslateY(clamped);
    prevTouchY = touch.clientY;
    prevTouchTime = Date.now();
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (!dragging()) return;
    const endTouch = e.changedTouches[0];
    const endY = endTouch?.clientY ?? prevTouchY;
    const endTime = Date.now();
    const dt = endTime - prevTouchTime;
    // px/ms — positive = dragging down, negative = dragging up
    const velocity = dt > 0 ? (endY - prevTouchY) / dt : 0;

    const currentY = dragTranslateY();
    let target: SheetState;

    if (Math.abs(velocity) > SWIPE_VELOCITY) {
      // Fast swipe: expand or collapse one step from nearest position
      const closest = nearestState(currentY);
      const idx = STATES_ORDER.indexOf(closest);
      if (velocity < 0) {
        // Swiping up → expand
        target = STATES_ORDER[Math.max(0, idx - 1)]!;
      } else {
        // Swiping down → collapse
        target = STATES_ORDER[Math.min(STATES_ORDER.length - 1, idx + 1)]!;
      }
    } else {
      // Slow drag → snap to nearest threshold
      target = nearestState(currentY);
    }

    setState(target);
    setDragging(false);
    document.body.style.overflow = "";
  };

  // Clean up body overflow on unmount
  onCleanup(() => {
    document.body.style.overflow = "";
  });

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
        class="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-accent/40 bg-surface-elevated shadow-xl"
        classList={{
          "transition-transform duration-300 ease-out": !dragging(),
        }}
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
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          class="flex w-full flex-col items-center gap-1.5 px-4 py-3"
          style={{ "touch-action": "none" }}
          aria-label={
            state() === "peek"
              ? "Expand pending roll"
              : "Collapse pending roll"
          }
          data-testid="sheet-drag-handle"
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
