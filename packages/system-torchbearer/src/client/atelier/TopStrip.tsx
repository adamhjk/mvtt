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
import type { AtelierState } from "./use-atelier.js";

type Mode = "independent" | "versus" | "disposition";

/**
 * Headline strip — initiator name + source label + subject + mode badge
 * + as-disposition toggle. Mirrors the chat-rail panel's headline
 * ("X is rolling Y for Z") and the per-roll mode hint, lifted out into
 * a discrete strip above the card grid.
 */
export function TopStrip(props: {
  atelier: AtelierState;
  mode: Mode;
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
      <span
        class="rounded-(--radius-control) bg-accent/20 px-2 py-0.5 text-[0.55rem] font-display uppercase tracking-[0.16em] text-accent"
        data-testid="atelier-mode-badge"
      >
        {props.mode}
      </span>
      <button
        type="button"
        class="ml-auto rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition"
        onClick={() =>
          props.atelier.toggleDisposition(!props.atelier.activeDisposition())
        }
        data-testid="atelier-disposition-toggle"
        title={
          props.atelier.activeDisposition()
            ? "Clear disposition mode — back to a normal test"
            : "Switch to a disposition roll — no obstacle, result = base + successes − team penalties"
        }
      >
        {props.atelier.activeDisposition()
          ? "as independent"
          : "as disposition"}
      </button>
    </header>
  );
}
