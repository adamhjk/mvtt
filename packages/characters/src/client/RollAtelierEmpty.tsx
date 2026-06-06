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
 * Hub-style empty state for the Roll Atelier — shown when no PendingRoll
 * entities exist. Mirrors the calm-tone hub patterns in CharactersPage /
 * NotesPage so the surface doesn't feel broken when idle.
 */
export function RollAtelierEmpty(): JSX.Element {
  return (
    <section
      class="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center"
      data-testid="atelier-empty-state"
    >
      <p
        class="font-display text-2xl tracking-tight text-fg-muted"
        style={{ "font-family": "var(--font-display)" }}
      >
        No rolls in progress.
      </p>
      <p class="max-w-prose text-sm text-fg-subtle">
        Trigger a roll from a character sheet to start one. Every active
        pending roll lands here — yours, your party's, and the GM's.
      </p>
    </section>
  );
}
