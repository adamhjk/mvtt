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

import {
  qualifiedName,
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import {
  useClient,
  useQuery,
  useTrait,
  type QueryRow,
} from "@vtt/substrate/client";
import {
  createMemo,
  createSignal,
  For,
  Show,
  type JSX,
} from "solid-js";
import { Identity, Online, Name } from "@vtt/identity/shared";
import { Character } from "@vtt/characters/shared";
import { ItemIdentity } from "@vtt/items/shared";
import { type WorkbenchStatusItem } from "@vtt/shell-workbench/shared";
import { GRIND_SENTINEL_ID } from "../shared/grind.js";
import {
  AssignLightCoverage,
  LightCoverage,
  lightCoverage,
  lightSourceKey,
} from "../shared/light.js";
import { TbCarries, TbSupply } from "../shared/items/item-traits.js";
import { TbMonster } from "../shared/monster-traits.js";
import { TbNpc } from "../shared/npc-traits.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LitSource {
  holderId: EntityId;
  entryIndex: number;
  itemId: EntityId;
  turnsRemaining: number;
  key: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns all currently lit light sources across all holders. */
function useLitSources(): () => LitSource[] {
  const holders = useQuery([TbCarries]);
  return createMemo(() => {
    const out: LitSource[] = [];
    for (const row of holders()) {
      const carries = row.values.TbCarries as {
        entries: Array<{
          itemId: EntityId;
          state?: { lit?: boolean; turnsRemaining?: number };
        }>;
      };
      for (let i = 0; i < carries.entries.length; i++) {
        const e = carries.entries[i]!;
        if (e.state?.lit) {
          out.push({
            holderId: row.id as EntityId,
            entryIndex: i,
            itemId: e.itemId,
            turnsRemaining: e.state.turnsRemaining ?? 0,
            key: lightSourceKey(row.id, i),
          });
        }
      }
    }
    return out;
  });
}

function useIsGm(): () => boolean {
  const client = useClient();
  const players = useQuery([Identity, Name, Online]);
  return createMemo(() => {
    const cid = client.clientId();
    if (!cid) return false;
    const me = players().find(
      (p) => (p.values.Online as { clientId: string }).clientId === cid,
    );
    if (!me) return false;
    return (me.values.Identity as { role: string }).role === "gm";
  });
}

/**
 * Player characters only — Characters that are neither monsters nor NPCs.
 *
 * `world.query([Character])` only returns the queried trait in each row's
 * `values`, so we can't tell a PC from a monster by inspecting that row alone.
 * Instead we query the discriminating traits directly (the idiomatic pattern,
 * cf. monsters-page's `useQuery([Character, TbMonster])`) and subtract those
 * ids. Each query subscribes to its own trait, so the result stays reactive
 * as monsters/NPCs are spawned or removed.
 */
function usePlayerCharacters(): () => QueryRow[] {
  const allChars = useQuery([Character]);
  const monsters = useQuery([Character, TbMonster]);
  const npcs = useQuery([Character, TbNpc]);
  return createMemo(() => {
    const excluded = new Set<EntityId>();
    for (const r of monsters()) excluded.add(r.id);
    for (const r of npcs()) excluded.add(r.id);
    return allChars().filter((r) => !excluded.has(r.id));
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ItemName(props: { itemId: EntityId }): JSX.Element {
  const item = useTrait(props.itemId, ItemIdentity) as () =>
    | { name: string }
    | undefined;
  return <span>{item()?.name ?? "?"}</span>;
}

function HolderName(props: { holderId: EntityId }): JSX.Element {
  const char = useTrait(props.holderId, Character) as () =>
    | { name: string }
    | undefined;
  return <span>{char()?.name ?? "?"}</span>;
}

function CharacterBadge(props: { characterId: EntityId }): JSX.Element {
  const char = useTrait(props.characterId, Character) as () =>
    | { name: string }
    | undefined;
  return (
    <span class="inline-block rounded-(--radius-control) bg-surface-alt px-1.5 py-0.5 text-[0.6rem] leading-tight">
      {char()?.name ?? "?"}
    </span>
  );
}

function CoverageEditor(props: {
  source: LitSource;
  assignment: { coveredCharacterIds: EntityId[]; maxCoverage: number } | undefined;
}): JSX.Element {
  const client = useClient();
  const playerChars = usePlayerCharacters();

  const covered = createMemo(
    () => new Set(props.assignment?.coveredCharacterIds ?? []),
  );
  const max = createMemo(() => props.assignment?.maxCoverage ?? lightCoverage(props.source.itemId));

  const toggle = (charId: EntityId): void => {
    const cur = [...covered()];
    const idx = cur.indexOf(charId);
    if (idx >= 0) {
      cur.splice(idx, 1);
    } else {
      if (cur.length >= max()) return;
      cur.push(charId);
    }
    void client.dispatch(
      AssignLightCoverage({
        holderId: props.source.holderId,
        entryIndex: props.source.entryIndex,
        coveredCharacterIds: cur,
      }) as CommandInstance,
    );
  };

  return (
    <div class="flex flex-wrap gap-1 pt-0.5">
      <For each={playerChars()}>
        {(row) => {
          const charId = row.id as EntityId;
          const char = row.values.Character as { name: string };
          const isChecked = (): boolean => covered().has(charId);
          const isDisabled = (): boolean =>
            !isChecked() && covered().size >= max();
          return (
            <button
              type="button"
              onClick={() => toggle(charId)}
              disabled={isDisabled()}
              class={`rounded-(--radius-control) border px-1.5 py-0.5 text-[0.6rem] leading-tight transition-colors ${
                isChecked()
                  ? "border-accent bg-accent/20 text-accent"
                  : "border-border bg-surface text-fg-subtle"
              } disabled:opacity-40`}
              title={
                isDisabled()
                  ? `Max ${max()} characters covered`
                  : isChecked()
                    ? `Remove ${char.name} from coverage`
                    : `Add ${char.name} to coverage`
              }
            >
              {char.name}
            </button>
          );
        }}
      </For>
    </div>
  );
}

function SourceRow(props: {
  source: LitSource;
  isGm: boolean;
  assignment: { coveredCharacterIds: EntityId[]; maxCoverage: number } | undefined;
}): JSX.Element {
  const [editing, setEditing] = createSignal(false);
  return (
    <div class="flex flex-col gap-0.5 border-b border-border/50 py-1 last:border-b-0">
      <div class="flex items-center gap-2 text-xs">
        <span class="font-medium">
          <ItemName itemId={props.source.itemId} />
        </span>
        <span class="text-fg-subtle">
          held by <HolderName holderId={props.source.holderId} />
        </span>
        {/* Turns remaining — GM only. Players must track this manually
             (DH p.42: "count those turns carefully"). */}
        <Show when={props.isGm}>
          <span class="text-fg-subtle">
            ({props.source.turnsRemaining}t)
          </span>
        </Show>
        <Show when={props.isGm}>
          <button
            type="button"
            onClick={() => setEditing(!editing())}
            class="ml-auto rounded-(--radius-control) border border-border bg-surface px-1.5 py-0.5 text-[0.6rem] text-fg-subtle hover:text-fg"
            data-testid="light-edit-coverage"
          >
            {editing() ? "done" : "assign"}
          </button>
        </Show>
      </div>
      {/* Coverage badges */}
      <Show when={(props.assignment?.coveredCharacterIds.length ?? 0) > 0}>
        <div class="flex flex-wrap gap-0.5">
          <For each={props.assignment?.coveredCharacterIds ?? []}>
            {(cid) => <CharacterBadge characterId={cid} />}
          </For>
        </div>
      </Show>
      <Show when={editing()}>
        <CoverageEditor source={props.source} assignment={props.assignment} />
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main widget
// ---------------------------------------------------------------------------

function LightTracker(): JSX.Element {
  const litSources = useLitSources();
  const isGm = useIsGm();
  const [expanded, setExpanded] = createSignal(false);

  const coverage = useTrait(GRIND_SENTINEL_ID, LightCoverage) as () =>
    | {
        assignments: Record<
          string,
          { coveredCharacterIds: EntityId[]; maxCoverage: number }
        >;
      }
    | undefined;

  const count = createMemo(() => litSources().length);

  // All player character IDs (excludes monsters and NPCs).
  const playerChars = usePlayerCharacters();
  const playerCharIds = createMemo(() =>
    playerChars().map((r) => r.id as EntityId),
  );

  // Characters NOT covered by any light source.
  const inDarkness = createMemo(() => {
    const coveredSet = new Set<string>();
    const asgn = coverage()?.assignments ?? {};
    for (const a of Object.values(asgn)) {
      for (const cid of a.coveredCharacterIds) {
        coveredSet.add(cid);
      }
    }
    return playerCharIds().filter((id) => !coveredSet.has(id));
  });

  return (
    <Show when={count() > 0}>
      <div
        data-testid="light-tracker"
        class="relative flex items-center gap-1.5 text-xs"
      >
        <button
          type="button"
          onClick={() => setExpanded(!expanded())}
          class="flex items-center gap-1 font-display text-[0.6rem] uppercase tracking-[0.14em] text-fg-subtle hover:text-fg"
          title="Light sources"
          data-testid="light-tracker-toggle"
        >
          <span class="text-sm">🔥</span>
          <span>{count()}</span>
          <Show when={inDarkness().length > 0}>
            <span class="text-warning" title={`${inDarkness().length} in darkness`}>
              ({inDarkness().length} dark)
            </span>
          </Show>
        </button>

        <Show when={expanded()}>
          <div
            class="absolute bottom-full right-0 z-50 mb-1 w-72 rounded-(--radius-panel) border border-border bg-surface-raised p-2 shadow-lg"
            data-testid="light-tracker-panel"
          >
            <div class="mb-1 font-display text-[0.6rem] uppercase tracking-[0.14em] text-fg-subtle">
              Light Sources
            </div>
            <For each={litSources()}>
              {(src) => (
                <SourceRow
                  source={src}
                  isGm={isGm()}
                  assignment={coverage()?.assignments[src.key]}
                />
              )}
            </For>
            <Show when={inDarkness().length > 0}>
              <div class="mt-1 border-t border-border pt-1">
                <div class="font-display text-[0.6rem] uppercase tracking-[0.14em] text-warning">
                  In Darkness
                </div>
                <div class="flex flex-wrap gap-0.5 pt-0.5">
                  <For each={inDarkness()}>
                    {(cid) => (
                      <span class="inline-block rounded-(--radius-control) border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[0.6rem] leading-tight text-warning">
                        <CharacterBadge characterId={cid} />
                      </span>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}

/**
 * Status-strip fill — light coverage tracker, visible to everyone
 * when at least one light source is lit.
 */
export const LightTrackerStatusItem: WorkbenchStatusItem = {
  id: qualifiedName(
    "@vtt/system-torchbearer/light-tracker",
  ) as WorkbenchStatusItem["id"],
  priority: 90,
  render: () => LightTracker(),
};
