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

import { createMemo, Show, type JSX } from "solid-js";
import type { AtelierState } from "../use-atelier.js";

/**
 * Disposition mode replaces ObstacleCard with this card. There is no
 * obstacle — the result IS the conflict HP, computed as
 * `dispoBase + successes − teamPenalties`. We render the formula
 * left-to-right with the additive base on the left, the unknown success
 * count in the middle, and the team-penalty sum on the right.
 *
 * The add-to picker (Will / Health / Nature for PCs) or monster pool
 * toggle (within / outside for monsters) lives on this card because it
 * shapes the result formula.
 */
export function ResultCard(props: { atelier: AtelierState }): JSX.Element {
  const dispoBase = createMemo<number | null>(() => {
    const v = props.atelier.previewedSpec()?.["dispoBase"];
    return typeof v === "number" ? v : null;
  });
  const successMods = createMemo<number>(() => {
    const mods = props.atelier.previewedSpec()?.["modifiers"];
    if (!Array.isArray(mods)) return 0;
    let total = 0;
    for (const m of mods as { kind?: string; value?: number; apply?: string }[]) {
      if (m.kind === "success" && m.apply === "always") total += m.value ?? 0;
    }
    return total;
  });
  const pool = createMemo<number | null>(() => {
    const v = props.atelier.previewedSpec()?.["pool"];
    return typeof v === "number" ? v : null;
  });
  const successTarget = createMemo<number>(() => {
    const v = props.atelier.previewedSpec()?.["successTarget"];
    return typeof v === "number" ? v : 4;
  });
  const estimatedHp = createMemo<number | null>(() => {
    const p = pool();
    const b = dispoBase();
    if (p === null || b === null) return null;
    // Expected dice successes = p * (7 - successTarget) / 6
    const expected = (p * (7 - successTarget())) / 6;
    return Math.round(b + expected + successMods());
  });

  return (
    <section
      class="flex flex-col gap-2 rounded-(--radius-card) border border-border bg-surface p-3"
      data-testid="atelier-result-card"
    >
      <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
        Result
      </span>

      <div
        class="flex items-baseline justify-around gap-1 font-mono"
        data-testid="atelier-result-formula"
      >
        <span class="text-center">
          <span class="block text-lg text-fg">{dispoBase() ?? "?"}</span>
          <span class="block text-[0.55rem] text-fg-subtle uppercase tracking-[0.14em]">base</span>
        </span>
        <span class="text-fg-subtle">+</span>
        <span class="text-center">
          <span class="block text-lg text-fg">?</span>
          <span class="block text-[0.55rem] text-fg-subtle uppercase tracking-[0.14em]">
            success
          </span>
        </span>
        <Show when={successMods() !== 0}>
          <span class="text-fg-subtle">{successMods() > 0 ? "+" : ""}</span>
          <span class="text-center">
            <span class="block text-lg text-danger">{successMods()}</span>
            <span class="block text-[0.55rem] text-fg-subtle uppercase tracking-[0.14em]">
              team
            </span>
          </span>
        </Show>
      </div>

      <Show when={estimatedHp() !== null}>
        <p class="text-center text-[0.65rem] text-fg-subtle" data-testid="atelier-result-estimated">
          estimated {estimatedHp()} HP
        </p>
      </Show>

      <Show
        when={props.atelier.initiatorIsMonster()}
        fallback={
          <div class="flex items-center gap-1" data-testid="atelier-result-addto">
            <span class="text-[0.6rem] text-fg-subtle uppercase tracking-[0.14em]">add to</span>
            <button
              type="button"
              class="rounded-(--radius-control) border px-1.5 py-0.5 text-[0.65rem] transition"
              classList={{
                "border-accent bg-accent text-accent-fg":
                  props.atelier.activeDispositionAddTo() === "will",
                "border-border bg-surface-elevated text-fg-muted hover:border-accent":
                  props.atelier.activeDispositionAddTo() !== "will",
              }}
              onClick={() => props.atelier.pickDispositionAddTo("will")}
              data-testid="atelier-result-addto-will"
            >
              Will
            </button>
            <button
              type="button"
              class="rounded-(--radius-control) border px-1.5 py-0.5 text-[0.65rem] transition"
              classList={{
                "border-accent bg-accent text-accent-fg":
                  props.atelier.activeDispositionAddTo() === "health",
                "border-border bg-surface-elevated text-fg-muted hover:border-accent":
                  props.atelier.activeDispositionAddTo() !== "health",
              }}
              onClick={() => props.atelier.pickDispositionAddTo("health")}
              data-testid="atelier-result-addto-health"
            >
              Health
            </button>
            <Show when={props.atelier.activeDispositionAddTo() === null}>
              <span
                class="text-[0.6rem] italic"
                style={{ color: "var(--color-warning, #C9A227)" }}
                data-testid="atelier-result-addto-warning"
              >
                pick Will or Health
              </span>
            </Show>
          </div>
        }
      >
        <div class="flex items-center gap-1" data-testid="atelier-result-monster-pool">
          <span class="text-[0.6rem] text-fg-subtle uppercase tracking-[0.14em]">Nature</span>
          <button
            type="button"
            class="rounded-(--radius-control) border px-1.5 py-0.5 text-[0.65rem] transition"
            classList={{
              "border-accent bg-accent text-accent-fg":
                props.atelier.activeMonsterPool() === "within",
              "border-border bg-surface-elevated text-fg-muted hover:border-accent":
                props.atelier.activeMonsterPool() !== "within",
            }}
            onClick={() => props.atelier.pickMonsterPool("within")}
            data-testid="atelier-result-pool-within"
          >
            within
          </button>
          <button
            type="button"
            class="rounded-(--radius-control) border px-1.5 py-0.5 text-[0.65rem] transition"
            classList={{
              "border-accent bg-accent text-accent-fg":
                props.atelier.activeMonsterPool() === "outside",
              "border-border bg-surface-elevated text-fg-muted hover:border-accent":
                props.atelier.activeMonsterPool() !== "outside",
            }}
            onClick={() => props.atelier.pickMonsterPool("outside")}
            data-testid="atelier-result-pool-outside"
          >
            outside
          </button>
        </div>
      </Show>
    </section>
  );
}
