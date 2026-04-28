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

interface SpawnRequest {
  kind: DieKind;
  value: number;
}

/**
 * Translate a single `DieOutcome` into the spawn request(s) it
 * needs. Most kinds map 1:1; d100 expands into two dice — the
 * tens d10 (kind `100`, faces 00/10/.../90) and the units d10
 * (kind `"10u"`, faces 0..9). For value V (1..100):
 *   tens = (V === 100 ? 0 : Math.floor(V / 10) * 10)
 *   units = V % 10
 * which gives "00" + "0" = 100 by tabletop convention.
 *
 * Numeric sides we recognise (4, 6, 8, 10, 12, 20, 100) map directly;
 * Fudge → "F"; anything else (an exotic die from the parser, e.g.
 * `d7` or `d30`) falls back to a d20 silhouette so the tumble still
 * runs — the printed label is what reads, the geometry is just
 * dressing.
 */
function spawnsForOutcome(die: DieOutcome): SpawnRequest[] {
  if (die.sides === 100) {
    const v = die.value;
    const tensValue = v === 100 ? 0 : Math.floor(v / 10) * 10;
    const unitsValue = v % 10;
    return [
      { kind: 100, value: tensValue },
      { kind: "10u", value: unitsValue },
    ];
  }
  let kind: DieKind;
  if (die.sides === "F") kind = "F";
  else if (die.sides === 4) kind = 4;
  else if (die.sides === 6) kind = 6;
  else if (die.sides === 8) kind = 8;
  else if (die.sides === 10) kind = 10;
  else if (die.sides === 12) kind = 12;
  else if (die.sides === 20) kind = 20;
  else kind = 20;
  return [{ kind, value: die.value }];
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
        // Flatten each rolled die into its spawn request(s); a
        // single d100 outcome expands into a tens + units pair.
        const requests: SpawnRequest[] = [];
        for (const die of dice) {
          for (const r of spawnsForOutcome(die)) requests.push(r);
        }
        for (let i = 0; i < requests.length; i++) {
          const r = requests[i]!;
          const delay = i * 70;
          setTimeout(() => {
            tray?.spawn({
              kind: r.kind,
              value: r.value,
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
