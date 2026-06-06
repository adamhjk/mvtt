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
import { previewRollable } from "@vtt/substrate";
import { useClient } from "@vtt/substrate/client";
import { PendingRoll, type Contribution } from "@vtt/characters/shared";
import type { AtelierState } from "../use-atelier.js";

interface PartnerProbe {
  pool?: unknown;
  source?: unknown;
  modifiers?: unknown;
}

/**
 * Read-only mirror of the paired opponent's emerging pool. When the
 * versus pairing is live this card shows the opponent's pool size, their
 * declared modifiers, and an "unpair" button. When no pairing is set, it
 * still occupies the slot but renders a hint that the versus pairing is
 * managed from the rail's "pair with:" candidate list.
 *
 * Versus mode replaces ObstacleCard with this card — the opponent's
 * successes become the obstacle, so heroic + Ob pips don't apply.
 */
export function OpponentCard(props: { atelier: AtelierState }): JSX.Element {
  const client = useClient();
  const partner = createMemo(() => {
    const id = props.atelier.activeVersusId();
    if (!id) return null;
    for (const row of client.world.query([PendingRoll])) {
      if (row.id === props.atelier.pr()?.["initiatorCharacterId"]) continue;
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
        peerVersus !== undefined
          ? peerVersus
          : typeof optsVersus === "string"
            ? optsVersus
            : null;
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

  const partnerPool = createMemo<number | null>(() => {
    const v = partnerSpec()?.pool;
    return typeof v === "number" ? v : null;
  });
  const partnerSource = createMemo<string>(() => {
    const v = partnerSpec()?.source;
    return typeof v === "string" ? v : "opponent";
  });
  const partnerMods = createMemo<{ value?: number; label?: string }[]>(() => {
    const mods = partnerSpec()?.modifiers;
    if (!Array.isArray(mods)) return [];
    return mods as { value?: number; label?: string }[];
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
        <Show when={props.atelier.activeVersusId() !== null}>
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
        fallback={
          <span class="text-[0.7rem] text-fg-subtle">
            no opponent paired — use the rail's "pair with" list
          </span>
        }
      >
        <div class="flex items-baseline gap-2">
          <span
            class="font-mono text-2xl text-accent"
            data-testid="atelier-opponent-pool"
          >
            {partnerPool() ?? "?"}D
          </span>
          <span class="font-mono text-[0.7rem] text-fg-subtle">
            {partnerSource()}
          </span>
        </div>
        <Show when={partnerMods().length > 0}>
          <ul class="flex flex-col gap-0.5 text-[0.65rem] font-mono text-fg-muted">
            <For each={partnerMods()}>
              {(m) => (
                <li>
                  <span
                    classList={{
                      "text-accent": (m.value ?? 0) > 0,
                      "text-danger": (m.value ?? 0) < 0,
                    }}
                  >
                    {(m.value ?? 0) > 0 ? "+" : ""}
                    {m.value}
                  </span>
                  <span class="ml-1 text-fg-subtle">{m.label}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
      <p class="text-[0.6rem] text-fg-subtle italic">
        opponent's successes are the obstacle
      </p>
    </section>
  );
}
