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

import { createSignal, For, Show, type JSX } from "solid-js";
import type { AtelierState, HelperRow } from "../use-atelier.js";

/**
 * Helpers card. For each eligible helper character, surfaces a skill
 * picker (eligible vs per-GM optgroups), a +1D help button (automatic),
 * a "per GM" button (GM-discretion), and a synergy toggle (DH p.87).
 *
 * The helper roster is computed in the hook (same-team filter, active
 * filter, can-write filter); this card just renders the resulting rows.
 */
export function HelpCard(props: { atelier: AtelierState }): JSX.Element {
  const [picks, setPicks] = createSignal<Record<string, string>>({});
  const pickOf = (h: HelperRow): string => {
    const fromState = picks()[h.characterId];
    if (fromState) return fromState;
    if (h.automatic.length > 0) return h.automatic[0]!.id;
    return h.gm[0]?.id ?? "";
  };
  const setPickFor = (charId: string, optId: string): void => {
    setPicks({ ...picks(), [charId]: optId });
  };

  return (
    <Show when={props.atelier.helpers().length > 0 || props.atelier.suggestedHelpNames().length > 0}>
      <section
        class="flex flex-col gap-2 rounded-(--radius-card) border border-border bg-surface p-3"
        data-testid="atelier-help-card"
      >
        <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Help &amp; companions
        </span>
        <Show when={props.atelier.suggestedHelpNames().length > 0}>
          <span class="text-[0.6rem] text-fg-subtle">
            suggested: {props.atelier.suggestedHelpNames().join(", ")} (DH p.37)
          </span>
        </Show>
        <Show
          when={props.atelier.helpers().length > 0}
          fallback={
            <span class="text-[0.65rem] text-fg-subtle italic">
              none of your characters can help on this roll
            </span>
          }
        >
          <ul class="flex flex-col gap-1">
            <For each={props.atelier.helpers()}>
              {(h) => {
                const isHelping = (): boolean => h.activeOptionId !== null;
                const activeViaGm = (): boolean =>
                  !!h.activeOptionId &&
                  !h.automatic.some((o) => o.id === h.activeOptionId);
                const isSynergy = (): boolean =>
                  props.atelier.synergyDeclared().includes(h.characterId);
                return (
                  <li
                    class="flex flex-wrap items-center gap-1 rounded-(--radius-control) bg-surface-elevated px-2 py-1"
                    data-testid={`atelier-help-row-${h.characterId}`}
                  >
                    <span class="flex-1 truncate text-[0.7rem] text-fg">
                      {h.name}
                      <Show when={isHelping()}>
                        <span class="ml-1 text-fg-subtle">
                          · helping{activeViaGm() ? " (per GM)" : ""}
                        </span>
                      </Show>
                    </span>
                    <Show when={h.automatic.length + h.gm.length > 1}>
                      <select
                        value={pickOf(h)}
                        onChange={(e) =>
                          setPickFor(h.characterId, e.currentTarget.value)
                        }
                        class="rounded-(--radius-control) border border-border bg-surface px-1 py-0.5 text-[0.65rem] text-fg outline-none focus:border-accent"
                        aria-label={`${h.name} help skill`}
                        data-testid={`atelier-help-pick-${h.characterId}`}
                      >
                        <Show when={h.automatic.length > 0}>
                          <optgroup label="eligible">
                            <For each={h.automatic}>
                              {(o) => <option value={o.id}>{o.label}</option>}
                            </For>
                          </optgroup>
                        </Show>
                        <Show when={h.gm.length > 0}>
                          <optgroup label="per GM">
                            <For each={h.gm}>
                              {(o) => <option value={o.id}>{o.label}</option>}
                            </For>
                          </optgroup>
                        </Show>
                      </select>
                    </Show>
                    <Show when={h.automatic.length > 0}>
                      <button
                        type="button"
                        class="rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-50"
                        disabled={!h.automatic.some((o) => o.id === pickOf(h))}
                        onClick={() => props.atelier.offerHelp(h, pickOf(h), false)}
                        data-testid={`atelier-help-btn-${h.characterId}`}
                      >
                        +1D help
                      </button>
                    </Show>
                    <Show when={h.gm.length > 0}>
                      <button
                        type="button"
                        class="rounded-(--radius-control) border border-dashed border-border bg-surface px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-50"
                        disabled={!h.gm.some((o) => o.id === pickOf(h))}
                        onClick={() => props.atelier.offerHelp(h, pickOf(h), true)}
                        data-testid={`atelier-help-gm-btn-${h.characterId}`}
                      >
                        per GM
                      </button>
                    </Show>
                    <Show when={isHelping()}>
                      <button
                        type="button"
                        class="rounded-(--radius-control) border px-2 py-0.5 text-[0.65rem] transition disabled:opacity-50"
                        classList={{
                          "border-accent bg-accent text-accent-fg": isSynergy(),
                          "border-border bg-surface text-fg-muted hover:border-accent hover:text-fg":
                            !isSynergy(),
                        }}
                        disabled={
                          !isSynergy() &&
                          props.atelier.helperFateAvail(h.characterId) < 1
                        }
                        onClick={() => props.atelier.toggleSynergy(h)}
                        data-testid={`atelier-synergy-btn-${h.characterId}`}
                      >
                        {isSynergy() ? "synergy ✓" : "synergy"}
                      </button>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  );
}
