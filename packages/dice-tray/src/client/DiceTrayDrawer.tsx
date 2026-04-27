import { qualifiedName, type EventInstance } from "@vtt/substrate";
import { useClient } from "@vtt/substrate/client";
import {
  type WorkbenchDrawer,
  type WorkbenchDrawerRenderArgs,
} from "@vtt/shell-workbench/shared";
import { RollResolved, type DieOutcome } from "@vtt/resolution/shared";
import { onCleanup, onMount, type JSX } from "solid-js";
import { createTray, tintForUser, type DieKind, type TrayHandle } from "./scene.js";

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
 */
export const DiceTrayDrawer: WorkbenchDrawer = {
  id: DICE_TRAY_DRAWER_ID,
  label: "Dice tray",
  icon: "🎲",
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

/**
 * Translate a `DieOutcome.sides` value to the tray's `DieKind`.
 * Numeric sides we recognise (4, 6, 8, 10, 12, 20, 100) map directly;
 * Fudge → "F"; anything else (an exotic die from the parser, e.g.
 * `d7` or `d30`) falls back to a d20 silhouette so the tumble still
 * runs — the printed label is what reads, the geometry is just dressing.
 */
function kindForSides(sides: number | "F"): DieKind {
  if (sides === "F") return "F";
  if (sides === 4) return 4;
  if (sides === 6) return 6;
  if (sides === 8) return 8;
  if (sides === 10) return 10;
  if (sides === 12) return 12;
  if (sides === 20) return 20;
  if (sides === 100) return 100;
  return 20;
}

function DiceTrayBody(props: { close: () => void }): JSX.Element {
  const client = useClient();
  let canvasEl: HTMLCanvasElement | undefined;
  let tray: TrayHandle | null = null;
  let unsubscribe: (() => void) | null = null;
  let resizeObs: ResizeObserver | null = null;

  onMount(() => {
    if (!canvasEl) return;
    tray = createTray(canvasEl);

    // Two-step resize: createTray's internal `engine.resize()` reads
    // the canvas's CSS box at construction, but the drawer's
    // slide-in transform is still animating, so the parent's layout
    // hasn't fully stabilised. requestAnimationFrame waits for the
    // browser to commit the next frame, by which point the canvas
    // has its true post-open size — refit the camera/tray then.
    requestAnimationFrame(() => tray?.resize());

    // Track size changes (drawer-resize, window resize) so the canvas
    // re-fits its viewport.
    resizeObs = new ResizeObserver(() => tray?.resize());
    resizeObs.observe(canvasEl);

    // Subscribe to RollResolved on the bus and spawn each die in the
    // event's payload onto the tray. Stagger spawns slightly so big
    // batches (e.g. `12d6`) read as a poured handful rather than a
    // single chord of geometry appearing at once.
    unsubscribe = client.bus.on(
      RollResolved.name,
      (e: EventInstance<unknown>) => {
        const payload = e.payload as {
          dice?: DieOutcome[];
          rolledByUserId?: string;
        };
        const dice = payload.dice ?? [];
        if (dice.length === 0) return;
        // Each new roll wipes the previous one's dice — the tray
        // shows just the most recent outcome. Pile-up of dice
        // *within* a single roll (e.g. 4d6 → 4 dice on screen
        // simultaneously) is preserved by spawning each die in the
        // same batch without clearing between them.
        tray?.clear();
        const tint = tintForUser(payload.rolledByUserId ?? "anonymous");
        for (let i = 0; i < dice.length; i++) {
          const die = dice[i]!;
          const delay = i * 70;
          setTimeout(() => {
            tray?.spawn({
              kind: kindForSides(die.sides),
              value: die.value,
              tintColor: tint,
            });
          }, delay);
        }
      },
    );
  });

  onCleanup(() => {
    unsubscribe?.();
    resizeObs?.disconnect();
    tray?.dispose();
    tray = null;
  });

  return (
    <div class="relative flex h-full w-full flex-col">
      <header class="flex items-center justify-between border-b border-border-muted bg-surface px-4 py-2">
        <h2 class="font-display text-[0.62rem] uppercase tracking-[0.2em] text-fg-subtle">
          Dice tray
        </h2>
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
