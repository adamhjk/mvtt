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

export type MobileMode = "character" | "chat";

/**
 * Bottom segmented control — two segments for Character and Chat.
 * `hasPendingRoll` shows a pulsing accent dot on the chat segment
 * to draw attention to an active roll.
 */
export function MobileNav(props: {
  mode: MobileMode;
  onModeChange: (mode: MobileMode) => void;
  hasPendingRoll: boolean;
}): JSX.Element {
  return (
    <nav
      class="flex shrink-0 items-center justify-center border-t border-border bg-surface px-4 py-2"
      style={{ "padding-bottom": "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <div class="flex w-full max-w-xs rounded-(--radius-card) border border-border bg-surface-sunken p-1">
        <button
          type="button"
          onClick={() => props.onModeChange("character")}
          class="flex flex-1 items-center justify-center gap-2 rounded-(--radius-control) px-4 py-2 text-sm font-medium transition"
          classList={{
            "bg-surface-elevated text-fg shadow-sm": props.mode === "character",
            "text-fg-muted hover:text-fg": props.mode !== "character",
          }}
          aria-pressed={props.mode === "character"}
        >
          {/* Person icon */}
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0H3z" />
          </svg>
          <span>Character</span>
        </button>
        <button
          type="button"
          onClick={() => props.onModeChange("chat")}
          class="relative flex flex-1 items-center justify-center gap-2 rounded-(--radius-control) px-4 py-2 text-sm font-medium transition"
          classList={{
            "bg-surface-elevated text-fg shadow-sm": props.mode === "chat",
            "text-fg-muted hover:text-fg": props.mode !== "chat",
          }}
          aria-pressed={props.mode === "chat"}
        >
          {/* Chat bubble icon */}
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path
              fill-rule="evenodd"
              d="M18 10c0 3.866-3.582 7-8 7a8.84 8.84 0 01-3.9-.9L2 18l1.338-3.123C2.493 13.587 2 12.33 2 11c0-3.866 3.582-7 8-7s8 3.134 8 7z"
              clip-rule="evenodd"
            />
          </svg>
          <span>Chat</span>
          {/* Pending roll indicator */}
          <Show when={props.hasPendingRoll}>
            <span
              class="absolute right-3 top-1.5 h-2.5 w-2.5 rounded-full bg-accent"
              style={{ animation: "mobile-shell-pulse 2s ease-in-out infinite" }}
              aria-label="Pending roll active"
            />
          </Show>
        </button>
      </div>
    </nav>
  );
}
