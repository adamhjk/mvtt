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
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { useClient, useQuery } from "@vtt/substrate/client";
import { TabPicker } from "./TabPicker.js";
import { useWorkspace } from "./use-workspace.js";
import { useMe } from "./use-me.js";
import { useProviderContext, type ProviderRunContext } from "./provider-context.js";
import {
  usePageProviders,
  useProviderTraitsVersion,
} from "./use-providers.js";
import {
  CloseTab,
  FocusPane,
  FocusTab,
  OpenPageAsSplit,
  OpenPageInNewTab,
  ShareTab,
  ToggleZen,
} from "../shared/commands.js";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { tabSentinelEntityId } from "../shared/tab-sentinel.js";
import type { WorkspacePane, WorkspaceTab } from "../shared/traits.js";
import type { PageProvider, PageRenderArgs } from "../shared/slots.js";

/**
 * Width budget reserved for the strip's right-side controls
 * (`+ new tab` + `split` + `zen` + the overflow `…` menu when shown).
 * Used by the visible/overflow tab partitioner so we don't squeeze the
 * controls off-screen when there are too many tabs to fit. Matches the
 * cumulative natural width of those buttons in the current layout.
 */
const RESERVED_CONTROLS_PX = 18 * 16;

/**
 * Estimated rendered width per tab. Tabs are picker-driven so the actual
 * width depends on the entity-name length, but they cluster around 10rem
 * for short labels and reach the picker's 16rem max-width cap for long
 * ones — 11rem is a reasonable mid-point.
 *
 * The partitioner uses this only as a heuristic; if it's slightly off the
 * worst case is one extra/one missing tab, no incorrect content.
 */
const PER_TAB_PX = 11 * 16;

/**
 * Re-mount key for a tab's rendered page. Per-tab UI state lives on the
 * tab sentinel as plugin-owned traits (read via `createOptimisticTrait`),
 * so the key only needs the workbench-layout fields (id, pageKind,
 * entityId). A retarget changes entityId, which keys a fresh provider
 * mount on the new entity; UI-state writes don't touch any of these.
 */
function paneKey(tab: WorkspaceTab): string {
  return `${tab.id}:${tab.pageKind}:${tab.entityId ?? "_null"}`;
}

/**
 * One leaf in the workspace tree. Renders the tab strip + the active
 * page. Clicking anywhere on the pane focuses it (FocusPane).
 *
 * Tab overflow strategy: when the strip can't fit every tab, the
 * partitioner drops trailing tabs into a `…` menu. The active tab is
 * always pinned visible — picking a hidden tab from the menu dispatches
 * FocusTab, which makes it active, which the partitioner then promotes
 * back into the visible set automatically.
 */
export function Pane(props: { pane: WorkspacePane }): JSX.Element {
  const client = useClient();
  const ws = useWorkspace();
  const ctx = useProviderContext();
  const providers = usePageProviders();

  const activeTab = createMemo<WorkspaceTab | null>(() => {
    const state = ws.state();
    if (!state) return null;
    const id = props.pane.activeTabId;
    if (!id) return null;
    return state.tabs[id] ?? null;
  });
  const isActivePane = createMemo(
    () => ws.state()?.activePaneId === props.pane.paneId,
  );
  const tabs = createMemo<WorkspaceTab[]>(() => {
    const state = ws.state();
    if (!state) return [];
    return props.pane.tabIds
      .map((id) => state.tabs[id])
      .filter((t): t is WorkspaceTab => Boolean(t));
  });

  // Track the strip's rendered width so we can decide how many tabs fit.
  // ResizeObserver is the right tool — `window resize` alone misses pane
  // resizes from the splitter drag.
  let stripEl: HTMLElement | undefined;
  const [stripWidth, setStripWidth] = createSignal(0);
  onMount(() => {
    if (!stripEl) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setStripWidth(w);
    });
    ro.observe(stripEl);
    onCleanup(() => ro.disconnect());
  });

  /**
   * Partition tabs into a visible set + overflow set. Active tab is
   * always promoted into the visible set so the user never loses sight
   * of "what's currently open." Order is preserved within each set.
   */
  const partitioned = createMemo<{
    visible: WorkspaceTab[];
    overflow: WorkspaceTab[];
  }>(() => {
    const list = tabs();
    if (list.length === 0) return { visible: [], overflow: [] };
    const w = stripWidth();
    // Until the ResizeObserver has fired (initial render), show
    // everything — letting the browser briefly clip is better than
    // hiding tabs behind a `…` that's actually unnecessary.
    if (w === 0) return { visible: list, overflow: [] };
    const budget = w - RESERVED_CONTROLS_PX;
    const maxN = Math.max(1, Math.floor(budget / PER_TAB_PX));
    if (list.length <= maxN) return { visible: list, overflow: [] };

    const activeId = props.pane.activeTabId;
    const activeIdx = activeId
      ? list.findIndex((t) => t.id === activeId)
      : -1;

    let visible: WorkspaceTab[];
    if (activeIdx === -1 || activeIdx < maxN) {
      visible = list.slice(0, maxN);
    } else {
      // Active is in the natural overflow region — pin it as the last
      // visible tab so it's always reachable without opening the menu.
      visible = [...list.slice(0, maxN - 1), list[activeIdx]!];
    }
    const visibleIds = new Set(visible.map((t) => t.id));
    const overflow = list.filter((t) => !visibleIds.has(t.id));
    return { visible, overflow };
  });

  const focus = () => {
    if (!isActivePane()) {
      client.dispatch(FocusPane({ paneId: props.pane.paneId }) as never);
    }
  };

  const splitMenu = () => {
    const tab = activeTab();
    if (!tab) return;
    // Cheap menu via prompt for v0; the design doc commits to a real
    // popover later. For now the keyboard shortcuts are the main path.
    const dir = window.prompt("split direction (left / right / top / bottom)?", "right");
    if (!dir) return;
    const norm = dir.trim().toLowerCase();
    if (norm !== "left" && norm !== "right" && norm !== "top" && norm !== "bottom") return;
    client.dispatch(
      OpenPageAsSplit({
        pageKind: tab.pageKind,
        entityId: tab.entityId,
        direction: norm,
      }) as never,
    );
  };

  const newTab = () => {
    // Always open a fresh empty tab — clicking "+ new tab" twice should
    // create two tabs, not focus the first. OpenPage would dedup on
    // (kind, entityId) and the second click would be a no-op focus.
    client.dispatch(
      OpenPageInNewTab({
        pageKind:
          providers().values().next().value?.kind ??
          ("@vtt/shell-workbench/empty" as never),
        entityId: null,
      }) as never,
    );
  };

  return (
    <section
      class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface"
      onMouseDown={focus}
    >
      {/* tab strip — `overflow-hidden` instead of `overflow-x-auto`: the
          strip never scrolls, overflow tabs hide into a `…` menu
          rendered at the right of the visible set. */}
      <header
        ref={(el) => {
          stripEl = el;
        }}
        class="flex shrink-0 items-stretch gap-px overflow-hidden border-b border-border-muted"
        style={{ height: "var(--workbench-tab-strip)" }}
      >
        <For each={partitioned().visible}>
          {(tab) => (
            <TabChip
              tab={tab}
              ctx={ctx()}
              paneId={props.pane.paneId}
              isActive={props.pane.activeTabId === tab.id}
              onFocusPane={focus}
            />
          )}
        </For>

        <Show when={partitioned().overflow.length > 0}>
          <OverflowMenu
            tabs={partitioned().overflow}
            ctx={ctx()}
            paneId={props.pane.paneId}
            providers={providers()}
            onFocusPane={focus}
          />
        </Show>

        {/* + new tab */}
        <button
          type="button"
          class="shrink-0 px-3 font-display text-xs text-fg-subtle hover:bg-surface-elevated hover:text-fg transition"
          title="open a new tab in this pane"
          onClick={(e) => {
            e.stopPropagation();
            focus();
            newTab();
          }}
        >
          + new tab
        </button>

        <div class="flex-1" />

        {/* split + zen affordances */}
        <Show when={tabs().length > 0}>
          <button
            type="button"
            class="shrink-0 px-3 text-[0.7rem] uppercase tracking-[0.14em] font-display text-fg-subtle hover:bg-surface-elevated hover:text-fg transition"
            onClick={(e) => {
              e.stopPropagation();
              focus();
              splitMenu();
            }}
            title="split this pane (⌘\\ right, ⌘- below)"
          >
            split
          </button>
        </Show>
        <button
          type="button"
          class="shrink-0 px-3 text-[0.7rem] uppercase tracking-[0.14em] font-display text-fg-subtle hover:bg-surface-elevated hover:text-fg transition"
          onClick={(e) => {
            e.stopPropagation();
            focus();
            client.dispatch(ToggleZen({}) as never);
          }}
          title="toggle zen mode (⌘.)"
        >
          {ws.state()?.zenPaneId === props.pane.paneId ? "exit zen" : "zen"}
        </button>
      </header>

      {/* page content */}
      <div class="relative min-h-0 min-w-0 flex-1 overflow-auto">
        <Show
          when={activeTab()}
          fallback={<EmptyPaneState ctx={ctx()} />}
        >
          {(tabAcc) => (
            // Re-key on (tabId, pageKind, entityId). Per-tab UI state
            // lives on the tab sentinel as plugin-owned traits, so the
            // workbench has no separate "ui state changed" reactive
            // path that would tear down a provider's subtree. The
            // provider's render(args) runs exactly once per key change.
            <Show
              keyed
              when={paneKey(tabAcc())}
              fallback={null}
            >
              {(_key) => {
                const tab = tabAcc();
                const provider = providers().get(tab.pageKind) ?? null;
                if (provider == null) {
                  return <MissingProvider tab={tab} />;
                }
                const args: PageRenderArgs = {
                  tabId: tab.id,
                  entityId: tab.entityId,
                };
                return <>{provider.render(args) as unknown as JSX.Element}</>;
              }}
            </Show>
          )}
        </Show>
      </div>
    </section>
  );
}

/**
 * One visible tab in the strip. Pulled out of `Pane` so the partitioner
 * iterates a flat list of tab elements rather than threading the tab UI
 * through the partition memo's body.
 */
function TabChip(props: {
  tab: WorkspaceTab;
  ctx: ProviderRunContext;
  paneId: string;
  isActive: boolean;
  onFocusPane: () => void;
}): JSX.Element {
  const client = useClient();
  return (
    <div
      class="group relative flex shrink-0 items-center gap-1 border-r border-border-muted px-2"
      classList={{
        "bg-surface": !props.isActive,
        "bg-tab-active-bg": props.isActive,
      }}
      style={{
        "background-color": props.isActive
          ? "var(--color-tab-active-bg)"
          : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        props.onFocusPane();
        if (!props.isActive) {
          client.dispatch(
            FocusTab({ paneId: props.paneId, tabId: props.tab.id }) as never,
          );
        }
      }}
    >
      <Show when={props.isActive}>
        <span
          aria-hidden
          class="pointer-events-none absolute inset-x-2 -bottom-px h-[2px]"
          style={{ "background-color": "var(--color-pane-edge)" }}
        />
      </Show>
      <TabPicker tab={props.tab} ctx={props.ctx} compact />
      <ShareMenu tab={props.tab} />
      <button
        type="button"
        class="ml-1 rounded-(--radius-control) px-1 text-[0.7rem] text-fg-subtle opacity-0 hover:bg-surface-elevated hover:text-danger group-hover:opacity-100 transition"
        onClick={(e) => {
          e.stopPropagation();
          client.dispatch(
            CloseTab({ paneId: props.paneId, tabId: props.tab.id }) as never,
          );
        }}
        aria-label="close tab"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Width of the share dropdown, in px. Matches the Tailwind `w-72` class on
 * the popover (`18rem` × 16px). Exposed as a constant so the position-
 * clamping math doesn't have to query layout.
 */
const SHARE_MENU_WIDTH = 288;

/**
 * Compute a viewport-clamped `left` for the share dropdown. The popover is
 * a portaled fixed element; default-anchoring it to the right of the
 * triggering button (so it cascades toward the pane center) is fine in
 * the middle of the strip but pushes the popover off-screen when the tab
 * is at the far left or far right edge of the viewport. This function
 * picks `left` so:
 *
 *   - the popover's right edge prefers to align with the button's right
 *     edge (`buttonRight - menuWidth`), matching the visual cascade of
 *     the existing OverflowMenu pattern,
 *   - but the result is clamped into `[margin, viewport - menuWidth - margin]`
 *     so the popover always fits with a small gutter on both sides.
 *
 * Pure function: takes only numbers, no DOM. The Pane test file unit-tests
 * the three branches (no-clamp, left-clamped, right-clamped).
 */
export function clampShareMenuLeft(args: {
  buttonRight: number;
  viewportWidth: number;
  menuWidth?: number;
  margin?: number;
}): number {
  const menuWidth = args.menuWidth ?? SHARE_MENU_WIDTH;
  const margin = args.margin ?? 8;
  const preferred = args.buttonRight - menuWidth;
  const minLeft = margin;
  const maxLeft = args.viewportWidth - menuWidth - margin;
  if (preferred < minLeft) return minLeft;
  if (preferred > maxLeft) return maxLeft;
  return preferred;
}

/**
 * Per-tab "share" affordance — a small button that opens a popover listing
 * the other online users. The dispatcher picks recipients (or "everyone")
 * and optionally GM-pulls them to the new tab via `forceFocus`. Player-to-
 * player sharing is allowed; only `forceFocus` is GM-gated, enforced both
 * server-side in `ShareTab.validate` and client-side here by disabling the
 * checkbox for non-GM connections (the visual confirmation matches the
 * authoritative rule).
 *
 * The whole point of this verb is that the recipient lands on the same
 * view as the sender — page 11 of the rulebook, sub-page 5 of a note —
 * which is handled entirely by the substrate: `ShareTab.apply` snapshots
 * every share-eligible trait off the sender's tab sentinel, so the
 * client doesn't have to enumerate or care.
 */
export function ShareMenu(props: { tab: WorkspaceTab }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const presence = useQuery([Identity, Name, Online]);
  const providers = usePageProviders();
  const worldVersion = useProviderTraitsVersion();
  const [open, setOpen] = createSignal(false);
  const [mode, setMode] = createSignal<"everyone" | "select">("everyone");
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(
    new Set<string>(),
  );
  const [forceFocus, setForceFocus] = createSignal(false);
  const [pos, setPos] = createSignal<{ top: number; left: number } | null>(null);
  let rootEl: HTMLDivElement | undefined;
  let buttonEl: HTMLButtonElement | undefined;
  let menuEl: HTMLDivElement | undefined;

  const onDocClick = (e: MouseEvent) => {
    if (rootEl?.contains(e.target as Node)) return;
    if (menuEl?.contains(e.target as Node)) return;
    setOpen(false);
  };
  document.addEventListener("mousedown", onDocClick);
  onCleanup(() => document.removeEventListener("mousedown", onDocClick));

  const onResize = () => {
    if (open()) computePos();
  };
  window.addEventListener("resize", onResize);
  onCleanup(() => window.removeEventListener("resize", onResize));

  const computePos = () => {
    if (!buttonEl) return;
    const rect = buttonEl.getBoundingClientRect();
    const left = clampShareMenuLeft({
      buttonRight: rect.right,
      viewportWidth: window.innerWidth,
    });
    setPos({ top: rect.bottom + 4, left });
  };

  /**
   * One-line summary of what's about to travel — "page 11", "page 'Skarn'",
   * etc. Only renders when the tab's PageProvider implements
   * `summarizeTabState` and returns a non-null value. The dependency on
   * `worldVersion()` is what makes this re-run when the underlying per-tab
   * UI-state trait changes mid-share-menu (the user toggles to a different
   * sub-page while the dropdown is open).
   */
  const summary = createMemo<string | null>(() => {
    worldVersion();
    const provider = providers().get(props.tab.pageKind);
    if (!provider?.summarizeTabState) return null;
    try {
      return provider.summarizeTabState({
        sentinelId: tabSentinelEntityId(props.tab.id),
        world: client.world,
      });
    } catch {
      return null;
    }
  });

  /** Online users other than me — the share-target candidates. */
  const others = createMemo<{ userId: string; name: string }[]>(() => {
    const meInfo = me();
    const myId = meInfo?.userId ?? null;
    const seen = new Set<string>();
    const out: { userId: string; name: string }[] = [];
    for (const row of presence()) {
      const id = row.values.Identity as { userId: string };
      if (id.userId === myId) continue;
      if (seen.has(id.userId)) continue;
      seen.add(id.userId);
      const nm = (row.values as { Name?: { value: string } }).Name;
      out.push({ userId: id.userId, name: nm?.value ?? id.userId });
    }
    return out;
  });

  const isGm = createMemo(() => me()?.role === "gm");

  const recipientList = (): string[] => {
    if (mode() === "everyone") return others().map((u) => u.userId);
    return others()
      .map((u) => u.userId)
      .filter((id) => selected().has(id));
  };

  const canSend = createMemo(() => recipientList().length > 0);

  const send = async () => {
    const targets = recipientList();
    if (targets.length === 0) return;
    // Flush any pending optimistic writes on this tab's sentinel before
    // ShareTab fires server-side. Without this, a per-tab UI-state trait
    // (PdfReaderState.page, NotesUiState.activePageId, etc.) whose write
    // is mid-debounce won't be visible to the server's `traitsOn`
    // snapshot, and the recipient lands on the previously-committed
    // value instead of what the sender currently sees.
    await client.optimisticFlushes.flushFor(tabSentinelEntityId(props.tab.id));
    client.dispatch(
      ShareTab({
        tabId: props.tab.id,
        recipientUserIds: targets,
        forceFocus: forceFocus() && isGm(),
      }) as never,
    );
    setOpen(false);
    // Reset transient menu state so the next open starts neutral.
    setMode("everyone");
    setSelected(new Set<string>());
    setForceFocus(false);
  };

  const toggleSelected = (uid: string) => {
    setSelected((prev) => {
      const next = new Set<string>(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  return (
    <div ref={rootEl} class="relative">
      <button
        ref={buttonEl}
        type="button"
        class="ml-1 rounded-(--radius-control) px-1 text-[0.7rem] text-fg-subtle opacity-0 hover:bg-surface-elevated hover:text-fg group-hover:opacity-100 transition"
        title="share this tab with another player"
        aria-label="share tab"
        aria-haspopup="dialog"
        aria-expanded={open()}
        onClick={(e) => {
          e.stopPropagation();
          if (!open()) computePos();
          setOpen((v) => !v);
        }}
      >
        ↗
      </button>

      <Show when={open() && pos()}>
        <Portal>
          <div
            ref={menuEl}
            role="dialog"
            aria-label="share tab"
            class="fixed z-50 w-72 rounded-(--radius-card) border border-border bg-surface-elevated p-3 text-xs shadow-2xl ring-1 ring-black/10"
            style={{ top: `${pos()!.top}px`, left: `${pos()!.left}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <Show when={summary() !== null}>
              <p class="mb-2 text-[0.65rem] uppercase tracking-[0.14em] text-fg-subtle">
                includes:{" "}
                <span class="normal-case tracking-normal text-fg">
                  {summary()}
                </span>
              </p>
            </Show>
            <Show
              when={others().length > 0}
              fallback={
                <p class="text-fg-subtle">no other players are online</p>
              }
            >
              <div class="flex flex-col gap-2">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="share-mode"
                    checked={mode() === "everyone"}
                    onChange={() => setMode("everyone")}
                  />
                  <span>everyone ({others().length})</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="share-mode"
                    checked={mode() === "select"}
                    onChange={() => setMode("select")}
                  />
                  <span>just…</span>
                </label>
                <Show when={mode() === "select"}>
                  <ul class="ml-6 flex flex-col gap-1">
                    <For each={others()}>
                      {(u) => (
                        <li>
                          <label class="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selected().has(u.userId)}
                              onChange={() => toggleSelected(u.userId)}
                            />
                            <span>{u.name}</span>
                          </label>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>

                <hr class="my-1 border-border-muted" />

                <label
                  class="flex items-center gap-2"
                  classList={{
                    "opacity-50 cursor-not-allowed": !isGm(),
                    "cursor-pointer": isGm(),
                  }}
                  title={
                    isGm()
                      ? "open the tab on their screen and pull focus to it"
                      : "only the GM can pull players to a tab"
                  }
                >
                  <input
                    type="checkbox"
                    checked={forceFocus()}
                    disabled={!isGm()}
                    onChange={(e) => setForceFocus(e.currentTarget.checked)}
                  />
                  <span>pull them to it (force focus)</span>
                </label>

                <div class="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    class="rounded-(--radius-control) px-2 py-1 text-fg-subtle hover:bg-surface hover:text-fg transition"
                    onClick={() => setOpen(false)}
                  >
                    cancel
                  </button>
                  <button
                    type="button"
                    class="rounded-(--radius-control) bg-accent px-2 py-1 text-on-accent disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!canSend()}
                    onClick={send}
                  >
                    send
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </Portal>
      </Show>
    </div>
  );
}

/**
 * `…` button + dropdown listing tabs that didn't fit in the strip.
 * Picking one dispatches FocusTab; the partitioner re-runs with the new
 * active tab and pins it into the visible set on the next render, so a
 * hidden tab "pops" to visible the moment it's chosen.
 *
 * Each row resolves its label through the registered PageProvider so
 * the menu shows real entity names, not opaque tab ids. Rows for tabs
 * pointing at unknown providers fall back to the qualified name string.
 */
function OverflowMenu(props: {
  tabs: WorkspaceTab[];
  ctx: ProviderRunContext;
  paneId: string;
  providers: ReadonlyMap<string, PageProvider>;
  onFocusPane: () => void;
}): JSX.Element {
  const client = useClient();
  const [open, setOpen] = createSignal(false);
  // Re-derive labels reactively when any provider-watched trait
  // changes (e.g. a scene rename refreshes every overflow row that
  // points at it). Same fine-grained subscription as TabPicker.
  const worldVersion = useProviderTraitsVersion();
  // Captured at open-time and on viewport resize so the portaled menu
  // tracks the button's position without a layout-effect on every frame.
  const [pos, setPos] = createSignal<{ top: number; right: number } | null>(null);
  let rootEl: HTMLDivElement | undefined;
  let buttonEl: HTMLButtonElement | undefined;
  let menuEl: HTMLUListElement | undefined;

  // Closes when a click lands outside both the trigger button AND the
  // portaled menu — the menu lives at document.body, not inside rootEl,
  // so we have to check both refs here.
  const onDocClick = (e: MouseEvent) => {
    if (rootEl?.contains(e.target as Node)) return;
    if (menuEl?.contains(e.target as Node)) return;
    setOpen(false);
  };
  document.addEventListener("mousedown", onDocClick);
  onCleanup(() => document.removeEventListener("mousedown", onDocClick));

  // Reposition on viewport resize while open — without this the menu
  // would "stick" to the button's old screen position when the user
  // resizes the window mid-open.
  const onResize = () => {
    if (open()) computePos();
  };
  window.addEventListener("resize", onResize);
  onCleanup(() => window.removeEventListener("resize", onResize));

  const computePos = () => {
    if (!buttonEl) return;
    const rect = buttonEl.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  };

  const labelFor = (tab: WorkspaceTab): { kind: string; entity: string } => {
    // Read worldVersion so the enclosing reactive scope (the For row)
    // re-evaluates when any trait changes.
    worldVersion();
    const provider = props.providers.get(tab.pageKind);
    if (!provider) {
      return { kind: tab.pageKind, entity: tab.entityId ?? "—" };
    }
    if (tab.entityId === null) {
      return { kind: provider.label, entity: "pick…" };
    }
    const found = provider
      .list(props.ctx)
      .find((e) => e.id === tab.entityId);
    return {
      kind: provider.label,
      entity: found?.label ?? "missing",
    };
  };

  return (
    <div ref={rootEl} class="relative">
      <button
        ref={buttonEl}
        type="button"
        class="h-full shrink-0 px-3 text-sm text-fg-subtle hover:bg-surface-elevated hover:text-fg transition"
        title={`${props.tabs.length} more tab${props.tabs.length === 1 ? "" : "s"}`}
        aria-label="show overflow tabs"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={(e) => {
          e.stopPropagation();
          props.onFocusPane();
          if (!open()) computePos();
          setOpen((v) => !v);
        }}
      >
        <span aria-hidden class="font-mono">…</span>
        <span class="ml-1 text-[0.65rem] text-fg-subtle">
          {props.tabs.length}
        </span>
      </button>

      <Show when={open() && pos()}>
        <Portal>
          <ul
            ref={menuEl}
            role="menu"
            class="fixed z-50 max-h-80 min-w-[18rem] overflow-y-auto rounded-(--radius-card) border border-border bg-surface-elevated shadow-2xl ring-1 ring-black/10"
            style={{
              top: `${pos()!.top}px`,
              right: `${pos()!.right}px`,
            }}
          >
            <For each={props.tabs}>
              {(tab) => {
                const lbl = labelFor(tab);
                return (
                  <li
                    role="menuitem"
                    tabindex={0}
                    class="group flex cursor-pointer items-baseline gap-3 px-3 py-2 text-xs hover:bg-surface"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      props.onFocusPane();
                      client.dispatch(
                        FocusTab({
                          paneId: props.paneId,
                          tabId: tab.id,
                        }) as never,
                      );
                    }}
                  >
                    <span class="font-display text-[0.62rem] uppercase tracking-[0.14em] text-fg-muted min-w-[5rem]">
                      {lbl.kind}
                    </span>
                    <span class="flex-1 truncate text-fg">{lbl.entity}</span>
                    <button
                      type="button"
                      class="rounded-(--radius-control) px-1 text-[0.7rem] text-fg-subtle opacity-0 hover:bg-surface hover:text-danger group-hover:opacity-100 transition"
                      title="close tab"
                      aria-label="close tab"
                      onClick={(e) => {
                        e.stopPropagation();
                        client.dispatch(
                          CloseTab({
                            paneId: props.paneId,
                            tabId: tab.id,
                          }) as never,
                        );
                      }}
                    >
                      ✕
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Portal>
      </Show>
    </div>
  );
}

function EmptyPaneState(props: { ctx: ProviderRunContext }): JSX.Element {
  return (
    <div class="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
      <p
        class="font-display text-2xl tracking-tight text-fg-muted"
        style={{ "font-family": "var(--font-display)" }}
      >
        Nothing here yet.
      </p>
      <p class="text-xs text-fg-subtle max-w-sm leading-relaxed">
        Pick a content type and an entity to fill this pane. Or press{" "}
        <kbd class="rounded-(--radius-control) border border-border-muted bg-surface-elevated px-1.5 py-0.5 font-mono text-[0.65rem]">
          ⌘K
        </kbd>{" "}
        for the quick switcher.
      </p>
      <TabPicker ctx={props.ctx} />
    </div>
  );
}

function MissingProvider(props: { tab: WorkspaceTab }): JSX.Element {
  return (
    <div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p class="font-display text-base text-warning">missing provider</p>
      <p class="text-xs text-fg-subtle max-w-sm">
        This tab points at <code class="font-mono text-fg">{props.tab.pageKind}</code>, but no
        plugin currently registers a provider for that kind. Install the plugin or
        retarget the tab using the picker above.
      </p>
    </div>
  );
}
