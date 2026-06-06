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
import { PendingRoll } from "../shared/pending.js";
import {
  RollAtelierRailSlot,
  type RollAtelierRailAccessory,
} from "../shared/atelier.js";

interface RailPill {
  rollId: EntityId;
  rollableName: string;
  initiatorName: string;
  poolPreview: number | null;
  obstaclePreview: number | null;
  badge: "independent" | "versus" | "disposition";
  openedAt: number;
}

interface RailRow {
  id: EntityId;
  values: { PendingRoll: import("../shared/pending.js").PendingRollValue };
}

/**
 * Left rail of pills, one per PendingRoll entity. Sorts by `openedAt`.
 * Clicking a pill writes `selectedRollId` via the parent's setter; the
 * accessory slot fills mount under the selected pill so system-specific
 * sympathetic UI (TB versus shadow, conflict cluster) lights up.
 */
export function RollAtelierRail(props: {
  rolls: RailRow[];
  selectedRollId: EntityId | null;
  onSelect: (rollId: EntityId) => void;
}): JSX.Element {
  const client = useClient();

  const accessories = createMemo<RollAtelierRailAccessory[]>(() => {
    const fills = client.registry.fillsForSlot(
      RollAtelierRailSlot,
    ) as RollAtelierRailAccessory[];
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
        let poolPreview: number | null = null;
        let obstaclePreview: number | null = null;
        let badge: RailPill["badge"] = "independent";
        if (rollable) {
          try {
            const raw = previewRollable(
              rollable,
              client.world,
              v.initiatorCharacterId,
              {
                ...(v.opts as Record<string, unknown>),
                contributions: v.contributions,
              },
            ) as Record<string, unknown> | null;
            if (raw) {
              if (typeof raw.pool === "number") poolPreview = raw.pool;
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
          poolPreview,
          obstaclePreview,
          badge,
          openedAt: v.openedAt,
        };
      });
  });

  return (
    <nav
      class="flex flex-col gap-2 border-r border-border bg-surface-sunken px-2 py-3"
      data-testid="atelier-rail"
    >
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
                  <span class="truncate text-[0.7rem] font-medium">
                    {p.initiatorName}
                  </span>
                  <span class="text-[0.55rem] font-display uppercase tracking-[0.12em] text-fg-subtle">
                    {p.badge}
                  </span>
                </span>
                <span class="font-mono text-[0.65rem] text-fg-subtle">
                  {p.poolPreview ?? "?"}D
                  <Show when={p.obstaclePreview !== null}>
                    <span> · Ob {p.obstaclePreview}</span>
                  </Show>
                </span>
              </button>
              <Show when={selected()}>
                <For each={accessories()}>
                  {(acc) => {
                    if (
                      acc.rollablePrefix &&
                      !p.rollableName.startsWith(acc.rollablePrefix)
                    ) {
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
    </nav>
  );
}
