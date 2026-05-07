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
import { useClient } from "@vtt/substrate/client";
import { createMemo, For, Show, type JSX } from "solid-js";
import {
  ALL_ACTIONS,
  LockScript,
  SetScriptSlot,
  UnlockScript,
  type ConflictAction,
  type ConflictSide,
  type ScriptSlot,
} from "../shared/index.js";
import { useCharacterName, useParticipants, useScript } from "./hooks.js";
import { useMe } from "./use-me.js";
import { ACTION_COLORS, ACTION_LABELS, ACTION_LETTERS } from "./styles.js";

/**
 * Vertical scripting block for one side. Three rows — slot 1, 2, 3 —
 * each row carrying an A/D/F/M action picker and a performer dropdown.
 * Selecting an action OR a performer auto-dispatches `SetScriptSlot`
 * with whichever values are currently picked, so the captain doesn't
 * have to confirm each row. A single Lock/Unlock button at the bottom
 * commits or reopens the script.
 *
 * Captain edits the party side; GM edits the enemy side. Teammates see
 * own-side filled chips face-up, opposing-side chips face-down (the
 * substrate's per-recipient event filter does the masking).
 */
export function ScriptInline(props: {
  conflictId: EntityId;
  side: ConflictSide;
}): JSX.Element {
  const me = useMe();
  const isGm = (): boolean => me()?.role === "gm";
  const canEdit = createMemo(() => {
    if (!me()) return false;
    return props.side === "enemy" ? isGm() : !isGm();
  });
  const ownSide = createMemo(() => {
    if (!me()) return null;
    return isGm() ? "enemy" : "party";
  });

  const script = useScript(props.conflictId, props.side);
  const isLocked = createMemo(() => script()?.locked ?? false);
  const slots = createMemo<ScriptSlot[]>(() => {
    const s = script();
    if (!s) return [{ status: "empty" }, { status: "empty" }, { status: "empty" }];
    return [...s.slots];
  });
  const allFilled = createMemo(
    () => slots().every((sl) => sl.status !== "empty"),
  );

  return (
    <div
      class="flex flex-col gap-1.5 mt-1"
      data-testid={`script-inline-${props.side}`}
    >
      <div class="flex items-baseline justify-between">
        <span class="font-display text-[0.7rem] uppercase tracking-[0.16em] text-fg-subtle">
          Script
        </span>
        <Show when={isLocked()}>
          <span
            class="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-accent"
            data-testid={`locked-${props.side}`}
          >
            locked
          </span>
        </Show>
      </div>
      <div
        class="flex flex-col gap-1 rounded-(--radius-control) border border-border-muted bg-surface-elevated px-2 py-1.5"
      >
        <For each={[0, 1, 2]}>
          {(i) => (
            <ScriptRow
              conflictId={props.conflictId}
              side={props.side}
              slotIndex={i}
              slot={slots()[i] ?? { status: "empty" }}
              canEdit={canEdit() && !isLocked()}
              ownSide={ownSide() === props.side}
            />
          )}
        </For>
      </div>
      <Show when={canEdit()}>
        <LockToggleButton
          conflictId={props.conflictId}
          side={props.side}
          locked={isLocked()}
          allFilled={allFilled()}
        />
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * One row: slot label · A D F M chips · performer ▾
 * ----------------------------------------------------------------------- */

function ScriptRow(props: {
  conflictId: EntityId;
  side: ConflictSide;
  slotIndex: number;
  slot: ScriptSlot;
  canEdit: boolean;
  ownSide: boolean;
}): JSX.Element {
  const client = useClient();
  const participants = useParticipants(props.conflictId, props.side);

  const filledOrRevealed = createMemo(
    () => props.slot.status === "filled" || props.slot.status === "revealed",
  );
  const action = createMemo<ConflictAction | null>(() => {
    if (filledOrRevealed()) return (props.slot as { action: ConflictAction }).action;
    return null;
  });
  const performerEntityId = createMemo<EntityId | null>(() => {
    // Slot now records the performer's participant entity id directly,
    // so the dropdown / label display read by participant. Two
    // copies of the same character — Goblin 1 vs Goblin 2 — stay
    // distinct.
    if (!filledOrRevealed()) return null;
    const slot = props.slot as {
      performerParticipantEntityId: EntityId;
    };
    return slot.performerParticipantEntityId ?? null;
  });

  const performerChoices = createMemo(() =>
    participants().filter((p) => !p.knockedOut),
  );

  const dispatchSet = (
    nextAction: ConflictAction,
    nextPerformer: EntityId,
  ): void => {
    client.dispatch(
      SetScriptSlot({
        conflictId: props.conflictId,
        side: props.side,
        slotIndex: props.slotIndex,
        action: nextAction,
        performerParticipantEntityId: nextPerformer,
        weaponItemId: null,
      }) as CommandInstance,
    );
  };

  const onPickAction = (a: ConflictAction): void => {
    if (!props.canEdit) return;
    const perf = performerEntityId() ?? performerChoices()[0]?.entityId;
    if (!perf) return;
    dispatchSet(a, perf);
  };
  const onPickPerformer = (entityId: EntityId): void => {
    if (!props.canEdit) return;
    const a = action();
    if (!a) return;
    dispatchSet(a, entityId);
  };

  return (
    <div
      class="grid items-center gap-2 text-xs"
      style={{ "grid-template-columns": "1.1rem auto 1fr" }}
      data-testid={`script-row-${props.side}-${props.slotIndex}`}
    >
      <span class="font-mono text-[0.7rem] text-fg-subtle text-center select-none">
        {props.slotIndex + 1}
      </span>
      <div class="flex items-center gap-1">
        <For each={ALL_ACTIONS}>
          {(a) => {
            const showColor = (): boolean =>
              (props.ownSide || props.slot.status === "revealed") && action() === a;
            const showHidden = (): boolean =>
              !props.ownSide && filledOrRevealed() && props.slot.status !== "revealed";
            return (
              <button
                type="button"
                disabled={!props.canEdit}
                onClick={() => onPickAction(a)}
                data-testid={`action-button-${props.side}-${props.slotIndex}-${a}`}
                aria-label={ACTION_LABELS[a]}
                title={ACTION_LABELS[a]}
                aria-pressed={action() === a}
                class="font-display font-bold w-6 h-6 rounded-sm border text-[0.7rem] transition disabled:cursor-default"
                style={{
                  "background-color": showColor()
                    ? ACTION_COLORS[a]
                    : "transparent",
                  color: showColor()
                    ? "white"
                    : showHidden()
                      ? "transparent"
                      : ACTION_COLORS[a],
                  "border-color": showHidden()
                    ? "var(--color-border-muted, #ccc)"
                    : ACTION_COLORS[a],
                  opacity: !props.canEdit && action() !== a ? 0.4 : 1,
                }}
              >
                {showHidden() ? "?" : ACTION_LETTERS[a]}
              </button>
            );
          }}
        </For>
      </div>
      <Show
        when={props.canEdit}
        fallback={
          <span class="font-mono text-[0.7rem] text-fg-subtle truncate">
            <Show
              when={filledOrRevealed() && (props.ownSide || props.slot.status === "revealed")}
              fallback={
                <span class="italic">
                  {filledOrRevealed() ? "(hidden)" : "—"}
                </span>
              }
            >
              <PerformerName
                participantEntityId={
                  (props.slot as { performerParticipantEntityId: EntityId })
                    .performerParticipantEntityId
                }
                characterId={
                  (props.slot as { performerCharacterId: EntityId })
                    .performerCharacterId
                }
                participants={participants()}
              />
            </Show>
          </span>
        }
      >
        <select
          value={performerEntityId() ?? ""}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v) onPickPerformer(v as EntityId);
          }}
          disabled={!props.canEdit}
          class="rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-[0.7rem] text-fg w-full"
          aria-label={`performer for slot ${props.slotIndex + 1}`}
          data-testid={`performer-select-${props.side}-${props.slotIndex}`}
        >
          <option value="">— who? —</option>
          <For each={performerChoices()}>
            {(p) => <PerformerOption participant={p} />}
          </For>
        </select>
      </Show>
    </div>
  );
}

function PerformerOption(props: {
  participant: {
    entityId: EntityId;
    characterId: EntityId;
    label?: string;
  };
}): JSX.Element {
  const characterName = useCharacterName(props.participant.characterId);
  // Per-instance label wins ("Goblin 2") so multi-spawn rosters
  // disambiguate in the dropdown. Singletons fall back to the live
  // character name.
  const display = createMemo(
    () => props.participant.label ?? characterName(),
  );
  return <option value={props.participant.entityId}>{display()}</option>;
}

function PerformerName(props: {
  participantEntityId: EntityId;
  characterId: EntityId;
  participants: ReadonlyArray<{
    entityId: EntityId;
    label?: string;
  }>;
}): JSX.Element {
  const characterName = useCharacterName(props.characterId);
  const display = createMemo(() => {
    const p = props.participants.find(
      (q) => q.entityId === props.participantEntityId,
    );
    return p?.label ?? characterName();
  });
  return <>{display()}</>;
}

/* -------------------------------------------------------------------------
 * Single Lock/Unlock toggle
 * ----------------------------------------------------------------------- */

function LockToggleButton(props: {
  conflictId: EntityId;
  side: ConflictSide;
  locked: boolean;
  allFilled: boolean;
}): JSX.Element {
  const client = useClient();
  const onClick = (): void => {
    if (props.locked) {
      client.dispatch(
        UnlockScript({
          conflictId: props.conflictId,
          side: props.side,
        }) as CommandInstance,
      );
    } else {
      client.dispatch(
        LockScript({
          conflictId: props.conflictId,
          side: props.side,
        }) as CommandInstance,
      );
    }
  };
  const disabled = (): boolean => !props.locked && !props.allFilled;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled()}
      data-testid={`lock-toggle-${props.side}`}
      class="self-end rounded-(--radius-control) border px-3 py-1 text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
      classList={{
        "border-accent bg-accent text-accent-fg hover:bg-accent-hover":
          !props.locked,
        "border-border-muted bg-surface-elevated text-fg hover:border-accent":
          props.locked,
      }}
      title={
        props.locked
          ? "Captain has locked the script — click to reopen for changes"
          : props.allFilled
            ? "All three slots filled — lock to commit"
            : "Pick an action and performer for all three slots first"
      }
    >
      {props.locked ? "Unlock script" : "Lock script"}
    </button>
  );
}
