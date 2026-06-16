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

import { Show, type JSX } from "solid-js";
import type { AtelierState } from "../use-atelier.js";

/**
 * Persona spends + channel Nature picker. PC-only — monsters don't
 * carry Fate/Persona pools (SG p.171). The persona button caps at 3
 * cumulative dice (DH p.8); the channel-nature picker only appears when
 * the character has a Nature rating > 0.
 */
export function PersonaNatureCard(props: { atelier: AtelierState }): JSX.Element {
  return (
    <Show when={!props.atelier.initiatorIsMonster()}>
      <section
        class="flex flex-col gap-2 rounded-(--radius-card) border border-border bg-surface p-3"
        data-testid="atelier-persona-card"
      >
        <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Persona &amp; Nature
        </span>

        <div class="flex flex-wrap items-center gap-1">
          <button
            type="button"
            class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.7rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={props.atelier.personaAvail() < 1 || props.atelier.personaSpendDeclared() >= 3}
            onClick={() => props.atelier.declarePersonaDice(1)}
            title={
              props.atelier.personaAvail() < 1
                ? "no persona to spend"
                : props.atelier.personaSpendDeclared() >= 3
                  ? "persona-dice cap reached (3 max — DH p.8)"
                  : `Spend 1 persona for +1D (cumulative: ${props.atelier.personaSpendDeclared()}/3)`
            }
            data-testid="atelier-persona-spend"
          >
            +1D persona ({props.atelier.personaSpendDeclared()}/3)
          </button>

          <Show when={props.atelier.natureRating() > 0}>
            <span
              class="inline-flex items-center gap-1 rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.65rem] text-fg-muted"
              data-testid="atelier-channel-group"
            >
              <button
                type="button"
                class="rounded-(--radius-control) border px-1.5 py-0.5 transition"
                classList={{
                  "border-accent bg-accent text-accent-fg":
                    props.atelier.channelDeclared() === "within",
                  "border-border hover:border-accent hover:text-fg":
                    props.atelier.channelDeclared() !== "within",
                }}
                disabled={
                  props.atelier.personaAvail() < 1 && props.atelier.channelDeclared() !== "within"
                }
                onClick={() => props.atelier.toggleChannelNature("within")}
                data-testid="atelier-channel-within"
              >
                within
              </button>
              <button
                type="button"
                class="rounded-(--radius-control) border px-1.5 py-0.5 transition"
                classList={{
                  "border-accent bg-accent text-accent-fg":
                    props.atelier.channelDeclared() === "outside",
                  "border-border hover:border-accent hover:text-fg":
                    props.atelier.channelDeclared() !== "outside",
                }}
                disabled={
                  props.atelier.personaAvail() < 1 && props.atelier.channelDeclared() !== "outside"
                }
                onClick={() => props.atelier.toggleChannelNature("outside")}
                data-testid="atelier-channel-outside"
              >
                outside
              </button>
              <span class="text-fg-subtle">channel +{props.atelier.natureRating()}D</span>
            </span>
          </Show>
        </div>
      </section>
    </Show>
  );
}
