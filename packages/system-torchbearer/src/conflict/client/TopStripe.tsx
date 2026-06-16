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

import type { CommandInstance, EntityId } from "@vtt/substrate";
import { useClient } from "@vtt/substrate/client";
import { Show, type JSX } from "solid-js";
import { EndConflict, TB_CONFLICT_TYPES, type ConflictType } from "../shared/index.js";
import { useConflict } from "./hooks.js";
import { useMe } from "./use-me.js";

/**
 * Slim header: type + location + round counter + GM-only "End
 * conflict" button. Subscribes to the conflict trait directly so
 * round changes propagate.
 */
export function TopStripe(props: { conflictId: EntityId }): JSX.Element {
  const client = useClient();
  const conflict = useConflict(props.conflictId);
  const me = useMe();
  const isGm = (): boolean => me()?.role === "gm";
  const typeDef = (): { label: string; summary: string } => {
    const c = conflict();
    if (!c) return { label: "", summary: "" };
    return TB_CONFLICT_TYPES[c.type as ConflictType];
  };
  const endConflict = (): void => {
    if (!window.confirm("End this conflict?")) return;
    client.dispatch(EndConflict({ conflictId: props.conflictId }) as CommandInstance);
  };
  return (
    <header
      class="border-b border-border-muted px-5 py-3 bg-surface-elevated"
      data-testid="conflict-top-stripe"
    >
      <div class="flex items-baseline justify-between gap-4">
        <h1
          class="font-display text-lg tracking-tight text-fg"
          style={{ "font-family": "var(--font-display)" }}
        >
          <span class="uppercase">{typeDef().label}</span>
          <Show when={conflict()?.locationLabel}>
            <span class="text-fg-subtle"> · </span>
            <span class="font-display text-base font-normal text-fg-muted">
              {conflict()?.locationLabel}
            </span>
          </Show>
        </h1>
        <span class="flex items-center gap-3">
          <span class="font-mono text-xs text-fg-subtle" data-testid="conflict-round-counter">
            round {conflict()?.round ?? 1} · {Math.min(conflict()?.revealIndex ?? 0, 3)}/3 revealed
            <Show when={conflict()?.winner}>
              {" · "}
              <span class="text-accent uppercase tracking-wider">{conflict()?.winner} won</span>
            </Show>
          </span>
          <Show when={isGm() && conflict()?.endedAt === null}>
            <button
              type="button"
              onClick={endConflict}
              data-testid="end-conflict"
              class="rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-xs text-fg-muted hover:border-danger hover:text-danger transition"
            >
              End conflict
            </button>
          </Show>
        </span>
      </div>
      <p class="mt-0.5 text-xs text-fg-subtle">{typeDef().summary}</p>
    </header>
  );
}
