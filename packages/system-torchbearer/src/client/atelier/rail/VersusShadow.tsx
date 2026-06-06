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

import { previewRollable, type EntityId } from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { kit } from "@vtt/characters/client";
import {
  Character,
  ContributeToPendingRoll,
  PendingRoll,
  type Contribution,
} from "@vtt/characters/shared";
import { createMemo, For, Show, type JSX } from "solid-js";
import {
  TB_VERSUS_CONTRIB_KIND,
  versusFromContributions,
} from "../../../shared/index.js";

interface PartnerProbe {
  pool?: unknown;
  source?: unknown;
}

interface VersusCandidate {
  pendingRollId: string;
  characterName: string;
}

/**
 * Rail accessory shown under the selected pill. When the selected roll
 * is paired, mirrors the partner's pool size + source. When unpaired,
 * lists other open TB pending rolls as candidates the user can pair
 * with.
 *
 * Mounts below the pill so the pairing UX is one click away without
 * occupying right-pane real estate.
 */
export function VersusShadow(props: { rollId: EntityId }): JSX.Element {
  const client = useClient();
  const me = kit.useMe();
  const pr = useTrait(props.rollId, PendingRoll);
  const allPendings = useQuery([PendingRoll]);

  const activeVersusId = createMemo<string | null>(() => {
    const v = pr();
    if (!v) return null;
    const fromContribs = versusFromContributions(v.contributions as Contribution[]);
    if (fromContribs !== undefined) return fromContribs;
    const optsVersus = (v.opts as { versusTestId?: unknown })?.versusTestId;
    return typeof optsVersus === "string" ? optsVersus : null;
  });

  const partner = createMemo(() => {
    const target = activeVersusId();
    if (!target) return null;
    for (const row of allPendings()) {
      if (row.id === props.rollId) continue;
      const v = row.values.PendingRoll as {
        rollableName: string;
        initiatorCharacterId: string;
        contributions: Contribution[];
        opts: unknown;
      };
      if (!v.rollableName.startsWith("@vtt/system-torchbearer/")) continue;
      const peerVersus = versusFromContributions(v.contributions);
      const optsVersus = (v.opts as { versusTestId?: unknown })?.versusTestId;
      const peerActive =
        peerVersus !== undefined
          ? peerVersus
          : typeof optsVersus === "string"
            ? optsVersus
            : null;
      if (peerActive !== target) continue;
      const char = client.world.get(v.initiatorCharacterId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      return {
        rowId: row.id,
        value: v,
        characterName: char?.Character.name ?? "?",
      };
    }
    return null;
  });

  const partnerPool = createMemo<number | null>(() => {
    const p = partner();
    if (!p) return null;
    const rollable = client.registry.rollables.get(p.value.rollableName);
    if (!rollable) return null;
    try {
      const raw = previewRollable(
        rollable,
        client.world,
        p.value.initiatorCharacterId as Parameters<typeof previewRollable>[2],
        {
          ...(p.value.opts as Record<string, unknown>),
          contributions: p.value.contributions,
        },
      );
      const probe = raw as PartnerProbe;
      return typeof probe?.pool === "number" ? probe.pool : null;
    } catch {
      return null;
    }
  });

  const candidates = createMemo<VersusCandidate[]>(() => {
    if (activeVersusId() !== null) return [];
    const out: VersusCandidate[] = [];
    for (const row of allPendings()) {
      if (row.id === props.rollId) continue;
      const v = row.values.PendingRoll as { rollableName: string; initiatorCharacterId: string };
      if (!v.rollableName.startsWith("@vtt/system-torchbearer/")) continue;
      const char = client.world.get(v.initiatorCharacterId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      out.push({
        pendingRollId: row.id,
        characterName: char?.Character.name ?? "?",
      });
    }
    return out;
  });

  let counter = 0;
  const freshId = () => {
    counter += 1;
    return `versus:${Date.now().toString(36)}-${counter}`;
  };

  const pair = (candidate: VersusCandidate) => {
    const m = me();
    if (!m) return;
    const next = freshId();
    const myChar = client.world.get(
      pr()?.initiatorCharacterId as EntityId,
      [Character],
    ) as { Character: { name: string } } | undefined;
    const myName = myChar?.Character.name ?? "your roll";
    client.dispatch(
      ContributeToPendingRoll({
        pendingRollId: props.rollId,
        contribution: {
          kind: TB_VERSUS_CONTRIB_KIND,
          label: `vs ${candidate.characterName}`,
          fromUserId: m.userId,
          payload: { versusTestId: next },
          replaces: "tb:versus",
        },
      }) as Parameters<typeof client.dispatch>[0],
    );
    client.dispatch(
      ContributeToPendingRoll({
        pendingRollId: candidate.pendingRollId as Parameters<
          typeof ContributeToPendingRoll
        >[0]["pendingRollId"],
        contribution: {
          kind: TB_VERSUS_CONTRIB_KIND,
          label: `vs ${myName}`,
          fromUserId: m.userId,
          payload: { versusTestId: next },
          replaces: "tb:versus",
        },
      }) as Parameters<typeof client.dispatch>[0],
    );
  };

  return (
    <Show when={partner() || candidates().length > 0}>
      <div
        class="flex flex-col gap-1 rounded-(--radius-control) border border-dashed border-border-muted bg-surface-elevated px-2 py-1"
        data-testid="atelier-versus-shadow"
      >
        <Show
          when={partner()}
          fallback={
            <>
              <span class="font-display text-[0.55rem] uppercase tracking-[0.16em] text-fg-subtle">
                pair with
              </span>
              <ul class="flex flex-col gap-0.5">
                <For each={candidates()}>
                  {(c) => (
                    <li class="flex items-center justify-between text-[0.65rem]">
                      <span class="truncate text-fg-muted">
                        {c.characterName}
                      </span>
                      <button
                        type="button"
                        onClick={() => pair(c)}
                        class="rounded-(--radius-control) border border-border bg-surface px-1.5 py-0.5 text-[0.6rem] text-fg-muted hover:border-accent hover:text-fg transition"
                        data-testid={`atelier-versus-pair-${c.pendingRollId}`}
                      >
                        pair
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </>
          }
        >
          {(p) => (
            <>
              <span class="font-display text-[0.55rem] uppercase tracking-[0.16em] text-fg-subtle">
                ◆ vs {p().characterName}
              </span>
              <span
                class="font-mono text-[0.75rem] text-fg"
                data-testid="atelier-versus-shadow-pool"
              >
                {partnerPool() ?? "?"}D building
              </span>
            </>
          )}
        </Show>
      </div>
    </Show>
  );
}
