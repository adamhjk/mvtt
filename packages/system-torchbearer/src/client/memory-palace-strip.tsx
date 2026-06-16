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

// Memory-palace slot strip — visualises the magician's slot capacity
// and what's currently memorized, with circle-sized tiles spanning
// the right number of slots. Mirrors the inventory page's body-slot
// strip metaphor so players learn one concept and see it everywhere.

import { useTrait } from "@vtt/substrate/client";
import { createMemo, For, Show, type JSX } from "solid-js";
import { SpellIdentity, TbMemoryPalace } from "../shared/spells/spell-traits.js";

/**
 * Resolve the i-th memorized entry into an inline display block.
 * Each tile spans `slotsConsumed` cells; cast tiles render greyed.
 */
function MemorizedTile(props: {
  spellId: string;
  slotsConsumed: number;
  cast: boolean;
}): JSX.Element {
  const identity = useTrait(props.spellId, SpellIdentity);
  const name = createMemo(() => identity()?.name ?? "Unknown");
  return (
    <div
      data-testid={`palace-tile-${props.spellId}`}
      style={{
        "grid-column": `span ${props.slotsConsumed}`,
        background: props.cast ? "var(--color-surface-sunken)" : "var(--color-accent-soft)",
        border: props.cast
          ? "1px dashed var(--color-border-muted)"
          : "1px solid var(--color-accent)",
        "border-radius": "var(--radius-control)",
        padding: "0.35rem 0.5rem",
        "font-size": "0.75rem",
        "font-weight": "500",
        color: props.cast ? "var(--color-fg-muted)" : "var(--color-fg)",
        "text-decoration": props.cast ? "line-through" : "none",
        opacity: props.cast ? 0.7 : 1,
        display: "flex",
        "align-items": "center",
        gap: "0.4rem",
        "min-width": 0,
        overflow: "hidden",
        "white-space": "nowrap",
        "text-overflow": "ellipsis",
      }}
      title={name()}
    >
      <span>{name()}</span>
      <Show when={props.cast}>
        <span style={{ "font-size": "0.65rem" }}>(cast)</span>
      </Show>
    </div>
  );
}

/**
 * Strip-style memory palace visualisation. Renders one cell per slot
 * in capacity, with memorized spells occupying contiguous spans
 * scaled to their circle.
 */
export function MemoryPalaceStrip(props: { characterId: string }): JSX.Element {
  const palace = useTrait(props.characterId, TbMemoryPalace);
  const capacity = createMemo(() => palace()?.capacity ?? 0);
  const memorized = createMemo(() => palace()?.memorized ?? []);
  const usedSlots = createMemo(() => memorized().reduce((acc, m) => acc + m.slotsConsumed, 0));
  const freeSlots = createMemo(() => Math.max(0, capacity() - usedSlots()));

  return (
    <div
      data-testid="memory-palace-strip"
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.4rem",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "0.5rem",
          "font-size": "0.75rem",
          color: "var(--color-fg-muted)",
        }}
      >
        <span>
          Memory palace: {usedSlots()} / {capacity()} slots used
        </span>
      </div>
      <Show
        when={capacity() > 0}
        fallback={
          <p
            style={{
              "font-size": "0.8rem",
              color: "var(--color-fg-muted)",
              "font-style": "italic",
              margin: 0,
            }}
          >
            no memory palace capacity yet — set one via [Set capacity] or a class level benefit (DH
            p.115).
          </p>
        }
      >
        <div
          style={{
            display: "grid",
            "grid-template-columns": `repeat(${capacity()}, minmax(7rem, 1fr))`,
            gap: "0.35rem",
            "min-height": "2.5rem",
          }}
        >
          <For each={memorized()}>
            {(m) => (
              <MemorizedTile spellId={m.spellId} slotsConsumed={m.slotsConsumed} cast={m.cast} />
            )}
          </For>
          <For each={Array.from({ length: freeSlots() })}>
            {(_, i) => (
              <div
                data-testid={`palace-empty-${i()}`}
                style={{
                  "grid-column": "span 1",
                  background: "var(--color-surface-sunken)",
                  border: "1px dashed var(--color-border-muted)",
                  "border-radius": "var(--radius-control)",
                  "min-height": "2.5rem",
                }}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
