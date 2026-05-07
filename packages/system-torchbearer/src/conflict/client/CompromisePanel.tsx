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
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import {
  ApplyCompromise,
  EndConflict,
  TB_COMPROMISE_LEVELS,
  type ConflictSide,
} from "../shared/index.js";
import { useCharacterName, useConflict, useParticipants } from "./hooks.js";
import { useMe } from "./use-me.js";

const COMPROMISE_CONDITIONS = [
  "hungryThirsty",
  "angry",
  "afraid",
  "exhausted",
  "injured",
  "sick",
  "dead",
] as const;

type CompromiseConditionId = (typeof COMPROMISE_CONDITIONS)[number];

const CONDITION_LABEL: Record<CompromiseConditionId, string> = {
  hungryThirsty: "Hungry & Thirsty",
  angry: "Angry",
  afraid: "Afraid",
  exhausted: "Exhausted",
  injured: "Injured",
  sick: "Sick",
  dead: "Dead",
};

/**
 * Compromise UI shown when phase = compromise. Computes the suggested
 * compromise level (minor/half/major) from the winner's surviving
 * disposition vs starting (SG p.74-75), lets the GM jot a description
 * + check off conditions per loser-side participant, then dispatches
 * ApplyCompromise + EndConflict.
 */
export function CompromisePanel(props: { conflictId: EntityId }): JSX.Element {
  const me = useMe();
  const isGm = (): boolean => me()?.role === "gm";
  const client = useClient();
  const conflict = useConflict(props.conflictId);

  const winnerSide = createMemo<ConflictSide | "tied" | null>(
    () => conflict()?.winner ?? null,
  );
  const loserSide = createMemo<ConflictSide | null>(() => {
    const w = winnerSide();
    if (!w || w === "tied") return null;
    return w === "party" ? "enemy" : "party";
  });

  const winnerStartDispo = createMemo(() => {
    const c = conflict();
    if (!c) return 0;
    return winnerSide() === "party" ? c.dispoParty.max : c.dispoEnemy.max;
  });
  const winnerEndDispo = createMemo(() => {
    const c = conflict();
    if (!c) return 0;
    return winnerSide() === "party"
      ? c.dispoParty.current
      : c.dispoEnemy.current;
  });

  /**
   * Suggested compromise level per SG p.74-75:
   *   - More than 1/2 starting → minor
   *   - Roughly 1/2 starting → half
   *   - Few points left → major
   *
   * Threshold: half-or-less = half/major, with the bottom quarter
   * promoted to major.
   */
  const suggestedLevel = createMemo<"minor" | "half" | "major">(() => {
    const start = winnerStartDispo();
    const end = winnerEndDispo();
    if (start === 0) return "major";
    const ratio = end / start;
    if (ratio > 0.5) return "minor";
    if (ratio > 0.25) return "half";
    return "major";
  });

  const losers = useParticipants(
    props.conflictId,
    (loserSide() ?? "party") as ConflictSide,
  );

  const [description, setDescription] = createSignal("");
  const [conditions, setConditions] = createSignal<
    Array<{ characterId: EntityId; conditionId: CompromiseConditionId }>
  >([]);

  const toggleCondition = (
    characterId: EntityId,
    conditionId: CompromiseConditionId,
  ): void => {
    setConditions((cur) => {
      const exists = cur.findIndex(
        (c) => c.characterId === characterId && c.conditionId === conditionId,
      );
      if (exists >= 0) return cur.filter((_, i) => i !== exists);
      return [...cur, { characterId, conditionId }];
    });
  };
  const isChecked = (
    characterId: EntityId,
    conditionId: CompromiseConditionId,
  ): boolean =>
    conditions().some(
      (c) => c.characterId === characterId && c.conditionId === conditionId,
    );

  const submit = (): void => {
    client.dispatch(
      ApplyCompromise({
        conflictId: props.conflictId,
        description: description(),
        conditions: conditions(),
      }) as CommandInstance,
    );
    client.dispatch(
      EndConflict({ conflictId: props.conflictId }) as CommandInstance,
    );
  };

  const skip = (): void => {
    client.dispatch(
      EndConflict({ conflictId: props.conflictId }) as CommandInstance,
    );
  };

  return (
    <Show when={isGm()}>
      <section
        class="border-t-2 border-fg bg-surface-elevated px-5 py-3"
        data-testid="compromise-panel"
        role="region"
        aria-label="Compromise"
      >
        <h2 class="font-display text-sm uppercase tracking-[0.16em] text-fg mb-1">
          Compromise
        </h2>
        <Show
          when={winnerSide() && winnerSide() !== "tied"}
          fallback={
            <p class="text-fg-muted text-sm">
              Tied conflict — both sides offer the loser a major
              compromise. Use the description below.
            </p>
          }
        >
          <p class="text-xs text-fg-subtle mb-2">
            {winnerSide()} won with {winnerEndDispo()} of {winnerStartDispo()}{" "}
            disposition remaining. Suggested level:{" "}
            <strong class="text-fg uppercase">{suggestedLevel()}</strong>.
          </p>
          <CompromiseLevelHint level={suggestedLevel()} />
        </Show>

        <label class="flex flex-col gap-1 mt-2 text-sm">
          <span class="text-xs uppercase tracking-wider text-fg-subtle">
            Description
          </span>
          <textarea
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder="What does the loser get / what does the winner give up?"
            class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            rows={3}
            data-testid="compromise-description"
          />
        </label>

        <Show when={loserSide()}>
          <p class="mt-3 text-xs uppercase tracking-wider text-fg-subtle">
            Conditions on {loserSide()}
          </p>
          <ul class="mt-1 flex flex-col gap-2">
            <For each={losers()}>
              {(p) => (
                <CompromiseLoserRow
                  characterId={p.characterId}
                  isChecked={isChecked}
                  toggle={toggleCondition}
                />
              )}
            </For>
          </ul>
        </Show>

        <div class="mt-3 flex gap-2">
          <button
            type="button"
            onClick={submit}
            data-testid="compromise-apply"
            class="rounded-(--radius-control) border border-border bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            Apply &amp; end conflict
          </button>
          <button
            type="button"
            onClick={skip}
            data-testid="compromise-skip"
            class="rounded-(--radius-control) border border-border bg-surface-elevated px-3 py-1.5 text-sm hover:border-accent"
          >
            End without compromise
          </button>
        </div>
      </section>
    </Show>
  );
}

function CompromiseLoserRow(props: {
  characterId: EntityId;
  isChecked: (
    characterId: EntityId,
    conditionId: CompromiseConditionId,
  ) => boolean;
  toggle: (
    characterId: EntityId,
    conditionId: CompromiseConditionId,
  ) => void;
}): JSX.Element {
  const name = useCharacterName(props.characterId);
  return (
    <li class="flex flex-wrap items-center gap-2 text-xs">
      <span class="font-display text-sm w-24">{name()}</span>
      <For each={COMPROMISE_CONDITIONS}>
        {(cid) => (
          <label class="flex items-center gap-1">
            <input
              type="checkbox"
              checked={props.isChecked(props.characterId, cid)}
              onChange={() => props.toggle(props.characterId, cid)}
              data-testid={`compromise-${props.characterId}-${cid}`}
            />
            <span>{CONDITION_LABEL[cid]}</span>
          </label>
        )}
      </For>
    </li>
  );
}

function CompromiseLevelHint(props: {
  level: "minor" | "half" | "major";
}): JSX.Element {
  const def = (): { description: string; killSpecific: string } => {
    const e = TB_COMPROMISE_LEVELS.find((l) => l.id === props.level);
    return {
      description: e?.description ?? "",
      killSpecific: e?.killSpecific ?? "",
    };
  };
  return (
    <div class="text-xs text-fg-muted bg-surface rounded-(--radius-control) px-2 py-1.5 border border-border-muted">
      <p>{def().description}</p>
      <p class="mt-0.5 text-fg-subtle italic">{def().killSpecific}</p>
    </div>
  );
}
