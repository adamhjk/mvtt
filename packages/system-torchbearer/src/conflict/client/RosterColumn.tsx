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
import { For, Show, type JSX } from "solid-js";
import { ItemIdentity } from "@vtt/items/shared";
import { type ConflictSide } from "../shared/index.js";
import {
  type ParticipantView,
  type WeaponView,
  useCharacterName,
  useParticipants,
  useWeaponBindings,
} from "./hooks.js";

export function RosterColumn(props: {
  conflictId: EntityId;
  side: ConflictSide;
  title: string;
}): JSX.Element {
  const participants = useParticipants(props.conflictId, props.side);
  const weaponBindings = useWeaponBindings(props.conflictId);
  return (
    <section
      class="px-3 py-3 border-r border-border-muted last:border-r-0"
      data-testid={`roster-column-${props.side}`}
    >
      <h2
        class="font-display text-[0.7rem] uppercase tracking-[0.16em] mb-3"
        classList={{
          "text-accent": props.side === "party",
          "text-warning": props.side === "enemy",
        }}
      >
        {props.title}
      </h2>
      <Show
        when={participants().length > 0}
        fallback={<p class="text-fg-subtle italic text-xs">No participants.</p>}
      >
        <ul class="space-y-3">
          <For each={participants()}>
            {(p) => (
              <li>
                <ParticipantCard
                  participant={p}
                  weaponBinding={weaponBindings().get(p.characterId)}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function ParticipantCard(props: {
  participant: ParticipantView;
  weaponBinding: WeaponView | undefined;
}): JSX.Element {
  const name = useCharacterName(props.participant.characterId);
  return (
    <article
      data-testid={`participant-${props.participant.entityId}`}
      class="border-l-2 pl-2 border-border"
      classList={{ "opacity-50": props.participant.knockedOut }}
    >
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-display text-sm uppercase tracking-wide text-fg">{name()}</span>
        <Show when={props.participant.knockedOut}>
          <span
            class="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-danger"
            data-testid="participant-ko"
          >
            ko
          </span>
        </Show>
      </div>
      <HpPips
        hp={props.participant.hp}
        hpMax={props.participant.hpMax}
        testId={`hp-${props.participant.entityId}`}
      />
      <WeaponLine binding={props.weaponBinding} />
    </article>
  );
}

function HpPips(props: { hp: number; hpMax: number; testId: string }): JSX.Element {
  const items = (): { full: boolean; idx: number }[] => {
    const out: { full: boolean; idx: number }[] = [];
    for (let i = 0; i < props.hpMax; i++) {
      out.push({ full: i < props.hp, idx: i });
    }
    return out;
  };
  return (
    <div
      class="font-mono text-base leading-none text-fg"
      data-testid={props.testId}
      aria-label={`HP ${props.hp} / ${props.hpMax}`}
    >
      <For each={items()}>{(p) => <span class="mr-px">{p.full ? "●" : "○"}</span>}</For>
    </div>
  );
}

function WeaponLine(props: { binding: WeaponView | undefined }): JSX.Element {
  return (
    <Show when={props.binding?.weaponItemId}>
      {(idAcc) => <WeaponName itemId={idAcc() as EntityId} />}
    </Show>
  );
}

function WeaponName(props: { itemId: EntityId }): JSX.Element {
  const ident = useTrait(props.itemId, ItemIdentity) as () => { name: string } | undefined;
  return <p class="text-xs text-fg-subtle font-mono mt-0.5">{ident()?.name ?? "(unknown)"}</p>;
}
