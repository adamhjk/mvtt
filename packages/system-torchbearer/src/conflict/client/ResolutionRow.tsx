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
import { useClient, useTrait } from "@vtt/substrate/client";
import { createMemo, For, Show, type JSX } from "solid-js";
import {
  AdvanceRound,
  RevealNextSlot,
  TB_ACTION_INDEP_OB,
  TB_CONFLICT_TYPES,
  TB_MATCHUP_NOTES,
  TbConflictParticipant,
  actionSkillLabel,
  testForAction,
  type ConflictAction,
  type ConflictSide,
  type ConflictType,
  type MatchupCell,
  type ScriptSlot,
} from "../shared/index.js";
import { useCharacterName, useConflict, useScript } from "./hooks.js";
import { useMe } from "./use-me.js";
import { useOpenCharacterSheet } from "./use-open-character.js";
import { ACTION_COLORS, ACTION_LABELS } from "./styles.js";

/**
 * The reveal cascade — between the two team columns. This panel is
 * pure facilitation: tells each side what test type (V/I/—) and which
 * skill to roll on their character sheet. No dice, no auto-resolution,
 * no HP changes — the GM types numbers in via the team columns.
 *
 * Once both sides lock, three slot cards render. The GM clicks
 * `Reveal action N →` and that slot flips to revealed for everyone.
 * After all three are revealed the GM advances the round manually.
 */
export function ResolutionRow(props: { conflictId: EntityId }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const isGm = (): boolean => me()?.role === "gm";
  const conflict = useConflict(props.conflictId);
  const partyScript = useScript(props.conflictId, "party");
  const enemyScript = useScript(props.conflictId, "enemy");

  // Use the publicly-readable mirror on the conflict sentinel. Non-
  // side viewers don't have read access to the opposing script
  // entity, so the mirror is the one source of truth that every role
  // can see. `ScriptLockedSystem` writes the script's own `locked`
  // field and this mirror in the same run on the same event, so
  // they're always in sync — if you see them disagreeing, it's a
  // substrate bug and the right fix is upstream, not a fallback here.
  const bothLocked = createMemo(
    () => (conflict()?.partyLocked ?? false) && (conflict()?.enemyLocked ?? false),
  );
  const revealIndex = createMemo(() => conflict()?.revealIndex ?? 0);
  const round = createMemo(() => conflict()?.round ?? 1);
  const conflictType = createMemo<ConflictType | null>(
    () => conflict()?.type ?? null,
  );

  /**
   * Per-slot pair to render. Revealed slots come from the publicly-
   * readable `conflict.revealedSlots` (so non-side viewers see them);
   * pending / next-up slots fall back to whichever side's script the
   * viewer can read (own side + GM).
   */
  const slots = createMemo<{
    party: ScriptSlot;
    enemy: ScriptSlot;
  }[]>(() => {
    const c = conflict();
    const revealed = c?.revealedSlots ?? [null, null, null];
    const ps = partyScript()?.slots;
    const es = enemyScript()?.slots;
    return [0, 1, 2].map((i) => {
      const r = revealed[i];
      if (r) {
        return {
          party: {
            status: "revealed" as const,
            action: r.partyAction,
            performerParticipantEntityId: r.partyPerformerParticipantEntityId,
            performerCharacterId: r.partyPerformerCharacterId,
            weaponItemId: r.partyWeaponItemId,
          } satisfies ScriptSlot,
          enemy: {
            status: "revealed" as const,
            action: r.enemyAction,
            performerParticipantEntityId: r.enemyPerformerParticipantEntityId,
            performerCharacterId: r.enemyPerformerCharacterId,
            weaponItemId: r.enemyWeaponItemId,
          } satisfies ScriptSlot,
        };
      }
      return {
        party: (ps?.[i] ?? { status: "empty" }) as ScriptSlot,
        enemy: (es?.[i] ?? { status: "empty" }) as ScriptSlot,
      };
    });
  });

  const allRevealed = createMemo(() => revealIndex() >= 3);

  const reveal = (): void => {
    client.dispatch(
      RevealNextSlot({ conflictId: props.conflictId }) as CommandInstance,
    );
  };
  const advanceRound = (): void => {
    client.dispatch(
      AdvanceRound({ conflictId: props.conflictId }) as CommandInstance,
    );
  };

  return (
    <section
      class="px-4 py-4 border-y border-border-muted bg-surface-elevated flex flex-col gap-3"
      data-testid="resolution-row"
    >
      <header class="flex items-baseline justify-between">
        <h2
          class="font-display uppercase tracking-[0.22em] text-[0.78rem]"
        >
          Round {round()}
          <span class="ml-2 font-mono text-fg-subtle text-[0.62rem] tracking-[0.16em]">
            reveal {Math.min(revealIndex(), 3)}/3
          </span>
        </h2>
        <Show when={bothLocked() && !allRevealed() && isGm()}>
          <RevealButton slotIndex={revealIndex()} onClick={reveal} />
        </Show>
        <Show when={bothLocked() && allRevealed() && isGm()}>
          <button
            type="button"
            onClick={advanceRound}
            data-testid="advance-round"
            class="rounded-(--radius-control) border border-accent bg-accent text-accent-fg hover:bg-accent-hover transition font-display tracking-[0.14em] uppercase px-3 py-1 text-xs"
          >
            Advance to round {round() + 1} →
          </button>
        </Show>
      </header>

      <Show
        when={bothLocked()}
        fallback={
          <p
            class="text-sm text-fg-subtle italic"
            data-testid="reveal-placeholder"
          >
            Lock both scripts to see the round play out.
          </p>
        }
      >
        <div class="flex flex-col gap-2">
          <For each={slots()}>
            {(pair, i) => (
              <SlotCard
                slotIndex={i()}
                pair={pair}
                revealIndex={revealIndex()}
                isGm={isGm()}
                conflictType={conflictType()}
                onReveal={reveal}
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * One slot card — pending / next-up / revealed
 * ----------------------------------------------------------------------- */

function SlotCard(props: {
  slotIndex: number;
  pair: { party: ScriptSlot; enemy: ScriptSlot };
  revealIndex: number;
  isGm: boolean;
  conflictType: ConflictType | null;
  onReveal: () => void;
}): JSX.Element {
  const status = (): "revealed" | "next" | "pending" => {
    if (
      props.pair.party.status === "revealed" &&
      props.pair.enemy.status === "revealed"
    )
      return "revealed";
    if (props.slotIndex === props.revealIndex) return "next";
    return "pending";
  };

  return (
    <article
      class="rounded-(--radius-control) border bg-surface transition"
      classList={{
        "border-border": status() === "revealed",
        "border-accent": status() === "next",
        "border-border-muted/60 opacity-60": status() === "pending",
      }}
      data-testid={`slot-card-${props.slotIndex}`}
      data-status={status()}
    >
      <SlotHeader slotIndex={props.slotIndex} pair={props.pair} status={status()} />
      <Show when={status() === "revealed"}>
        <RevealedBody pair={props.pair} conflictType={props.conflictType} />
      </Show>
      <Show when={status() === "next" && props.isGm}>
        <div class="px-4 py-2 border-t border-border-muted/60 flex justify-end">
          <RevealButton
            slotIndex={props.slotIndex}
            onClick={props.onReveal}
            compact
          />
        </div>
      </Show>
      <Show when={status() === "next" && !props.isGm}>
        <p class="px-4 py-2 border-t border-border-muted/60 text-[0.7rem] text-fg-subtle italic">
          waiting for the GM to reveal…
        </p>
      </Show>
    </article>
  );
}

/* -------------------------------------------------------------------------
 * Header — slot number + X vs Y matchup chip
 * ----------------------------------------------------------------------- */

function SlotHeader(props: {
  slotIndex: number;
  pair: { party: ScriptSlot; enemy: ScriptSlot };
  status: "revealed" | "next" | "pending";
}): JSX.Element {
  const partyAction = (): ConflictAction | null => {
    const s = props.pair.party;
    if (s.status === "filled" || s.status === "revealed") return s.action;
    return null;
  };
  const enemyAction = (): ConflictAction | null => {
    const s = props.pair.enemy;
    if (s.status === "filled" || s.status === "revealed") return s.action;
    return null;
  };
  const showActions = (): boolean =>
    props.status === "revealed" ||
    (props.status === "next" && partyAction() !== null && enemyAction() !== null);
  const matchupNote = (): string => {
    const a = partyAction();
    const b = enemyAction();
    if (!a || !b) return "";
    return TB_MATCHUP_NOTES[a][b];
  };

  return (
    <div class="px-4 pt-3 pb-2">
      <div class="flex items-center justify-between gap-3">
        <span class="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-fg-subtle">
          Action {props.slotIndex + 1}
        </span>
        <Show
          when={showActions()}
          fallback={
            <span class="font-mono text-[0.7rem] text-fg-subtle italic">
              {props.status === "next" ? "next up" : "awaiting earlier action"}
            </span>
          }
        >
          <div class="flex items-baseline gap-2 font-display uppercase tracking-[0.16em]">
            <ActionGlyph action={partyAction()!} />
            <span class="text-fg-subtle text-[0.7rem] italic font-display tracking-[0.18em]">
              vs
            </span>
            <ActionGlyph action={enemyAction()!} />
          </div>
        </Show>
        <Show when={showActions()}>
          <MatchupKindChip
            partyAction={partyAction()!}
            enemyAction={enemyAction()!}
          />
        </Show>
      </div>
      <Show when={showActions() && matchupNote()}>
        <p class="mt-1 text-[0.7rem] text-fg-muted italic">
          {matchupNote()}
        </p>
      </Show>
    </div>
  );
}

function ActionGlyph(props: { action: ConflictAction }): JSX.Element {
  return (
    <span
      class="inline-block px-2 py-0.5 rounded-sm text-[0.78rem] font-bold border"
      style={{
        color: ACTION_COLORS[props.action],
        "border-color": ACTION_COLORS[props.action],
      }}
    >
      {ACTION_LABELS[props.action]}
    </span>
  );
}

function MatchupKindChip(props: {
  partyAction: ConflictAction;
  enemyAction: ConflictAction;
}): JSX.Element {
  // Show whether this slot involves a forfeit — that's the only
  // surprising shape worth a header chip. Both party and enemy cells
  // are inspected since the matrix is asymmetric.
  const partyCell = (): MatchupCell =>
    testForAction(props.partyAction, props.enemyAction);
  const enemyCell = (): MatchupCell =>
    testForAction(props.enemyAction, props.partyAction);
  const label = (): string => {
    if (partyCell() === "versus") return "Versus test";
    if (partyCell() === "noTest") return "Party forfeits";
    if (enemyCell() === "noTest") return "Enemy forfeits";
    return "Independent test";
  };
  return (
    <span class="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
      {label()}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Revealed body — per-side facilitation card
 * ----------------------------------------------------------------------- */

function RevealedBody(props: {
  pair: { party: ScriptSlot; enemy: ScriptSlot };
  conflictType: ConflictType | null;
}): JSX.Element {
  return (
    <div
      class="border-t border-border-muted/60 grid"
      style={{ "grid-template-columns": "1fr 1fr" }}
      data-testid="revealed-body"
    >
      <SideColumn
        side="party"
        slot={props.pair.party}
        opposingSlot={props.pair.enemy}
        conflictType={props.conflictType}
      />
      <SideColumn
        side="enemy"
        slot={props.pair.enemy}
        opposingSlot={props.pair.party}
        conflictType={props.conflictType}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Per-side column — what to roll
 * ----------------------------------------------------------------------- */

function SideColumn(props: {
  side: ConflictSide;
  slot: ScriptSlot;
  opposingSlot: ScriptSlot;
  conflictType: ConflictType | null;
}): JSX.Element {
  const sideLabel = (): string => (props.side === "party" ? "Party" : "Enemy");
  const sideColor = (): string =>
    props.side === "party"
      ? "var(--color-accent, #7A1E1E)"
      : "var(--color-warning, #8C6210)";
  const performerCharId = (): EntityId | null =>
    props.slot.status === "revealed" ? props.slot.performerCharacterId : null;
  const performerParticipantId = (): EntityId | null =>
    props.slot.status === "revealed"
      ? props.slot.performerParticipantEntityId
      : null;
  const action = (): ConflictAction | null =>
    props.slot.status === "revealed" ? props.slot.action : null;
  const opposingAction = (): ConflictAction | null =>
    props.opposingSlot.status === "revealed" ? props.opposingSlot.action : null;
  // Per SG p.70: "find your action on the left and your opponent's
  // along the top row." This column already knows which action is
  // ITS side's, so we feed `testForAction(myAction, oppAction)`
  // directly — no party/enemy reordering. The cells are not
  // symmetric: Defend(party) vs Feint(enemy) → party `noTest` AND
  // enemy `independent`.
  const test = (): MatchupCell | null => {
    const my = action();
    const opp = opposingAction();
    if (!my || !opp) return null;
    return testForAction(my, opp);
  };
  const skills = (): ReadonlyArray<string> => {
    const a = action();
    const t = props.conflictType;
    if (!a || !t) return [];
    return TB_CONFLICT_TYPES[t].actionSkill[a];
  };
  const obstacle = (): number | null => {
    const t = test();
    const a = action();
    if (t !== "independent" || !a) return null;
    return TB_ACTION_INDEP_OB[a];
  };

  return (
    <div
      class="px-4 py-3 flex flex-col gap-2 border-r border-border-muted/60 last:border-r-0"
      data-testid={`side-column-${props.side}`}
    >
      <header class="flex items-baseline justify-between">
        <span
          class="font-display text-[0.62rem] uppercase tracking-[0.22em]"
          style={{ color: sideColor() }}
        >
          {sideLabel()}
        </span>
        <Show when={performerCharId()}>
          {(charIdAcc) => (
            <span class="font-display text-sm tracking-tight">
              <PerformerName
                participantEntityId={performerParticipantId()}
                characterId={charIdAcc() as EntityId}
              />
            </span>
          )}
        </Show>
      </header>

      <Show
        when={test() && action()}
        fallback={
          <p class="text-[0.72rem] text-fg-subtle italic">
            no action this slot
          </p>
        }
      >
        <TestPrompt
          test={test()!}
          action={action()!}
          skills={skills()}
          obstacle={obstacle()}
          sideColor={sideColor()}
        />
      </Show>
    </div>
  );
}

function PerformerName(props: {
  participantEntityId: EntityId | null;
  characterId: EntityId;
}): JSX.Element {
  const characterName = useCharacterName(props.characterId);
  // Read the participant's per-instance label live so multi-spawns
  // resolve to "Goblin 2" instead of just "Goblin". Singletons leave
  // label undefined and we fall back to the live character name.
  const participant = useTrait(
    props.participantEntityId ?? ("" as EntityId),
    TbConflictParticipant,
  ) as () => { label?: string } | undefined;
  const display = createMemo(
    () => participant()?.label ?? characterName(),
  );
  const openSheet = useOpenCharacterSheet();
  return (
    <button
      type="button"
      onClick={() => openSheet(props.characterId)}
      title={`Open ${characterName()}`}
      class="cursor-pointer underline-offset-2 decoration-transparent hover:decoration-current decoration-1 underline hover:text-accent transition-colors"
    >
      {display()}
    </button>
  );
}

function TestPrompt(props: {
  test: MatchupCell;
  action: ConflictAction;
  skills: ReadonlyArray<string>;
  obstacle: number | null;
  sideColor: string;
}): JSX.Element {
  return (
    <div class="flex flex-col gap-1 text-sm">
      <div class="flex items-baseline gap-3">
        <TestSymbol kind={props.test} />
        <span class="font-display tracking-tight" style={{ color: props.sideColor }}>
          <Show when={props.test === "noTest"} fallback={<>roll</>}>
            <em class="not-italic">do not roll</em>
          </Show>
        </span>
        <Show when={props.test !== "noTest"}>
          <span class="font-display text-fg">
            {actionSkillLabel(props.skills)}
          </span>
        </Show>
      </div>
      <Show when={props.test === "independent"}>
        <p class="font-mono text-[0.7rem] text-fg-subtle">
          obstacle <span class="text-fg font-semibold">Ob {props.obstacle}</span>
        </p>
      </Show>
      <Show when={props.test === "versus"}>
        <p class="font-mono text-[0.7rem] text-fg-subtle">
          versus your opponent's pool — winner's MoS counts
        </p>
      </Show>
      <Show when={props.test === "noTest"}>
        <p class="font-mono text-[0.7rem] text-fg-subtle italic">
          your action forfeits — your opponent rolls instead
        </p>
      </Show>
    </div>
  );
}

function TestSymbol(props: { kind: MatchupCell }): JSX.Element {
  const symbol = (): string => {
    if (props.kind === "versus") return "V";
    if (props.kind === "independent") return "I";
    return "—"; // noTest
  };
  const color = (): string => {
    if (props.kind === "versus") return "var(--color-accent, #7A1E1E)";
    if (props.kind === "independent") return "var(--color-fg, #1A1815)";
    return "var(--color-fg-subtle, #888)";
  };
  return (
    <span
      class="inline-flex items-center justify-center w-7 h-7 rounded-sm font-mono font-bold text-base border-2"
      style={{
        color: color(),
        "border-color": color(),
      }}
      data-testid="test-symbol"
      data-kind={props.kind}
      aria-hidden
    >
      {symbol()}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Reveal button
 * ----------------------------------------------------------------------- */

function RevealButton(props: {
  slotIndex: number;
  onClick: () => void;
  compact?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      data-testid="reveal-next-slot"
      class="rounded-(--radius-control) border border-accent bg-accent text-accent-fg hover:bg-accent-hover transition font-display tracking-[0.14em] uppercase"
      classList={{
        "px-3 py-1 text-xs": !props.compact,
        "px-2.5 py-0.5 text-[0.7rem]": props.compact === true,
      }}
    >
      Reveal action {props.slotIndex + 1} →
    </button>
  );
}
