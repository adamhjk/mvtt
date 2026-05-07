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
import { ItemIdentity } from "@vtt/items/shared";
import {
  TbItemSpecialRules,
  TbWeapon,
} from "../../shared/items/index.js";
import {
  ALL_ACTIONS,
  type ConflictAction,
  type ConflictSide,
} from "../shared/index.js";
import { useCharacterName, useParticipants, useWeaponBindings } from "./hooks.js";
import { ACTION_LETTERS } from "./styles.js";

export function WeaponPanel(props: {
  conflictId: EntityId;
  side: ConflictSide;
  title: string;
}): JSX.Element {
  const participants = useParticipants(props.conflictId, props.side);
  const bindings = useWeaponBindings(props.conflictId);
  const rows = createMemo(() => {
    const out: { characterId: EntityId; weaponItemId: EntityId | null }[] = [];
    for (const p of participants()) {
      const b = bindings().get(p.characterId);
      out.push({
        characterId: p.characterId,
        weaponItemId: b?.weaponItemId ?? null,
      });
    }
    return out;
  });
  return (
    <section
      class="px-3 py-3 border-t border-border-muted"
      data-testid={`weapon-panel-${props.side}`}
    >
      <h2 class="font-display text-[0.7rem] uppercase tracking-[0.16em] mb-2">
        {props.title} — Bonuses & Specials
      </h2>
      <table
        class="w-full text-sm font-mono border-collapse"
        style={{ "table-layout": "fixed" }}
      >
        <colgroup>
          <col style={{ width: "9rem" }} />
          <col style={{ width: "10rem" }} />
          <For each={ALL_ACTIONS}>
            {() => <col style={{ width: "2.5rem" }} />}
          </For>
          <col />
        </colgroup>
        <thead>
          <tr class="text-fg-subtle">
            <th class="text-left pb-1 font-normal">char</th>
            <th class="text-left pb-1 font-normal">weapon</th>
            <For each={ALL_ACTIONS}>
              {(a) => (
                <th class="text-center pb-1 font-normal">
                  {ACTION_LETTERS[a]}
                </th>
              )}
            </For>
            <th class="text-left pb-1 pl-2 font-normal">special</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(r) => (
              <WeaponRow
                characterId={r.characterId}
                weaponItemId={r.weaponItemId}
              />
            )}
          </For>
        </tbody>
      </table>
    </section>
  );
}

function WeaponRow(props: {
  characterId: EntityId;
  weaponItemId: EntityId | null;
}): JSX.Element {
  const name = useCharacterName(props.characterId);
  return (
    <tr
      class="border-t border-border-muted/40"
      data-testid="weapon-row"
    >
      <td class="py-1 text-xs truncate" title={name()}>
        {name()}
      </td>
      <Show
        when={props.weaponItemId}
        fallback={
          <>
            <td class="py-1 text-fg-subtle italic">unarmed</td>
            <For each={ALL_ACTIONS}>{() => <td class="text-center">—</td>}</For>
            <td class="text-fg-subtle text-xs"></td>
          </>
        }
      >
        {(idAcc) => <WeaponDetails itemId={idAcc() as EntityId} />}
      </Show>
    </tr>
  );
}

function WeaponDetails(props: { itemId: EntityId }): JSX.Element {
  const ident = useTrait(props.itemId, ItemIdentity) as () =>
    | { name: string }
    | undefined;
  const weapon = useTrait(props.itemId, TbWeapon) as () =>
    | ReturnType<typeof TbWeapon>["value"]
    | undefined;
  const special = useTrait(props.itemId, TbItemSpecialRules) as () =>
    | { text: string }
    | undefined;
  const bonusFor = (action: ConflictAction): string => {
    const b = weapon()?.conflictBonuses?.[action];
    if (!b || b.value === 0) return "—";
    const sign = b.value > 0 ? "+" : "";
    const suffix = b.type === "dice" ? "D" : b.type === "success" ? "s" : "r";
    return `${sign}${b.value}${suffix}`;
  };
  return (
    <>
      <td class="py-1 truncate" title={ident()?.name ?? ""}>
        {ident()?.name ?? "(item)"}
      </td>
      <For each={ALL_ACTIONS}>
        {(a) => (
          <td class="text-center" data-testid={`weapon-bonus-${a}`}>
            {bonusFor(a)}
          </td>
        )}
      </For>
      <td
        class="py-1 pl-2 text-[0.65rem] text-fg-subtle leading-snug"
        title={special()?.text ?? ""}
      >
        {special()?.text ?? ""}
      </td>
    </>
  );
}
