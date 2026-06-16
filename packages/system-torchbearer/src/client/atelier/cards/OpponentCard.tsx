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
import { previewRollable, type EntityId } from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { Character, PendingRoll, type Contribution } from "@vtt/characters/shared";
import { Formula, RolledBy, RollResult } from "@vtt/resolution/shared";
import { TbRollMetaSchema } from "../../../shared/index.js";
import type { AtelierState } from "../use-atelier.js";

interface PartnerProbe {
  source?: unknown;
}

/**
 * The opponent side of a versus test. When the pairing is live this card
 * names the paired character and the skill/ability they're testing, plus
 * an "unpair" button — deliberately NOT their pool size or modifiers;
 * how strong the opposition is rolling stays their business until dice
 * hit the table. Before an opponent is picked it lists the other open
 * TB pending rolls as pair-with candidates, so the whole versus flow
 * lives in the roll screen.
 *
 * Versus mode replaces ObstacleCard with this card — the opponent's
 * successes become the obstacle, so heroic + Ob pips don't apply.
 */
export function OpponentCard(props: { atelier: AtelierState }): JSX.Element {
  const client = useClient();
  // Candidates we can actually pair with: rolls not already locked into
  // somebody else's versus test (pairing with one of those would hijack
  // its id and silently create a three-way).
  const pairable = createMemo(() =>
    props.atelier
      .versusCandidates()
      .filter((c) => c.versusId === null || c.versusId === props.atelier.activeVersusId()),
  );
  // Reactive query — the partner mirror must update live as the peer
  // roll's contributions land/change (a bare client.world.query inside
  // a memo wouldn't re-run when the *peer's* trait changes).
  const allPendings = useQuery([PendingRoll]);
  const partner = createMemo(() => {
    const id = props.atelier.activeVersusId();
    if (!id) return null;
    for (const row of allPendings()) {
      if (row.id === props.atelier.rollId) continue;
      const v = row.values.PendingRoll as {
        rollableName: string;
        initiatorCharacterId: string;
        contributions: Contribution[];
        opts: unknown;
      };
      if (!v.rollableName.startsWith("@vtt/system-torchbearer/")) continue;
      const optsVersus = (v.opts as { versusTestId?: unknown })?.versusTestId;
      const peerVersus = (() => {
        for (const c of v.contributions) {
          if (c.kind === "tb-versus") {
            const payload = c.payload as { versusTestId?: string | null };
            if (typeof payload?.versusTestId === "string") return payload.versusTestId;
            if (payload?.versusTestId === null) return null;
          }
        }
        return undefined;
      })();
      const active =
        peerVersus !== undefined ? peerVersus : typeof optsVersus === "string" ? optsVersus : null;
      if (active !== id) continue;
      return { rowId: row.id, value: v };
    }
    return null;
  });

  const partnerSpec = createMemo<PartnerProbe | null>(() => {
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
      return raw && typeof raw === "object" ? (raw as PartnerProbe) : null;
    } catch {
      return null;
    }
  });

  /**
   * Pairing survives the opponent committing first: their PendingRoll
   * despawns, but the spawned Roll entity carries the same versusTestId
   * in its Formula.meta. Surfacing it here keeps the pairing visible
   * (and keeps the pair-with list from offering a re-pair that would
   * orphan the committed half) until this side rolls too.
   */
  const resolvedRolls = useQuery([Formula, RollResult, RolledBy]);
  const committedPartner = createMemo<{
    name: string;
    source: string;
  } | null>(() => {
    const id = props.atelier.activeVersusId();
    if (!id) return null;
    for (const row of resolvedRolls()) {
      const f = row.values.Formula as { meta?: unknown } | undefined;
      const parsed = TbRollMetaSchema.safeParse(f?.meta);
      if (!parsed.success) continue;
      if (parsed.data.spec.versusTestId !== id) continue;
      return {
        name: (row.values.RolledBy as { displayName: string }).displayName,
        source: parsed.data.spec.source,
      };
    }
    return null;
  });

  const partnerSource = createMemo<string>(() => {
    const v = partnerSpec()?.source;
    if (typeof v === "string" && v.length > 0) return v;
    // Spec preview unavailable — fall back to the rollable's short name.
    const p = partner();
    if (!p) return "?";
    return p.value.rollableName.split("/").pop() ?? p.value.rollableName;
  });

  return (
    <section
      class="flex flex-col gap-2 rounded-(--radius-card) border border-border bg-surface p-3"
      data-testid="atelier-opponent-card"
    >
      <header class="flex items-center justify-between">
        <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          Opponent
        </span>
        <Show when={partner()}>
          <button
            type="button"
            onClick={() => props.atelier.unpair()}
            class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-danger hover:text-danger transition"
            data-testid="atelier-opponent-unpair"
            title="Clear the versus pairing"
          >
            unpair
          </button>
        </Show>
      </header>
      <Show
        when={partner()}
        keyed
        fallback={
          <Show
            when={committedPartner()}
            keyed
            fallback={
              <Show
                when={pairable().length > 0}
                fallback={
                  <span class="text-[0.7rem] text-fg-subtle italic">
                    no other open rolls to oppose — start the opponent's roll first
                  </span>
                }
              >
                <span class="text-[0.6rem] text-fg-subtle">pair with:</span>
                <ul class="flex flex-col gap-0.5">
                  <For each={pairable()}>
                    {(c) => (
                      <li class="flex items-center justify-between gap-2 text-[0.7rem]">
                        <span class="truncate text-fg-muted">{c.characterName}</span>
                        <button
                          type="button"
                          onClick={() => props.atelier.togglePairWith(c)}
                          class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition"
                          data-testid={`atelier-opponent-pair-${c.pendingRollId}`}
                        >
                          pair
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            }
          >
            {(cp) => (
              <div class="flex flex-col gap-0.5" data-testid="atelier-opponent-committed">
                <span class="font-display text-base text-fg">vs {cp.name}</span>
                <span class="font-mono text-[0.7rem] text-fg-subtle">
                  tested {cp.source} — rolled, waiting on you
                </span>
              </div>
            )}
          </Show>
        }
      >
        {(p) => (
          <div class="flex flex-col gap-0.5" data-testid="atelier-opponent-partner">
            <span class="font-display text-base text-fg">
              vs <PartnerName characterId={p.value.initiatorCharacterId as EntityId} />
            </span>
            <span
              class="font-mono text-[0.7rem] text-fg-subtle"
              data-testid="atelier-opponent-source"
            >
              testing {partnerSource()}
            </span>
          </div>
        )}
      </Show>
      <p class="text-[0.6rem] text-fg-subtle italic">opponent's successes are the obstacle</p>
    </section>
  );
}

/**
 * Live name read at the leaf — renames propagate without re-running the
 * partner search. Mounted under a keyed `<Show>`, so the id is stable
 * for this component's lifetime.
 */
function PartnerName(props: { characterId: EntityId }): JSX.Element {
  const c = useTrait(props.characterId, Character);
  return <>{c()?.name ?? "?"}</>;
}
