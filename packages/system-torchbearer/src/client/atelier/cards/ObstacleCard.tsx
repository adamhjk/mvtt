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

import { For, Show, type JSX } from "solid-js";
import type { AtelierState } from "../use-atelier.js";

const OBSTACLE_VALUES: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Pip strip (Ob 1–10) + heroic on/off + +1s bonus successes row. The pip
 * strip is the same toggle semantics as the old contributor: clicking the
 * active value clears it; clicking another switches.
 *
 * Mounts only in the Independent variant — versus and disposition swap
 * this card for their own (OpponentCard / ResultCard).
 */
export function ObstacleCard(props: { atelier: AtelierState }): JSX.Element {
  return (
    <section
      class="flex flex-col gap-2 rounded-(--radius-card) border border-border bg-surface p-3"
      data-testid="atelier-obstacle-card"
    >
      <div class="flex items-center justify-between">
        <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Obstacle
        </span>
        <Show when={props.atelier.activeObstacle() === null}>
          <span class="text-[0.6rem] text-fg-subtle">any success passes</span>
        </Show>
      </div>
      <div class="flex flex-wrap gap-1" role="radiogroup" aria-label="Obstacle">
        <For each={OBSTACLE_VALUES}>
          {(n) => (
            <button
              type="button"
              role="radio"
              aria-checked={props.atelier.activeObstacle() === n}
              class="inline-flex h-7 w-7 items-center justify-center rounded-(--radius-control) border font-mono text-[0.75rem] transition"
              classList={{
                "border-accent bg-accent text-accent-fg": props.atelier.activeObstacle() === n,
                "border-border bg-surface-elevated text-fg-muted hover:border-accent hover:text-fg":
                  props.atelier.activeObstacle() !== n,
              }}
              onClick={() => props.atelier.pickObstacle(n)}
              title={
                props.atelier.activeObstacle() === n ? `Click to clear Ob ${n}` : `Set Ob ${n}`
              }
              data-testid={`atelier-obstacle-pip-${n}`}
            >
              {n}
            </button>
          )}
        </For>
      </div>

      <div class="flex items-center gap-1 border-t border-border-muted pt-2">
        <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Heroic
        </span>
        <button
          type="button"
          class="rounded-(--radius-control) border px-2 py-0.5 text-[0.7rem] transition"
          classList={{
            "border-accent bg-accent text-accent-fg": props.atelier.panelHeroic() === true,
            "border-border bg-surface-elevated text-fg-muted hover:border-accent hover:text-fg":
              props.atelier.panelHeroic() !== true,
          }}
          onClick={() => props.atelier.toggleHeroic(true)}
          data-testid="atelier-heroic-on"
        >
          on (3+)
        </button>
        <button
          type="button"
          class="rounded-(--radius-control) border px-2 py-0.5 text-[0.7rem] transition"
          classList={{
            "border-accent bg-accent text-accent-fg": props.atelier.panelHeroic() === false,
            "border-border bg-surface-elevated text-fg-muted hover:border-accent hover:text-fg":
              props.atelier.panelHeroic() !== false,
          }}
          onClick={() => props.atelier.toggleHeroic(false)}
          data-testid="atelier-heroic-off"
        >
          off (4+)
        </button>
        <Show when={props.atelier.panelHeroic() === undefined}>
          <span class="text-[0.6rem] text-fg-subtle">spec default</span>
        </Show>
      </div>

      <div class="flex items-center gap-1 border-t border-border-muted pt-2">
        <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Bonus
        </span>
        <button
          type="button"
          class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.7rem] text-fg-muted hover:border-accent hover:text-fg transition"
          onClick={() =>
            props.atelier.offerQuickMod({
              kind: "success",
              value: 1,
              label: "+1s",
              apply: "always",
            })
          }
          data-testid="atelier-bonus-plus-1s"
        >
          +1s
        </button>
        <button
          type="button"
          class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.7rem] text-fg-muted hover:border-accent hover:text-fg transition"
          onClick={() =>
            props.atelier.offerQuickMod({
              kind: "success",
              value: -1,
              label: "−1s",
              apply: "always",
            })
          }
          data-testid="atelier-bonus-minus-1s"
        >
          −1s
        </button>
      </div>
    </section>
  );
}
