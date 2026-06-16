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

import { previewRollable, type EntityId } from "@vtt/substrate";
import { useClient } from "@vtt/substrate/client";
import { createMemo, For, Show, type JSX } from "solid-js";
import { Character } from "../shared/traits.js";
import {
  RollAtelierRailSlot,
  type RollAtelierRailAccessory,
  type ResolvedRollEntry,
} from "../shared/atelier.js";

interface RailPill {
  rollId: EntityId;
  rollableName: string;
  initiatorName: string;
  /** What's being rolled — ability/skill label ("Will", "Fighter", "Nature"). */
  sourceLabel: string;
  obstaclePreview: number | null;
  badge: "independent" | "versus" | "disposition";
  openedAt: number;
}

interface RailRow {
  id: EntityId;
  values: { PendingRoll: import("../shared/pending.js").PendingRollValue };
}

/** Cap the Recent list so a long session's roll history doesn't grow the
 * rail unbounded — the full log lives on the world; this is a shortlist. */
const RECENT_LIMIT = 40;

/**
 * Left rail. A "Pending rolls" section of pills (one per PendingRoll,
 * accessory slot fills mount under the selected pill) above a "Recent"
 * section of resolved-roll pills fed by `ResolvedRollFeedSlot`. Clicking
 * any pill writes `selectedRollId` via the parent's setter. The quick-roll
 * affordance opens the freeform dice composer in the right pane.
 */
export function RollAtelierRail(props: {
  rolls: RailRow[];
  resolved: ResolvedRollEntry[];
  selectedRollId: EntityId | null;
  onSelect: (rollId: EntityId) => void;
  onQuickRoll?: () => void;
  quickRollActive?: boolean;
}): JSX.Element {
  const client = useClient();

  const accessories = createMemo<RollAtelierRailAccessory[]>(() => {
    const fills = client.registry.fillsForSlot(RollAtelierRailSlot) as RollAtelierRailAccessory[];
    return [...fills].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  });

  const pills = createMemo<RailPill[]>(() => {
    return [...props.rolls]
      .sort((a, b) => a.values.PendingRoll.openedAt - b.values.PendingRoll.openedAt)
      .map((row) => {
        const v = row.values.PendingRoll;
        const char = client.world.get(v.initiatorCharacterId, [Character]) as
          | { Character: { name: string } }
          | undefined;
        const rollable = client.registry.rollables.get(v.rollableName);
        // Fallback: the rollable's short name ("will-check") when the
        // spec doesn't carry a friendlier source label.
        let sourceLabel = v.rollableName.split("/").pop() ?? v.rollableName;
        let obstaclePreview: number | null = null;
        let badge: RailPill["badge"] = "independent";
        if (rollable) {
          try {
            const raw = previewRollable(rollable, client.world, v.initiatorCharacterId, {
              ...(v.opts as Record<string, unknown>),
              contributions: v.contributions,
            }) as Record<string, unknown> | null;
            if (raw) {
              if (typeof raw.source === "string" && raw.source.length > 0) {
                sourceLabel = raw.source;
              }
              if (typeof raw.obstacle === "number") obstaclePreview = raw.obstacle;
              if (raw.dispositionMode === true) badge = "disposition";
              else if (raw.versusTestId) badge = "versus";
            }
          } catch {
            /* preview failed — leave pill bare */
          }
        }
        return {
          rollId: row.id,
          rollableName: v.rollableName,
          initiatorName: char?.Character.name ?? "(unknown)",
          sourceLabel,
          obstaclePreview,
          badge,
          openedAt: v.openedAt,
        };
      });
  });

  const recent = createMemo<ResolvedRollEntry[]>(() => props.resolved.slice(0, RECENT_LIMIT));

  return (
    <nav
      class="flex flex-col gap-2 border-r border-border bg-surface-sunken px-2 py-3"
      data-testid="atelier-rail"
    >
      <Show when={props.onQuickRoll}>
        <button
          type="button"
          class="flex items-center justify-center gap-1 rounded-(--radius-control) border px-2 py-1.5 text-[0.7rem] font-medium uppercase tracking-[0.12em] transition"
          classList={{
            "border-accent bg-accent/15 text-fg": props.quickRollActive,
            "border-border bg-surface text-fg-muted hover:border-accent hover:text-fg":
              !props.quickRollActive,
          }}
          onClick={() => props.onQuickRoll?.()}
          data-testid="atelier-quick-roll"
        >
          + Quick roll
        </button>
      </Show>

      <header class="flex items-baseline justify-between px-1">
        <h2 class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Pending rolls
        </h2>
        <span class="text-[0.6rem] text-fg-subtle">{pills().length}</span>
      </header>
      <For each={pills()}>
        {(p) => {
          const selected = () => props.selectedRollId === p.rollId;
          return (
            <div class="flex flex-col gap-1">
              <button
                type="button"
                class="flex flex-col gap-0.5 rounded-(--radius-control) border px-2 py-1.5 text-left transition"
                classList={{
                  "border-accent bg-accent/15 text-fg": selected(),
                  "border-border bg-surface text-fg-muted hover:border-accent hover:text-fg":
                    !selected(),
                }}
                onClick={() => props.onSelect(p.rollId)}
                data-testid={`atelier-rail-pill-${p.rollId}`}
                data-selected={selected()}
              >
                <span class="flex items-baseline justify-between gap-1">
                  <span class="truncate text-[0.7rem] font-medium">{p.initiatorName}</span>
                  <span class="text-[0.55rem] font-display uppercase tracking-[0.12em] text-fg-subtle">
                    {p.badge}
                  </span>
                </span>
                <span class="truncate font-mono text-[0.65rem] text-fg-subtle">
                  {p.sourceLabel}
                  <Show when={p.obstaclePreview !== null}>
                    <span> · Ob {p.obstaclePreview}</span>
                  </Show>
                </span>
              </button>
              <Show when={selected()}>
                <For each={accessories()}>
                  {(acc) => {
                    if (acc.rollablePrefix && !p.rollableName.startsWith(acc.rollablePrefix)) {
                      return null;
                    }
                    return acc.render({
                      rollId: p.rollId,
                      selected: true,
                    }) as JSX.Element;
                  }}
                </For>
              </Show>
            </div>
          );
        }}
      </For>

      <Show when={recent().length > 0}>
        <header class="mt-2 flex items-baseline justify-between px-1">
          <h2 class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
            Recent
          </h2>
          <span class="text-[0.6rem] text-fg-subtle">{recent().length}</span>
        </header>
        <For each={recent()}>
          {(e) => {
            const selected = () => props.selectedRollId === e.id;
            return (
              <button
                type="button"
                class="flex flex-col gap-0.5 rounded-(--radius-control) border px-2 py-1.5 text-left transition"
                classList={{
                  "border-accent bg-accent/15 text-fg": selected(),
                  "border-border bg-surface text-fg-muted hover:border-accent hover:text-fg":
                    !selected(),
                }}
                onClick={() => props.onSelect(e.id as EntityId)}
                title={e.subtitle}
                data-testid={`atelier-recent-pill-${e.id}`}
                data-selected={selected()}
              >
                <span class="flex items-baseline justify-between gap-1">
                  <span class="truncate text-[0.7rem] font-medium">{e.title}</span>
                  <Show when={e.subtitle}>
                    <span class="shrink-0 font-mono text-[0.55rem] text-fg-subtle">
                      {e.subtitle}
                    </span>
                  </Show>
                </span>
                <Show when={e.outcome}>
                  {(o) => (
                    <span
                      class="truncate text-[0.65rem] font-medium"
                      classList={{
                        "text-accent": o().tone === "success",
                        "text-danger": o().tone === "fail",
                        "text-fg-subtle": o().tone === "neutral",
                      }}
                      data-testid={`atelier-recent-outcome-${e.id}`}
                      data-tone={o().tone}
                    >
                      {o().text}
                    </span>
                  )}
                </Show>
              </button>
            );
          }}
        </For>
      </Show>
    </nav>
  );
}
