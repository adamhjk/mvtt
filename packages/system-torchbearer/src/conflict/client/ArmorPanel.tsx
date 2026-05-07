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
import { TbArmor } from "../../shared/items/index.js";
import {
  TB_ARMOR_RULES,
  type ConflictSide,
} from "../shared/index.js";
import {
  useCharacterName,
  useEquippedArmor,
  useParticipants,
} from "./hooks.js";

/**
 * Armor at a glance — read-only play aid. Each row shows the
 * character and what they're currently wearing (armor / helm /
 * shield), live off their `TbCarries`. No degradation, no
 * absorption math — players track armor state on their own sheets.
 * Rules legend is collapsible at the bottom.
 */
/**
 * Combined panel — both sides + the rules legend. Kept for callers
 * that want one wrapper. The board uses `ArmorSidePanel` directly so
 * party / enemy armor can interleave with weapons.
 */
export function ArmorPanel(props: { conflictId: EntityId }): JSX.Element {
  return (
    <section data-testid="armor-panel">
      <ArmorSidePanel
        conflictId={props.conflictId}
        side="party"
        title="Party Armor"
      />
      <ArmorSidePanel
        conflictId={props.conflictId}
        side="enemy"
        title="Enemy Armor"
      />
      <ArmorRulesLegend />
    </section>
  );
}

export function ArmorSidePanel(props: {
  conflictId: EntityId;
  side: ConflictSide;
  title: string;
}): JSX.Element {
  const participants = useParticipants(props.conflictId, props.side);
  return (
    <div
      class="px-3 py-3 border-t border-border-muted"
      data-testid={`armor-panel-${props.side}`}
    >
      <h2 class="font-display text-[0.7rem] uppercase tracking-[0.16em] mb-2">
        {props.title} — Equipped
      </h2>
      <table class="w-full text-sm font-mono border-collapse">
        <thead>
          <tr class="text-fg-subtle">
            <th class="text-left pb-1 font-normal">char</th>
            <th class="text-left pb-1 font-normal">armor</th>
            <th class="text-left pb-1 font-normal">helm</th>
            <th class="text-left pb-1 font-normal">shield</th>
          </tr>
        </thead>
        <tbody>
          <For each={participants()}>
            {(p) => <ArmorRow characterId={p.characterId} />}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function ArmorRow(props: { characterId: EntityId }): JSX.Element {
  const name = useCharacterName(props.characterId);
  const equipped = useEquippedArmor(props.characterId);
  return (
    <tr
      class="border-t border-border-muted/40"
      data-testid={`armor-row-${props.characterId}`}
    >
      <td class="py-1 text-xs">{name()}</td>
      <td class="py-1">
        <ArmorCell itemId={equipped().armorItemId} />
      </td>
      <td class="py-1">
        <ArmorCell itemId={equipped().helmetItemId} />
      </td>
      <td class="py-1">
        <ArmorCell itemId={equipped().shieldItemId} />
      </td>
    </tr>
  );
}

function ArmorCell(props: { itemId: EntityId | null }): JSX.Element {
  return (
    <Show
      when={props.itemId}
      fallback={<span class="text-fg-subtle">—</span>}
    >
      {(idAcc) => <ArmorCellLabel itemId={idAcc() as EntityId} />}
    </Show>
  );
}

function ArmorCellLabel(props: { itemId: EntityId }): JSX.Element {
  const ident = useTrait(props.itemId, ItemIdentity) as () =>
    | { name: string }
    | undefined;
  const armor = useTrait(props.itemId, TbArmor) as () =>
    | { armorType: string }
    | undefined;
  return (
    <span>{ident()?.name ?? armor()?.armorType ?? "(armor)"}</span>
  );
}

export function ArmorRulesLegend(): JSX.Element {
  return (
    <details class="mt-2 px-3 pb-3 text-xs text-fg-subtle">
      <summary class="cursor-pointer">Armor rules (DH p.150-151)</summary>
      <table class="mt-2 w-full">
        <thead>
          <tr>
            <th class="text-left font-normal">type</th>
            <th class="text-left font-normal">absorb</th>
            <th class="text-left font-normal">after</th>
            <th class="text-left font-normal">bypassed by</th>
          </tr>
        </thead>
        <tbody>
          <For each={TB_ARMOR_RULES}>
            {(rule) => (
              <tr class="border-t border-border-muted/40">
                <td>{rule.label}</td>
                <td>{rule.absorb}</td>
                <td>{rule.afterAbsorb}</td>
                <td>{rule.bypassedBy}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </details>
  );
}
