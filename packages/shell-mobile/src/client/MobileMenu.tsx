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

import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { useClient, useQuery } from "@vtt/substrate/client";
import { usePageProviders, useMe } from "@vtt/shell-workbench/client";
import type { PageEntity, PageProvider } from "@vtt/shell-workbench/shared";
import { setShellPreference } from "./detect.js";

/**
 * Slide-over menu from the left. Contains:
 *   - a user-info chip
 *   - the navigation list: every registered PageProvider with its
 *     entities (characters, books, rules, notes, …). Tapping an
 *     entity calls `navigate(pageKind, entityId)`, which dispatches
 *     OpenPage and switches the content panel to that page. Tapping
 *     the provider header itself opens the management hub (empty-
 *     entity branch) when the provider supports it.
 *   - plugin-supplied extras (e.g. WorldPicker) via `children`
 *   - "Switch to desktop layout" at the bottom
 */
export function MobileMenu(props: {
  open: boolean;
  onClose: () => void;
  userName: string;
  navigate: (pageKind: string, entityId: string | null) => void;
  children?: JSX.Element;
}): JSX.Element {
  const switchToDesktop = () => {
    setShellPreference("desktop");
    window.location.reload();
  };

  return (
    <Show when={props.open}>
      {/* Scrim */}
      <div
        class="fixed inset-0 z-50"
        style={{ "background-color": "var(--color-scrim)" }}
        onClick={() => props.onClose()}
      />
      {/* Panel */}
      <div class="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-surface shadow-xl">
        <header class="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            class="font-display text-sm font-semibold tracking-tight text-fg"
            style={{ "font-family": "var(--font-display)" }}
          >
            mvtt
          </h2>
          <button
            type="button"
            onClick={() => props.onClose()}
            class="inline-flex h-8 w-8 items-center justify-center rounded-(--radius-control) text-fg-muted hover:text-fg transition"
            aria-label="Close menu"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            >
              <line x1="5" y1="5" x2="15" y2="15" />
              <line x1="15" y1="5" x2="5" y2="15" />
            </svg>
          </button>
        </header>

        <div class="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {/* User info */}
          <div class="flex items-center gap-2 text-sm text-fg-muted">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0H3z" />
            </svg>
            <span>{props.userName || "Player"}</span>
          </div>

          {/* Pages navigation — one collapsible section per registered
              PageProvider. The list of entities comes from the
              provider's `list(ctx)` call, which is the same source
              the workbench's palette / tab picker reads from. */}
          <PagesNav onNavigate={props.navigate} />

          {/* Plugin-supplied menu content (e.g. WorldPicker) */}
          {props.children}

          {/* Layout switch */}
          <div class="mt-auto border-t border-border-muted pt-4">
            <button
              type="button"
              onClick={switchToDesktop}
              class="flex w-full items-center gap-2 rounded-(--radius-control) border border-border bg-surface-elevated px-3 py-2 text-xs text-fg-muted hover:border-accent hover:text-fg transition"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <rect x="2" y="3" width="16" height="11" rx="1" />
                <line x1="6" y1="17" x2="14" y2="17" />
                <line x1="10" y1="14" x2="10" y2="17" />
              </svg>
              <span>Switch to desktop layout</span>
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

/**
 * Renders every registered PageProvider as a collapsible group, each
 * filled with the provider's listable entities. Tapping the provider
 * header expands the section; tapping an entity navigates to that
 * page. Same data path as the workbench's picker / palette, so plugins
 * don't need a mobile-specific surface to be reachable here.
 */
function PagesNav(props: {
  onNavigate: (pageKind: string, entityId: string | null) => void;
}): JSX.Element {
  const client = useClient();
  const providers = usePageProviders();
  const me = useMe();

  // Sort providers by their label so the menu is alphabetical and
  // stable regardless of registration order. Filter out providers
  // that need a `me` context but the user isn't resolved yet —
  // they'll appear after Identity/Online land.
  const orderedProviders = createMemo<PageProvider[]>(() => {
    return Array.from(providers().values()).sort((a, b) => a.label.localeCompare(b.label));
  });

  return (
    <nav class="flex flex-col gap-1" aria-label="Pages">
      <h3 class="font-display text-[0.65rem] uppercase tracking-[0.16em] text-fg-subtle">Pages</h3>
      <For each={orderedProviders()}>
        {(provider) => (
          <ProviderSection
            provider={provider}
            ctxAccessor={() => {
              const m = me();
              return m
                ? {
                    world: client.world,
                    registry: client.registry,
                    userId: m.userId,
                    role: m.role,
                  }
                : null;
            }}
            onNavigate={props.onNavigate}
          />
        )}
      </For>
    </nav>
  );
}

function ProviderSection(props: {
  provider: PageProvider;
  ctxAccessor: () => {
    world: import("@vtt/substrate").World;
    registry: import("@vtt/substrate").Registry;
    userId: string;
    role: string;
  } | null;
  onNavigate: (pageKind: string, entityId: string | null) => void;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);

  // The provider's `list` reads world state — re-derive whenever an
  // entity matching the provider's declared trait set changes. The
  // workbench's pane uses the same trick: subscribe to the trait set
  // the provider declared via `reads`, then re-run `list` on every
  // mutation that affects those traits. Without this, the menu
  // wouldn't refresh when characters / books / notes are added.
  const watcher = useQuery(props.provider.reads);

  const entities = createMemo<readonly PageEntity[]>(() => {
    // Touch the watcher so this memo re-runs on trait changes.
    void watcher();
    const ctx = props.ctxAccessor();
    if (!ctx) return [];
    try {
      return props.provider.list(ctx);
    } catch {
      return [];
    }
  });

  return (
    <div class="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        class="flex w-full items-center justify-between rounded-(--radius-control) px-2 py-1.5 text-sm text-fg hover:bg-surface-elevated transition"
        aria-expanded={expanded()}
      >
        <span class="flex items-center gap-2">
          <span aria-hidden class="text-fg-subtle">
            ›
          </span>
          <span>{props.provider.label}</span>
          <span class="text-[0.65rem] text-fg-subtle">({entities().length})</span>
        </span>
        <span
          aria-hidden
          class="text-fg-subtle transition-transform"
          style={{
            transform: expanded() ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          ›
        </span>
      </button>
      <Show when={expanded()}>
        <div class="flex flex-col gap-0.5 pb-1 pl-5">
          {/* Hub entry — open the provider with null entityId so the
              user lands on the management view (create form, list,
              etc.) instead of a specific entity. */}
          <button
            type="button"
            onClick={() => props.onNavigate(props.provider.kind, null)}
            class="rounded-(--radius-control) px-2 py-1 text-left text-xs text-fg-muted hover:bg-surface-elevated hover:text-fg transition"
          >
            All {props.provider.label.toLowerCase()}…
          </button>
          <For each={entities()}>
            {(entity) => (
              <button
                type="button"
                onClick={() => props.onNavigate(props.provider.kind, entity.id)}
                class="rounded-(--radius-control) px-2 py-1 text-left text-sm text-fg hover:bg-surface-elevated transition"
              >
                {entity.label}
              </button>
            )}
          </For>
          <Show when={entities().length === 0}>
            <p class="px-2 py-1 text-xs text-fg-subtle italic">none yet</p>
          </Show>
        </div>
      </Show>
    </div>
  );
}
