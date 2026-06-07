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
import type { AtelierMode, AtelierState } from "./use-atelier.js";

const MODES: ReadonlyArray<{ mode: AtelierMode; title: string }> = [
  {
    mode: "independent",
    title: "Independent test — roll against a fixed obstacle",
  },
  {
    mode: "versus",
    title:
      "Versus test — oppose another open roll; their successes become your obstacle (DH p.21)",
  },
  {
    mode: "disposition",
    title:
      "Disposition roll — no obstacle, result = base + successes − team penalties (SG p.63)",
  },
];

/**
 * Headline strip — initiator name + source label + subject + the
 * three-way mode switch (independent / versus / disposition). Mirrors
 * the chat-rail panel's headline ("X is rolling Y for Z"), lifted out
 * into a discrete strip above the card grid. The switch is the single
 * place a roll's mode changes; picking "versus" hands off to the
 * Opponent card's pair-with list for choosing who to oppose.
 */
export function TopStrip(props: {
  atelier: AtelierState;
  mode: AtelierMode;
}): JSX.Element {
  const sourceLabel = createMemo<string>(() => {
    const fromSpec = props.atelier.previewedSpec()?.["source"];
    if (typeof fromSpec === "string" && fromSpec.length > 0) return fromSpec;
    const name = props.atelier.rollableName();
    if (!name) return "?";
    return name.split("/").pop() ?? name;
  });

  const subjectLabel = createMemo<string | null>(() => {
    const spec = props.atelier.previewedSpec() as
      | { spellCast?: { spellName?: unknown }; invocationPerform?: { invocationName?: unknown } }
      | null;
    if (typeof spec?.spellCast?.spellName === "string") {
      return spec.spellCast.spellName;
    }
    if (typeof spec?.invocationPerform?.invocationName === "string") {
      return spec.invocationPerform.invocationName;
    }
    return null;
  });

  return (
    <header
      class="flex flex-wrap items-baseline gap-3 border-b border-border-muted pb-2"
      data-testid="atelier-top-strip"
    >
      <h3 class="font-display text-sm tracking-tight text-fg">
        <span>{props.atelier.initiatorName() ?? "someone"}</span>
        <span class="text-fg-muted"> · </span>
        <span>{sourceLabel()}</span>
        <Show when={subjectLabel()}>
          {(subj) => (
            <>
              <span class="text-fg-muted"> for </span>
              <span>{subj()}</span>
            </>
          )}
        </Show>
      </h3>
      <div
        role="group"
        aria-label="test mode"
        class="ml-auto flex overflow-hidden rounded-(--radius-control) border border-border"
        data-testid="atelier-mode-switch"
      >
        <For each={MODES}>
          {(m) => (
            <button
              type="button"
              aria-pressed={props.mode === m.mode}
              class="px-2 py-0.5 font-display text-[0.55rem] uppercase tracking-[0.16em] transition"
              classList={{
                "bg-accent text-accent-fg": props.mode === m.mode,
                "bg-surface text-fg-muted hover:text-fg":
                  props.mode !== m.mode,
              }}
              onClick={() => props.atelier.setMode(m.mode)}
              data-testid={`atelier-mode-${m.mode}`}
              title={m.title}
            >
              {m.mode}
            </button>
          )}
        </For>
      </div>
    </header>
  );
}
