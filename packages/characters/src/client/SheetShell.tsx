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

import { useClient } from "@vtt/substrate/client";
import {
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import {
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
  type CharacterSheetRegion,
  type CharacterSheetTab,
} from "../shared/slot.js";

const SHEET_SHELL_STYLE_ID = "vtt-characters-sheet-shell-styles";

/*
 * SheetShell stylesheet, injected once into <head> on the first mount.
 * Kept inline (not as a module-level CSS import) because the plugin
 * manifest is also evaluated by the server's tsx loader, which cannot
 * resolve `.css` files. A runtime injector sidesteps that without
 * forcing every plugin to coordinate its CSS through the client app's
 * top-level stylesheet.
 *
 * Three breakpoints:
 *   <600px      phone — sticky top, sticky bottom, single column
 *   600-1023px  tablet — single column, vitals/status flatten to strips
 *   ≥1024px     desktop — two-pane with rail
 */
const SHEET_SHELL_CSS = `
.sheet-shell {
  container-type: inline-size;
  container-name: sheet;
  display: grid;
  height: 100%;
  background: var(--color-surface);
  color: var(--color-fg);
  grid-template-columns: 1fr;
  grid-template-areas:
    "identity"
    "vitals"
    "status"
    "tabs"
    "actions";
  grid-template-rows: auto auto auto 1fr auto;
}
.sheet-shell__region { min-width: 0; min-height: 0; }
.sheet-shell__identity {
  grid-area: identity;
  position: sticky; top: 0; z-index: 5;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border-muted);
  padding: 0.75rem 1rem;
  display: flex; flex-direction: column; gap: 0.5rem;
}
.sheet-shell__vitals {
  grid-area: vitals;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--color-border-muted);
  display: flex; flex-direction: row; flex-wrap: nowrap;
  gap: 0.75rem; overflow-x: auto; scrollbar-width: thin;
}
.sheet-shell__status {
  grid-area: status;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--color-border-muted);
  display: flex; flex-direction: row; flex-wrap: wrap; gap: 0.4rem;
}
.sheet-shell__tabs {
  grid-area: tabs;
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
}
.sheet-shell__tabbar {
  display: flex; flex-direction: row; flex-wrap: nowrap;
  overflow-x: auto; scrollbar-width: thin;
  border-bottom: 1px solid var(--color-border-muted);
  background: var(--color-surface-elevated);
}
.sheet-shell__tabbutton {
  flex: 0 0 auto;
  padding: 0.5rem 1rem;
  font-family: var(--font-display);
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-fg-subtle);
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}
.sheet-shell__tabbutton:hover { color: var(--color-fg-muted); }
.sheet-shell__tabbutton[aria-selected="true"] {
  color: var(--color-fg);
  border-bottom-color: var(--color-accent);
}
.sheet-shell__tabbody {
  flex: 1 1 auto; overflow-y: auto; padding: 1rem;
}
.sheet-shell__actions {
  grid-area: actions;
  position: sticky; bottom: 0; z-index: 5;
  background: var(--color-surface);
  border-top: 1px solid var(--color-border-muted);
  padding: 0.5rem 1rem;
  display: flex; flex-direction: row; flex-wrap: wrap; gap: 0.5rem;
}
@container sheet (min-width: 600px) {
  .sheet-shell__vitals { flex-wrap: wrap; overflow-x: visible; }
}
@container sheet (min-width: 1024px) {
  .sheet-shell {
    grid-template-columns: 240px 1fr;
    grid-template-areas:
      "identity identity"
      "vitals   tabs"
      "status   tabs"
      "actions  actions";
    grid-template-rows: auto auto 1fr auto;
  }
  .sheet-shell__vitals {
    border-bottom: 0; border-right: 1px solid var(--color-border-muted);
    flex-direction: column; flex-wrap: nowrap;
    overflow-x: visible; overflow-y: auto;
  }
  .sheet-shell__status {
    border-right: 1px solid var(--color-border-muted);
  }
}
.sheet-shell:not(:has(.sheet-shell__vitals > *)) .sheet-shell__vitals,
.sheet-shell:not(:has(.sheet-shell__status > *)) .sheet-shell__status,
.sheet-shell:not(:has(.sheet-shell__actions > *)) .sheet-shell__actions {
  display: none;
}
@container sheet (min-width: 1024px) {
  .sheet-shell:not(:has(.sheet-shell__vitals > *)):not(:has(.sheet-shell__status > *)) {
    grid-template-columns: 1fr;
    grid-template-areas:
      "identity"
      "tabs"
      "actions";
    grid-template-rows: auto 1fr auto;
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
 * SheetShell is the responsive grid that hosts every character sheet.
 * The shell owns spatial layout (CSS grid + container queries collapse
 * across desktop/tablet/phone) and delegates contents to five slots:
 *
 *   Identity (sticky top)   ── name, portrait, system sub-line
 *   Vitals (rail / strip)   ── HP, AC, init — anything always-watched
 *   Status (rail / strip)   ── condition chips, ongoing effects
 *   Tabs (body)             ── the bulk of the sheet, tabbed by system
 *   Actions (sticky bottom) ── quick rolls + pre-roll triggers
 *
 * Empty slots collapse via the CSS — a system that fills only Tabs
 * gets a single-column sheet with no empty rail or action bar.
 *
 * Game-system plugins fill these slots via the manifest's `fills`. The
 * default characters plugin fills Identity itself (the name + player
 * dropdown that lived on the old sheet); systems extend it with their
 * own sub-lines (level/class) and contribute to the other four slots.
 */
export function SheetShell(props: { characterId: string }): JSX.Element {
  onMount(injectSheetShellStyles);
  const client = useClient();

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
  const tabs = createMemo(() =>
    sortTabs(client.registry.fillsForSlot(CharacterSheetTabsSlot)),
  );

  // Active tab id is local state — no need to persist across remounts.
  // Defaults to the first tab in the sorted list; updates if the
  // active tab disappears (system unloaded or tab list re-ordered).
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const resolvedActive = createMemo<CharacterSheetTab | null>(() => {
    const list = tabs();
    if (list.length === 0) return null;
    const wanted = activeId();
    const found = wanted ? list.find((t) => t.id === wanted) : null;
    return found ?? list[0]!;
  });

  return (
    <div class="sheet-shell">
      <div
        class="sheet-shell__region sheet-shell__identity"
        data-region="identity"
      >
        <For each={identity()}>
          {(fill) => (
            <>{fill.render({ characterId: props.characterId }) as JSX.Element}</>
          )}
        </For>
      </div>

      <div class="sheet-shell__region sheet-shell__vitals" data-region="vitals">
        <For each={vitals()}>
          {(fill) => (
            <>{fill.render({ characterId: props.characterId }) as JSX.Element}</>
          )}
        </For>
      </div>

      <div class="sheet-shell__region sheet-shell__status" data-region="status">
        <For each={status()}>
          {(fill) => (
            <>{fill.render({ characterId: props.characterId }) as JSX.Element}</>
          )}
        </For>
      </div>

      <div class="sheet-shell__region sheet-shell__tabs" data-region="tabs">
        <Show
          when={tabs().length > 0}
          fallback={
            <div class="sheet-shell__tabbody">
              <p class="text-xs text-fg-subtle">
                no game system has projected tabs onto this character yet
              </p>
            </div>
          }
        >
          <div
            class="sheet-shell__tabbar"
            role="tablist"
            aria-label="Character sheet tabs"
          >
            <For each={tabs()}>
              {(tab) => (
                <button
                  type="button"
                  class="sheet-shell__tabbutton"
                  role="tab"
                  aria-selected={resolvedActive()?.id === tab.id}
                  onClick={() => setActiveId(tab.id)}
                >
                  {tab.label}
                </button>
              )}
            </For>
          </div>
          <div class="sheet-shell__tabbody" role="tabpanel">
            <Show when={resolvedActive()}>
              {(active) =>
                active().render({
                  characterId: props.characterId,
                }) as JSX.Element
              }
            </Show>
          </div>
        </Show>
      </div>

      <div
        class="sheet-shell__region sheet-shell__actions"
        data-region="actions"
      >
        <For each={actions()}>
          {(fill) => (
            <>{fill.render({ characterId: props.characterId }) as JSX.Element}</>
          )}
        </For>
      </div>
    </div>
  );
}

function sortRegion(
  fills: ReadonlyArray<unknown>,
): CharacterSheetRegion[] {
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
