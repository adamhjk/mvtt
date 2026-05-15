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
  type EventInstance,
} from "@vtt/substrate";
import { useClient } from "@vtt/substrate/client";
import {
  SetDrawerKeepOpen,
  type WorkbenchDrawer,
  type WorkbenchDrawerRenderArgs,
} from "@vtt/shell-workbench/shared";
import { useWorkspace } from "@vtt/shell-workbench/client";
import { RollResolved, type DieOutcome } from "@vtt/resolution/shared";
import { createMemo, onCleanup, onMount, type JSX } from "solid-js";
import { createTray, tintForUser, type TrayHandle } from "./scene.js";
import { specForOutcome, type SpawnRequest } from "./spec.js";

export const DICE_TRAY_DRAWER_ID = qualifiedName("@vtt/dice-tray/tray");

/**
 * The drawer registration. Pile-up + per-player tint + auto-close
 * after the user's roll dwell window. The workbench owns the open/
 * close timer based on `autoCloseAfterMs` and the
 * `WorkbenchDrawers` host owns the auto-open subscription based on
 * `autoOpenOn` — so this fill stays declarative.
 *
 * The body subscribes to `RollResolved` itself (not via a workbench
 * hook) because it needs the *event payload* to drive Babylon
 * spawns; the workbench's auto-open hook only carries "an event
 * fired."
 *
 * Icon is a monochrome Unicode glyph (DIE FACE-3) to match the
 * black-and-white style of other workbench glyphs (config "⚙",
 * tokens "▣"); colour emoji like 🎲 stand out distractingly.
 */
export const DiceTrayDrawer: WorkbenchDrawer = {
  id: DICE_TRAY_DRAWER_ID,
  label: "Dice tray",
  icon: "⚂",
  edge: "bottom",
  // Generous height so the top-down tray view actually breathes on
  // open. Users can still resize via ResizeDrawer if they want it
  // smaller; the persisted size overrides this default per user.
  defaultSize: 520,
  autoOpenOn: RollResolved.name,
  // Dwell window after the *most recent* roll. Pile-up resets this
  // because OpenDrawer bumps openedAt on every fresh RollResolved,
  // which restarts the close timer in the workbench host.
  autoCloseAfterMs: 4500,
  priority: 50,
  render: (args: WorkbenchDrawerRenderArgs): JSX.Element => {
    return <DiceTrayBody close={args.close} />;
  },
};

interface PendingRoll {
  dice: DieOutcome[];
  rolledByUserId: string;
}

function DiceTrayBody(props: { close: () => void }): JSX.Element {
  const client = useClient();
  const ws = useWorkspace();
  let canvasEl: HTMLCanvasElement | undefined;
  let tray: TrayHandle | null = null;
  let unsubscribe: (() => void) | null = null;
  let resizeObs: ResizeObserver | null = null;
  let stabilityTimer: number | undefined;

  // Queue of RollResolved payloads received before the canvas is
  // stable. The drawer body is mounted as soon as the workbench
  // boots (display: none while closed), so RollResolved events fire
  // here before the tray has its real on-screen size — spawning
  // into a degenerate-aspect canvas places dice far outside the
  // visible camera frustum. Hold them until ResizeObserver reports
  // the canvas has been at the same size for a beat, then drain.
  const pendingRolls: PendingRoll[] = [];
  let canvasReady = false;

  // Keep-open lives in WorkspaceState; the header checkbox dispatches
  // SetDrawerKeepOpen rather than mutating local state.
  const drawerState = createMemo(
    () => ws.state()?.openDrawers[DICE_TRAY_DRAWER_ID],
  );
  const keepOpen = createMemo(() => drawerState()?.keepOpen ?? false);

  function processRoll(payload: PendingRoll): void {
    if (!tray) return;
    if (payload.dice.length === 0) return;
    // Each new roll wipes the previous one's dice — the tray shows
    // just the most recent outcome. Pile-up of dice *within* a
    // single roll (e.g. 4d6 → 4 dice on screen simultaneously) is
    // preserved by spawning each die in the same batch without
    // clearing between them.
    tray.clear();
    const tint = tintForUser(payload.rolledByUserId);
    // Pick a "throwing hand" side once per roll batch so every die
    // in this throw enters from the same side of the tray, like
    // they all came out of the same hand. Random per-roll for
    // variety across rolls.
    const throwSide: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
    // Flatten each rolled die into its spawn request(s); a single
    // d100 outcome expands into a tens + units pair.
    const requests: SpawnRequest[] = [];
    for (const die of payload.dice) {
      for (const r of specForOutcome(die)) requests.push(r);
    }
    // Tight stagger so a handful of dice releases almost
    // simultaneously — like a fist opening — rather than as a
    // stream of dice. Combined with the wide spawn-position spread
    // inside the tray, this keeps dice from landing on top of each
    // other at the same patch of floor.
    for (let i = 0; i < requests.length; i++) {
      const r = requests[i]!;
      const delay = i * 25;
      setTimeout(() => {
        tray?.spawn({
          spec: r.spec,
          value: r.value,
          tintColor: tint,
          throwSide,
        });
      }, delay);
    }
  }

  function drainPending(): void {
    if (!canvasReady || !tray) return;
    if (pendingRolls.length === 0) return;
    // If multiple rolls queued up while the canvas was stabilising,
    // play just the most recent — the tray only ever displays the
    // latest outcome anyway, and replaying older ones in sequence
    // would be a confusing flash.
    const latest = pendingRolls[pendingRolls.length - 1]!;
    pendingRolls.length = 0;
    processRoll(latest);
  }

  onMount(() => {
    if (!canvasEl) return;

    // Subscribe FIRST. The dice tray's body mounts as soon as the
    // workbench boots, but the canvas may be hidden (display: none)
    // and ResizeObserver hasn't fired yet. Events that arrive
    // before the canvas is stable get queued and replayed once the
    // tray is ready.
    unsubscribe = client.bus.on(
      RollResolved.name,
      (e: EventInstance<unknown>) => {
        const payload = e.payload as {
          dice?: DieOutcome[];
          rolledByUserId?: string;
        };
        const dice = payload.dice ?? [];
        if (dice.length === 0) return;
        const roll: PendingRoll = {
          dice,
          rolledByUserId: payload.rolledByUserId ?? "anonymous",
        };
        if (canvasReady && tray) {
          processRoll(roll);
        } else {
          pendingRolls.push(roll);
        }
      },
    );

    // Wait for the canvas to reach a non-degenerate size and stay
    // there for a beat (debounced ResizeObserver). Only then
    // initialise the tray and process any queued rolls.
    //
    // The drawer's open/close transition is 300ms; a 120ms quiet
    // window is comfortably longer than the longest single
    // ResizeObserver gap during the animation, but short enough
    // that the user perceives no extra delay between roll command
    // and dice landing.
    const STABILITY_QUIET_MS = 120;
    const onResize = (): void => {
      if (stabilityTimer !== undefined) {
        window.clearTimeout(stabilityTimer);
      }
      stabilityTimer = window.setTimeout(() => {
        stabilityTimer = undefined;
        if (!canvasEl) return;
        const w = canvasEl.clientWidth;
        const h = canvasEl.clientHeight;
        if (w <= 0 || h <= 0) {
          canvasReady = false;
          return;
        }
        if (!tray) {
          tray = createTray(canvasEl);
        } else {
          tray.resize();
        }
        canvasReady = true;
        drainPending();
      }, STABILITY_QUIET_MS);
    };

    resizeObs = new ResizeObserver(onResize);
    resizeObs.observe(canvasEl);
    // Kick off in case the canvas is already at its final size when
    // we mount (e.g. drawer was open at app boot).
    onResize();
  });

  onCleanup(() => {
    unsubscribe?.();
    if (stabilityTimer !== undefined) window.clearTimeout(stabilityTimer);
    resizeObs?.disconnect();
    tray?.dispose();
    tray = null;
  });

  const onToggleKeepOpen = (e: Event) => {
    const checked = (e.currentTarget as HTMLInputElement).checked;
    client.dispatch(
      SetDrawerKeepOpen({
        id: DICE_TRAY_DRAWER_ID,
        keepOpen: checked,
      }) as CommandInstance,
    );
  };

  return (
    <div class="relative flex h-full w-full flex-col">
      <header class="flex items-center justify-between border-b border-border-muted bg-surface px-4 py-2">
        <h2 class="font-display text-[0.62rem] uppercase tracking-[0.2em] text-fg-subtle">
          Dice tray
        </h2>
        <div class="flex items-center gap-3">
          <label class="inline-flex cursor-pointer select-none items-center gap-1.5 text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle hover:text-fg transition">
            <input
              type="checkbox"
              class="h-3 w-3 cursor-pointer accent-(--color-pane-edge)"
              checked={keepOpen()}
              onChange={onToggleKeepOpen}
            />
            <span>keep open</span>
          </label>
          <button
            type="button"
            onClick={() => {
              tray?.clear();
              props.close();
            }}
            class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-1 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition"
            title="Clear and close"
          >
            ✕
          </button>
        </div>
      </header>
      <div class="relative min-h-0 flex-1">
        <canvas
          ref={canvasEl}
          class="absolute inset-0 h-full w-full"
          aria-label="3D dice tray"
        />
      </div>
    </div>
  );
}
