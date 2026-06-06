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
import type { AtelierState } from "../use-atelier.js";

type Mode = "independent" | "versus" | "disposition";

/**
 * Commit + cancel buttons. Both are visible only to the initiator or to
 * the GM (mirrors PendingRollPanel's gating). Commit invokes the
 * rollable + dispatches the result + CommitPendingRoll; Cancel dispatches
 * CancelPendingRoll.
 */
export function FooterActions(props: {
  atelier: AtelierState;
  mode: Mode;
}): JSX.Element {
  return (
    <Show when={props.atelier.canCommit()}>
      <footer
        class="flex items-center justify-end gap-2 border-t border-border pt-2"
        data-testid="atelier-footer"
      >
        <Show when={props.mode === "versus"}>
          <span class="text-[0.6rem] text-fg-subtle italic">
            paired roll — both sides commit independently
          </span>
        </Show>
        <Show when={props.mode === "disposition"}>
          <span class="text-[0.6rem] text-fg-subtle italic">
            result becomes conflict HP
          </span>
        </Show>
        <button
          type="button"
          class="rounded-(--radius-control) border border-border bg-surface px-3 py-1 text-xs text-fg-subtle hover:border-danger hover:text-danger transition"
          onClick={() => props.atelier.cancel()}
          data-testid="atelier-cancel"
        >
          cancel
        </button>
        <button
          type="button"
          class="rounded-(--radius-control) bg-accent px-4 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover transition"
          onClick={() => props.atelier.commit()}
          data-testid="atelier-commit"
        >
          Roll
        </button>
      </footer>
    </Show>
  );
}
