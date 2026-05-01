// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { useQuery, useTrait } from "@vtt/substrate/client";
import {
  ChatTimelineContributorSlot,
  type ChatTimelineContributor,
  type ChatTimelineEntry,
} from "@vtt/comms/shared";
import { createMemo, Show, type Accessor } from "solid-js";
import { Formula, RollResult, RolledBy } from "../shared/traits.js";

/**
 * Card body for a single resolved-roll entity. Identical visual shape
 * to the previous RollEntryView; rendered inline by the chat timeline
 * (no Surface fan-out anymore).
 */
function RollRow(props: { entityId: string }) {
  const formula = useTrait(props.entityId, Formula);
  const result = useTrait(props.entityId, RollResult);
  const rolledBy = useTrait(props.entityId, RolledBy);
  return (
    <Show when={formula() && result() && rolledBy()}>
      <article class="rounded-(--radius-card) border border-border-muted bg-surface-elevated p-3">
        <header class="flex items-baseline justify-between gap-2">
          <span class="text-xs text-fg-muted">
            <span class="text-fg">{rolledBy()!.displayName}</span>{" "}
            <span class="text-fg-subtle">rolled</span>{" "}
            <code class="font-mono text-fg-muted">{formula()!.notation}</code>
          </span>
          <strong class="font-mono text-base text-accent">
            {result()!.total}
          </strong>
        </header>
        <Show when={formula()!.reason}>
          {/* Reason can be arbitrarily long (a stat-check label might
              accumulate many help/modifier breakdowns). CSS truncates to
              one line; hover shows the full text. */}
          <p
            class="mt-1 truncate text-[11px] text-fg-muted"
            title={formula()!.reason}
          >
            {formula()!.reason}
          </p>
        </Show>
        <p
          class="mt-1 truncate font-mono text-[11px] text-fg-subtle"
          title={result()!.output}
        >
          {result()!.output}
        </p>
      </article>
    </Show>
  );
}

/**
 * Plugin-resolution's chat-timeline contribution. Surfaces every Roll
 * entity (Formula + RollResult + RolledBy) as a row in the unified
 * chat stream, sorted by `RollResult.rolledAt` so it interleaves
 * chronologically with `ChatMessage` entries.
 *
 * The plugin no longer ships any standalone UI of its own — the chat
 * composer's `/r` slash handler is the input path; this contributor
 * is the output path.
 */
export const RollTimelineContributor: ChatTimelineContributor = {
  kind: "@vtt/resolution/roll",
  useEntries: () => {
    const rolls = useQuery([Formula, RollResult, RolledBy]);
    const accessor: Accessor<ChatTimelineEntry[]> = createMemo(() =>
      rolls().map((row) => {
        const r = row.values.RollResult as { rolledAt: number };
        return {
          id: row.id,
          sortKey: r.rolledAt,
          render: () => <RollRow entityId={row.id} />,
        };
      }),
    );
    // Cast through unknown to satisfy the loose `() => () => Entry[]`
    // shape declared in shared/ (shared/ doesn't import solid-js so it
    // can't reference Accessor directly). At call-time the chat stream
    // re-asserts the Accessor type.
    return accessor as unknown as () => ChatTimelineEntry[];
  },
};

/**
 * Manifest fill keyed by the qualified slot name so the substrate can
 * validate it against the slot schema declared by comms.
 */
export const RollTimelineFills = {
  [ChatTimelineContributorSlot.name]: [RollTimelineContributor],
};
