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

import { type CommandInstance, type EventName } from "@vtt/substrate";
import { useClient } from "@vtt/substrate/client";
import {
  createEffect,
  createMemo,
  For,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import {
  WorkbenchDrawersSlot,
  type WorkbenchDrawer,
  type DrawerEdge,
} from "../shared/slots.js";
import { OpenDrawer, CloseDrawer } from "../shared/commands.js";
import { useWorkspace } from "./use-workspace.js";

const DEFAULT_SIZE_FOR_EDGE: Record<DrawerEdge, number> = {
  bottom: 320,
  top: 240,
  right: 360,
  left: 300,
};

/**
 * Top-level orchestrator for plugin-supplied drawers. Wires:
 *
 *  - Auto-open subscription: each drawer with an `autoOpenOn` event
 *    name gets an OpenDrawer({keepOpen:false}) dispatched on each
 *    bus emit.
 *  - Auto-close timer: only fires when `keepOpen` is false. Drawers
 *    the user opened by clicking the tab stay sticky until closed.
 *  - Per-edge layout regions (currently bottom only).
 *
 * Drawer bodies are mounted once at workbench startup and stay
 * mounted; closed drawers are hidden via `display: none` so any
 * effects/subscriptions inside the body keep running. (The dice
 * tray relies on this to catch `RollResolved` even when the panel
 * is collapsed.)
 */
export function WorkbenchDrawers(): JSX.Element {
  const client = useClient();

  const drawers = createMemo<WorkbenchDrawer[]>(() => {
    const fills = client.registry.fillsForSlot(
      WorkbenchDrawersSlot,
    ) as WorkbenchDrawer[];
    const byId = new Map<string, WorkbenchDrawer>();
    for (const d of fills) {
      const cur = byId.get(d.id);
      if (!cur || (d.priority ?? 0) > (cur.priority ?? 0)) {
        byId.set(d.id, d);
      }
    }
    return Array.from(byId.values()).sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return a.label.localeCompare(b.label);
    });
  });

  const bottomDrawers = createMemo(() =>
    drawers().filter((d) => d.edge === "bottom"),
  );

  // Auto-open subscriptions: dispatch OpenDrawer({keepOpen:false}) on
  // the configured event for any drawer that has autoOpenOn set. The
  // server-side OpenDrawer.apply preserves a sticky `keepOpen: true`
  // if the user has it on, so this never downgrades user intent.
  createEffect(() => {
    const ds = drawers();
    const cleanups: Array<() => void> = [];
    for (const d of ds) {
      if (!d.autoOpenOn) continue;
      const off = client.bus.on(d.autoOpenOn as EventName, () => {
        client.dispatch(
          OpenDrawer({ id: d.id, keepOpen: false }) as CommandInstance,
        );
      });
      cleanups.push(off);
    }
    onCleanup(() => {
      for (const off of cleanups) off();
    });
  });

  return (
    <Show when={bottomDrawers().length > 0}>
      <BottomDrawerRegion drawers={bottomDrawers()} />
    </Show>
  );
}

/**
 * Bottom-edge drawer region — modelled on `@vtt/scene/SceneDock`:
 *
 *   ┌─ ▼ │ DICE TRAY · NOTES ──────────────────────────────────┐
 *   │   panel content (collapsible, height transitions)         │
 *   └───────────────────────────────────────────────────────────┘
 *
 * The tab strip is always visible (when any bottom drawer is
 * registered). Active drawer's tab gets an accent underline + full
 * text colour; inactive tabs are muted. The chevron on the left
 * collapses/expands the currently-active drawer.
 *
 * Only one drawer per edge can be open at a time — clicking an
 * inactive tab closes whatever's open and opens the clicked one,
 * matching the scene dock's "switch tab, don't stack" behaviour.
 */
function BottomDrawerRegion(props: {
  drawers: WorkbenchDrawer[];
}): JSX.Element {
  const client = useClient();
  const ws = useWorkspace();

  // Per-drawer body, rendered once and reused. Closed drawers are
  // hidden via `display: none` (the body's effects keep running
  // — that's how the dice tray's bus subscription survives across
  // close/reopen cycles).
  const bodies = props.drawers.map((d) => {
    const close = () =>
      client.dispatch(CloseDrawer({ id: d.id }) as CommandInstance);
    const initialSize = d.defaultSize ?? DEFAULT_SIZE_FOR_EDGE[d.edge];
    const body = d.render({ close, size: initialSize }) as JSX.Element;
    return { drawer: d, body };
  });

  // Auto-close lifecycle: per drawer, watch openedAt + keepOpen.
  // Schedule a CloseDrawer dispatch only when keepOpen is false —
  // sticky drawers (user clicked the tab, or toggled the keep-open
  // checkbox) skip the timer entirely.
  for (const d of props.drawers) {
    if (!d.autoCloseAfterMs) continue;
    createEffect(() => {
      const state = ws.state()?.openDrawers[d.id];
      if (!state) return;
      if (state.keepOpen) return;
      const elapsed = Date.now() - state.openedAt;
      const remaining = Math.max(0, d.autoCloseAfterMs! - elapsed);
      const timer = window.setTimeout(() => {
        client.dispatch(CloseDrawer({ id: d.id }) as CommandInstance);
      }, remaining);
      onCleanup(() => window.clearTimeout(timer));
    });
  }

  /** The currently-active drawer — the one with content showing. */
  const activeDrawer = createMemo<WorkbenchDrawer | null>(() => {
    const opened = ws.state()?.openDrawers ?? {};
    for (const d of props.drawers) {
      if (opened[d.id]) return d;
    }
    return null;
  });

  /** Pixel height of the open content panel. */
  const panelHeight = createMemo(() => {
    const d = activeDrawer();
    if (!d) return 0;
    const state = ws.state()?.openDrawers[d.id];
    return state?.size ?? d.defaultSize ?? DEFAULT_SIZE_FOR_EDGE[d.edge];
  });

  /**
   * Click a tab. The tab is a pure "make this drawer sticky-open"
   * trigger — it always dispatches `OpenDrawer({keepOpen: true})`,
   * even if the drawer was already open via auto-open. That way a
   * user who watches dice land and then clicks the tab actually
   * upgrades the drawer to sticky and stops the auto-close timer.
   * Closing is the drawer body's job (its own 'x' button).
   *
   * Only one drawer per edge can be open at a time, so we close any
   * other open drawer first.
   */
  const onTabClick = (drawer: WorkbenchDrawer) => {
    const opened = ws.state()?.openDrawers ?? {};
    for (const other of props.drawers) {
      if (other.id !== drawer.id && opened[other.id]) {
        client.dispatch(
          CloseDrawer({ id: other.id }) as CommandInstance,
        );
      }
    }
    client.dispatch(
      OpenDrawer({ id: drawer.id, keepOpen: true }) as CommandInstance,
    );
  };

  return (
    <aside class="flex shrink-0 flex-col border-t border-border bg-surface-elevated">
      {/* Collapsible content panel — height transitions between 0
          and the open drawer's pixel size. Each drawer's body lives
          inside a wrapper that's display:block when active and
          display:none otherwise. */}
      <div
        class="overflow-hidden bg-surface transition-[height] duration-300 ease-out"
        style={{ height: `${panelHeight()}px` }}
      >
        <For each={bodies}>
          {(b) => {
            const visible = createMemo(
              () => activeDrawer()?.id === b.drawer.id,
            );
            return (
              <div
                class="h-full w-full"
                style={{ display: visible() ? "block" : "none" }}
              >
                {b.body}
              </div>
            );
          }}
        </For>
      </div>

      {/* Tab strip — persistent footer styled to match the scene's
          bottom dock. Each tab opens its drawer (closing is the
          drawer body's responsibility, via its own 'x'). */}
      <header class="flex h-9 shrink-0 items-stretch gap-px border-t border-border-muted px-1">
        <For each={props.drawers}>
          {(d) => {
            const isActive = createMemo(() => activeDrawer()?.id === d.id);
            return (
              <button
                type="button"
                onClick={() => onTabClick(d)}
                class="group relative inline-flex items-center gap-1.5 px-3 font-display text-[0.7rem] uppercase tracking-[0.14em] transition"
                classList={{
                  "text-fg": isActive(),
                  "text-fg-subtle hover:text-fg": !isActive(),
                }}
                aria-pressed={isActive()}
              >
                <Show when={d.icon}>
                  <span aria-hidden class="text-[0.85rem]">{d.icon}</span>
                </Show>
                <span>{d.label}</span>
                <Show when={isActive()}>
                  <span
                    aria-hidden
                    class="pointer-events-none absolute inset-x-2 -bottom-px h-[2px]"
                    style={{ "background-color": "var(--color-pane-edge)" }}
                  />
                </Show>
              </button>
            );
          }}
        </For>
      </header>
    </aside>
  );
}
