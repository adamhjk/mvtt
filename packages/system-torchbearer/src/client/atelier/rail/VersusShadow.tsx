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
import {
  Character,
  PendingRoll,
  type Contribution,
} from "@vtt/characters/shared";
import { Formula, RolledBy, RollResult } from "@vtt/resolution/shared";
import { createMemo, Show, type JSX } from "solid-js";
import {
  TbRollMetaSchema,
  versusFromContributions,
} from "../../../shared/index.js";

interface PartnerProbe {
  source?: unknown;
}

/**
 * Rail accessory shown under the selected pill. When the selected roll
 * is paired into a versus test, names the partner and the skill/ability
 * they're testing — deliberately NOT their pool size; the opposition's
 * strength stays secret until the dice land. Pairing and unpairing live
 * in the Atelier's mode switch + Opponent card — this is display-only.
 */
export function VersusShadow(props: { rollId: EntityId }): JSX.Element {
  const client = useClient();
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

  const partnerSource = createMemo<string | null>(() => {
    const p = partner();
    if (!p) return null;
    const rollable = client.registry.rollables.get(p.value.rollableName);
    if (rollable) {
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
        if (typeof probe?.source === "string" && probe.source.length > 0) {
          return probe.source;
        }
      } catch {
        /* preview failed — fall through to the rollable short name */
      }
    }
    return p.value.rollableName.split("/").pop() ?? p.value.rollableName;
  });

  // The pairing outlives the partner's commit: their PendingRoll
  // despawns but the spawned Roll entity carries the versusTestId in
  // its Formula.meta. Mirror that state so the pill doesn't silently
  // drop the "vs" marker while this side is still building.
  const resolvedRolls = useQuery([Formula, RollResult, RolledBy]);
  const committedPartner = createMemo<{
    name: string;
    source: string;
  } | null>(() => {
    const target = activeVersusId();
    if (!target) return null;
    for (const row of resolvedRolls()) {
      const f = row.values.Formula as { meta?: unknown } | undefined;
      const parsed = TbRollMetaSchema.safeParse(f?.meta);
      if (!parsed.success) continue;
      if (parsed.data.spec.versusTestId !== target) continue;
      return {
        name: (row.values.RolledBy as { displayName: string }).displayName,
        source: parsed.data.spec.source,
      };
    }
    return null;
  });

  return (
    <Show
      when={partner()}
      fallback={
        <Show when={committedPartner()} keyed>
          {(cp) => (
            <div
              class="flex flex-col gap-1 rounded-(--radius-control) border border-dashed border-border-muted bg-surface-elevated px-2 py-1"
              data-testid="atelier-versus-shadow"
            >
              <span class="font-display text-[0.55rem] uppercase tracking-[0.16em] text-fg-subtle">
                ◆ vs {cp.name}
              </span>
              <span
                class="font-mono text-[0.75rem] text-fg"
                data-testid="atelier-versus-shadow-committed"
              >
                rolled {cp.source} — waiting on you
              </span>
            </div>
          )}
        </Show>
      }
    >
      {(p) => (
        <div
          class="flex flex-col gap-1 rounded-(--radius-control) border border-dashed border-border-muted bg-surface-elevated px-2 py-1"
          data-testid="atelier-versus-shadow"
        >
          <span class="font-display text-[0.55rem] uppercase tracking-[0.16em] text-fg-subtle">
            ◆ vs {p().characterName}
          </span>
          <span
            class="font-mono text-[0.75rem] text-fg"
            data-testid="atelier-versus-shadow-source"
          >
            testing {partnerSource() ?? "?"}
          </span>
        </div>
      )}
    </Show>
  );
}
