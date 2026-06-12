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

import { useQuery, useTrait } from "@vtt/substrate/client";
import {
  ChatTimelineContributorSlot,
  type ChatTimelineContributor,
  type ChatTimelineEntry,
} from "@vtt/comms/shared";
import {
  ResolvedRollFeedSlot,
  type ResolvedRollEntry,
  type ResolvedRollFeed,
} from "@vtt/characters/shared";
import { createMemo, Show, type Accessor } from "solid-js";
import { Formula, RollResult, RolledBy } from "../shared/traits.js";

/**
 * True for rolls no game system has claimed via `Formula.meta.system`.
 * Both the chat contributor and the Atelier feed render only these — a
 * system-claimed roll (TB) is rendered by that system's own row.
 */
function isUnclaimedRoll(formula: unknown): boolean {
  const meta = (formula as { meta?: unknown } | undefined)?.meta as
    | { system?: unknown }
    | undefined;
  return !meta || typeof meta !== "object" || typeof meta.system !== "string";
}

function originOf(formula: unknown): string | null {
  const meta = (formula as { meta?: unknown } | undefined)?.meta as
    | { originPendingRollId?: unknown }
    | undefined;
  return typeof meta?.originPendingRollId === "string"
    ? meta.originPendingRollId
    : null;
}

/**
 * Card body for a single resolved-roll entity. Identical visual shape
 * to the previous RollEntryView; rendered inline by the chat timeline
 * (no Surface fan-out anymore). System-claimed rolls (those with
 * `Formula.meta.system` set) are filtered out by the contributor
 * upstream so this default row is never asked to render them.
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
      rolls()
        // Game-system-claimed rolls (Formula.meta.system set) are
        // rendered by that system's contributor; skip them here so
        // chat doesn't show two rows for one roll.
        .filter((row) => isUnclaimedRoll(row.values.Formula))
        .map((row) => {
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

/**
 * Resolved-roll feed for the Roll Atelier. Surfaces every unclaimed Roll
 * entity as a "Recent" rail entry whose right-pane card reuses the same
 * `RollRow` the chat timeline used. The Atelier (in `@vtt/characters`)
 * can't read resolution's traits directly, so this feed is how plain `/r`
 * and quick rolls reach it.
 */
export const RollAtelierFeed: ResolvedRollFeed = {
  kind: "@vtt/resolution/roll",
  useEntries: () => {
    const rolls = useQuery([Formula, RollResult, RolledBy]);
    const accessor: Accessor<ResolvedRollEntry[]> = createMemo(() =>
      rolls()
        .filter((row) => isUnclaimedRoll(row.values.Formula))
        .map((row) => {
          const f = row.values.Formula as { notation: string };
          const r = row.values.RollResult as { rolledAt: number; total: number };
          const rb = row.values.RolledBy as { displayName: string };
          return {
            id: row.id,
            sortKey: r.rolledAt,
            title: rb.displayName,
            subtitle: `${f.notation} · ${r.total}`,
            originPendingRollId: originOf(row.values.Formula),
            render: () => <RollRow entityId={row.id} />,
          };
        }),
    );
    return accessor as unknown as () => ResolvedRollEntry[];
  },
};

export const RollAtelierFeedFills = {
  [ResolvedRollFeedSlot.name]: [RollAtelierFeed],
};
