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

import { createMemo, For, Show, type JSX } from "solid-js";
import type { AtelierState } from "../use-atelier.js";

interface PreviewModifier {
  id?: string;
  kind?: string;
  value?: number;
  label?: string;
  apply?: string;
  source?: string;
}

/**
 * Live pool size + additive breakdown column. Reads the previewed spec
 * for the post-fold pool number; lists every `apply: "always", kind:
 * "dice"` modifier as a `+ND label` row underneath the headline so the
 * user can see where the dice came from.
 */
export function PoolCard(props: { atelier: AtelierState }): JSX.Element {
  const pool = createMemo<number | null>(() => {
    const v = props.atelier.previewedSpec()?.["pool"];
    return typeof v === "number" ? v : null;
  });
  const baseDice = createMemo<number | null>(() => {
    const v = props.atelier.previewedSpec()?.["baseDice"];
    return typeof v === "number" ? v : null;
  });
  const dispoBase = createMemo<number | null>(() => {
    const v = props.atelier.previewedSpec()?.["dispoBase"];
    return typeof v === "number" ? v : null;
  });
  const dispoAddTo = createMemo<string | null>(() => {
    const v = props.atelier.previewedSpec()?.["dispoAddTo"];
    return typeof v === "string" ? v : null;
  });
  const diceMods = createMemo<PreviewModifier[]>(() => {
    const mods = props.atelier.previewedSpec()?.["modifiers"];
    if (!Array.isArray(mods)) return [];
    return (mods as PreviewModifier[]).filter(
      (m) => m.kind === "dice" && m.apply === "always" && (m.value ?? 0) !== 0,
    );
  });

  return (
    <section
      class="flex flex-col gap-2 rounded-(--radius-card) border border-border bg-surface p-3"
      data-testid="atelier-pool-card"
    >
      <header class="flex items-baseline justify-between">
        <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Pool
        </span>
        <Show when={dispoAddTo() && dispoBase() !== null}>
          <span class="font-mono text-[0.65rem] text-fg-subtle">
            + {dispoAddTo()} {dispoBase()}
          </span>
        </Show>
      </header>
      <div class="flex items-baseline gap-2">
        <span class="font-mono text-2xl text-accent" data-testid="atelier-pool-size">
          {pool() ?? 0}D
        </span>
        <Show when={baseDice() !== null}>
          <span class="font-mono text-[0.7rem] text-fg-subtle">base {baseDice()}</span>
        </Show>
      </div>
      <Show when={diceMods().length > 0}>
        <ul class="flex flex-col gap-0.5 text-[0.65rem] font-mono text-fg-muted">
          <For each={diceMods()}>
            {(m) => (
              <li>
                <span
                  classList={{
                    "text-accent": (m.value ?? 0) > 0,
                    "text-danger": (m.value ?? 0) < 0,
                  }}
                >
                  {(m.value ?? 0) > 0 ? "+" : ""}
                  {m.value}D
                </span>
                <span class="ml-1 text-fg-subtle">{m.label}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
