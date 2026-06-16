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

import type { CommandInstance } from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import type { ChatTimelineContributor, ChatTimelineEntry } from "@vtt/comms/shared";
import type { NotificationEntry, NotificationFeed } from "@vtt/shell-workbench/shared";
import {
  ResolvedRollFeedSlot,
  type ResolvedRollEntry,
  type ResolvedRollFeed,
} from "@vtt/characters/shared";
import { Formula, RollResult, RolledBy } from "@vtt/resolution/shared";
import { createMemo, For, Show, type JSX } from "solid-js";
import {
  AbilityImprovementOpportunity,
  countSuccesses,
  DismissLightWentOut,
  GrindToll,
  ImproveAbility,
  ImproveSkill,
  LearnSkill,
  LightWentOutNotice,
  MarkGrindToll,
  resolveSuccessCount,
  SkillImprovementOpportunity,
  SkillLearningOpportunity,
  TB_ROLL_META_SYSTEM,
  TbRollMetaSchema,
  type GrindCondition,
  type TbRollSpec,
} from "../shared/index.js";
import { TbRollRow } from "./tb-roll-row.js";

type DieFace = { sides: number | "F"; value: number };
type RollRow = { id: string; values: Record<string, unknown> };

/** Margin as a signed success delta, with a real minus glyph. */
function signedSuccesses(n: number): string {
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/**
 * Resolve a TB roll into the compact Recent-pill outcome: pass/fail (or
 * win/loss/tie for a versus test), the success count, and the margin.
 * Reuses the exact success model `TbRollRow` renders — `resolveSuccessCount`
 * for independent rolls, comparable successes vs the opponent's total for
 * versus, the dispo formula for disposition — so the pill and the full
 * card never disagree.
 */
export function tbOutcome(
  selfId: string,
  spec: TbRollSpec,
  dice: ReadonlyArray<DieFace>,
  rows: ReadonlyArray<RollRow>,
): ResolvedRollEntry["outcome"] {
  const sum = resolveSuccessCount(spec, dice);
  if (spec.dispositionMode) {
    const base = spec.dispoBase ?? spec.baseDice;
    const value = Math.max(1, base + sum.rawSuccesses + sum.always);
    return { tone: "neutral", text: `Disposition ${value}` };
  }
  if (spec.versusTestId) {
    const mine = countSuccesses(dice, spec.successTarget) + spec.bonusSuccesses;
    let oppTotal: number | null = null;
    for (const r of rows) {
      if (r.id === selfId) continue;
      const meta = (r.values.Formula as { meta?: unknown } | undefined)?.meta;
      const parsed = TbRollMetaSchema.safeParse(meta);
      if (!parsed.success) continue;
      if (parsed.data.spec.versusTestId !== spec.versusTestId) continue;
      oppTotal = (r.values.RollResult as { total: number }).total;
      break;
    }
    if (oppTotal === null) return { tone: "neutral", text: `${mine}s · vs ?` };
    const diff = mine - oppTotal;
    if (diff > 0)
      return {
        tone: "success",
        text: `Win · ${mine}s vs ${oppTotal}s · ${signedSuccesses(diff)}`,
      };
    if (diff < 0)
      return {
        tone: "fail",
        text: `Loss · ${mine}s vs ${oppTotal}s · ${signedSuccesses(diff)}`,
      };
    return { tone: "neutral", text: `Tie · ${mine}s vs ${oppTotal}s` };
  }
  // Independent test.
  if (spec.obstacle !== null) {
    const margin = sum.final - spec.obstacle;
    return {
      tone: sum.passed ? "success" : "fail",
      text: `${sum.passed ? "Pass" : "Fail"} · ${sum.final}s vs Ob ${spec.obstacle} · ${signedSuccesses(margin)}`,
    };
  }
  return {
    tone: sum.passed ? "success" : "fail",
    text: `${sum.passed ? "Pass" : "Fail"} · ${sum.final}s`,
  };
}

/**
 * Renders one open improvement opportunity as a chat-timeline row. Body
 * reads "{Character} improved at {Skill}!" — phrased the way the user
 * asked for, even though the click hasn't strictly happened yet — and
 * carries an [Improve] button that dispatches `ImproveSkill` against
 * the same character + skill. The opportunity entity is despawned by
 * the universal-mirror system once the click goes through, so the row
 * disappears from the timeline as soon as the rating bumps.
 *
 * Click validation is server-side: if the track somehow isn't full
 * anymore (the player un-filled a bubble between row spawn and click),
 * `validate` rejects and the row stays put.
 */
function OpportunityRow(props: { entityId: string }): JSX.Element {
  const client = useClient();
  const record = useTrait(props.entityId, SkillImprovementOpportunity);

  return (
    <Show when={record()} keyed>
      {(rec) => {
        const r = rec as {
          characterId: string;
          characterName: string;
          skillId: string;
          skillName: string;
          rating: number;
        };
        const improve = () => {
          client.dispatch(
            ImproveSkill({
              characterId: r.characterId,
              skillId: r.skillId,
            }) as CommandInstance,
          );
        };
        return (
          <article
            class="rounded-(--radius-card) border border-border-muted bg-surface-elevated px-3 py-2 text-sm"
            data-tb-improvement-row="true"
          >
            <header class="flex items-baseline justify-between gap-2 pr-6 text-xs">
              <span class="font-medium text-fg">{r.characterName}</span>
              <span class="text-[0.6rem] uppercase tracking-[0.16em] text-accent">advancement</span>
            </header>
            <p class="mt-1 whitespace-pre-wrap break-words text-fg-muted">
              {`${r.characterName} improved at ${r.skillName}!`}
            </p>
            <div class="mt-1.5 flex justify-end">
              <button
                type="button"
                class="rounded-(--radius-control) border border-accent bg-transparent px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-accent transition hover:bg-accent hover:text-accent-fg"
                title={`Improve ${r.skillName}`}
                onClick={improve}
              >
                Improve
              </button>
            </div>
          </article>
        );
      }}
    </Show>
  );
}

/**
 * Plug-in contributor for the comms `chat-timeline-contributors` slot.
 * Yields one timeline entry per `SkillImprovementRecord` entity in the
 * world — sorted by their `sentAt` so they interleave correctly with
 * normal chat messages.
 */
export const TbChatTimelineContributor: NotificationFeed = {
  kind: "@vtt/system-torchbearer/skill-improvement",
  useEntries: () => {
    const rows = useQuery([SkillImprovementOpportunity]);
    const accessor = createMemo<NotificationEntry[]>(() =>
      rows().map((row) => {
        const rec = row.values.SkillImprovementOpportunity as { sentAt: number };
        return {
          id: row.id,
          sortKey: rec.sentAt,
          render: () => OpportunityRow({ entityId: row.id }) as unknown,
        };
      }),
    );
    return accessor as unknown as () => NotificationEntry[];
  },
};

/**
 * Ability / town-ability improvement card — the Will / Health / Resources
 * / Circles counterpart of `OpportunityRow`. Reads the opportunity and
 * carries an [Improve] button dispatching `ImproveAbility`.
 */
function AbilityOpportunityRow(props: { entityId: string }): JSX.Element {
  const client = useClient();
  const record = useTrait(props.entityId, AbilityImprovementOpportunity);
  return (
    <Show when={record()} keyed>
      {(rec) => {
        const r = rec as {
          characterId: string;
          characterName: string;
          ability: "will" | "health" | "resources" | "circles";
          abilityLabel: string;
        };
        const improve = () => {
          client.dispatch(
            ImproveAbility({
              characterId: r.characterId,
              ability: r.ability,
            }) as CommandInstance,
          );
        };
        return (
          <article
            class="rounded-(--radius-card) border border-border-muted bg-surface-elevated px-3 py-2 text-sm"
            data-tb-ability-improvement-row="true"
          >
            <header class="flex items-baseline justify-between gap-2 pr-6 text-xs">
              <span class="font-medium text-fg">{r.characterName}</span>
              <span class="text-[0.6rem] uppercase tracking-[0.16em] text-accent">advancement</span>
            </header>
            <p class="mt-1 whitespace-pre-wrap break-words text-fg-muted">
              {`${r.characterName} improved their ${r.abilityLabel}!`}
            </p>
            <div class="mt-1.5 flex justify-end">
              <button
                type="button"
                class="rounded-(--radius-control) border border-accent bg-transparent px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-accent transition hover:bg-accent hover:text-accent-fg"
                title={`Improve ${r.abilityLabel}`}
                onClick={improve}
              >
                Improve
              </button>
            </div>
          </article>
        );
      }}
    </Show>
  );
}

export const TbAbilityImprovementFeed: NotificationFeed = {
  kind: "@vtt/system-torchbearer/ability-improvement",
  useEntries: () => {
    const rows = useQuery([AbilityImprovementOpportunity]);
    const accessor = createMemo<NotificationEntry[]>(() =>
      rows().map((row) => {
        const rec = row.values.AbilityImprovementOpportunity as {
          sentAt: number;
        };
        return {
          id: row.id,
          sortKey: rec.sentAt,
          render: () => AbilityOpportunityRow({ entityId: row.id }) as unknown,
        };
      }),
    );
    return accessor as unknown as () => NotificationEntry[];
  },
};

/**
 * Renders one open `SkillLearningOpportunity` as a chat-timeline
 * row. Body reads "{Character} learned {Skill}!" — phrased the way
 * the player will read it after committing — and carries a [Learn]
 * button that dispatches `LearnSkill` to bump the rating from 0 to
 * 2 (DH p.75) and despawn the row.
 *
 * If the editor un-fills a learning pip between row spawn and
 * click, the server-side validator rejects the dispatch and the
 * `SkillLearningSweepSystem` despawns the row on the next
 * `CharacterFieldSet` write.
 */
function LearningOpportunityRow(props: { entityId: string }): JSX.Element {
  const client = useClient();
  const record = useTrait(props.entityId, SkillLearningOpportunity);
  return (
    <Show when={record()} keyed>
      {(rec) => {
        const r = rec as {
          characterId: string;
          characterName: string;
          skillId: string;
          skillName: string;
        };
        const learn = () => {
          client.dispatch(
            LearnSkill({
              characterId: r.characterId,
              skillId: r.skillId,
            }) as CommandInstance,
          );
        };
        return (
          <article
            class="rounded-(--radius-card) border border-border-muted bg-surface-elevated px-3 py-2 text-sm"
            data-tb-learning-row="true"
          >
            <header class="flex items-baseline justify-between gap-2 pr-6 text-xs">
              <span class="font-medium text-fg">{r.characterName}</span>
              <span class="text-[0.6rem] uppercase tracking-[0.16em] text-accent">learning</span>
            </header>
            <p class="mt-1 whitespace-pre-wrap break-words text-fg-muted">
              {`${r.characterName} learned ${r.skillName}!`}
            </p>
            <div class="mt-1.5 flex justify-end">
              <button
                type="button"
                class="rounded-(--radius-control) border border-accent bg-transparent px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-accent transition hover:bg-accent hover:text-accent-fg"
                title={`Learn ${r.skillName}`}
                onClick={learn}
              >
                Learn
              </button>
            </div>
          </article>
        );
      }}
    </Show>
  );
}

/**
 * Plug-in contributor for the comms `chat-timeline-contributors` slot
 * surfacing every open `SkillLearningOpportunity` entity (one per
 * unlearned skill whose Beginner's Luck track has just filled).
 */
export const TbSkillLearningTimelineContributor: NotificationFeed = {
  kind: "@vtt/system-torchbearer/skill-learning",
  useEntries: () => {
    const rows = useQuery([SkillLearningOpportunity]);
    const accessor = createMemo<NotificationEntry[]>(() =>
      rows().map((row) => {
        const rec = row.values.SkillLearningOpportunity as { sentAt: number };
        return {
          id: row.id,
          sortKey: rec.sentAt,
          render: () => LearningOpportunityRow({ entityId: row.id }) as unknown,
        };
      }),
    );
    return accessor as unknown as () => NotificationEntry[];
  },
};

/**
 * Plug-in contributor for the comms `chat-timeline-contributors` slot
 * that surfaces every TB-flavoured Roll entity (Formula.meta.system
 * === "@vtt/system-torchbearer") as a TB-aware row. The resolution
 * package's contributor filters out system-claimed rolls, so for any
 * given TB roll exactly one chat row appears.
 */
/**
 * Plug-in contributor for the comms `chat-timeline-contributors`
 * slot. Surfaces every `LightWentOutNotice` entity as a chat card
 * reading "{character}'s {item} goes out" — spawned by the grind
 * tick system when a lit light source's turnsRemaining hits 0.
 * The notice entity persists so the card stays visible across
 * snapshot replays.
 */
function LightWentOutCard(props: { entityId: string }): JSX.Element {
  const client = useClient();
  const notice = useTrait(props.entityId, LightWentOutNotice) as () =>
    | {
        holderName: string;
        itemName: string;
        turn: number;
      }
    | undefined;
  const remove = (): void => {
    client.dispatch(DismissLightWentOut({ noticeId: props.entityId }) as CommandInstance);
  };
  return (
    <Show when={notice()} keyed>
      {(n) => (
        <article
          class="rounded-(--radius-card) border border-border-muted bg-surface-elevated px-3 py-2 text-sm"
          data-testid={`light-out-card-${props.entityId}`}
        >
          <header class="flex items-baseline justify-between gap-2 pr-6 text-xs">
            <span class="font-medium text-fg">{n.holderName}</span>
            <span class="text-[0.6rem] uppercase tracking-[0.16em] text-warning">
              light · turn {n.turn}
            </span>
          </header>
          <p class="mt-1 whitespace-pre-wrap break-words text-fg-muted">
            {`${n.holderName}'s ${n.itemName} goes out.`}
          </p>
          <div class="mt-1.5 flex justify-end">
            <button
              type="button"
              class="rounded-(--radius-control) border border-border bg-transparent px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-fg-muted transition hover:bg-surface"
              data-testid={`light-out-remove-${props.entityId}`}
              title="Remove the burnt-out light source from inventory"
              onClick={remove}
            >
              Remove
            </button>
          </div>
        </article>
      )}
    </Show>
  );
}

function GrindTollCard(props: { entityId: string }): JSX.Element {
  const client = useClient();
  const toll = useTrait(props.entityId, GrindToll) as () =>
    | {
        turn: number;
        rows: Array<{
          characterId: string;
          characterName: string;
          condition: GrindCondition;
          applied: boolean;
        }>;
      }
    | undefined;
  const apply = (rowIndex: number): void => {
    client.dispatch(
      MarkGrindToll({
        tollId: props.entityId,
        rowIndex,
      }) as CommandInstance,
    );
  };
  return (
    <Show when={toll()} keyed>
      {(t) => (
        <article
          class="rounded-(--radius-card) border border-border-muted bg-surface-elevated px-3 py-2 text-sm"
          data-testid={`grind-toll-card-${props.entityId}`}
        >
          <header class="flex items-baseline justify-between gap-2 pr-6 text-xs">
            <span class="font-medium text-fg">The grind takes its toll.</span>
            <span class="text-[0.6rem] uppercase tracking-[0.16em] text-warning">
              turn {t.turn}
            </span>
          </header>
          <ul class="mt-1.5 flex flex-col gap-1.5 list-none p-0 m-0">
            <For each={t.rows}>
              {(row, idx) => (
                <li class="flex items-center gap-2">
                  <span class="flex-1">
                    {row.characterName} is {grindConditionLabel(row.condition)}.
                  </span>
                  <Show
                    when={row.applied}
                    fallback={
                      <button
                        type="button"
                        class="rounded-(--radius-control) border border-accent bg-transparent px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-accent transition hover:bg-accent hover:text-accent-fg"
                        data-testid={`grind-toll-apply-${props.entityId}-${idx()}`}
                        title={`Mark ${row.characterName} as ${grindConditionLabel(row.condition)}`}
                        onClick={() => apply(idx())}
                      >
                        Apply
                      </button>
                    }
                  >
                    <span
                      class="text-[0.7rem] uppercase tracking-[0.12em] text-fg-subtle"
                      data-testid={`grind-toll-applied-${props.entityId}-${idx()}`}
                    >
                      ✓ applied
                    </span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </article>
      )}
    </Show>
  );
}

function grindConditionLabel(c: GrindCondition): string {
  switch (c) {
    case "hungryThirsty":
      return "hungry and thirsty";
    case "exhausted":
      return "exhausted";
    case "angry":
      return "angry";
    case "sick":
      return "sick";
    case "injured":
      return "injured";
    case "afraid":
      return "afraid";
    case "dead":
      return "dead";
  }
}

/**
 * Plug-in contributor for the comms `chat-timeline-contributors`
 * slot. Surfaces every open `GrindToll` entity as one chat card —
 * a row per character with an Apply button. Once every row is
 * applied the toll entity is despawned and the card disappears.
 */
export const TbGrindTollContributor: NotificationFeed = {
  kind: "@vtt/system-torchbearer/grind-toll",
  useEntries: () => {
    const rows = useQuery([GrindToll]);
    const accessor = createMemo<NotificationEntry[]>(() =>
      rows().map((row) => {
        const t = row.values.GrindToll as { sentAt: number };
        return {
          id: row.id,
          sortKey: t.sentAt,
          render: () => GrindTollCard({ entityId: row.id }) as unknown,
        };
      }),
    );
    return accessor as unknown as () => NotificationEntry[];
  },
};

export const TbLightWentOutContributor: NotificationFeed = {
  kind: "@vtt/system-torchbearer/light-out",
  useEntries: () => {
    const rows = useQuery([LightWentOutNotice]);
    const accessor = createMemo<NotificationEntry[]>(() =>
      rows().map((row) => {
        const n = row.values.LightWentOutNotice as { sentAt: number };
        return {
          id: row.id,
          sortKey: n.sentAt,
          render: () => LightWentOutCard({ entityId: row.id }) as unknown,
        };
      }),
    );
    return accessor as unknown as () => NotificationEntry[];
  },
};

/** True for Roll entities this TB system claims via Formula.meta.system. */
function isTbRoll(formula: unknown): boolean {
  const meta = (formula as { meta?: unknown } | undefined)?.meta as
    | { system?: unknown }
    | undefined;
  return !!meta && (meta as { system?: string }).system === TB_ROLL_META_SYSTEM;
}

function tbOriginOf(formula: unknown): string | null {
  const meta = (formula as { meta?: unknown } | undefined)?.meta as
    | { originPendingRollId?: unknown }
    | undefined;
  return typeof meta?.originPendingRollId === "string" ? meta.originPendingRollId : null;
}

export const TbRollChatTimelineContributor: ChatTimelineContributor = {
  kind: "@vtt/system-torchbearer/roll",
  useEntries: () => {
    const rolls = useQuery([Formula, RollResult, RolledBy]);
    const accessor = createMemo<ChatTimelineEntry[]>(() =>
      rolls()
        .filter((row) => isTbRoll(row.values.Formula))
        .map((row) => {
          const r = row.values.RollResult as { rolledAt: number };
          return {
            id: row.id,
            sortKey: r.rolledAt,
            render: () => TbRollRow({ entityId: row.id }) as unknown,
          };
        }),
    );
    return accessor as unknown as () => ChatTimelineEntry[];
  },
};

/**
 * Resolved-roll feed for the Roll Atelier — the TB counterpart of
 * resolution's `RollAtelierFeed`. Surfaces every TB Roll entity as a
 * "Recent" rail entry whose right-pane card is the full `TbRollRow`
 * audit trail. The Atelier (in `@vtt/characters`) can't read TB traits
 * or decide TB rendering, so this feed is how committed TB rolls reach it.
 */
export const TbRollAtelierFeed: ResolvedRollFeed = {
  kind: "@vtt/system-torchbearer/roll",
  useEntries: () => {
    const rolls = useQuery([Formula, RollResult, RolledBy]);
    const accessor = createMemo<ResolvedRollEntry[]>(() => {
      const all = rolls() as ReadonlyArray<RollRow>;
      return all
        .filter((row) => isTbRoll(row.values.Formula))
        .map((row) => {
          const f = row.values.Formula as { notation: string; meta?: unknown };
          const r = row.values.RollResult as {
            rolledAt: number;
            dice?: ReadonlyArray<DieFace>;
          };
          const rb = row.values.RolledBy as { displayName: string };
          const parsed = TbRollMetaSchema.safeParse(f.meta);
          const outcome = parsed.success
            ? tbOutcome(row.id, parsed.data.spec, r.dice ?? [], all)
            : undefined;
          return {
            id: row.id,
            sortKey: r.rolledAt,
            title: rb.displayName,
            subtitle: f.notation,
            originPendingRollId: tbOriginOf(row.values.Formula),
            outcome,
            render: () => TbRollRow({ entityId: row.id }) as unknown,
          };
        });
    });
    return accessor as unknown as () => ResolvedRollEntry[];
  },
};

export const TbRollAtelierFeedFills = {
  [ResolvedRollFeedSlot.name]: [TbRollAtelierFeed],
};
