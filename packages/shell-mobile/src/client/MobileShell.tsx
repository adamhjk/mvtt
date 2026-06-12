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

import { defineView, clientOnly, RootSurface, type CommandInstance } from "@vtt/substrate";
import { Surface, useClient, useQuery } from "@vtt/substrate/client";
import { PendingRoll, ROLL_ATELIER_KIND } from "@vtt/characters/shared";
import { CharacterSheet } from "@vtt/characters/client";
import { Character } from "@vtt/characters/shared";
import { RollResolved } from "@vtt/resolution/shared";
import {
  OpenPage,
  WorkbenchChatRailSurface,
  type PageProvider,
} from "@vtt/shell-workbench/shared";
import {
  usePageProviders,
  useChatRailWidgets,
  useMe,
  useWorkspace,
} from "@vtt/shell-workbench/client";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
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

    // The mobile content panel mirrors whatever the user's workspace
    // says is active: clicking a book citation, note wikilink, or any
    // other deep link already dispatches OpenPage, which retargets the
    // workspace's active tab. We just read from the same WorkspaceState
    // the workbench reads, so navigation works for free across shells
    // — switch between desktop and mobile and you land on the same
    // page. When there's no active tab yet (fresh login), we fall back
    // to the user's default character.
    const workspace = useWorkspace();
    const activeTab = createMemo(() => {
      const s = workspace.state();
      if (!s) return null;
      const pane = s.panes[s.activePaneId];
      if (!pane?.activeTabId) return null;
      return s.tabs[pane.activeTabId] ?? null;
    });
    const activeProvider = createMemo<PageProvider | null>(() => {
      const tab = activeTab();
      if (!tab) return null;
      return providers().get(tab.pageKind) ?? null;
    });

    // Combine tab + provider into a single keyed value so `<Show keyed>`
    // re-mounts the rendered page exactly when (tab.id, pageKind,
    // entityId) changes — mirrors the workbench's per-pane keying so a
    // provider's render(args) runs once per logical "page". Re-using
    // the same provider sub-tree across entity changes would inherit
    // closure-captured ids from the prior render; the keyed remount
    // matches `useTrait(entityId, …)` semantics.
    const activeTabAndProvider = createMemo<
      { tab: NonNullable<ReturnType<typeof activeTab>>; provider: PageProvider } | null
    >(() => {
      const tab = activeTab();
      const provider = activeProvider();
      if (!tab || !provider) return null;
      return { tab, provider };
    });

    // Bottom-nav label — track whatever's actually on screen so the
    // button reads like a breadcrumb. When the workspace has an active
    // tab, use that provider's label ("Books", "Notes", "Rules"). When
    // we're on the default-character fallback path, use the characters
    // provider's label so the button still reflects what the panel is
    // showing.
    const pageLabel = createMemo(() => {
      const provider = activeProvider();
      if (provider) return provider.label;
      const charProvider = providers().get("@vtt/characters/characters");
      return charProvider?.label ?? "Page";
    });

    const chatRailWidgets = useChatRailWidgets();

    // When a roll the current user initiated resolves, open the Roll
    // Atelier page and surface it (page mode), so they see the result
    // without manually tapping over. Roll results live in the Atelier
    // now, not chat — so we navigate there rather than to chat mode.
    // We gate on `rolledByUserId` so another player rolling at the table
    // doesn't yank you away from whatever you're doing.
    const offRoll = client.bus.on(RollResolved.name, (e) => {
      const payload = e.payload as { rolledByUserId: string };
      const meVal = me();
      if (!meVal) return;
      if (payload.rolledByUserId !== meVal.userId) return;
      client.dispatch(
        OpenPage({
          pageKind: ROLL_ATELIER_KIND as Parameters<typeof OpenPage>[0]["pageKind"],
          entityId: null,
        }) as CommandInstance,
      );
      setMode("character");
    });
    onCleanup(offRoll);

    // The chat-mode panel and the chat stream's scroll viewport. When
    // the chat panel is hidden via `display:none` the chat stream's
    // own pin-to-bottom effect runs against a 0-height element and
    // sets `scrollTop = 0`, so when the panel reappears the viewer
    // lands at the top instead of the bottom. We snap to bottom from
    // the shell on every transition into chat mode so the most recent
    // roll/message is in view.
    let chatPanelEl: HTMLDivElement | undefined;

    createEffect(() => {
      if (mode() !== "chat") return;
      // After Solid commits the display flip, the viewport has
      // measurable height. requestAnimationFrame waits one tick so
      // scrollHeight reflects the laid-out content.
      requestAnimationFrame(() => {
        const el = chatPanelEl?.querySelector(
          "[data-testid='chat-stream-viewport']",
        ) as HTMLElement | null;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });

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
          {/* Page mode — renders whichever PageProvider matches the
              workspace's active tab (Character, Book, Note, Rule, …).
              Falls back to the default character sheet on a fresh
              login before any tab exists. */}
          <div
            class="h-full w-full overflow-y-auto"
            style={{ display: mode() === "character" ? "block" : "none" }}
            data-testid="mobile-content-panel"
          >
            <Show
              when={activeTabAndProvider()}
              fallback={
                <Show
                  when={defaultCharacterId()}
                  fallback={
                    <div class="flex h-full items-center justify-center px-6">
                      <p class="text-sm text-fg-muted">No character found</p>
                    </div>
                  }
                >
                  {(idAcc) => <CharacterSheet characterId={idAcc()} />}
                </Show>
              }
              keyed
            >
              {(pair) => (
                <>
                  {pair.provider.render({
                    tabId: pair.tab.id,
                    entityId: pair.tab.entityId,
                  }) as unknown as JSX.Element}
                </>
              )}
            </Show>
          </div>

          {/* Chat mode */}
          <div
            ref={chatPanelEl}
            class="flex h-full w-full flex-col overflow-hidden"
            style={{ display: mode() === "chat" ? "flex" : "none" }}
            data-testid="mobile-chat-panel"
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
          pageLabel={pageLabel()}
        />

        {/* Overlays */}
        <PendingRollSheet />
        <MobileMenu
          open={menuOpen()}
          onClose={() => setMenuOpen(false)}
          userName={me()?.name ?? ""}
          navigate={(pageKind, entityId) => {
            // Dispatch OpenPage so the user's WorkspaceState retargets
            // the active tab. The mobile shell's `activeTab` memo picks
            // up the change and renders the new provider — same
            // mechanism a workbench wikilink uses.
            client.dispatch(
              OpenPage({ pageKind, entityId }) as CommandInstance,
            );
            // Make sure the content panel is visible so the user sees
            // the page they just opened — chat mode would hide it.
            setMode("character");
            setMenuOpen(false);
          }}
        />
      </div>
    );
  }),
});
