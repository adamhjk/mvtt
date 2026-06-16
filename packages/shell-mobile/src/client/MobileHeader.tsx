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

import type { JSX } from "solid-js";

/**
 * Simplified mobile header — logo + hamburger trigger.
 */
export function MobileHeader(props: { onMenuOpen: () => void }): JSX.Element {
  return (
    <header class="flex items-center justify-between border-b border-border bg-surface px-4 py-2.5">
      <h1
        class="font-display text-base font-semibold tracking-tight text-fg"
        style={{ "font-family": "var(--font-display)" }}
      >
        mvtt
      </h1>
      <button
        type="button"
        onClick={() => props.onMenuOpen()}
        class="inline-flex h-9 w-9 items-center justify-center rounded-(--radius-control) text-fg-muted hover:bg-surface-elevated hover:text-fg transition"
        aria-label="Open menu"
      >
        {/* Three-bar hamburger icon */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        >
          <line x1="3" y1="5" x2="17" y2="5" />
          <line x1="3" y1="10" x2="17" y2="10" />
          <line x1="3" y1="15" x2="17" y2="15" />
        </svg>
      </button>
    </header>
  );
}
