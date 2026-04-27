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
import { OpenDrawer, CloseDrawer, ToggleDrawer } from "../shared/commands.js";
import { useWorkspace } from "./use-workspace.js";

const DEFAULT_SIZE_FOR_EDGE: Record<DrawerEdge, number> = {
  bottom: 280,
  top: 240,
  right: 360,
  left: 300,
};

/**
 * Per-edge container layout. Edge drawers float over the body — they
 * don't reflow the panes underneath. The `transform` on the wrapper
 * provides the slide animation; the inner panel paints once the wrapper
 * is in its open position.
 */
function edgeContainerClass(edge: DrawerEdge): string {
  const base =
    "pointer-events-none absolute z-30 transition-transform duration-300 ease-out";
  switch (edge) {
    case "bottom":
      return `${base} bottom-0 left-0 right-0`;
    case "top":
      return `${base} top-0 left-0 right-0`;
    case "right":
      return `${base} right-0 top-0 bottom-0`;
    case "left":
      return `${base} left-0 top-0 bottom-0`;
  }
}

/**
 * Translation that hides a drawer offscreen along its edge axis. When a
 * drawer is open we set transform to none; when closed/closing we set
 * it to this value and the CSS transition animates the slide.
 */
function hiddenTransform(edge: DrawerEdge): string {
  switch (edge) {
    case "bottom":
      return "translate-y-full";
    case "top":
      return "-translate-y-full";
    case "right":
      return "translate-x-full";
    case "left":
      return "-translate-x-full";
  }
}

/**
 * Renders all registered drawers as edge-anchored overlays. Drawers
 * are absolute-positioned siblings inside the workbench container —
 * the parent must be `position: relative` for them to anchor correctly.
 *
 * Lifecycle responsibilities:
 *  - Subscribe to `autoOpenOn` events on the bus and dispatch OpenDrawer.
 *  - When a drawer opens, schedule a CloseDrawer timer based on
 *    `autoCloseAfterMs` if set; reset the timer on every re-open.
 *  - Always render the drawer's `<DrawerPanel>` so the slide-out
 *    transition has something to animate against. The wrapper's
 *    transform decides whether it's visible.
 */
export function WorkbenchDrawers(): JSX.Element {
  const client = useClient();
  const ws = useWorkspace();

  const drawers = createMemo<WorkbenchDrawer[]>(() => {
    const fills = client.registry.fillsForSlot(
      WorkbenchDrawersSlot,
    ) as WorkbenchDrawer[];
    // De-duplicate by id, keeping the highest-priority fill.
    const byId = new Map<string, WorkbenchDrawer>();
    for (const d of fills) {
      const cur = byId.get(d.id);
      if (!cur || (d.priority ?? 0) > (cur.priority ?? 0)) {
        byId.set(d.id, d);
      }
    }
    return Array.from(byId.values());
  });

  // Wire auto-open: a single createEffect per drawer subscribes to its
  // declared event and dispatches OpenDrawer. Cleanup unsubscribes when
  // the drawer set changes (plugin loaded/unloaded) or on unmount.
  createEffect(() => {
    const ds = drawers();
    const cleanups: Array<() => void> = [];
    for (const d of ds) {
      if (!d.autoOpenOn) continue;
      const off = client.bus.on(d.autoOpenOn as EventName, () => {
        client.dispatch(OpenDrawer({ id: d.id }) as CommandInstance);
      });
      cleanups.push(off);
    }
    onCleanup(() => {
      for (const off of cleanups) off();
    });
  });

  return (
    <For each={drawers()}>
      {(d) => (
        <DrawerSlot
          drawer={d}
          openedAt={() => ws.state()?.openDrawers[d.id]?.openedAt ?? null}
          size={() =>
            ws.state()?.openDrawers[d.id]?.size ??
            d.defaultSize ??
            DEFAULT_SIZE_FOR_EDGE[d.edge]
          }
        />
      )}
    </For>
  );
}

/**
 * One drawer slot — owns the auto-close timer and the slide animation.
 * Splits drawer-by-drawer so each one's timer/effect lifecycle is
 * isolated; bumping `openedAt` resets just this one's timer.
 */
function DrawerSlot(props: {
  drawer: WorkbenchDrawer;
  openedAt: () => number | null;
  size: () => number;
}): JSX.Element {
  const client = useClient();
  const open = () => props.openedAt() !== null;

  const close = () => {
    client.dispatch(
      CloseDrawer({ id: props.drawer.id }) as CommandInstance,
    );
  };

  // Auto-close timer: re-runs whenever openedAt changes (open or
  // re-open). Cancels the previous timer first so a re-open resets the
  // dwell window — matches the "pile-up resets the close timer" spec.
  createEffect(() => {
    const at = props.openedAt();
    const ms = props.drawer.autoCloseAfterMs;
    if (at === null || !ms) return;
    const elapsed = Date.now() - at;
    const remaining = Math.max(0, ms - elapsed);
    const timer = window.setTimeout(close, remaining);
    onCleanup(() => window.clearTimeout(timer));
  });

  const sizeStyle = createMemo(() => {
    const px = `${props.size()}px`;
    switch (props.drawer.edge) {
      case "bottom":
      case "top":
        return { height: px };
      case "right":
      case "left":
        return { width: px };
    }
  });

  // Mount the drawer body exactly once at component setup so it
  // can subscribe to bus events from app-load time AND so that
  // reactive prop changes (size, openedAt, etc.) don't cause
  // re-render → remount. Calling `props.drawer.render(...)` inline
  // inside the JSX put it in a tracked scope; every
  // WorkspaceStateChanged event re-evaluated that expression and
  // unmounted/remounted the body, which for the dice tray meant
  // tearing down + rebuilding the entire Babylon engine on every
  // roll (visible as a flicker; materials never finished shader
  // compilation before the next remount). Computing the body once
  // here outside the JSX keeps it stable for the life of the
  // workbench mount — which is exactly what bus subscribers want.
  const body = props.drawer.render({
    close,
    // Initial size only. Drawer bodies that need to react to size
    // changes use ResizeObserver on their own canvas/container —
    // the same pattern other resizable plugin views use, and it
    // sidesteps the remount footgun above.
    size: props.size(),
  }) as JSX.Element;
  return (
    <div
      class={`${edgeContainerClass(props.drawer.edge)} ${
        open() ? "" : hiddenTransform(props.drawer.edge)
      }`}
      style={sizeStyle()}
      aria-hidden={!open()}
    >
      <div class="pointer-events-auto h-full w-full overflow-hidden border border-border-muted bg-surface-elevated shadow-xl">
        {body}
      </div>
    </div>
  );
}

/**
 * Header launcher cluster — one button per registered drawer. Click
 * toggles the drawer; the button is highlighted when its drawer is
 * currently open. Sorted by priority (desc) then label.
 */
export function DrawerLaunchers(): JSX.Element {
  const client = useClient();
  const ws = useWorkspace();

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

  return (
    <Show when={drawers().length > 0}>
      <div class="flex items-center gap-1">
        <For each={drawers()}>
          {(d) => {
            const isOpen = () => Boolean(ws.state()?.openDrawers[d.id]);
            return (
              <button
                type="button"
                onClick={() =>
                  client.dispatch(
                    ToggleDrawer({ id: d.id }) as CommandInstance,
                  )
                }
                class={
                  "inline-flex items-center gap-1.5 rounded-(--radius-control) border px-2.5 py-1.5 text-xs transition " +
                  (isOpen()
                    ? "border-accent bg-accent/10 text-fg"
                    : "border-border bg-surface-elevated text-fg-muted hover:border-accent hover:text-fg")
                }
                title={`Toggle ${d.label}`}
                aria-pressed={isOpen()}
              >
                <Show when={d.icon}>
                  <span aria-hidden>{d.icon}</span>
                </Show>
                <span class="hidden md:inline">{d.label}</span>
              </button>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
