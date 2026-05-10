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

import { Show, type JSX } from "solid-js";
import { setShellPreference } from "./detect.js";

/**
 * Slide-over menu from the left. Contains layout switcher and user
 * info. WorldPicker is mounted by the caller (since it comes from
 * shell-workbench and the import is handled at the shell level).
 */
export function MobileMenu(props: {
  open: boolean;
  onClose: () => void;
  userName: string;
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
