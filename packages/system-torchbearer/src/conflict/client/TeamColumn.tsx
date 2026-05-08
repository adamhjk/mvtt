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
import { useClient, useTrait, useQuery } from "@vtt/substrate/client";
import { BookCitation } from "@vtt/books/client";
import { createMemo, For, Show, type JSX } from "solid-js";
import { ItemDerivedFrom, ItemIdentity } from "@vtt/items/shared";
import { canWrite, Permissions } from "@vtt/permissions/shared";
import { TbCarries, TbConflictResource, TbWeapon } from "../../shared/index.js";
import { TbMonster } from "../../shared/monster-traits.js";
import { tbCanonicalBookAbbreviation } from "../../data/seed.js";
import {
  ChooseWeapon,
  SetParticipantHp,
  SetTeamDisposition,
  TB_CONFLICT_TYPES,
  dispoRollLabel,
  type ConflictSide,
  type ConflictType,
} from "../shared/index.js";
import {
  useCharacterName,
  useConflict,
  useGloballyCarriedItemIds,
  useParticipants,
  useScript,
  useWeaponBindings,
} from "./hooks.js";
import { useMe } from "./use-me.js";
import { ScriptInline } from "./ScriptInline.js";

/**
 * Render label for a `<BookCitation>` from a TB pageRef. Resolves the
 * canonicalId to a TB abbreviation when known (`"LMM p.261"`); falls
 * back to a generic `"p.<page>"` for unknown books.
 */
function citationLabel(canonicalId: string, page: number): string {
  const abbrev = tbCanonicalBookAbbreviation(canonicalId);
  return abbrev !== null ? `${abbrev} p.${page}` : `p.${page}`;
}

/**
 * One full per-side column: editable dispo box at the top, roster
 * rows with HP + weapon picker per participant, and the inline
 * scripting / lock controls. Everything subscribes to its own slice
 * via useTrait/useQuery so the column reacts to remote updates.
 */
export function TeamColumn(props: {
  conflictId: EntityId;
  side: ConflictSide;
  title: string;
}): JSX.Element {
  const me = useMe();
  const isGm = (): boolean => me()?.role === "gm";
  const conflict = useConflict(props.conflictId);
  const participants = useParticipants(props.conflictId, props.side);

  const dispo = createMemo(() => {
    const c = conflict();
    if (!c) return { current: 0, max: 0 };
    return props.side === "party" ? c.dispoParty : c.dispoEnemy;
  });
  const allocated = createMemo(() =>
    participants().reduce((s, p) => s + p.hpMax, 0),
  );
  const participantsBelowOne = createMemo(
    () => participants().filter((p) => p.hpMax < 1).length,
  );

  return (
    <section
      class="px-3 py-3 border-r border-border-muted last:border-r-0 flex flex-col gap-3"
      data-testid={`team-column-${props.side}`}
    >
      <h2
        class="font-display text-[0.7rem] uppercase tracking-[0.16em]"
        classList={{
          "text-accent": props.side === "party",
          "text-warning": props.side === "enemy",
        }}
      >
        {props.title}
      </h2>

      <DispositionBox
        conflictId={props.conflictId}
        side={props.side}
        current={dispo().current}
        max={dispo().max}
        canEdit={isGm()}
        allocated={allocated()}
        participantCount={participants().length}
        participantsBelowOne={participantsBelowOne()}
        conflictType={conflict()?.type ?? null}
      />

      <Show
        when={participants().length > 0}
        fallback={
          <p class="text-fg-subtle italic text-xs">No participants.</p>
        }
      >
        <ul class="flex flex-col gap-1.5">
          <For each={participants()}>
            {(p) => (
              <li>
                <ParticipantRow
                  conflictId={props.conflictId}
                  side={props.side}
                  participantEntityId={p.entityId}
                  characterId={p.characterId}
                  label={p.label}
                  hp={p.hp}
                  hpMax={p.hpMax}
                  knockedOut={p.knockedOut}
                  canEdit={isGm()}
                  dispoCurrent={dispo().current}
                  dispoMax={dispo().max}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>

      <ScriptInline conflictId={props.conflictId} side={props.side} />
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Dispo box — GM types in side-max disposition. When max is set and
 * current was 0, current jumps to match (the captain just rolled
 * dispo, we want the scoreboard to start full). The allocation
 * ticker below shows sum-of-participant-HPs vs max, so the GM can
 * eyeball whether the team's HP is fully distributed.
 * ----------------------------------------------------------------------- */

function DispositionBox(props: {
  conflictId: EntityId;
  side: ConflictSide;
  current: number;
  max: number;
  canEdit: boolean;
  allocated: number;
  participantCount: number;
  participantsBelowOne: number;
  conflictType: ConflictType | null;
}): JSX.Element {
  const client = useClient();
  const setDispo = (current: number, max: number): void => {
    if (current < 0 || max < 0 || current > max) return;
    client.dispatch(
      SetTeamDisposition({
        conflictId: props.conflictId,
        side: props.side,
        current,
        max,
      }) as CommandInstance,
    );
  };
  const setMax = (raw: number): void => {
    const max = Math.max(0, Math.min(99, raw));
    // If current was 0, jump it to the new max — the GM's just
    // committed disposition for the round and the scoreboard should
    // start full. Otherwise preserve current (dispo in progress).
    const nextCurrent = props.current === 0 ? max : Math.min(props.current, max);
    setDispo(nextCurrent, max);
  };
  const pct = (): number => {
    if (props.max === 0) return 0;
    return Math.max(0, Math.min(100, (props.current / props.max) * 100));
  };
  const allocationMatches = (): boolean =>
    props.max > 0 && props.allocated === props.max;
  const everyoneEngaged = (): boolean => props.participantsBelowOne === 0;
  // Compromise zones per Scholar's Guide p.75:
  //   exactly full         → no compromise (clean win)            → green
  //   > 1/2 starting dispo → minor compromise                     → yellow
  //   ~ 1/2 starting dispo → half compromise                      → orange
  //   few points left      → major compromise (winner barely held)→ red
  // Same on both sides — health-bar conventions read the same way
  // regardless of party or enemy. Empty bar (0/0) shows muted.
  const compromiseLevel = ():
    | "full"
    | "minor"
    | "half"
    | "major"
    | null => {
    if (props.max === 0) return null;
    if (props.current >= props.max) return "full";
    if (props.current === 0) return "major";
    const ratio = props.current / props.max;
    if (ratio > 0.5) return "minor";
    if (ratio > 0.25) return "half";
    return "major";
  };
  const compromiseColor = (): string => {
    switch (compromiseLevel()) {
      case "full":
        return "var(--color-success, #2F8A4A)";
      case "minor":
        return "#C9A227"; // yellow
      case "half":
        return "#C97C27"; // amber/orange
      case "major":
        return "var(--color-danger, #B83227)";
      default:
        return "var(--color-fg-subtle, #888)";
    }
  };
  const rollPrompt = (): string | null => {
    const t = props.conflictType;
    if (!t) return null;
    return dispoRollLabel(TB_CONFLICT_TYPES[t]);
  };
  return (
    <div
      class="rounded-(--radius-control) border border-border-muted bg-surface-elevated px-3 py-2"
      data-testid={`dispo-box-${props.side}`}
    >
      <div class="flex items-baseline justify-between mb-1">
        <span class="font-display text-[0.7rem] uppercase tracking-wider text-fg-subtle">
          Disposition
        </span>
        <span class="font-mono text-sm text-fg" data-testid={`dispo-readout-${props.side}`}>
          {props.current} / {props.max}
        </span>
      </div>
      <Show when={rollPrompt()}>
        <p
          class="text-[0.7rem] text-fg-muted italic mb-1"
          data-testid={`dispo-roll-prompt-${props.side}`}
        >
          {rollPrompt()} for disposition
        </p>
      </Show>
      <Show when={props.canEdit}>
        <div class="flex items-center gap-3 text-xs font-mono mt-1">
          <label class="flex items-center gap-1.5">
            <span class="text-fg-subtle uppercase tracking-wider text-[0.6rem]">
              Cur
            </span>
            <input
              type="number"
              min="0"
              max={props.max}
              value={props.current}
              onChange={(e) => {
                const v = Number.parseInt(e.currentTarget.value, 10);
                if (Number.isFinite(v))
                  setDispo(Math.min(props.max, Math.max(0, v)), props.max);
              }}
              class="w-12 rounded-(--radius-control) border border-border bg-surface px-1.5 py-0.5 text-fg"
              data-testid={`dispo-current-${props.side}`}
              aria-label="current disposition"
            />
          </label>
          <label class="flex items-center gap-1.5">
            <span class="text-fg-subtle uppercase tracking-wider text-[0.6rem]">
              Max
            </span>
            <input
              type="number"
              min="0"
              max="99"
              value={props.max}
              onChange={(e) => {
                const v = Number.parseInt(e.currentTarget.value, 10);
                if (Number.isFinite(v)) setMax(v);
              }}
              class="w-12 rounded-(--radius-control) border border-border bg-surface px-1.5 py-0.5 text-fg"
              data-testid={`dispo-max-${props.side}`}
              aria-label="max disposition"
            />
          </label>
        </div>
      </Show>
      <div
        class="h-1.5 mt-2 rounded-sm bg-border-muted overflow-hidden"
        data-testid={`dispo-bar-${props.side}`}
        data-compromise={compromiseLevel() ?? "none"}
      >
        <div
          class="h-full transition-all duration-200"
          style={{
            width: `${pct()}%`,
            "background-color": compromiseColor(),
          }}
        />
      </div>
      <Show when={props.max > 0 || props.allocated > 0}>
        <div
          class="mt-1.5 flex items-baseline justify-between gap-2 text-[0.7rem] font-mono"
          data-testid={`dispo-allocation-${props.side}`}
        >
          <span class="text-fg-subtle uppercase tracking-wider text-[0.6rem]">
            allocated
          </span>
          <span
            class="font-semibold"
            style={{
              color: allocationMatches()
                ? "var(--color-success, #2F8A4A)"
                : "var(--color-warning, #8C6210)",
            }}
          >
            {props.allocated} / {props.max} HP
          </span>
        </div>
      </Show>
      <Show when={props.participantCount > 0 && !everyoneEngaged()}>
        <p
          class="mt-0.5 text-[0.65rem] italic"
          style={{ color: "var(--color-warning, #8C6210)" }}
          data-testid={`dispo-engagement-warning-${props.side}`}
        >
          {props.participantsBelowOne} participant
          {props.participantsBelowOne === 1 ? "" : "s"} need at least 1 HP to
          engage
        </p>
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Participant row: HP input + weapon dropdown (editable for GM)
 * ----------------------------------------------------------------------- */

function ParticipantRow(props: {
  conflictId: EntityId;
  side: ConflictSide;
  participantEntityId: EntityId;
  characterId: EntityId;
  label: string | undefined;
  hp: number;
  hpMax: number;
  knockedOut: boolean;
  canEdit: boolean;
  dispoCurrent: number;
  dispoMax: number;
}): JSX.Element {
  const client = useClient();
  const me = useMe();
  const characterName = useCharacterName(props.characterId);
  const name = createMemo(() => props.label ?? characterName());
  // Monster's printed-stat-block citation. Read live so the pill
  // updates when the GM (re)binds the canonical book or edits the
  // template's pageRef. Null for PCs / homebrew monsters with no
  // rulebook reference — the row falls back to just the name.
  const monster = useTrait(props.characterId, TbMonster);
  const monsterPageRef = createMemo(() => monster()?.pageRef ?? null);
  const bindings = useWeaponBindings(props.conflictId);
  const currentWeapon = createMemo(
    () => bindings().get(props.participantEntityId)?.weaponItemId ?? null,
  );

  // Weapon-pick permission is broader than HP edit:
  //   - GMs can always pick (covered by props.canEdit).
  //   - The character's owner can pick their own weapon (party
  //     members shouldn't have to ask the GM what to wield).
  // HP / knock-out / dispo math stays GM-only via props.canEdit
  // because they're conflict-scoring concerns, not character
  // expression. Server-side ChooseWeapon already accepts non-GMs;
  // this gate just unhides the dropdown for them.
  const characterPermissions = useTrait(props.characterId, Permissions);
  const canEditWeapon = createMemo(() => {
    if (props.canEdit) return true;
    return canWrite(
      me(),
      characterPermissions() as Parameters<typeof canWrite>[1],
    );
  });

  const carries = useTrait(props.characterId, TbCarries) as () =>
    | ReturnType<typeof TbCarries>["value"]
    | undefined;
  const allItems = useQuery([TbWeapon]);
  // For the dropdown's shared pool we restrict to catalog-derived
  // resources — monster weapons (no ItemDerivedFrom) stay with their
  // owner via the per-character carries branch only.
  const conflictResources = useQuery([
    TbWeapon,
    TbConflictResource,
    ItemDerivedFrom,
  ]);
  // The per-character branch still uses the unrestricted resource
  // index so a monster's own dropdown picks up its monstrous weapons
  // (which lack ItemDerivedFrom). Reads are O(1) by id.
  const allConflictResources = useQuery([TbWeapon, TbConflictResource]);
  const conflict = useConflict(props.conflictId);
  const globallyCarried = useGloballyCarriedItemIds();

  const weaponChoices = createMemo<EntityId[]>(() => {
    // Filter weapons to those relevant for the current conflict type
    // AND that this character can actually wield:
    //
    //   1. Weapons this character carries — generic items (no
    //      `TbConflictResource`, e.g. a sword) always qualify;
    //      conflict-bound items only when their `applicableConflicts`
    //      covers the conflict type. Spawned monster weapons live
    //      here for the monster they belong to.
    //   2. Shared catalog conflict-resources (Blackmail, Hostage,
    //      True Name, …) — entities that *no character carries*,
    //      filtered by conflict type. The Vampire Lord's Hideous Bite
    //      is carried by the lord and so excluded from anyone else's
    //      pool, even though it has a `TbConflictResource`.
    const ct = conflict()?.type;
    const carried = new Set(
      (carries()?.entries ?? []).map((e) => e.itemId as string),
    );
    const ownedByAnyone = globallyCarried();
    const matchesConflict = (cr: {
      applicableConflicts: ReadonlyArray<string>;
    }): boolean => {
      if (cr.applicableConflicts.length === 0) return true;
      if (!ct) return true;
      return cr.applicableConflicts.includes(ct);
    };
    const crById = new Map<
      string,
      { applicableConflicts: ReadonlyArray<string>; kind: string }
    >();
    for (const row of allConflictResources()) {
      crById.set(
        row.id as string,
        row.values.TbConflictResource as {
          applicableConflicts: ReadonlyArray<string>;
          kind: string;
        },
      );
    }
    const ids = new Set<string>();
    for (const row of allItems()) {
      if (!carried.has(row.id as string)) continue;
      const cr = crById.get(row.id as string);
      if (!cr) {
        ids.add(row.id as string);
      } else if (cr.kind === "weapon" && matchesConflict(cr)) {
        ids.add(row.id as string);
      }
    }
    for (const row of conflictResources()) {
      const id = row.id as string;
      if (ownedByAnyone.has(id)) continue; // already covered by per-character carries
      const cr = row.values.TbConflictResource as {
        applicableConflicts: ReadonlyArray<string>;
        kind: string;
        ownerCharacterId?: string | null;
      };
      // Owned-by-monster resources stay out of the shared pool even
      // when the local user can't read the owner's TbCarries.
      if (cr.ownerCharacterId) continue;
      if (cr.kind !== "weapon") continue;
      if (!matchesConflict(cr)) continue;
      ids.add(id);
    }
    return Array.from(ids) as EntityId[];
  });

  const setHp = (hp: number, hpMax: number): void => {
    if (hp < 0 || hpMax < 0 || hp > hpMax) return;
    client.dispatch(
      SetParticipantHp({
        conflictId: props.conflictId,
        participantEntityId: props.participantEntityId,
        hp,
        hpMax,
      }) as CommandInstance,
    );
  };
  const chooseWeapon = (id: EntityId | null): void => {
    client.dispatch(
      ChooseWeapon({
        conflictId: props.conflictId,
        participantEntityId: props.participantEntityId,
        weaponItemId: id,
      }) as CommandInstance,
    );
  };

  // Two controls per row, sharing one model (hp = current, hpMax =
  // allocated for this conflict):
  //   - −/+ buttons step current `hp`, clamped to [0, hpMax].
  //     Damage clicks "−"; Defend regroup clicks "+". hpMax stays put,
  //     so the GM can see "3 / 5" — Beren took 2 damage from 5.
  //   - The max input edits `hpMax` directly. If current was at the
  //     previous max (undamaged — i.e. allocation phase), current
  //     follows along; otherwise current is preserved (clamped to
  //     the new max if it shrinks).
  //
  // Per SG p.65, damage and Defend regroup move the side's
  // disposition by the same delta. Stepping HP also fires
  // SetTeamDisposition with `dispoCurrent + delta` (clamped to
  // [0, dispoMax]) so the scoreboard tracks automatically. The GM
  // can still type into the dispo box to correct drift.
  const setDispoCurrent = (next: number): void => {
    if (next === props.dispoCurrent) return;
    const clamped = Math.max(0, Math.min(props.dispoMax, next));
    if (clamped === props.dispoCurrent) return;
    client.dispatch(
      SetTeamDisposition({
        conflictId: props.conflictId,
        side: props.side,
        current: clamped,
        max: props.dispoMax,
      }) as CommandInstance,
    );
  };
  const bumpHp = (delta: number): void => {
    const next = Math.max(0, Math.min(props.hpMax, props.hp + delta));
    if (next === props.hp) return;
    const realDelta = next - props.hp;
    setHp(next, props.hpMax);
    setDispoCurrent(props.dispoCurrent + realDelta);
  };
  const setMax = (raw: number): void => {
    const max = Math.max(0, Math.min(99, raw));
    const wasUndamaged = props.hp >= props.hpMax;
    const nextHp = wasUndamaged ? max : Math.min(props.hp, max);
    setHp(nextHp, max);
  };
  const notEngaged = (): boolean => props.hpMax < 1;
  const damaged = (): boolean => props.hp < props.hpMax;

  return (
    <article
      class="flex items-center gap-2 text-sm"
      classList={{ "opacity-50": props.knockedOut }}
      data-testid={`participant-row-${props.participantEntityId}`}
    >
      <span class="font-display text-sm text-fg truncate flex-1 min-w-0 inline-flex items-baseline gap-1.5">
        <span class="truncate">{name()}</span>
        <Show when={monsterPageRef()}>
          {(ref) => (
            <BookCitation
              canonicalId={ref().canonicalId}
              page={ref().page}
              label={citationLabel(ref().canonicalId, ref().page)}
              ariaLabel={`open ${name()} stat block in ${ref().canonicalId} at page ${ref().page}`}
            />
          )}
        </Show>
        <Show when={props.knockedOut}>
          <span class="ml-1 text-[0.6rem] uppercase tracking-wider text-danger">
            ko
          </span>
        </Show>
      </span>

      <Show
        when={props.canEdit}
        fallback={
          <span class="font-mono text-xs text-fg-subtle whitespace-nowrap">
            {props.hp}/{props.hpMax}
          </span>
        }
      >
        <span
          class="flex items-center gap-0.5 font-mono text-xs"
          data-testid={`hp-stepper-${props.participantEntityId}`}
        >
          <button
            type="button"
            onClick={() => bumpHp(-1)}
            disabled={props.hp <= 0}
            data-testid={`hp-decrement-${props.participantEntityId}`}
            class="w-5 h-5 rounded-sm border border-border bg-surface text-fg-subtle hover:border-accent hover:text-fg transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center leading-none"
            aria-label={`Decrement current HP for ${name()}`}
          >
            −
          </button>
          <span
            class="w-6 text-center tabular-nums"
            data-testid={`hp-current-${props.participantEntityId}`}
            classList={{
              "text-warning": notEngaged(),
              "text-danger": props.hp === 0 && props.hpMax > 0,
              "text-fg-muted": damaged() && props.hp > 0,
              "text-fg": !damaged() && !notEngaged(),
            }}
            title={`${props.hp} / ${props.hpMax} HP`}
          >
            {props.hp}
          </span>
          <button
            type="button"
            onClick={() => bumpHp(1)}
            disabled={props.hp >= props.hpMax}
            data-testid={`hp-increment-${props.participantEntityId}`}
            class="w-5 h-5 rounded-sm border border-border bg-surface text-fg-subtle hover:border-accent hover:text-fg transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center leading-none"
            aria-label={`Increment current HP for ${name()}`}
          >
            +
          </button>
          <span class="text-fg-subtle mx-0.5">/</span>
          <input
            type="number"
            min="0"
            max="99"
            value={props.hpMax}
            onChange={(e) => {
              const v = Number.parseInt(e.currentTarget.value, 10);
              if (Number.isFinite(v)) setMax(v);
            }}
            class="w-9 rounded-sm border border-border bg-surface px-1 py-0.5 text-fg tabular-nums text-center"
            classList={{
              "border-warning text-warning": notEngaged(),
            }}
            data-testid={`hp-max-${props.participantEntityId}`}
            aria-label={`Allocated HP for ${name()}`}
            title={
              notEngaged()
                ? "Needs ≥ 1 HP to engage in this conflict"
                : "Allocated HP for this conflict"
            }
          />
        </span>
      </Show>

      <Show
        when={canEditWeapon()}
        fallback={
          <Show
            when={currentWeapon()}
            fallback={
              <span class="font-mono text-[0.7rem] text-fg-subtle italic">
                unarmed
              </span>
            }
          >
            {(idAcc) => <WeaponName itemId={idAcc() as EntityId} />}
          </Show>
        }
      >
        <select
          value={currentWeapon() ?? ""}
          onChange={(e) => {
            const v = e.currentTarget.value;
            chooseWeapon(v === "" ? null : (v as EntityId));
          }}
          class="rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-xs text-fg max-w-[7.5rem]"
          data-testid={`weapon-select-${props.participantEntityId}`}
        >
          <option value="">— unarmed —</option>
          <For each={weaponChoices()}>
            {(id) => <WeaponOption itemId={id} />}
          </For>
        </select>
      </Show>
    </article>
  );
}

function WeaponOption(props: { itemId: EntityId }): JSX.Element {
  const ident = useTrait(props.itemId, ItemIdentity) as () =>
    | { name: string }
    | undefined;
  return <option value={props.itemId}>{ident()?.name ?? "(item)"}</option>;
}

function WeaponName(props: { itemId: EntityId }): JSX.Element {
  const ident = useTrait(props.itemId, ItemIdentity) as () =>
    | { name: string }
    | undefined;
  return (
    <span class="text-xs text-fg-subtle font-mono truncate max-w-[8rem]">
      {ident()?.name ?? "(item)"}
    </span>
  );
}

void useScript;
