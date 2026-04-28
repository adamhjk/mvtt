import {
  defineView,
  clientOnly,
  RootSurface,
} from "@vtt/substrate";
import { Surface } from "@vtt/substrate/client";
import { createSignal, Show, type JSX } from "solid-js";
import { WorkspaceTreeView } from "./WorkspaceTree.js";
import { ChatRail } from "./ChatRail.js";
import { Palette } from "./Palette.js";
import { useWorkspace } from "./use-workspace.js";
import { useWorkbenchKeybindings } from "./keybindings.js";
import { WorkbenchHeaderSurface, PaletteSurface } from "../shared/surfaces.js";
import { useMe } from "./use-me.js";
import { WorkbenchDrawers } from "./Drawers.js";

/**
 * The whole workbench. Mounted into RootSurface at higher priority than
 * any default-shell ChromeView so the substrate's `single` surface
 * picker selects this when both shells are loaded.
 *
 * Layout (3-row grid):
 *   ┌─ header ────────────────────────────────────────────────────┐
 *   │ logo · plugin-supplied header chips · palette trigger       │
 *   ├─────────────────────────────────────────┬───────────────────┤
 *   │ workspace tree (recursive splits)       │ chat rail         │
 *   │  - one or more panes                    │  - rail widgets   │
 *   │  - each pane is a tab strip + page      │  - chat composer  │
 *   │                                         │  - chat stream    │
 *   ├─────────────────────────────────────────┴───────────────────┤
 *   │ bottom-edge drawer region (collapsible content + tab strip)  │
 *   └──────────────────────────────────────────────────────────────┘
 *  + ⌘K palette overlay
 */
export const WorkbenchView = defineView({
  name: "Workbench",
  surface: RootSurface,
  // High priority so the workbench wins over @vtt/shell-default's
  // ChromeView when both happen to be loaded together.
  priority: 100,
  render: clientOnly((): JSX.Element => {
    const ws = useWorkspace();
    const me = useMe();
    const [paletteOpen, setPaletteOpen] = createSignal(false);

    useWorkbenchKeybindings({
      onPalette: () => setPaletteOpen((v) => !v),
      enabled: () => true,
    });

    return (
      <div
        class="relative grid h-screen min-h-0 grid-rows-[auto_1fr_auto] overflow-hidden bg-surface-sunken text-fg"
        // Suppress password-manager autofill across the whole workbench.
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
      >
        {/* ── header ─────────────────────────────────────────────── */}
        <header class="flex items-center justify-between gap-4 border-b border-border bg-surface px-5 py-2.5">
          <div class="flex items-baseline gap-3">
            <h1
              class="font-display text-base font-semibold tracking-tight text-fg"
              style={{ "font-family": "var(--font-display)" }}
            >
              mvtt
            </h1>
            <span class="font-display text-[0.62rem] uppercase tracking-[0.2em] text-fg-subtle">
              workbench
            </span>
          </div>

          <div class="flex flex-1 items-center justify-end gap-3">
            {/* Plugin-contributed header items (presence chips, GM tools, etc.) */}
            <Surface name={WorkbenchHeaderSurface.name} />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              class="group inline-flex items-center gap-2 rounded-(--radius-control) border border-border bg-surface-elevated px-3 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-fg transition"
              title="open quick switcher (⌘K)"
            >
              <span aria-hidden class="text-fg-subtle group-hover:text-accent transition">
                ›
              </span>
              <span class="hidden sm:inline">search</span>
              <kbd class="rounded-(--radius-control) border border-border-muted bg-surface px-1.5 py-0.5 font-mono text-[0.6rem] text-fg-muted">
                ⌘K
              </kbd>
            </button>
          </div>
        </header>

        {/* ── body ───────────────────────────────────────────────── */}
        <div class="flex min-h-0 min-w-0">
          <main class="flex min-h-0 min-w-0 flex-1 flex-col">
            <Show
              when={ws.state()}
              fallback={
                <div class="flex h-full items-center justify-center px-6">
                  <div class="flex flex-col items-center gap-3 text-center">
                    <p
                      class="font-display text-3xl tracking-tight text-fg-muted"
                      style={{ "font-family": "var(--font-display)" }}
                    >
                      Setting your workspace…
                    </p>
                    <p class="text-xs text-fg-subtle">
                      <Show when={me()} fallback="connecting">
                        bootstrapping for {me()?.name ?? "you"}
                      </Show>
                    </p>
                  </div>
                </div>
              }
            >
              {(stateAcc) => (
                <WorkspaceTreeView
                  tree={stateAcc().tree}
                  paneById={stateAcc().panes}
                  zenPaneId={stateAcc().zenPaneId}
                />
              )}
            </Show>
          </main>
          <ChatRail />
        </div>

        {/* ── drawers ────────────────────────────────────────────── */}
        {/* Bottom-edge drawer region: persistent tab strip + a
            collapsible content panel above it. Sits in the workbench
            grid as a 3rd auto-sized row, so opening/closing pushes the
            body up/down rather than overlaying it. Renders nothing if
            no drawers are registered. */}
        <WorkbenchDrawers />

        {/* ── palette ────────────────────────────────────────────── */}
        <Palette open={paletteOpen()} onClose={() => setPaletteOpen(false)} />
        {/* Plugin-contributed palette extras (e.g. inline date picker). */}
        <Show when={paletteOpen()}>
          <Surface name={PaletteSurface.name} />
        </Show>
      </div>
    );
  }),
});
