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

import { defineView, clientOnly, RootSurface } from "@vtt/substrate";
import { Surface, useClient, useQuery } from "@vtt/substrate/client";
import { PendingRoll } from "@vtt/characters/shared";
import { CharacterSheet } from "@vtt/characters/client";
import { Character } from "@vtt/characters/shared";
import {
  WorkbenchChatRailSurface,
  type PageProvider,
} from "@vtt/shell-workbench/shared";
import {
  usePageProviders,
  useChatRailWidgets,
  useMe,
} from "@vtt/shell-workbench/client";
import {
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { shouldUseMobileShell } from "./detect.js";
import { MobileHeader } from "./MobileHeader.js";
import { MobileNav, type MobileMode } from "./MobileNav.js";
import { MobileMenu } from "./MobileMenu.js";
import { PendingRollSheet } from "./PendingRollSheet.js";

const MOBILE_SHELL_STYLE_ID = "vtt-shell-mobile-styles";
const MOBILE_SHELL_CSS = `
@keyframes mobile-shell-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}
`;

function injectStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(MOBILE_SHELL_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = MOBILE_SHELL_STYLE_ID;
  el.textContent = MOBILE_SHELL_CSS;
  document.head.appendChild(el);
}

/**
 * The mobile shell view. Registered on RootSurface at priority 200
 * (above WorkbenchView at 100). The `shouldUseMobileShell()` gate is
 * evaluated once at mount; if false, returns null and the substrate's
 * stacked surface falls through to WorkbenchView.
 *
 * Layout:
 *   ┌─ MobileHeader (hamburger + logo) ──────────────────┐
 *   ├─────────────────────────────────────────────────────┤
 *   │ Character mode: full-width character sheet          │
 *   │        — or —                                       │
 *   │ Chat mode: full-width chat stream + composer        │
 *   ├─────────────────────────────────────────────────────┤
 *   │ MobileNav (segmented control)                       │
 *   └─────────────────────────────────────────────────────┘
 *   + PendingRollSheet overlay (bottom sheet)
 *   + MobileMenu overlay (slide-from-left)
 */
export const MobileShellView = defineView({
  name: "MobileShell",
  surface: RootSurface,
  priority: 200,
  render: clientOnly(() => {
    // Gate: check once at mount. If not mobile, return null so
    // WorkbenchView renders instead.
    const useMobile = shouldUseMobileShell();
    if (!useMobile) return null;

    onMount(injectStyles);

    const [mode, setMode] = createSignal<MobileMode>("character");
    const [menuOpen, setMenuOpen] = createSignal(false);

    const me = useMe();
    const rolls = useQuery([PendingRoll]);
    const hasPendingRoll = createMemo(() => rolls().length > 0);

    // Resolve the user's default character via the characters page
    // provider. The provider's `defaultEntity` picks the first
    // character the user can see.
    const client = useClient();
    const providers = usePageProviders();
    const characters = useQuery([Character]);

    const defaultCharacterId = createMemo<string | null>(() => {
      // Touch the characters query so we re-derive when characters change.
      void characters();
      const charProvider = Array.from(providers().values()).find(
        (p) => p.kind === "@vtt/characters/characters",
      ) as PageProvider | undefined;
      if (!charProvider?.defaultEntity) return null;
      const meVal = me();
      if (!meVal) return null;
      const id = charProvider.defaultEntity({
        world: client.world,
        registry: client.registry,
        userId: meVal.userId,
        role: meVal.role,
      });
      return id ?? null;
    });

    const chatRailWidgets = useChatRailWidgets();

    return (
      <div
        class="relative flex h-screen flex-col overflow-hidden bg-surface text-fg"
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
        data-testid="mobile-shell"
      >
        <MobileHeader onMenuOpen={() => setMenuOpen(true)} />

        {/* Body — exactly one mode visible at a time */}
        <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Character mode */}
          <div
            class="h-full w-full overflow-y-auto"
            style={{ display: mode() === "character" ? "block" : "none" }}
          >
            <Show
              when={defaultCharacterId()}
              fallback={
                <div class="flex h-full items-center justify-center px-6">
                  <p class="text-sm text-fg-muted">No character found</p>
                </div>
              }
            >
              {(idAcc) => (
                <CharacterSheet characterId={idAcc()} />
              )}
            </Show>
          </div>

          {/* Chat mode */}
          <div
            class="flex h-full w-full flex-col overflow-hidden"
            style={{ display: mode() === "chat" ? "flex" : "none" }}
          >
            {/* Chat rail widgets (pending roll panels, player list, etc.) */}
            <div class="shrink-0 border-b border-border-muted px-3 py-2">
              <For each={chatRailWidgets()}>
                {(w) => (
                  <div class="shrink-0">
                    {w.render() as unknown as JSX.Element}
                  </div>
                )}
              </For>
            </div>
            {/* Chat stream + composer via the workbench chat rail surface */}
            <div class="flex min-h-0 flex-1 flex-col px-3 py-2">
              <Surface name={WorkbenchChatRailSurface.name} />
            </div>
          </div>
        </main>

        <MobileNav
          mode={mode()}
          onModeChange={setMode}
          hasPendingRoll={hasPendingRoll()}
        />

        {/* Overlays */}
        <PendingRollSheet />
        <MobileMenu
          open={menuOpen()}
          onClose={() => setMenuOpen(false)}
          userName={me()?.name ?? ""}
        />
      </div>
    );
  }),
});
