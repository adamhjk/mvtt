import { createMemo, For, Show, type JSX } from "solid-js";
import { createOptimisticTrait, useClient } from "@vtt/substrate/client";
import { type EntityId } from "@vtt/substrate";
import { useTabSentinel } from "@vtt/shell-workbench/client";
import { BooksUiState, SetBooksUiState } from "../shared/ui-state.js";
import {
  BookOverlayTabsSlot,
  type BookOverlayTab,
} from "../shared/slot.js";

interface BooksDockProps {
  bookId: string;
  /** Workbench tab id — used to look up the per-tab sentinel. */
  tabId: string;
}

/**
 * The bottom dock — the book's "options panel."
 *
 * Closed: a single ~36px strip listing every registered tab as a pill.
 * Click a pill (or the chevron) to open. Open: the strip stays as the
 * tab switcher; a content panel grows above it.
 *
 * Tab order: priority desc, then label asc for stability. Built-in
 * Config (priority 100) lands first; projection plugins fill below.
 *
 * Persistence: dock state lives on the per-tab sentinel as
 * `BooksUiState`, written through `createOptimisticTrait` (immediate
 * local feedback, server-confirmed reconciliation, last-write-wins).
 * Survives tab switches and replicates across the user's connections.
 */
export function BooksDock(props: BooksDockProps): JSX.Element {
  const client = useClient();
  const sentinelId: EntityId = useTabSentinel(props.tabId);
  const [ui, setUi] = createOptimisticTrait(sentinelId, BooksUiState, {
    write: (value) => SetBooksUiState({ entityId: sentinelId, value }),
  });

  const tabs = createMemo<BookOverlayTab[]>(() => {
    const fills = client.registry.fillsForSlot(
      BookOverlayTabsSlot,
    ) as BookOverlayTab[];
    return [...fills].sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return a.label.localeCompare(b.label);
    });
  });

  const open = createMemo(() => ui.dockOpen);
  const activeId = createMemo<string | null>(() => {
    const want = ui.dockActiveId;
    const list = tabs();
    if (want && list.some((t) => t.id === want)) return want;
    return list[0]?.id ?? null;
  });
  const activeTab = createMemo<BookOverlayTab | null>(() => {
    const id = activeId();
    if (!id) return null;
    return tabs().find((t) => t.id === id) ?? null;
  });

  const toggle = () => {
    setUi("dockOpen", !ui.dockOpen);
  };

  const activate = (id: string) => {
    setUi({ dockOpen: true, dockActiveId: id });
  };

  return (
    <aside class="flex shrink-0 flex-col border-t border-border bg-surface-elevated">
      <header class="flex h-9 shrink-0 items-stretch gap-px border-b border-border-muted px-1">
        <button
          type="button"
          onClick={toggle}
          aria-label={open() ? "collapse dock" : "expand dock"}
          aria-expanded={open()}
          title={open() ? "collapse dock" : "expand dock"}
          class="px-3 font-mono text-xs text-fg-subtle hover:bg-surface hover:text-fg transition"
        >
          {open() ? "▼" : "▲"}
        </button>
        <span aria-hidden class="my-1 w-px bg-border-muted mx-1" />
        <Show
          when={tabs().length > 0}
          fallback={
            <span class="flex items-center px-2 text-[0.65rem] text-fg-subtle">
              no dock tabs registered
            </span>
          }
        >
          <For each={tabs()}>
            {(tab) => {
              const isActive = createMemo(
                () => open() && activeId() === tab.id,
              );
              return (
                <button
                  type="button"
                  onClick={() => activate(tab.id)}
                  class="group relative inline-flex items-center gap-1.5 px-3 font-display text-[0.7rem] uppercase tracking-[0.14em] transition"
                  classList={{
                    "text-fg": isActive(),
                    "text-fg-subtle hover:text-fg": !isActive(),
                  }}
                  aria-pressed={isActive()}
                >
                  <Show when={tab.icon}>
                    <span aria-hidden class="text-[0.85rem]">{tab.icon}</span>
                  </Show>
                  <span>{tab.label}</span>
                  <Show when={isActive()}>
                    <span
                      aria-hidden
                      class="pointer-events-none absolute inset-x-2 -bottom-px h-[2px]"
                      style={{ "background-color": "var(--color-pane-edge)" }}
                    />
                  </Show>
                </button>
              );
            }}
          </For>
        </Show>
      </header>

      <Show when={open() && activeTab()}>
        {(tab) => (
          <div
            class="min-h-0 overflow-hidden border-t border-border-muted bg-surface px-4 py-3"
            style={{ height: "clamp(12rem, 35vh, 24rem)" }}
          >
            <div class="h-full min-h-0">
              {tab().render({ bookId: props.bookId }) as unknown as JSX.Element}
            </div>
          </div>
        )}
      </Show>
    </aside>
  );
}
