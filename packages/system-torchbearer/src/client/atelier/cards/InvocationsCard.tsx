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

/**
 * Trait invocations card. Each character trait gets a row with three
 * possible actions: "for self" (+1D on the roll), "−1D / +1 ✓" (take a
 * penalty, earn a check), and "+2D opp / +2 ✓" (only in versus mode —
 * boost the opponent, earn two checks). One-trait-per-test guard
 * (DH p.81) disables all actions once any trait has been invoked.
 */
export function InvocationsCard(props: { atelier: AtelierState }): JSX.Element {
  return (
    <Show
      when={
        !props.atelier.initiatorIsMonster() &&
        (props.atelier.initiatorTraits()?.entries.length ?? 0) > 0
      }
    >
      <section
        class="flex flex-col gap-2 rounded-(--radius-card) border border-border bg-surface p-3"
        data-testid="atelier-invocations-card"
      >
        <div class="flex items-baseline justify-between">
          <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
            Traits
          </span>
          <Show when={props.atelier.traitAlreadyUsed()}>
            <span
              class="text-[0.6rem] text-fg-subtle italic"
              data-testid="atelier-trait-already-used"
            >
              one trait per test (DH p.81)
            </span>
          </Show>
        </div>
        <ul class="flex flex-col gap-1">
          <For each={props.atelier.initiatorTraits()?.entries ?? []}>
            {(t, i) => {
              const usesLeft = (): number =>
                t.level >= 3
                  ? Infinity
                  : Math.max(0, t.level - (t.beneficialUses ?? 0));
              const usedAgainstThisSession = (): boolean =>
                t.usedAgainst === true;
              const forDisabled = (): boolean =>
                props.atelier.traitAlreadyUsed() ||
                (t.level < 3 && usesLeft() <= 0);
              const againstDisabled = (): boolean =>
                props.atelier.traitAlreadyUsed() || usedAgainstThisSession();
              return (
                <li
                  class="flex items-center gap-1 rounded-(--radius-control) bg-surface-elevated px-2 py-1"
                  data-testid={`atelier-trait-row-${i()}`}
                >
                  <span class="flex-1 truncate text-[0.7rem] text-fg">
                    {t.name}
                    <span class="ml-1 text-fg-subtle">
                      Lv {t.level}
                      {t.level < 3
                        ? ` · ${usesLeft()}/${t.level}`
                        : " · all tests"}
                      <Show when={usedAgainstThisSession()}>
                        <span class="ml-1">· vs self ✓</span>
                      </Show>
                    </span>
                  </span>
                  <button
                    type="button"
                    class="rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={forDisabled()}
                    onClick={() => props.atelier.useTraitFor(i())}
                    data-testid={`atelier-trait-for-${i()}`}
                  >
                    for self
                  </button>
                  <button
                    type="button"
                    class="rounded-(--radius-control) border border-dashed border-border bg-surface px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={againstDisabled()}
                    onClick={() =>
                      props.atelier.useTraitAgainst(i(), "minus-1d")
                    }
                    data-testid={`atelier-trait-against-${i()}`}
                  >
                    −1D / +1 ✓
                  </button>
                  <Show when={props.atelier.activeVersusId() !== null}>
                    <button
                      type="button"
                      class="rounded-(--radius-control) border border-dashed border-border bg-surface px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-40 disabled:cursor-not-allowed"
                      disabled={againstDisabled()}
                      onClick={() =>
                        props.atelier.useTraitAgainst(i(), "plus-2d-opp")
                      }
                      data-testid={`atelier-trait-opp-${i()}`}
                    >
                      +2D opp / +2 ✓
                    </button>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </section>
    </Show>
  );
}
