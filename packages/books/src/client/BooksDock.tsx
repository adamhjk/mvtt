import { createMemo, For, Show, type JSX } from "solid-js";
import { useClient } from "@vtt/substrate/client";
import {
  BookOverlayTabsSlot,
  type BookOverlayTab,
} from "../shared/slot.js";

/**
 * Persisted state shape stashed in the workbench tab's `uiState` blob.
 * Mirrors scene's dock — same field names with a `book` prefix to
 * avoid collisions with scene's keys when other plugins put both kinds
 * of dock state in the same tab.
 */
interface DockUiState {
  bookDockOpen?: boolean;
  bookDockActive?: string | null;
}

interface BooksDockProps {
  bookId: string;
  uiState: unknown;
  setUiState: (next: unknown) => void;
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
 * Persistence: same uiState round-trip as scene's dock, so dock state
 * survives tab switches and replicates across devices.
 */
export function BooksDock(props: BooksDockProps): JSX.Element {
  const client = useClient();

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

  const ui = (): DockUiState => (props.uiState ?? {}) as DockUiState;
  const open = createMemo(() => ui().bookDockOpen ?? false);
  const activeId = createMemo<string | null>(() => {
    const want = ui().bookDockActive ?? null;
    const list = tabs();
    if (want && list.some((t) => t.id === want)) return want;
    return list[0]?.id ?? null;
  });
  const activeTab = createMemo<BookOverlayTab | null>(() => {
    const id = activeId();
    if (!id) return null;
    return tabs().find((t) => t.id === id) ?? null;
  });

  const update = (patch: Partial<DockUiState>) => {
    const base = (props.uiState ?? {}) as Record<string, unknown>;
    props.setUiState({ ...base, ...patch });
  };

  const toggle = () => {
    update({ bookDockOpen: !open() });
  };

  const activate = (id: string) => {
    update({ bookDockActive: id, bookDockOpen: true });
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
