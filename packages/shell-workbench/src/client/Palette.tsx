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
import Fuse from "fuse.js";
import { useClient } from "@vtt/substrate/client";
import {
  OpenPage,
  OpenPageInNewTab,
  OpenPageAsSplit,
} from "../shared/commands.js";
import { useProviderContext } from "./provider-context.js";
import {
  usePageProviders,
  usePaletteCommands,
  useProviderTraitsVersion,
} from "./use-providers.js";
import { useMe } from "./use-me.js";
import type { PageProvider } from "../shared/slots.js";

type Hit =
  | {
      kind: "page";
      providerKind: string;
      providerLabel: string;
      providerIcon?: string;
      /** null = open the page-root tab with no entity selected. */
      entityId: string | null;
      label: string;
      hint?: string;
    }
  | {
      /**
       * Synthetic "open the page and run this query" entry, surfaced
       * when the input matches `<prefix>:<query>` for a provider that
       * declared `palettePrefix`. Always shown at the top of results
       * so a fast-typed `rules: weaver` resolves with a single Enter.
       */
      kind: "prefixSearch";
      providerKind: string;
      providerLabel: string;
      providerIcon?: string;
      query: string;
      label: string;
      hint?: string;
      publish: (q: string) => void;
    }
  | {
      kind: "command";
      id: string;
      label: string;
      hint?: string;
    };

/**
 * The fuzzy switcher. ⌘K opens it; selection dispatches OpenPage by
 * default, ⌘⏎ opens in a new tab, ⌘\ splits right, ⌘- splits below.
 *
 * Visually: centered overlay 720px wide, scrim with a backdrop blur,
 * search input set in the display face (2xl), results in a tight grid
 * with the kind label MONO-CAPS on the left and the entity label as
 * body text on the right. The active row has a 2px accent left edge —
 * the same focus-ring language as the active pane.
 */
export function Palette(props: { open: boolean; onClose: () => void }): JSX.Element {
  const client = useClient();
  const ctx = useProviderContext();
  const providers = usePageProviders();
  const commands = usePaletteCommands();
  const me = useMe();
  // Rebuild the corpus when any provider-watched trait changes —
  // freshly-renamed scenes, newly-added entities, etc. Provider.list
  // doesn't subscribe to world directly; this signal does.
  const worldVersion = useProviderTraitsVersion();

  const [query, setQuery] = createSignal("");
  const [cursor, setCursor] = createSignal(0);
  let inputEl: HTMLInputElement | undefined;

  // Build the searchable corpus. Re-runs when providers / commands /
  // ctx change AND on any world mutation (worldVersion).
  const corpus = createMemo<Hit[]>(() => {
    worldVersion();
    const out: Hit[] = [];
    for (const p of providers().values()) {
      // Page-root entry: opens the page with no entity selected, so
      // typing "rules" / "books" / "notes" lands on the page's
      // entity-less view (Rules cross-corpus search, Books library
      // hub, Notes index, …). Each provider's own entity-bound
      // entries follow.
      out.push({
        kind: "page",
        providerKind: p.kind,
        providerLabel: p.label,
        providerIcon: p.icon,
        entityId: null,
        label: p.label,
        hint: "page",
      });
      const entries = p.list(ctx());
      for (const e of entries) {
        out.push({
          kind: "page",
          providerKind: p.kind,
          providerLabel: p.label,
          providerIcon: p.icon,
          entityId: e.id,
          label: e.label,
          hint: e.hint,
        });
      }
    }
    for (const c of commands()) {
      out.push({
        kind: "command",
        id: c.id,
        label: c.label,
        hint: c.hint,
      });
    }
    return out;
  });

  /**
   * Recognise `<prefix>:<query>` input shapes (e.g. `rules: weaver`)
   * and return a synthetic top-result that, when chosen, publishes
   * the query through the matching provider's `publishPaletteQuery`
   * hook before opening the page-root tab. Whitespace after the
   * colon is permitted; case-insensitive prefix match.
   */
  const prefixHit = createMemo<Hit | null>(() => {
    const raw = query();
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(raw);
    if (!m) return null;
    const prefix = m[1]!.toLowerCase();
    const rest = m[2] ?? "";
    for (const p of providers().values()) {
      if (
        p.palettePrefix &&
        p.palettePrefix.toLowerCase() === prefix &&
        p.publishPaletteQuery
      ) {
        const trimmed = rest.trim();
        return {
          kind: "prefixSearch",
          providerKind: p.kind,
          providerLabel: p.label,
          providerIcon: p.icon,
          query: trimmed,
          label:
            trimmed.length > 0
              ? `Search ${p.label} for “${trimmed}”`
              : `Open ${p.label}`,
          hint: trimmed.length > 0 ? "↩ search" : "↩ open",
          publish: p.publishPaletteQuery,
        };
      }
    }
    return null;
  });

  const fuse = createMemo(() => {
    return new Fuse<Hit>(corpus(), {
      includeScore: false,
      threshold: 0.4,
      ignoreLocation: true,
      keys: [
        { name: "label", weight: 0.7 },
        { name: "providerLabel", weight: 0.2 },
        { name: "hint", weight: 0.1 },
      ],
    });
  });

  const results = createMemo<Hit[]>(() => {
    const q = query().trim();
    const synthetic = prefixHit();
    const base =
      q.length === 0
        ? corpus().slice(0, 50)
        : fuse()
            .search(q)
            .slice(0, 50)
            .map((r) => r.item);
    // Synthetic prefix-search hit always pinned to the top so the
    // intent ("rules: weaver" → run a rules search) is one Enter
    // away even if Fuse also surfaces partial matches for "weaver".
    return synthetic ? [synthetic, ...base] : base;
  });

  // Keep the cursor in range.
  const safeCursor = createMemo(() => {
    const len = results().length;
    if (len === 0) return 0;
    return Math.max(0, Math.min(cursor(), len - 1));
  });

  const reset = () => {
    setQuery("");
    setCursor(0);
  };

  // Reset and focus when open flips on.
  let prevOpen = false;
  const onTick = () => {
    if (props.open && !prevOpen) {
      reset();
      // Focus on next microtask so the input exists.
      queueMicrotask(() => inputEl?.focus());
    }
    prevOpen = props.open;
  };
  onMount(onTick);
  // Re-run when open changes — the simplest way is a memo whose body
  // touches `open` and whose fn we don't care about returning.
  createMemo(onTick);

  const dispatchOpen = (
    mode: "open" | "newTab" | "splitRight" | "splitBelow",
    pageKind: string,
    entityId: string | null,
  ): void => {
    // OpenPage's payload accepts `entityId: EntityId | null` — null
    // is the page-root case (Rules cross-corpus search, Books hub,
    // etc.). The substrate's command-pipeline schema treats the
    // field as nullable; we just pass it through.
    const payload = { pageKind, entityId } as {
      pageKind: string;
      entityId: string | null;
    };
    const cmd =
      mode === "newTab"
        ? OpenPageInNewTab(payload as never)
        : mode === "splitRight"
          ? OpenPageAsSplit({ ...payload, direction: "right" } as never)
          : mode === "splitBelow"
            ? OpenPageAsSplit({ ...payload, direction: "bottom" } as never)
            : OpenPage(payload as never);
    client.dispatch(cmd as never);
  };

  const choose = (mode: "open" | "newTab" | "splitRight" | "splitBelow") => {
    const list = results();
    const hit = list[safeCursor()];
    if (!hit) return;
    if (hit.kind === "page") {
      dispatchOpen(mode, hit.providerKind, hit.entityId);
    } else if (hit.kind === "prefixSearch") {
      // Publish first so the page-root view's `createEffect`
      // sees the pending query the moment it mounts (or, for an
      // already-open tab, on the next tick after focus). Then
      // dispatch OpenPage to focus / create the tab.
      if (hit.query.length > 0) hit.publish(hit.query);
      dispatchOpen(mode, hit.providerKind, null);
    } else {
      // command
      const c = commands().find((x) => x.id === hit.id);
      const m = me();
      if (c && m) {
        const out = c.run({ userId: m.userId, role: m.role });
        if (out) client.dispatch(out);
      }
    }
    props.onClose();
  };

  const onKey = (e: KeyboardEvent) => {
    if (!props.open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results().length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) choose("newTab");
      else choose("open");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
      e.preventDefault();
      choose("splitRight");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "-" || e.key === "_")) {
      e.preventDefault();
      choose("splitBelow");
      return;
    }
  };

  document.addEventListener("keydown", onKey);
  onCleanup(() => document.removeEventListener("keydown", onKey));

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] backdrop-blur-md"
        style={{ "background-color": "var(--color-scrim)" }}
        onClick={props.onClose}
      >
        <div
          class="w-full max-w-2xl overflow-hidden rounded-(--radius-card) border border-border bg-surface shadow-2xl ring-1 ring-black/20"
          onClick={(e) => e.stopPropagation()}
        >
          <header class="border-b border-border-muted px-5 py-4">
            <div class="flex items-baseline gap-3">
              <span
                aria-hidden
                class="font-mono text-base text-fg-subtle select-none"
              >
                ›
              </span>
              <input
                ref={inputEl}
                type="text"
                placeholder="search pages and commands…"
                value={query()}
                onInput={(e) => {
                  setQuery(e.currentTarget.value);
                  setCursor(0);
                }}
                autocomplete="off"
                spellcheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-bwignore="true"
                class="flex-1 bg-transparent font-display text-2xl text-fg outline-none placeholder:text-fg-subtle"
                style={{ "font-family": "var(--font-display)" }}
              />
            </div>
          </header>

          <div class="max-h-[50vh] overflow-y-auto py-1">
            <Show
              when={results().length > 0}
              fallback={
                <div class="px-5 py-8 text-center text-xs text-fg-subtle">
                  no matches
                </div>
              }
            >
              <ul role="listbox">
                <For each={results()}>
                  {(hit, i) => {
                    const active = createMemo(() => i() === safeCursor());
                    return (
                      <li
                        role="option"
                        class="relative flex cursor-pointer items-baseline gap-4 px-5 py-2.5 transition-colors"
                        classList={{
                          "bg-surface-elevated": active(),
                          "hover:bg-surface-elevated": !active(),
                        }}
                        onMouseEnter={() => setCursor(i())}
                        onClick={() => choose("open")}
                      >
                        <Show when={active()}>
                          <span
                            aria-hidden
                            class="absolute inset-y-1 left-0 w-[2px]"
                            style={{ "background-color": "var(--color-pane-edge)" }}
                          />
                        </Show>
                        <span
                          class="font-display text-[0.65rem] uppercase tracking-[0.16em] min-w-[5.5rem]"
                          classList={{
                            "text-fg-muted": hit.kind === "page",
                            "text-accent":
                              hit.kind === "prefixSearch",
                            "text-warning": hit.kind === "command",
                          }}
                        >
                          {hit.kind === "page" || hit.kind === "prefixSearch"
                            ? hit.providerLabel
                            : "command"}
                        </span>
                        <span class="flex-1 truncate text-sm text-fg">{hit.label}</span>
                        <Show when={hit.hint}>
                          <span class="hidden truncate text-[0.7rem] text-fg-subtle md:inline">
                            {hit.hint}
                          </span>
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </div>

          <footer class="flex items-center justify-between gap-2 border-t border-border-muted bg-surface-elevated px-5 py-2 text-[0.65rem] text-fg-subtle">
            <span class="flex items-center gap-3">
              <Hint k="↩">open</Hint>
              <Hint k="⌘↩">new tab</Hint>
              <Hint k="⌘\\">split right</Hint>
              <Hint k="⌘-">split below</Hint>
            </span>
            <Hint k="esc">close</Hint>
          </footer>
        </div>
      </div>
    </Show>
  );
}

function Hint(props: { k: string; children: JSX.Element }): JSX.Element {
  return (
    <span class="inline-flex items-center gap-1">
      <kbd class="rounded-(--radius-control) border border-border-muted bg-surface px-1.5 py-0.5 font-mono text-[0.6rem] text-fg-muted">
        {props.k}
      </kbd>
      <span>{props.children}</span>
    </span>
  );
}
