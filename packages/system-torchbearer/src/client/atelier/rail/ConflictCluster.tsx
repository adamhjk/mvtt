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

import { type EntityId } from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { Character, PendingRoll, type Contribution } from "@vtt/characters/shared";
import { createMemo, For, Show, type JSX } from "solid-js";
import { dispositionFromContributions } from "../../../shared/index.js";

/**
 * When the selected pending roll is in disposition mode, list every other
 * concurrent TB disposition roll in the world. Surfaces the broader
 * "phase" of a conflict-disposition without forcing the user to flip
 * pills one-by-one.
 *
 * Each line names the rolling character + their current pool size; lets
 * the captain check whether every party member has built their pool
 * before commit cascade.
 */
export function ConflictCluster(props: { rollId: EntityId }): JSX.Element {
  const client = useClient();
  const pr = useTrait(props.rollId, PendingRoll);
  const all = useQuery([PendingRoll]);

  const isDispo = createMemo<boolean>(() => {
    const v = pr();
    if (!v) return false;
    const fromContribs = dispositionFromContributions(v.contributions as Contribution[]);
    if (typeof fromContribs === "boolean") return fromContribs;
    const fromOpts = (v.opts as { dispositionMode?: unknown })?.dispositionMode;
    return typeof fromOpts === "boolean" ? fromOpts : false;
  });

  const otherDispoRolls = createMemo(() => {
    if (!isDispo()) return [];
    const out: { id: string; characterName: string }[] = [];
    for (const row of all()) {
      if (row.id === props.rollId) continue;
      const v = row.values.PendingRoll as {
        rollableName: string;
        initiatorCharacterId: string;
        contributions: Contribution[];
        opts: unknown;
      };
      if (!v.rollableName.startsWith("@vtt/system-torchbearer/")) continue;
      const peerDispo = dispositionFromContributions(v.contributions);
      const peerOpts = (v.opts as { dispositionMode?: unknown })?.dispositionMode;
      const peerActive =
        typeof peerDispo === "boolean"
          ? peerDispo
          : typeof peerOpts === "boolean"
            ? peerOpts
            : false;
      if (!peerActive) continue;
      const char = client.world.get(v.initiatorCharacterId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      out.push({
        id: row.id,
        characterName: char?.Character.name ?? "(unknown)",
      });
    }
    return out;
  });

  return (
    <Show when={otherDispoRolls().length > 0}>
      <div
        class="flex flex-col gap-1 rounded-(--radius-control) border border-dashed border-border-muted bg-surface-elevated px-2 py-1"
        data-testid="atelier-conflict-cluster"
      >
        <span class="font-display text-[0.55rem] uppercase tracking-[0.16em] text-fg-subtle">
          ⚖ conflict
        </span>
        <ul class="flex flex-col gap-0.5 text-[0.65rem] text-fg-muted">
          <For each={otherDispoRolls()}>
            {(r) => (
              <li class="truncate" data-testid={`atelier-conflict-row-${r.id}`}>
                {r.characterName} building
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  );
}
