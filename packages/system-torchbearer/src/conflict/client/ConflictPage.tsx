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

import type { CommandInstance, EntityId } from "@vtt/substrate";
import { definePageProvider, RetargetTab } from "@vtt/shell-workbench/shared";
import { useClient, useQuery } from "@vtt/substrate/client";
import {
  createMemo,
  createSignal,
  For,
  Show,
  type JSX,
} from "solid-js";
import { Character, SetField, Team } from "@vtt/characters/shared";
import {
  ALL_CONFLICT_TYPES,
  DeclareConflict,
  TB_CONFLICT_TYPES,
  TbConflict,
  TbConflictParticipant,
  type ConflictType,
} from "../shared/index.js";
import { useConflict, useScript } from "./hooks.js";
import { TopStripe } from "./TopStripe.js";
import { TeamColumn } from "./TeamColumn.js";
import { ResolutionRow } from "./ResolutionRow.js";
import { ActionMatrix } from "./ActionMatrix.js";
import { WeaponPanel } from "./WeaponPanel.js";
import { ArmorRulesLegend, ArmorSidePanel } from "./ArmorPanel.js";
import { ConditionsPanel } from "./ConditionsPanel.js";
import { CompromisePanel } from "./CompromisePanel.js";
import { useMe } from "./use-me.js";

export const CONFLICT_PAGE_KIND = "@vtt/system-torchbearer/conflict";

/**
 * Workbench page provider for the Reference Board. Lists every
 * `TbConflict` entity in the world; clicking opens the live board.
 * Empty branch is the management hub: list every conflict + an
 * inline declare-conflict form (GM only). Mirrors the
 * Notes / Characters / Books / Items hub pattern.
 */
export const ConflictPageProvider = definePageProvider({
  kind: CONFLICT_PAGE_KIND,
  icon: "swords",
  label: "Conflicts",
  reads: [TbConflict, TbConflictParticipant],
  list: ({ world }) => {
    const out: { id: EntityId; label: string }[] = [];
    for (const row of world.query([TbConflict])) {
      const c = row.values.TbConflict as ReturnType<typeof TbConflict>["value"];
      const label =
        c.locationLabel || `${TB_CONFLICT_TYPES[c.type].label} (round ${c.round})`;
      out.push({ id: row.id, label });
    }
    return out;
  },
  defaultEntity: () => null,
  render: ({ tabId, entityId }) =>
    (<ConflictPage tabId={tabId} entityId={entityId} />) as unknown,
});

function ConflictPage(props: {
  tabId: string;
  entityId: EntityId | null;
}): JSX.Element {
  return (
    <Show
      when={props.entityId}
      fallback={
        <section class="flex h-full flex-col gap-3">
          <ConflictsHub tabId={props.tabId} />
        </section>
      }
    >
      {(idAcc) => <ConflictBoard conflictId={idAcc() as EntityId} />}
    </Show>
  );
}

/* -------------------------------------------------------------------------
 * Hub view — empty state + list + create form
 * ----------------------------------------------------------------------- */

function ConflictsHub(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const conflictRows = useQuery([TbConflict]);

  const conflicts = createMemo(() =>
    conflictRows()
      .map((row) => {
        const c = row.values.TbConflict as ReturnType<typeof TbConflict>["value"];
        return {
          id: row.id as EntityId,
          label:
            c.locationLabel ||
            `${TB_CONFLICT_TYPES[c.type].label} (round ${c.round})`,
          type: c.type,
          round: c.round,
          winner: c.winner,
          ended: c.endedAt !== null,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  const open = (id: EntityId): void => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: CONFLICT_PAGE_KIND,
        entityId: id,
      }) as CommandInstance,
    );
  };

  const isGm = (): boolean => me()?.role === "gm";

  return (
    <div class="flex h-full items-start justify-center overflow-y-auto py-10">
      <div class="flex w-full max-w-lg flex-col gap-6 px-5">
        <Show
          when={conflicts().length > 0}
          fallback={
            <div class="flex flex-col items-center gap-5 text-center">
              <p
                class="font-display text-2xl tracking-tight text-fg-muted"
                style={{ "font-family": "var(--font-display)" }}
              >
                No conflicts yet — declare the first one.
              </p>
              <Show
                when={me()}
                fallback={
                  <p class="text-xs text-fg-subtle">
                    sign in to declare a conflict…
                  </p>
                }
              >
                <Show
                  when={isGm()}
                  fallback={
                    <p class="text-xs text-fg-subtle">
                      only the GM can declare a conflict
                    </p>
                  }
                >
                  <DeclareConflictForm tabId={props.tabId} />
                </Show>
              </Show>
            </div>
          }
        >
          <header class="flex items-baseline justify-between">
            <h2
              class="font-display text-xl tracking-tight text-fg"
              style={{ "font-family": "var(--font-display)" }}
            >
              Conflicts
            </h2>
            <span class="font-display text-[0.62rem] uppercase tracking-[0.16em] text-fg-subtle">
              {conflicts().length} total
            </span>
          </header>
          <ul class="flex flex-col gap-1">
            <For each={conflicts()}>
              {(c) => (
                <li class="group flex items-center gap-3 rounded-(--radius-control) border border-border-muted bg-surface-elevated px-3 py-2">
                  <button
                    type="button"
                    onClick={() => open(c.id)}
                    data-testid={`open-conflict-${c.id}`}
                    class="flex-1 truncate text-left text-sm text-fg hover:text-accent transition"
                    title={c.label}
                  >
                    <span class="font-display">{c.label}</span>
                    <span class="ml-2 text-fg-subtle">
                      · {TB_CONFLICT_TYPES[c.type as ConflictType].label} ·
                      round {c.round}
                      {c.winner ? ` · ${c.winner} won` : ""}
                      {c.ended ? " · ended" : ""}
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <Show when={isGm()}>
            <div class="mt-2 flex flex-col gap-3 border-t border-border-muted pt-5">
              <h3 class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
                Declare a new conflict
              </h3>
              <DeclareConflictForm tabId={props.tabId} />
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Declare form
 * ----------------------------------------------------------------------- */

interface CharacterRow {
  readonly id: EntityId;
  readonly name: string;
  readonly team: "party" | "enemy";
}

function DeclareConflictForm(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const charRows = useQuery([Character]);
  const teamRows = useQuery([Team]);

  const characters = createMemo<CharacterRow[]>(() => {
    const teams = new Map<EntityId, "party" | "enemy">();
    for (const r of teamRows()) {
      const t = r.values.Team as { kind: "party" | "enemy" };
      teams.set(r.id, t.kind);
    }
    const out: CharacterRow[] = [];
    for (const r of charRows()) {
      const c = r.values.Character as { name: string };
      out.push({
        id: r.id,
        name: c.name,
        team: teams.get(r.id) ?? "party",
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });

  const toggleTeam = (c: CharacterRow): void => {
    const next = c.team === "party" ? "enemy" : "party";
    client.dispatch(
      SetField({
        characterId: c.id,
        trait: Team.name,
        path: ["kind"],
        value: next,
      }) as CommandInstance,
    );
    // If we just flipped a selected party or enemy out of its bucket,
    // drop it so the form stays consistent.
    if (next === "enemy" && partyIds().has(c.id)) {
      setPartyIds((cur) => {
        const n = new Set(cur);
        n.delete(c.id);
        return n;
      });
      if (captainId() === c.id) setCaptainId(null);
    }
    if (next === "party" && enemyIds().has(c.id)) {
      setEnemyIds((cur) => {
        const n = new Set(cur);
        n.delete(c.id);
        return n;
      });
    }
  };

  const partyChars = createMemo(() => characters().filter((c) => c.team === "party"));
  const enemyChars = createMemo(() => characters().filter((c) => c.team === "enemy"));

  const [type, setType] = createSignal<ConflictType>("kill");
  const [location, setLocation] = createSignal("");
  const [captainId, setCaptainId] = createSignal<EntityId | null>(null);
  const [partyIds, setPartyIds] = createSignal<Set<EntityId>>(new Set());
  const [enemyIds, setEnemyIds] = createSignal<Set<EntityId>>(new Set());
  const [busy, setBusy] = createSignal(false);

  const togglePartyMember = (id: EntityId): void => {
    setPartyIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) {
        next.delete(id);
        if (captainId() === id) setCaptainId(null);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const toggleEnemyMember = (id: EntityId): void => {
    setEnemyIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSubmit = createMemo(
    () =>
      partyIds().size > 0 &&
      enemyIds().size > 0 &&
      captainId() !== null &&
      partyIds().has(captainId() as EntityId) &&
      !busy(),
  );

  const submit = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault();
    if (!canSubmit()) return;
    setBusy(true);
    const partyParticipants = [...partyIds()].map((id) => ({
      characterId: id,
    }));
    const enemyParticipants = [...enemyIds()].map((id) => ({
      characterId: id,
    }));
    const before = new Set(
      client.world.query([TbConflict]).map((r) => r.id as string),
    );
    const handle = client.dispatch(
      DeclareConflict({
        type: type(),
        locationLabel: location(),
        captainCharacterId: captainId() as EntityId,
        partyParticipants,
        enemyParticipants,
      }) as CommandInstance,
    );
    try {
      await handle.ack;
      const newId = client.world
        .query([TbConflict])
        .map((r) => r.id as string)
        .find((id) => !before.has(id));
      if (newId) {
        client.dispatch(
          RetargetTab({
            tabId: props.tabId,
            pageKind: CONFLICT_PAGE_KIND,
            entityId: newId as EntityId,
          }) as CommandInstance,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      class="flex flex-col gap-3"
      data-testid="declare-conflict-form"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
    >
      <label class="grid grid-cols-[6rem,1fr] gap-2 items-center text-sm">
        <span class="text-xs uppercase tracking-wider text-fg-subtle">
          Type
        </span>
        <select
          value={type()}
          onChange={(e) => setType(e.currentTarget.value as ConflictType)}
          class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-sm text-fg"
          data-testid="declare-type"
        >
          <For each={ALL_CONFLICT_TYPES}>
            {(t) => <option value={t}>{TB_CONFLICT_TYPES[t].label}</option>}
          </For>
        </select>
      </label>
      <label class="grid grid-cols-[6rem,1fr] gap-2 items-center text-sm">
        <span class="text-xs uppercase tracking-wider text-fg-subtle">
          Location
        </span>
        <input
          type="text"
          value={location()}
          onInput={(e) => setLocation(e.currentTarget.value)}
          placeholder="e.g. Dread Crypt of Skogenby"
          class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          data-testid="declare-location"
          autocomplete="off"
          spellcheck={false}
          name="conflict-location"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
        />
      </label>

      <fieldset class="flex flex-col gap-2 border-0 p-0">
        <legend class="text-xs uppercase tracking-wider text-fg-subtle">
          Party ({partyIds().size}) · captain marked ★
        </legend>
        <Show
          when={partyChars().length > 0}
          fallback={
            <p class="text-xs text-fg-subtle italic">
              No party characters in this world. Create one in the
              Characters tab first.
            </p>
          }
        >
          <ul class="flex flex-wrap gap-1">
            <For each={partyChars()}>
              {(c) => (
                <CharChip
                  c={c}
                  selected={partyIds().has(c.id)}
                  onToggle={() => togglePartyMember(c.id)}
                  badge={
                    captainId() === c.id ? (
                      <span aria-label="captain">★</span>
                    ) : partyIds().has(c.id) ? (
                      // Renders inside a selected (bg-accent) chip,
                      // so use accent-fg for legible white-on-green
                      // contrast — fg-subtle was unreadable.
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCaptainId(c.id);
                        }}
                        class="text-[0.65rem] underline text-accent-fg/80 hover:text-accent-fg"
                        data-testid={`make-captain-${c.id}`}
                      >
                        captain?
                      </button>
                    ) : null
                  }
                  testId={`party-chip-${c.id}`}
                />
              )}
            </For>
          </ul>
        </Show>
      </fieldset>

      <fieldset class="flex flex-col gap-2 border-0 p-0">
        <legend class="text-xs uppercase tracking-wider text-fg-subtle">
          Enemy ({enemyIds().size}) · enemy-team characters
        </legend>
        <Show
          when={enemyChars().length > 0}
          fallback={
            <p class="text-xs text-fg-subtle italic">
              No enemy-team characters yet. Use "Switch team" below to flip a
              character to the enemy side.
            </p>
          }
        >
          <ul class="flex flex-wrap gap-1">
            <For each={enemyChars()}>
              {(c) => (
                <CharChip
                  c={c}
                  selected={enemyIds().has(c.id)}
                  onToggle={() => toggleEnemyMember(c.id)}
                  testId={`enemy-chip-${c.id}`}
                />
              )}
            </For>
          </ul>
        </Show>
      </fieldset>

      <fieldset class="flex flex-col gap-1 border-t border-border-muted pt-2">
        <legend class="text-xs uppercase tracking-wider text-fg-subtle">
          Switch team
        </legend>
        <p class="text-[0.7rem] text-fg-subtle">
          Flip a character between the party and enemy teams (e.g. to make an
          NPC monster an enemy).
        </p>
        <Show
          when={characters().length > 0}
          fallback={
            <p class="text-xs text-fg-subtle italic">
              No characters yet. Create one in the Characters tab.
            </p>
          }
        >
          <ul class="flex flex-col gap-0.5 text-xs max-h-40 overflow-y-auto">
            <For each={characters()}>
              {(c) => (
                <li class="flex items-center gap-2">
                  <span class="flex-1 text-fg">{c.name}</span>
                  <span class="font-mono text-fg-subtle text-[0.7rem]">
                    {c.team}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleTeam(c)}
                    data-testid={`toggle-team-${c.id}`}
                    class="rounded-(--radius-control) border border-border-muted bg-surface-elevated px-2 py-0.5 text-[0.7rem] hover:border-accent"
                    title={`Move to ${c.team === "party" ? "enemy" : "party"} side`}
                  >
                    → {c.team === "party" ? "enemy" : "party"}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </fieldset>

      <button
        type="submit"
        disabled={!canSubmit()}
        data-testid="declare-submit"
        class="rounded-(--radius-control) border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy() ? "Declaring…" : "Declare conflict"}
      </button>
      <p class="text-[0.7rem] text-fg-subtle">
        Pick at least one party, designate a captain, and pick at least one
        enemy.
      </p>
    </form>
  );
}

function CharChip(props: {
  c: CharacterRow;
  selected: boolean;
  onToggle: () => void;
  badge?: JSX.Element;
  testId: string;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={props.onToggle}
        data-testid={props.testId}
        class="rounded-(--radius-control) border px-2 py-1 text-xs flex items-center gap-1 transition"
        classList={{
          "border-accent bg-accent text-accent-fg": props.selected,
          "border-border-muted bg-surface text-fg hover:border-accent":
            !props.selected,
        }}
      >
        <span>{props.c.name}</span>
        {props.badge}
      </button>
    </li>
  );
}

/* -------------------------------------------------------------------------
 * Live board
 * ----------------------------------------------------------------------- */

/**
 * Live board for one conflict. Slim, data-driven layout:
 *
 *   - TopStripe: type, location, round, end-conflict (GM)
 *   - Two TeamColumns side-by-side: per-side dispo input, roster
 *     with HP + weapon edit, inline scripting + lock
 *   - ResolutionRow between/below: matchup hint + reveal-next
 *   - ActionMatrix / WeaponPanel / ArmorPanel / ConditionsPanel as
 *     reference panels below the fold
 *   - DamageDistributor pop-in when overflow needs distribution
 *   - CompromisePanel when the conflict ends in compromise
 *
 * Every component subscribes to its own slice via useTrait/useQuery
 * (passing `conflictId` as a stable string, never a snapshotted
 * value object). That's why the board reacts to remote dispo / HP
 * / phase / script updates.
 */
function ConflictBoard(props: { conflictId: EntityId }): JSX.Element {
  const conflict = useConflict(props.conflictId);
  const partyScript = useScript(props.conflictId, "party");
  const enemyScript = useScript(props.conflictId, "enemy");

  const matrixHighlight = createMemo(() => {
    const c = conflict();
    if (!c) return undefined;
    const partyS = partyScript();
    const enemyS = enemyScript();
    if (!partyS || !enemyS) return undefined;
    const idx = Math.max(0, c.revealIndex - 1);
    const partySlot = partyS.slots[idx];
    const enemySlot = enemyS.slots[idx];
    if (
      partySlot?.status === "revealed" &&
      enemySlot?.status === "revealed"
    ) {
      return {
        partyAction: partySlot.action,
        enemyAction: enemySlot.action,
      };
    }
    return undefined;
  });

  return (
    <Show
      when={conflict()}
      fallback={
        <p class="text-fg-subtle italic px-5 py-4">
          Conflict not found or no longer visible.
        </p>
      }
    >
      <div class="flex h-full flex-col overflow-y-auto bg-surface text-fg">
        <TopStripe conflictId={props.conflictId} />
        <div
          class="grid"
          style={{ "grid-template-columns": "1fr 1fr" }}
          data-testid="team-columns"
        >
          <TeamColumn
            conflictId={props.conflictId}
            side="party"
            title="Party"
          />
          <TeamColumn
            conflictId={props.conflictId}
            side="enemy"
            title="Enemy"
          />
        </div>
        <ResolutionRow conflictId={props.conflictId} />
        <ActionMatrix highlight={matrixHighlight()} />
        <div data-testid="combat-aids">
          <WeaponPanel
            conflictId={props.conflictId}
            side="party"
            title="Party Weapons"
          />
          <ArmorSidePanel
            conflictId={props.conflictId}
            side="party"
            title="Party Armor"
          />
          <WeaponPanel
            conflictId={props.conflictId}
            side="enemy"
            title="Enemy Weapons"
          />
          <ArmorSidePanel
            conflictId={props.conflictId}
            side="enemy"
            title="Enemy Armor"
          />
          <ArmorRulesLegend />
        </div>
        <ConditionsPanel conflictId={props.conflictId} />
        <Show
          when={
            conflict()?.winner !== null && conflict()?.endedAt === null
          }
        >
          <CompromisePanel conflictId={props.conflictId} />
        </Show>
        <Show when={conflict()?.endedAt !== null}>
          <p
            class="px-5 py-4 font-display text-lg uppercase tracking-wider text-fg"
            data-testid="conflict-ended-banner"
          >
            {conflict()?.winner
              ? `${conflict()?.winner} won.`
              : "Conflict ended."}
          </p>
        </Show>
        <span class="px-5 py-2 text-[0.65rem] text-fg-subtle font-mono">
          conflict {props.conflictId}
        </span>
      </div>
    </Show>
  );
}
