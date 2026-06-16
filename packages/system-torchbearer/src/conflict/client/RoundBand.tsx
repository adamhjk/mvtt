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

import type { EntityId } from "@vtt/substrate";
import { For, Show, type JSX } from "solid-js";
import type { ConflictSide, ScriptSlot } from "../shared/index.js";
import { useScript, type ConflictView } from "./hooks.js";
import { ACTION_COLORS, ACTION_LETTERS } from "./styles.js";

interface RoundBandProps {
  readonly conflict: ConflictView;
  /**
   * Which side's slots can the viewer see contents of? `null` means
   * spectator (sees only locked count and revealed slots).
   */
  readonly viewerSide: ConflictSide | null;
}

export function RoundBand(props: RoundBandProps): JSX.Element {
  return (
    <section class="px-3 py-3 flex flex-col gap-3" data-testid="round-band">
      <h2 class="font-display text-[0.7rem] uppercase tracking-[0.16em] text-fg-subtle">
        ROUND {props.conflict.round}
      </h2>
      <ScriptRow
        conflictId={props.conflict.id}
        side="party"
        viewerSide={props.viewerSide}
        label="captain"
      />
      <ScriptRow
        conflictId={props.conflict.id}
        side="enemy"
        viewerSide={props.viewerSide}
        label="GM"
      />
    </section>
  );
}

function ScriptRow(props: {
  conflictId: EntityId;
  side: ConflictSide;
  viewerSide: ConflictSide | null;
  label: string;
}): JSX.Element {
  const script = useScript(props.conflictId, props.side);
  const isOwn = (): boolean => props.viewerSide === props.side;
  const isLocked = (): boolean => script()?.locked ?? false;
  return (
    <div data-testid={`script-row-${props.side}`}>
      <div class="flex items-baseline gap-3 mb-1">
        <span class="font-display text-xs uppercase tracking-wider w-16 text-fg-subtle">
          {props.label}
        </span>
        <span class="flex gap-2">
          <For each={[0, 1, 2]}>
            {(i) => (
              <SlotChip
                slot={(script()?.slots[i] ?? { status: "empty" }) as ScriptSlot}
                visible={isOwn() || script()?.slots[i]?.status === "revealed"}
              />
            )}
          </For>
        </span>
        <Show when={isLocked()}>
          <span
            class="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-fg-subtle"
            data-testid={`locked-${props.side}`}
          >
            locked
          </span>
        </Show>
      </div>
    </div>
  );
}

function SlotChip(props: { slot: ScriptSlot; visible: boolean }): JSX.Element {
  const showRevealed = (): boolean => props.slot.status === "revealed";
  const showFilledOwn = (): boolean => props.visible && props.slot.status === "filled";
  const action = (): string | null => {
    if (props.slot.status === "filled" || props.slot.status === "revealed") {
      return props.slot.action;
    }
    return null;
  };
  // The four action chip colors are load-bearing for play (they're
  // the same red/blue/purple/green players see across every action
  // surface), so we keep them as inline styles. Everything else uses
  // design-token classes.
  const a = action() as keyof typeof ACTION_COLORS | null;
  return (
    <span
      data-testid={`slot-chip-${props.slot.status}`}
      class="inline-flex items-center justify-center w-7 h-7 rounded-sm font-display font-bold text-sm transition-colors"
      classList={{
        "border border-border-muted bg-surface-elevated text-fg-subtle":
          !showRevealed() && !showFilledOwn(),
        "border border-dotted bg-surface-elevated": showFilledOwn() && !showRevealed(),
        "border-2": showRevealed(),
      }}
      style={
        a
          ? showRevealed()
            ? {
                "background-color": ACTION_COLORS[a],
                color: "white",
                "border-color": ACTION_COLORS[a],
              }
            : showFilledOwn()
              ? {
                  color: ACTION_COLORS[a],
                  "border-color": ACTION_COLORS[a],
                }
              : undefined
          : undefined
      }
    >
      {showRevealed() || showFilledOwn() ? ACTION_LETTERS[a as keyof typeof ACTION_LETTERS] : "?"}
    </span>
  );
}
