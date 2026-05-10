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
  createEffect,
  createSignal,
  For,
  onMount,
  Show,
  type JSX,
} from "solid-js";

export type MobileMode = "character" | "chat";

export type NavTab = {
  id: string;
  label: string;
  icon?: JSX.Element;
  badge?: boolean;
};

/**
 * Bottom navigation bar with horizontally scrollable tabs.
 *
 * Renders tabs in a scrollable segmented control. When tabs overflow
 * the container, subtle fade indicators appear on the edges that have
 * more content. The active tab auto-scrolls into view on change.
 */
export function MobileNav(props: {
  tabs: NavTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
}): JSX.Element {
  let scrollRef: HTMLDivElement | undefined;
  const [showLeftFade, setShowLeftFade] = createSignal(false);
  const [showRightFade, setShowRightFade] = createSignal(false);

  const updateFades = () => {
    if (!scrollRef) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef;
    setShowLeftFade(scrollLeft > 4);
    setShowRightFade(scrollLeft + clientWidth < scrollWidth - 4);
  };

  onMount(updateFades);

  // Auto-scroll active tab into view when it changes
  createEffect(() => {
    const activeId = props.activeTab;
    if (!scrollRef) return;
    const el = scrollRef.querySelector(
      `[data-tab-id="${activeId}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  });

  return (
    <nav
      class="flex shrink-0 items-center justify-center border-t border-border bg-surface px-4 py-2"
      style={{
        "padding-bottom": "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div class="relative w-full max-w-xs">
        {/* Left fade indicator */}
        <Show when={showLeftFade()}>
          <div
            class="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 rounded-l-(--radius-card)"
            style={{
              background:
                "linear-gradient(to right, var(--color-surface-sunken), transparent)",
            }}
            data-testid="nav-fade-left"
          />
        </Show>

        {/* Scrollable tab container */}
        <div
          ref={scrollRef}
          class="mobile-nav-scroll flex rounded-(--radius-card) border border-border bg-surface-sunken p-1 overflow-x-auto"
          style={{
            "-webkit-overflow-scrolling": "touch",
            "scrollbar-width": "none",
          }}
          onScroll={updateFades}
          data-testid="nav-scroll-container"
        >
          <For each={props.tabs}>
            {(tab) => (
              <button
                type="button"
                data-tab-id={tab.id}
                onClick={() => props.onTabChange(tab.id)}
                class="relative flex shrink-0 flex-1 items-center justify-center gap-2 rounded-(--radius-control) px-4 py-2 text-sm font-medium transition"
                classList={{
                  "bg-surface-elevated text-fg shadow-sm":
                    props.activeTab === tab.id,
                  "text-fg-muted hover:text-fg": props.activeTab !== tab.id,
                }}
                aria-pressed={props.activeTab === tab.id}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {/* Badge indicator */}
                <Show when={tab.badge}>
                  <span
                    class="absolute right-3 top-1.5 h-2.5 w-2.5 rounded-full bg-accent"
                    style={{
                      animation: "mobile-shell-pulse 2s ease-in-out infinite",
                    }}
                    aria-label="Badge active"
                  />
                </Show>
              </button>
            )}
          </For>
        </div>

        {/* Right fade indicator */}
        <Show when={showRightFade()}>
          <div
            class="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 rounded-r-(--radius-card)"
            style={{
              background:
                "linear-gradient(to left, var(--color-surface-sunken), transparent)",
            }}
            data-testid="nav-fade-right"
          />
        </Show>
      </div>
    </nav>
  );
}
