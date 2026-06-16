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

import { qualifiedName, type CommandInstance, type EntityId } from "@vtt/substrate";
import { useClient, useQuery, useTrait, type QueryRow } from "@vtt/substrate/client";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { Identity, Online, Name } from "@vtt/identity/shared";
import { Character } from "@vtt/characters/shared";
import { ItemIdentity } from "@vtt/items/shared";
import { type WorkbenchStatusItem } from "@vtt/shell-workbench/shared";
import { GRIND_SENTINEL_ID } from "../shared/grind.js";
import {
  AssignLightCoverage,
  assignableNonHolderSlots,
  effectiveCovered,
  LightCoverage,
  lightCoverage,
  lightSourceKey,
} from "../shared/light.js";
import { TbCarries } from "../shared/items/item-traits.js";
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
    const me = players().find((p) => (p.values.Online as { clientId: string }).clientId === cid);
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
  const item = useTrait(props.itemId, ItemIdentity) as () => { name: string } | undefined;
  return <span>{item()?.name ?? "?"}</span>;
}

function HolderName(props: { holderId: EntityId }): JSX.Element {
  const char = useTrait(props.holderId, Character) as () => { name: string } | undefined;
  return <span>{char()?.name ?? "?"}</span>;
}

/** Live character name text — read at the leaf so renames propagate. */
function LiveCharName(props: { characterId: EntityId }): JSX.Element {
  const char = useTrait(props.characterId, Character) as () => { name: string } | undefined;
  return <>{char()?.name ?? "?"}</>;
}

/** Opaque full-light badge (the bearer + fully-covered characters). */
function CharacterBadge(props: { characterId: EntityId }): JSX.Element {
  return (
    <span class="inline-block rounded-(--radius-control) bg-surface-elevated px-1.5 py-0.5 text-[0.6rem] leading-tight">
      <LiveCharName characterId={props.characterId} />
    </span>
  );
}

function CoverageEditor(props: {
  source: LitSource;
  assignment:
    | { coveredCharacterIds: EntityId[]; dimCharacterIds?: EntityId[]; maxCoverage: number }
    | undefined;
}): JSX.Element {
  const client = useClient();
  const playerChars = usePlayerCharacters();
  // Resolve the item name client-side so `max` matches the server's
  // lightCoverage(itemId, itemName) exactly — otherwise a name-heuristic
  // source (e.g. an adventure item named "Torch") would cap the editor lower
  // than the server and lock the GM out of a slot.
  const itemIdentity = useTrait(props.source.itemId, ItemIdentity) as () =>
    | { name: string }
    | undefined;
  const max = createMemo(() => lightCoverage(props.source.itemId, itemIdentity()?.name));

  const covered = createMemo(() => new Set(props.assignment?.coveredCharacterIds ?? []));
  const dim = createMemo(() => new Set(props.assignment?.dimCharacterIds ?? []));
  // Effective full set always includes the holder; remaining non-holder slots
  // drive when full-light toggles disable.
  const effective = createMemo(() => effectiveCovered(props.source.holderId, [...covered()]));
  const remainingFull = createMemo(() => assignableNonHolderSlots(max(), effective()));

  const dispatch = (cov: EntityId[], dimIds: EntityId[]): void => {
    void client.dispatch(
      AssignLightCoverage({
        holderId: props.source.holderId,
        entryIndex: props.source.entryIndex,
        coveredCharacterIds: cov,
        dimCharacterIds: dimIds,
      }) as CommandInstance,
    );
  };

  const toggleFull = (charId: EntityId): void => {
    const cur = [...covered()];
    const idx = cur.indexOf(charId);
    if (idx >= 0) {
      cur.splice(idx, 1);
    } else {
      if (remainingFull() <= 0) return;
      cur.push(charId);
    }
    // A character moving into full light leaves the dim ring.
    dispatch(
      cur,
      [...dim()].filter((id) => id !== charId),
    );
  };

  const toggleDim = (charId: EntityId): void => {
    const cur = [...dim()];
    const idx = cur.indexOf(charId);
    if (idx >= 0) {
      cur.splice(idx, 1);
    } else {
      if (cur.length >= max()) return;
      cur.push(charId);
    }
    dispatch([...covered()], cur);
  };

  // Non-holder player characters are the only ones the GM toggles; the holder
  // is always fully lit and shown as a fixed chip.
  const others = createMemo(() =>
    playerChars().filter((r) => (r.id as EntityId) !== props.source.holderId),
  );

  return (
    <div class="flex flex-col gap-1 pt-0.5" data-testid="light-coverage-editor">
      {/* Full light — holder is a fixed bearer chip, others toggle. */}
      <div class="flex flex-wrap items-center gap-1" data-testid="light-full-editor">
        <span class="text-[0.55rem] uppercase tracking-wide text-fg-subtle">Full</span>
        <span
          class="rounded-(--radius-control) border border-accent bg-accent/20 px-1.5 py-0.5 text-[0.6rem] leading-tight text-accent opacity-70"
          title="The bearer is always in full light"
          data-testid="light-holder-chip"
        >
          <HolderName holderId={props.source.holderId} /> ☀
        </span>
        <For each={others()}>
          {(row) => {
            const charId = row.id as EntityId;
            const char = row.values.Character as { name: string };
            const isChecked = (): boolean => covered().has(charId);
            const isDisabled = (): boolean => !isChecked() && remainingFull() <= 0;
            return (
              <button
                type="button"
                onClick={() => toggleFull(charId)}
                disabled={isDisabled()}
                class={`rounded-(--radius-control) border px-1.5 py-0.5 text-[0.6rem] leading-tight transition-colors ${
                  isChecked()
                    ? "border-accent bg-accent/20 text-accent"
                    : "border-border bg-surface text-fg-subtle"
                } disabled:opacity-40`}
                title={
                  isDisabled()
                    ? `Full light covers at most ${max()} (incl. bearer)`
                    : isChecked()
                      ? `Remove ${char.name} from full light`
                      : `Add ${char.name} to full light`
                }
              >
                {char.name}
              </button>
            );
          }}
        </For>
      </div>
      {/* Dim light — same capacity as full; mutually exclusive with full. */}
      <div class="flex flex-wrap items-center gap-1" data-testid="light-dim-editor">
        <span class="text-[0.55rem] uppercase tracking-wide text-fg-subtle">Dim</span>
        <For each={others()}>
          {(row) => {
            const charId = row.id as EntityId;
            const char = row.values.Character as { name: string };
            const isChecked = (): boolean => dim().has(charId);
            const isFull = (): boolean => covered().has(charId);
            const isDisabled = (): boolean => isFull() || (!isChecked() && dim().size >= max());
            return (
              <button
                type="button"
                onClick={() => toggleDim(charId)}
                disabled={isDisabled()}
                class={`rounded-(--radius-control) border px-1.5 py-0.5 text-[0.6rem] leading-tight transition-colors ${
                  isChecked()
                    ? "border-warning bg-warning/20 text-warning"
                    : "border-border bg-surface text-fg-subtle"
                } disabled:opacity-40`}
                title={
                  isFull()
                    ? `${char.name} is in full light`
                    : isDisabled()
                      ? `Dim light covers at most ${max()}`
                      : isChecked()
                        ? `Remove ${char.name} from dim light`
                        : `Add ${char.name} to dim light`
                }
              >
                {char.name}
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

function SourceRow(props: {
  source: LitSource;
  isGm: boolean;
  editing: boolean;
  onToggleEdit: () => void;
  assignment:
    | { coveredCharacterIds: EntityId[]; dimCharacterIds?: EntityId[]; maxCoverage: number }
    | undefined;
}): JSX.Element {
  // `editing` lives in the parent (keyed by src.key) so the open state
  // survives <For> recreating this row when useLitSources rebuilds objects.
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
          <span class="text-fg-subtle">({props.source.turnsRemaining}t)</span>
        </Show>
        <Show when={props.isGm}>
          <button
            type="button"
            onClick={() => props.onToggleEdit()}
            class="ml-auto rounded-(--radius-control) border border-border bg-surface px-1.5 py-0.5 text-[0.6rem] text-fg-subtle hover:text-fg"
            data-testid="light-edit-coverage"
          >
            {props.editing ? "done" : "assign"}
          </button>
        </Show>
      </div>
      {/* Full-light coverage badges (includes the bearer). */}
      <Show when={(props.assignment?.coveredCharacterIds.length ?? 0) > 0}>
        <div class="flex flex-wrap gap-0.5">
          <For each={props.assignment?.coveredCharacterIds ?? []}>
            {(cid) => <CharacterBadge characterId={cid} />}
          </For>
        </div>
      </Show>
      {/* Dim-light badges for this source. */}
      <Show when={(props.assignment?.dimCharacterIds?.length ?? 0) > 0}>
        <div class="flex flex-wrap gap-0.5">
          <For each={props.assignment?.dimCharacterIds ?? []}>
            {(cid) => (
              <span class="inline-block rounded-(--radius-control) border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[0.6rem] leading-tight text-warning">
                <LiveCharName characterId={cid} />
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.editing}>
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
  // Which source's editor is open, keyed by the stable src.key. Held here in
  // the parent (not in SourceRow) so it survives <For> recreating rows.
  const [openKey, setOpenKey] = createSignal<string | null>(null);

  const coverage = useTrait(GRIND_SENTINEL_ID, LightCoverage) as () =>
    | {
        assignments: Record<
          string,
          {
            holderId?: EntityId;
            coveredCharacterIds: EntityId[];
            dimCharacterIds?: EntityId[];
            maxCoverage: number;
          }
        >;
      }
    | undefined;

  const count = createMemo(() => litSources().length);

  // All player character IDs (excludes monsters and NPCs).
  const playerChars = usePlayerCharacters();
  const playerCharIds = createMemo(() => playerChars().map((r) => r.id as EntityId));

  // Live full/dim/dark classification (brightest-wins). The bearer of every
  // lit source is always in full light, even before any coverage is assigned.
  // `dimCharacterIds ?? []` guards legacy assignments that predate the field.
  const classification = createMemo(() => {
    const full = new Set<string>();
    for (const src of litSources()) full.add(src.holderId);
    const asgn = coverage()?.assignments ?? {};
    for (const a of Object.values(asgn)) {
      for (const cid of a.coveredCharacterIds) full.add(cid);
    }
    const dim = new Set<string>();
    for (const a of Object.values(asgn)) {
      for (const cid of a.dimCharacterIds ?? []) {
        if (!full.has(cid)) dim.add(cid);
      }
    }
    const dimList = playerCharIds().filter((id) => dim.has(id));
    const darkList = playerCharIds().filter((id) => !full.has(id) && !dim.has(id));
    return { full, dimList, darkList };
  });

  const inDarkness = createMemo(() => classification().darkList);
  const inDim = createMemo(() => classification().dimList);

  return (
    <Show when={count() > 0}>
      <div data-testid="light-tracker" class="relative flex items-center gap-1.5 text-xs">
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
            class="absolute bottom-full right-0 z-50 mb-1 w-72 rounded-(--radius-panel) border border-border bg-surface-elevated p-2 shadow-lg"
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
                  editing={openKey() === src.key}
                  onToggleEdit={() => setOpenKey(openKey() === src.key ? null : src.key)}
                  assignment={coverage()?.assignments[src.key]}
                />
              )}
            </For>
            <Show when={inDim().length > 0}>
              <div class="mt-1 border-t border-border pt-1" data-testid="light-dim-section">
                <div
                  class="font-display text-[0.6rem] uppercase tracking-[0.14em] text-warning"
                  title="Dim light: +1 Ob on all tests except riddling (DH p.43)"
                >
                  Dim Light
                </div>
                <div class="flex flex-wrap gap-0.5 pt-0.5">
                  <For each={inDim()}>
                    {(cid) => (
                      <span class="inline-block rounded-(--radius-control) border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[0.6rem] leading-tight text-warning">
                        <LiveCharName characterId={cid} />
                      </span>
                    )}
                  </For>
                </div>
              </div>
            </Show>
            <Show when={inDarkness().length > 0}>
              <div class="mt-1 border-t border-border pt-1">
                <div class="font-display text-[0.6rem] uppercase tracking-[0.14em] text-fg-subtle">
                  In Darkness
                </div>
                <div class="flex flex-wrap gap-0.5 pt-0.5">
                  <For each={inDarkness()}>
                    {(cid) => (
                      <span class="inline-block rounded-(--radius-control) border border-border bg-surface px-1.5 py-0.5 text-[0.6rem] leading-tight text-fg-subtle">
                        <LiveCharName characterId={cid} />
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
  id: qualifiedName("@vtt/system-torchbearer/light-tracker") as WorkbenchStatusItem["id"],
  priority: 90,
  render: () => LightTracker(),
};
