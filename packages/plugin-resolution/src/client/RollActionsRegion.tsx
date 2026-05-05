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
import { useClient, useTrait } from "@vtt/substrate/client";
import { createMemo, For, Show, type JSX } from "solid-js";
import { Formula } from "../shared/traits.js";
import {
  RollActionsSlot,
  type RollActionsContributor,
} from "../shared/slot.js";

/**
 * Stack of `RollActionsSlot` fills for a resolved Roll entity.
 *
 * System-specific chat rows (TB, system-simple, future systems) drop
 * this in below their headline + dice + result regions to compose
 * post-roll affordances — log buttons, fate/persona spends,
 * pin-to-journal add-ons. Fills filter on `rollablePrefix` against the
 * Roll's `Formula.meta.<system-anchored-name>`; system-aware fills
 * stay scoped, system-agnostic fills (no prefix) render everywhere.
 *
 * The component renders nothing when no fills match — leaving the
 * surrounding row layout undisturbed.
 */
export function RollActionsRegion(props: { rollId: EntityId }): JSX.Element {
  const client = useClient();
  const formula = useTrait(props.rollId, Formula);

  /**
   * Best-effort rollable name for prefix filtering. The Formula
   * itself doesn't carry a rollable id; system-claimed rolls stash
   * a `system: "<scope>"` tag in `meta`, which is enough to match the
   * `@vtt/<system>/` family. Ad-hoc /r rolls have no meta — fills
   * with no prefix still render; prefix-gated fills don't.
   */
  const rollableName = createMemo<string | undefined>(() => {
    const f = formula();
    if (!f) return undefined;
    const meta = f.meta as { system?: unknown } | undefined;
    if (typeof meta?.system === "string") return meta.system;
    return undefined;
  });

  const contributors = createMemo<RollActionsContributor[]>(() => {
    const fills = client.registry.fillsForSlot(
      RollActionsSlot,
    ) as RollActionsContributor[];
    const name = rollableName();
    const matching = fills.filter((f) => {
      if (!f.rollablePrefix) return true;
      return typeof name === "string" && name.startsWith(f.rollablePrefix);
    });
    return [...matching].sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return a.id.localeCompare(b.id);
    });
  });

  return (
    <Show when={contributors().length > 0}>
      <div class="flex flex-col gap-2" data-testid="roll-actions-region">
        <For each={contributors()}>
          {(c) => (
            <div data-roll-actions-fill={c.id}>
              {c.render({ rollId: props.rollId, rollableName: rollableName() }) as JSX.Element}
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
