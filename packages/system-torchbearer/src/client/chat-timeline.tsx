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
import type {
  ChatTimelineContributor,
  ChatTimelineEntry,
} from "@vtt/comms/shared";
import { Formula, RollResult, RolledBy } from "@vtt/resolution/shared";
import { createMemo, Show, type JSX } from "solid-js";
import {
  ImproveSkill,
  LearnSkill,
  SkillImprovementOpportunity,
  SkillLearningOpportunity,
  TB_ROLL_META_SYSTEM,
} from "../shared/index.js";
import { TbRollRow } from "./tb-roll-row.js";

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
            <header class="flex items-baseline justify-between gap-2 text-xs">
              <span class="font-medium text-fg">{r.characterName}</span>
              <span class="text-[0.6rem] uppercase tracking-[0.16em] text-accent">
                advancement
              </span>
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
export const TbChatTimelineContributor: ChatTimelineContributor = {
  kind: "@vtt/system-torchbearer/skill-improvement",
  useEntries: () => {
    const rows = useQuery([SkillImprovementOpportunity]);
    const accessor = createMemo<ChatTimelineEntry[]>(() =>
      rows().map((row) => {
        const rec = row.values.SkillImprovementOpportunity as { sentAt: number };
        return {
          id: row.id,
          sortKey: rec.sentAt,
          render: () => OpportunityRow({ entityId: row.id }) as unknown,
        };
      }),
    );
    return accessor as unknown as () => ChatTimelineEntry[];
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
            <header class="flex items-baseline justify-between gap-2 text-xs">
              <span class="font-medium text-fg">{r.characterName}</span>
              <span class="text-[0.6rem] uppercase tracking-[0.16em] text-accent">
                learning
              </span>
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
export const TbSkillLearningTimelineContributor: ChatTimelineContributor = {
  kind: "@vtt/system-torchbearer/skill-learning",
  useEntries: () => {
    const rows = useQuery([SkillLearningOpportunity]);
    const accessor = createMemo<ChatTimelineEntry[]>(() =>
      rows().map((row) => {
        const rec = row.values.SkillLearningOpportunity as { sentAt: number };
        return {
          id: row.id,
          sortKey: rec.sentAt,
          render: () => LearningOpportunityRow({ entityId: row.id }) as unknown,
        };
      }),
    );
    return accessor as unknown as () => ChatTimelineEntry[];
  },
};

/**
 * Plug-in contributor for the comms `chat-timeline-contributors` slot
 * that surfaces every TB-flavoured Roll entity (Formula.meta.system
 * === "@vtt/system-torchbearer") as a TB-aware row. The resolution
 * package's contributor filters out system-claimed rolls, so for any
 * given TB roll exactly one chat row appears.
 */
export const TbRollChatTimelineContributor: ChatTimelineContributor = {
  kind: "@vtt/system-torchbearer/roll",
  useEntries: () => {
    const rolls = useQuery([Formula, RollResult, RolledBy]);
    const accessor = createMemo<ChatTimelineEntry[]>(() =>
      rolls()
        .filter((row) => {
          const meta = (row.values.Formula as { meta?: unknown } | undefined)
            ?.meta as { system?: unknown } | undefined;
          return !!meta && (meta as { system?: string }).system === TB_ROLL_META_SYSTEM;
        })
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
