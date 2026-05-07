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
import { useTrait } from "@vtt/substrate/client";
import { createMemo, For, Show, type JSX } from "solid-js";
import { Conditions } from "../../shared/traits.js";
import { TB_CONDITION_RULES } from "../shared/index.js";
import { useCharacterName, useParticipants } from "./hooks.js";

export function ConditionsPanel(props: { conflictId: EntityId }): JSX.Element {
  const party = useParticipants(props.conflictId, "party");
  const enemy = useParticipants(props.conflictId, "enemy");
  const all = createMemo(() => [...party(), ...enemy()]);
  return (
    <section
      class="px-3 py-3 border-t border-border-muted"
      data-testid="conditions-panel"
    >
      <h2 class="font-display text-[0.7rem] uppercase tracking-[0.16em] mb-2">
        Conditions In Play
      </h2>
      <For each={all()}>
        {(p) => <ParticipantConditions characterId={p.characterId} />}
      </For>
    </section>
  );
}

function ParticipantConditions(props: {
  characterId: EntityId;
}): JSX.Element {
  const name = useCharacterName(props.characterId);
  const conds = useTrait(props.characterId, Conditions) as () =>
    | ReturnType<typeof Conditions>["value"]
    | undefined;
  const active = createMemo<{ id: string; label: string; effect: string }[]>(() => {
    const v = conds();
    if (!v) return [];
    const out: { id: string; label: string; effect: string }[] = [];
    for (const rule of TB_CONDITION_RULES) {
      const val = (v as Record<string, boolean>)[rule.id];
      if (val) {
        out.push({
          id: rule.id,
          label: rule.label,
          effect: rule.inConflictEffect,
        });
      }
    }
    return out;
  });
  return (
    <Show when={active().length > 0}>
      <div
        class="text-sm mb-1"
        data-testid={`conditions-row-${props.characterId}`}
      >
        <span class="font-display text-xs uppercase tracking-wide w-20 inline-block">
          {name()}
        </span>
        <For each={active()}>
          {(c) => (
            <span class="inline-block mr-2 text-xs">
              <span class="font-display uppercase tracking-wider">⚠ {c.label}</span>
              <span class="ml-1 text-fg-subtle">{c.effect}</span>
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}
