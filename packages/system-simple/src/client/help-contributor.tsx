// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { qualifiedName, readTraitWithDefault } from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { Character } from "@vtt/characters/shared";
import {
  type PendingRollContributor,
  type PendingRollContributorArgs,
} from "@vtt/characters/shared";
import { Identity, Online } from "@vtt/identity/shared";
import { OwnedBy } from "@vtt/permissions/shared";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { Stats } from "../shared/index.js";

const STATS = ["might", "quickness", "mind", "charm"] as const;
type StatKey = (typeof STATS)[number];

/**
 * Help-with-character contributor — system-simple's flavour of the
 * Burning Wheel "help dice" pattern.
 *
 * Lists every Character entity the current user owns (other than the
 * roll's initiator) and exposes a stat picker per character. Clicking
 * "Help" appends a `help` contribution to the PendingRoll carrying the
 * chosen character + stat + that stat's current value as bonus dice.
 *
 * The dice value is locked at help-time (computed from the helper's
 * current stats), not at commit-time. That mirrors how BW Help works
 * and avoids late-binding surprises if the helper bumps their stat
 * mid-roll.
 */
function HelpWithCharacterPanel(props: PendingRollContributorArgs): JSX.Element {
  const client = useClient();
  const allCharacters = useQuery([Character, OwnedBy]);
  const onlinePresence = useQuery([Identity, Online]);
  const initiatorChar = useTrait(props.initiatorCharacterId, Character);

  // "Who am I?" — match this connection's clientId against the Online
  // trait carried by the Identity entities. Mirrors the characters
  // package's useMe hook; copied here to avoid a cross-plugin import
  // of internals.
  const meUserId = createMemo<string | null>(() => {
    const cid = client.clientId();
    if (!cid) return null;
    const found = onlinePresence().find(
      (row) => (row.values.Online as { clientId: string }).clientId === cid,
    );
    if (!found) return null;
    return (found.values.Identity as { userId: string }).userId;
  });

  // Every character the current user owns, excluding the initiator's
  // (you can't help yourself with yourself in this flow).
  const myCharacters = createMemo(() => {
    const uid = meUserId();
    if (!uid) return [];
    return allCharacters()
      .filter((row) => {
        const owned = row.values.OwnedBy as { userId: string };
        return owned.userId === uid && row.id !== props.initiatorCharacterId;
      })
      .map((row) => ({
        id: row.id,
        name: (row.values.Character as { name: string }).name,
      }));
  });

  // Per-character stat selection.
  const [picks, setPicks] = createSignal<Record<string, StatKey>>({});
  const pick = (charId: string): StatKey => picks()[charId] ?? "might";
  const setPick = (charId: string, stat: StatKey) => {
    setPicks({ ...picks(), [charId]: stat });
  };

  const offerHelp = (helper: { id: string; name: string }) => {
    const uid = meUserId();
    if (!uid) return;
    const stat = pick(helper.id);
    // Helper character may never have had Stats edited yet — the kit
    // only materialises the trait on first SetField. Use the substrate's
    // default-aware reader so the Zod default (might/quickness/mind/charm
    // = 2) flows through and the help button always has something to
    // offer.
    const stats = readTraitWithDefault(client.world, helper.id, Stats) as
      | Record<StatKey, number>
      | undefined;
    if (!stats) return;
    const dice = stats[stat];
    props.contribute({
      kind: "help",
      label: `${helper.name} helps with ${capitalize(stat)} ${dice}`,
      fromUserId: uid,
      fromCharacterId: helper.id,
      payload: { dice, stat },
    });
  };

  return (
    <div class="flex flex-col gap-1">
      <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
        Help with one of your characters
      </span>
      <Show
        when={myCharacters().length > 0}
        fallback={
          <span class="text-[0.65rem] text-fg-subtle">
            you have no other characters to help{" "}
            <Show when={initiatorChar()}>{initiatorChar()!.name}</Show>
          </span>
        }
      >
        <ul class="flex flex-col gap-1">
          <For each={myCharacters()}>
            {(c) => (
              <li class="flex items-center gap-1 rounded-(--radius-control) bg-surface px-2 py-1">
                <span class="flex-1 truncate text-xs text-fg">{c.name}</span>
                <select
                  value={pick(c.id)}
                  onChange={(e) => setPick(c.id, e.currentTarget.value as StatKey)}
                  class="rounded-(--radius-control) border border-border bg-surface-elevated px-1 py-0.5 text-[0.65rem] text-fg outline-none focus:border-accent"
                >
                  <For each={STATS}>
                    {(s) => <option value={s}>{capitalize(s)}</option>}
                  </For>
                </select>
                <button
                  type="button"
                  onClick={() => offerHelp(c)}
                  class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition"
                >
                  help
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const HelpWithCharacterContributor: PendingRollContributor = {
  id: qualifiedName("@vtt/system-simple/help-with-character") as PendingRollContributor["id"],
  priority: 50,
  rollablePrefix: "@vtt/system-simple/",
  render: (args) => HelpWithCharacterPanel(args),
};
