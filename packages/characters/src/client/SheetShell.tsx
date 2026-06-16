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

import { createOptimisticTrait, useClient } from "@vtt/substrate/client";
import { createMemo, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { useTabSentinel } from "@vtt/shell-workbench/client";
import type { CommandInstance } from "@vtt/substrate";
import {
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
  type CharacterSheetRegion,
  type CharacterSheetTab,
} from "../shared/slot.js";
import { CharacterSheetUiState, SetCharacterSheetUiState } from "../shared/sheet-ui-state.js";
import { Tabs, type TabSpec } from "./kit.js";

const SHEET_SHELL_STYLE_ID = "vtt-characters-sheet-shell-styles";

/*
 * SheetShell stylesheet, injected once into <head> on the first mount.
 *
 * Layout strategy depends on the container's width:
 *
 * Column mode (narrow — phone, tablet portrait, side panel):
 *   The whole sheet is one continuous scroll inside `.sheet-shell`.
 *   Identity sticks to the top, the tab bar sticks just under it
 *   (offset by `--sheet-identity-height`, which a ResizeObserver in
 *   the component writes whenever the identity bar changes size),
 *   and the actions bar sticks to the bottom. Rail and tab body
 *   flow naturally and the outer scroll handles all of it. This
 *   gives long content (inventory, skills) the full leftover height
 *   instead of a 60%-of-viewport sub-window.
 *
 * Desktop mode (≥1024px container):
 *   Main flips to `flex-direction: row`. The rail becomes a 280px
 *   left sidebar with its own scroll so vitals stay pinned next to
 *   the user as they scroll the tab body. The shell itself is
 *   `overflow: hidden` and identity/actions revert to `static`.
 *
 * The Tabs primitive (kit.tsx) ships with its own
 * `overflow:hidden`/scrollable-body defaults, so other consumers
 * still get fixed-region tabs. We override those defaults here, but
 * only inside `.sheet-shell` and only in column mode.
 */
const SHEET_SHELL_CSS = `
.sheet-shell {
  container-type: inline-size;
  container-name: sheet;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  scrollbar-width: thin;
  background: var(--color-surface);
  color: var(--color-fg);
}
.sheet-shell__region { min-width: 0; min-height: 0; }
.sheet-shell__identity {
  flex: 0 0 auto;
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border-muted);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  background: var(--color-surface);
}
.sheet-shell__main {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
}
.sheet-shell__rail {
  flex: 0 0 auto;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--color-border-muted);
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  background: var(--color-surface);
}
.sheet-shell__rail-region { display: flex; flex-direction: column; gap: 0.5rem; }
.sheet-shell__actions {
  flex: 0 0 auto;
  position: sticky;
  bottom: 0;
  z-index: 2;
  padding: 0.5rem 1rem;
  border-top: 1px solid var(--color-border-muted);
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.5rem;
  background: var(--color-surface);
}

/* Tabs primitive overrides — scoped to inside the sheet so other
   consumers of <Tabs> keep the fixed-region defaults from kit.tsx. */
.sheet-shell .vk-tabs {
  overflow: visible;
}
.sheet-shell .vk-tabs__bar {
  position: sticky;
  top: var(--sheet-identity-height, 0px);
  scroll-margin-top: var(--sheet-identity-height, 0px);
  z-index: 1;
}
.sheet-shell .vk-tabs__body {
  overflow-y: visible;
}

/* When all rail fills are empty, drop the rail entirely so tabs has
   the full main area. Same trick for actions. */
.sheet-shell__main:not(:has(.sheet-shell__rail-region > *)) .sheet-shell__rail {
  display: none;
}
.sheet-shell:not(:has(.sheet-shell__actions > *)) .sheet-shell__actions {
  display: none;
}

@container sheet (min-width: 1024px) {
  .sheet-shell { overflow: hidden; }
  .sheet-shell__identity { position: static; }
  .sheet-shell__actions { position: static; }
  .sheet-shell__main {
    flex-direction: row;
    min-height: 0;
    overflow: hidden;
  }
  .sheet-shell__rail {
    flex: 0 0 280px;
    overflow-y: auto;
    scrollbar-width: thin;
    border-bottom: 0;
    border-right: 1px solid var(--color-border-muted);
  }
  .sheet-shell .vk-tabs {
    overflow: hidden;
    min-height: 0;
  }
  .sheet-shell .vk-tabs__bar {
    position: static;
    scroll-margin-top: 0;
  }
  .sheet-shell .vk-tabs__body {
    overflow-y: auto;
    min-height: 0;
  }
}
`;

function injectSheetShellStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(SHEET_SHELL_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = SHEET_SHELL_STYLE_ID;
  el.textContent = SHEET_SHELL_CSS;
  document.head.appendChild(el);
}

/**
 * SheetShell is the responsive flex container that hosts every
 * character sheet. The shell owns spatial layout (sticky top/bottom +
 * a rail-or-tabs middle that flips between stacked-column on phone/
 * tablet and side-by-side on desktop) and delegates contents to five
 * slots:
 *
 *   Identity (sticky top)   ── name, portrait, system sub-line
 *   Vitals (rail / strip)   ── HP, AC, init — anything always-watched
 *   Status (rail / strip)   ── condition chips, ongoing effects
 *   Tabs (body)             ── the bulk of the sheet, tabbed by system
 *   Actions (sticky bottom) ── quick rolls + pre-roll triggers
 *
 * Empty slots collapse via the `:not(:has(...))` CSS rules — a system
 * that fills only Tabs gets a single-column sheet with no empty rail
 * or action bar.
 *
 * Game-system plugins fill these slots via the manifest's `fills`. The
 * default characters plugin fills Identity itself (the name + token
 * portrait that lived on the old sheet); systems extend it with their
 * own sub-lines (level/class) and contribute to the other four slots.
 */
export function SheetShell(props: {
  characterId: string;
  /**
   * Workbench tab id hosting this sheet. When set, the active sub-tab
   * survives sheet remounts (navigation away & back, retargeting onto
   * a different character) by persisting through `createOptimisticTrait`
   * on the tab's per-tab sentinel entity. Omit only in tests that mount
   * `SheetShell` outside a workbench tab — selection then falls back to
   * the kit's local-signal default.
   */
  tabId?: string;
}): JSX.Element {
  onMount(injectSheetShellStyles);
  const client = useClient();
  // Persistence only kicks in when the workbench has actually spawned
  // the per-tab sentinel. In production the workbench guarantees this
  // on tab open; in tests that mount SheetShell directly (without
  // dispatching OpenPage), it's absent and we fall back to the kit's
  // local-signal default — ephemeral but functional.
  const sentinelId = props.tabId ? useTabSentinel(props.tabId) : null;
  const persistence =
    sentinelId !== null && client.world.has(sentinelId) ? sheetTabPersistence(sentinelId) : null;

  const identity = createMemo(() =>
    sortRegion(client.registry.fillsForSlot(CharacterSheetIdentitySlot)),
  );
  const vitals = createMemo(() =>
    sortRegion(client.registry.fillsForSlot(CharacterSheetVitalsSlot)),
  );
  const status = createMemo(() =>
    sortRegion(client.registry.fillsForSlot(CharacterSheetStatusSlot)),
  );
  const actions = createMemo(() =>
    sortRegion(client.registry.fillsForSlot(CharacterSheetActionsSlot)),
  );
  const tabFills = createMemo(() => sortTabs(client.registry.fillsForSlot(CharacterSheetTabsSlot)));

  // Adapt CharacterSheetTab fills to the kit.Tabs `TabSpec` shape. The
  // characterId is captured here so the tab's render closure doesn't
  // need to thread it through props.
  const tabSpecs = createMemo<TabSpec[]>(() =>
    tabFills().map((fill) => ({
      id: fill.id,
      label: fill.label,
      priority: fill.priority,
      render: () => fill.render({ characterId: props.characterId }) as JSX.Element,
    })),
  );

  // Sticky tab bar in column mode lives at `top: var(--sheet-identity-height)`
  // so it parks immediately under the sticky identity bar instead of
  // overlapping it. The identity bar's height varies with what game systems
  // project into it (one-line vs two-line headers), so a ResizeObserver
  // keeps the var in sync. The same value also drives `scroll-margin-top`
  // on the bar, so `scrollIntoView` from kit.Tabs lands the bar at its
  // sticky-pinned position rather than tucked behind identity.
  let shellEl: HTMLDivElement | undefined;
  let identityEl: HTMLDivElement | undefined;
  onMount(() => {
    if (!shellEl || !identityEl || typeof ResizeObserver === "undefined") return;
    const sync = () => {
      shellEl!.style.setProperty("--sheet-identity-height", `${identityEl!.offsetHeight}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(identityEl);
    onCleanup(() => ro.disconnect());
  });

  return (
    <div class="sheet-shell" ref={shellEl}>
      <div
        ref={identityEl}
        class="sheet-shell__region sheet-shell__identity"
        data-region="identity"
      >
        <For each={identity()}>
          {(fill) => <>{fill.render({ characterId: props.characterId }) as JSX.Element}</>}
        </For>
      </div>

      <div class="sheet-shell__main">
        <div class="sheet-shell__rail" data-region="rail">
          <Show when={vitals().length > 0}>
            <div class="sheet-shell__rail-region" data-region="vitals">
              <For each={vitals()}>
                {(fill) => (
                  <>
                    {
                      fill.render({
                        characterId: props.characterId,
                      }) as JSX.Element
                    }
                  </>
                )}
              </For>
            </div>
          </Show>
          <Show when={status().length > 0}>
            <div class="sheet-shell__rail-region" data-region="status">
              <For each={status()}>
                {(fill) => (
                  <>
                    {
                      fill.render({
                        characterId: props.characterId,
                      }) as JSX.Element
                    }
                  </>
                )}
              </For>
            </div>
          </Show>
        </div>

        <Tabs
          tabs={tabSpecs()}
          ariaLabel="Character sheet tabs"
          activeId={persistence?.activeId() ?? null}
          onSelectTab={persistence?.select}
          emptyState={
            <div
              style={{
                padding: "1rem",
                color: "var(--color-fg-muted)",
                "font-size": "0.85rem",
              }}
            >
              no game system has projected tabs onto this character yet
            </div>
          }
        />
      </div>

      <div class="sheet-shell__region sheet-shell__actions" data-region="actions">
        <For each={actions()}>
          {(fill) => <>{fill.render({ characterId: props.characterId }) as JSX.Element}</>}
        </For>
      </div>
    </div>
  );
}

function sortRegion(fills: ReadonlyArray<unknown>): CharacterSheetRegion[] {
  const arr = [...(fills as ReadonlyArray<CharacterSheetRegion>)];
  arr.sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pb - pa;
    return a.id.localeCompare(b.id);
  });
  return arr;
}

function sortTabs(fills: ReadonlyArray<unknown>): CharacterSheetTab[] {
  const arr = [...(fills as ReadonlyArray<CharacterSheetTab>)];
  arr.sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pb - pa;
    return a.label.localeCompare(b.label);
  });
  return arr;
}

/**
 * Bind the active sub-tab to the workbench's per-tab sentinel via
 * `createOptimisticTrait`. Returns a reactive accessor + setter the
 * `Tabs` primitive consumes in controlled mode. The store's value is
 * the source of truth; `Tabs` falls back to the first available tab
 * when the stored id isn't among the projected fills (handles tab
 * fills appearing/disappearing across game-system swaps).
 */
function sheetTabPersistence(sentinelId: import("@vtt/substrate").EntityId): {
  activeId: () => string | null;
  select: (id: string) => void;
} {
  const [ui, setUi] = createOptimisticTrait(sentinelId, CharacterSheetUiState, {
    write: (value) =>
      SetCharacterSheetUiState({
        entityId: sentinelId,
        value,
      }) as CommandInstance,
  });
  return {
    activeId: () => ui.activeTabId,
    select: (id) => setUi("activeTabId", id),
  };
}
