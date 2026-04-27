import { defineView, clientOnly, RootSurface } from "@vtt/substrate";
import { Surface } from "@vtt/substrate/client";
import {
  HeaderSurface,
  MainSurface,
  SidebarSurface,
  FooterSurface,
} from "../shared/surfaces.js";

export const ChromeView = defineView({
  name: "ChromeView",
  surface: RootSurface,
  priority: 0,
  render: clientOnly(() => {
    return (
      <div
        class="grid min-h-screen grid-rows-[auto_1fr_auto] grid-cols-[1fr_18rem] gap-px bg-border-muted"
        // Suppress password-manager autofill across the entire signed-in app.
        // The auth gate is mounted *outside* this tree, so credentials forms
        // there still get 1Password / LastPass / Bitwarden support.
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
      >
        <header class="col-span-2 flex items-center justify-between bg-surface-elevated px-6 py-3">
          <div class="flex items-baseline gap-3">
            <h1 class="text-lg font-semibold tracking-tight text-fg">mvtt</h1>
            <span class="text-xs text-fg-muted">scaffold</span>
          </div>
          <Surface name={HeaderSurface.name} />
        </header>

        <main class="bg-surface px-8 py-6">
          <Surface name={MainSurface.name} />
        </main>

        <aside class="bg-surface-sunken px-4 py-6">
          <Surface name={SidebarSurface.name} />
        </aside>

        <footer class="col-span-2 bg-surface-elevated px-6 py-3 text-xs text-fg-muted">
          <Surface name={FooterSurface.name} />
        </footer>
      </div>
    );
  }),
});
