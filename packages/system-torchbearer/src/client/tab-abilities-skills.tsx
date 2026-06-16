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

import { qualifiedName, type CommandInstance } from "@vtt/substrate";
import { useClient, useTrait } from "@vtt/substrate/client";
import { kit } from "@vtt/characters/client";
import { useTraitPath } from "@vtt/substrate/client";
import type { CharacterSheetTab } from "@vtt/characters/shared";
import { createMemo, For, Show, type JSX } from "solid-js";
import {
  ALL_SKILLS,
  HealthCheck,
  ImproveAbility,
  ImproveSkill,
  LearnSkill,
  PinnedRolls,
  pinnedRollKey,
  RawAbilities,
  ResourcesCheck,
  CirclesCheck,
  SetSpecialtySkill,
  SkillCheck,
  Skills,
  TogglePinnedRoll,
  TownAbilities,
  WillCheck,
  NatureCheck,
  type PinnedRollEntryT,
  type SkillEntry,
} from "../shared/index.js";

/**
 * "Abilities & Skills" tab — the rolling surface. Renders the three
 * raw abilities (Will / Health / Nature) with rating + advancement,
 * then the four town abilities, then the full alphabetical skill list
 * (DH 33 + LMM 8 = 41 skills, no source-book sub-headers).
 *
 * Each row's P/F bubbles come from the `kit.AdvancementTrack`
 * primitive: bubble counts are derived from the rating via the
 * Torchbearer formula (DH p.108).
 */
function AbilitiesSkillsTab(props: { characterId: string }): JSX.Element {
  const sortedSkills = createMemo<ReadonlyArray<SkillEntry>>(() =>
    ALL_SKILLS.filter((s) => s.category !== "npc").sort((a, b) => a.name.localeCompare(b.name)),
  );

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
      <kit.SheetSection title="Abilities">
        <kit.SheetGroup layout="grid" cols={2}>
          <AbilityRow
            characterId={props.characterId}
            kind="will"
            label="Will"
            rollable={WillCheck.name}
          />
          <AbilityRow
            characterId={props.characterId}
            kind="health"
            label="Health"
            rollable={HealthCheck.name}
          />
        </kit.SheetGroup>
        <NatureRow characterId={props.characterId} />
        <NatureDescriptorsRow characterId={props.characterId} />
      </kit.SheetSection>

      <kit.SheetSection title="Town">
        <kit.SheetGroup layout="grid" cols={2}>
          <TownRatedRow
            characterId={props.characterId}
            kind="resources"
            label="Resources"
            rollable={ResourcesCheck.name}
          />
          <TownRatedRow
            characterId={props.characterId}
            kind="circles"
            label="Circles"
            rollable={CirclesCheck.name}
          />
          <kit.FieldRow label="Precedence">
            <kit.NumberField
              characterId={props.characterId}
              trait={TownAbilities}
              path={["precedence"]}
              min={0}
              max={10}
            />
          </kit.FieldRow>
          <kit.FieldRow label="Might">
            <kit.NumberField
              characterId={props.characterId}
              trait={TownAbilities}
              path={["might"]}
              min={0}
              max={6}
            />
          </kit.FieldRow>
        </kit.SheetGroup>
      </kit.SheetSection>

      <kit.SheetSection title="Skills">
        <kit.SheetGroup layout="grid" cols={2}>
          <For each={sortedSkills()}>
            {(skill) => <SkillRow characterId={props.characterId} skill={skill} />}
          </For>
        </kit.SheetGroup>
      </kit.SheetSection>
    </div>
  );
}

/**
 * Render an ability row in the same shape as `SkillRow`: a clickable
 * name label that opens a pending roll, an editable rating field, and
 * the standard P / F advancement track. The label — not the number —
 * is the click target so editing the rating doesn't double-fire as a
 * roll, matching how skills work.
 */
function AbilityRow(props: {
  characterId: string;
  kind: "will" | "health";
  label: string;
  rollable: string;
}): JSX.Element {
  const client = useClient();
  const rating = useTraitPath(props.characterId, RawAbilities, [props.kind, "rating"]);
  const improve = () =>
    client.dispatch(
      ImproveAbility({
        characterId: props.characterId,
        ability: props.kind,
      }) as CommandInstance,
    );
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "0.6rem",
        "min-width": 0,
      }}
    >
      <PinToggleButton
        characterId={props.characterId}
        entry={{ kind: "ability", ability: props.kind }}
      />
      <kit.RollableLabel characterId={props.characterId} rollable={props.rollable}>
        <span
          style={{
            display: "inline-flex",
            "align-items": "baseline",
            "min-width": "9rem",
            "font-family": "var(--font-display)",
            "font-size": "0.85rem",
            color: "var(--color-fg)",
          }}
        >
          {props.label}
        </span>
      </kit.RollableLabel>
      <kit.NumberField
        characterId={props.characterId}
        trait={RawAbilities}
        path={[props.kind, "rating"]}
        min={0}
        max={7}
      />
      <kit.AdvancementTrack
        characterId={props.characterId}
        trait={RawAbilities}
        passPath={[props.kind, "advancement", "pass"]}
        failPath={[props.kind, "advancement", "fail"]}
        rating={typeof rating() === "number" ? (rating() as number) : 0}
        onImprove={improve}
        improveLabel={`Improve ${props.label}`}
      />
    </div>
  );
}

function NatureRow(props: { characterId: string }): JSX.Element {
  // DH p.69: Nature advances against its **maximum** rating, not the
  // current (possibly taxed) rating — track length and improve threshold
  // both follow `nature.maximum`.
  const maxRating = useTraitPath(props.characterId, RawAbilities, ["nature", "maximum"]);
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "0.6rem",
        "min-width": 0,
      }}
    >
      <PinToggleButton
        characterId={props.characterId}
        entry={{ kind: "ability", ability: "nature" }}
      />
      <kit.RollableLabel characterId={props.characterId} rollable={NatureCheck.name}>
        <span
          style={{
            display: "inline-flex",
            "align-items": "baseline",
            "min-width": "9rem",
            "font-family": "var(--font-display)",
            "font-size": "0.85rem",
            color: "var(--color-fg)",
          }}
        >
          Nature
        </span>
      </kit.RollableLabel>
      <kit.NumberField
        characterId={props.characterId}
        trait={RawAbilities}
        path={["nature", "rating"]}
        min={0}
        max={7}
      />
      <Hint text="maximum" />
      <kit.NumberField
        characterId={props.characterId}
        trait={RawAbilities}
        path={["nature", "maximum"]}
        min={0}
        max={7}
      />
      <kit.AdvancementTrack
        characterId={props.characterId}
        trait={RawAbilities}
        passPath={["nature", "advancement", "pass"]}
        failPath={["nature", "advancement", "fail"]}
        rating={typeof maxRating() === "number" ? (maxRating() as number) : 0}
      />
    </div>
  );
}

function NatureDescriptorsRow(props: { characterId: string }): JSX.Element {
  return (
    <div class="vk-row">
      <span class="vk-row__label" style={{ "min-width": "9rem" }}>
        Nature Descriptors
      </span>
      <kit.EntryListField
        characterId={props.characterId}
        trait={RawAbilities}
        path={["nature", "descriptors"]}
        emptyPlaceholder="add descriptor…"
        placeholder="+ descriptor"
      />
    </div>
  );
}

function TownRatedRow(props: {
  characterId: string;
  kind: "resources" | "circles";
  label: string;
  rollable: string;
}): JSX.Element {
  const client = useClient();
  const rating = useTraitPath(props.characterId, TownAbilities, [props.kind, "rating"]);
  const improve = () =>
    client.dispatch(
      ImproveAbility({
        characterId: props.characterId,
        ability: props.kind,
      }) as CommandInstance,
    );
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "0.6rem",
        "min-width": 0,
      }}
    >
      <PinToggleButton
        characterId={props.characterId}
        entry={{ kind: "ability", ability: props.kind }}
      />
      <kit.RollableLabel characterId={props.characterId} rollable={props.rollable}>
        <span
          style={{
            display: "inline-flex",
            "align-items": "baseline",
            "min-width": "9rem",
            "font-family": "var(--font-display)",
            "font-size": "0.85rem",
            color: "var(--color-fg)",
          }}
        >
          {props.label}
        </span>
      </kit.RollableLabel>
      <kit.NumberField
        characterId={props.characterId}
        trait={TownAbilities}
        path={[props.kind, "rating"]}
        min={0}
        max={10}
      />
      <kit.AdvancementTrack
        characterId={props.characterId}
        trait={TownAbilities}
        passPath={[props.kind, "advancement", "pass"]}
        failPath={[props.kind, "advancement", "fail"]}
        rating={typeof rating() === "number" ? (rating() as number) : 0}
        onImprove={improve}
        improveLabel={`Improve ${props.label}`}
      />
    </div>
  );
}

function Hint(props: { text: string }): JSX.Element {
  return (
    <span style={{ "font-size": "0.75rem", color: "var(--color-fg-muted)" }}>{props.text}</span>
  );
}

function SkillRow(props: { characterId: string; skill: SkillEntry }): JSX.Element {
  // Each skill row: clickable name + BL hint, editable rating, then a
  // vertically-stacked P/F advancement track (bubble count derived
  // from rating via DH p.108 formula). On narrow viewports the whole
  // section drops to one column via `vk-group--cols-2` collapse.
  //
  // Beginner's Luck learning state (DH p.75): once the player has
  // started using BL on an unlearned skill, the row displays "X" in
  // place of the rating field and a single "L" track sized to the
  // character's max Nature rating. The L track ticks up each time a
  // BL roll is logged via the chat-row "Log Test" button; when the
  // count crosses max Nature, the system auto-promotes the skill to
  // rating 2 (rules-as-written).
  const client = useClient();
  const rating = useTraitPath(props.characterId, Skills, ["entries", props.skill.id, "rating"]);

  const learningTests = useTraitPath(props.characterId, Skills, [
    "entries",
    props.skill.id,
    "learningTests",
  ]);
  // Max Nature drives the learning threshold (DH p.75). We read
  // `nature.maximum` since taxing Nature doesn't change the maximum
  // rating used for advancement / learning math (DH p.69
  // "Advancing Nature").
  const maxNature = useTraitPath(props.characterId, RawAbilities, ["nature", "maximum"]);
  const isLearning = createMemo<boolean>(() => {
    const r = typeof rating() === "number" ? (rating() as number) : 0;
    const l = typeof learningTests() === "number" ? (learningTests() as number) : 0;
    return r === 0 && l > 0;
  });
  const learningThreshold = createMemo<number>(() => {
    const m = typeof maxNature() === "number" ? (maxNature() as number) : 0;
    return m;
  });
  const isLearningFull = createMemo<boolean>(() => {
    if (!isLearning()) return false;
    const t = learningThreshold();
    if (t <= 0) return false;
    const l = typeof learningTests() === "number" ? (learningTests() as number) : 0;
    return l >= t;
  });
  const canEdit = kit.useCanEdit(props.characterId);
  const improve = () => {
    client.dispatch(
      ImproveSkill({
        characterId: props.characterId,
        skillId: props.skill.id,
      }) as CommandInstance,
    );
  };
  const learn = () => {
    client.dispatch(
      LearnSkill({
        characterId: props.characterId,
        skillId: props.skill.id,
      }) as CommandInstance,
    );
  };
  // Advancement / learning opportunities are opened server-side by
  // `LogAdvancement` the moment a roll fills the track — independent of
  // whether this sheet is mounted. We deliberately do NOT re-open them
  // from a mount-time effect here: that re-created cards on every refresh
  // (flooding the overlay) and resurrected ones the player had dismissed.
  // The improve / learn arrows below still commit directly.
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "0.6rem",
        "min-width": 0,
      }}
    >
      <PinToggleButton
        characterId={props.characterId}
        entry={{ kind: "skill", skillId: props.skill.id }}
      />
      <SpecialtyToggleButton
        characterId={props.characterId}
        skillId={props.skill.id}
        skillName={props.skill.name}
      />
      <kit.RollableLabel
        characterId={props.characterId}
        rollable={SkillCheck.name}
        opts={{ skillId: props.skill.id }}
      >
        <span
          style={{
            display: "inline-flex",
            "align-items": "baseline",
            gap: "0.3rem",
            "min-width": "9rem",
            "font-family": "var(--font-display)",
            "font-size": "0.85rem",
            color: "var(--color-fg)",
          }}
        >
          {props.skill.name}
          <span style={{ color: "var(--color-fg-muted)", "font-size": "0.75rem" }}>
            ({props.skill.bl === "will" ? "W" : "H"})
          </span>
        </span>
      </kit.RollableLabel>
      <Show
        when={isLearning()}
        fallback={
          <>
            <kit.NumberField
              characterId={props.characterId}
              trait={Skills}
              path={["entries", props.skill.id, "rating"]}
              min={0}
              max={6}
            />
            <kit.AdvancementTrack
              characterId={props.characterId}
              trait={Skills}
              passPath={["entries", props.skill.id, "advancement", "pass"]}
              failPath={["entries", props.skill.id, "advancement", "fail"]}
              rating={typeof rating() === "number" ? (rating() as number) : 0}
              onImprove={improve}
              improveLabel={`Improve ${props.skill.name}`}
            />
          </>
        }
      >
        <span
          aria-label={`learning ${props.skill.name}`}
          title={`Learning ${props.skill.name} via Beginner's Luck (DH p.75)`}
          data-testid={`tb-skill-learning-rating-${props.skill.id}`}
          style={{
            display: "inline-flex",
            "align-items": "center",
            "justify-content": "center",
            "min-width": "1.6rem",
            "font-family": "var(--font-display)",
            "font-size": "0.95rem",
            "font-weight": "600",
            color: "var(--color-accent)",
          }}
        >
          X
        </span>
        <LearningTrack
          characterId={props.characterId}
          skillId={props.skill.id}
          skillName={props.skill.name}
          max={learningThreshold()}
          isFull={isLearningFull() && canEdit()}
          onLearn={learn}
        />
      </Show>
    </div>
  );
}

/**
 * Single dot track + "L" legend showing learning-test progress for a
 * skill not yet rated. `max` is the character's max Nature rating
 * (DH p.75). Bound to `Skills.entries[skillId].learningTests`, so
 * editors can click to nudge the count manually if needed — same
 * affordance the standard P/F bubbles offer. When the track is full,
 * an "up" arrow appears that dispatches `LearnSkill` to commit the
 * 0 → 2 rating bump, mirroring the standard advancement track.
 */
function LearningTrack(props: {
  characterId: string;
  skillId: string;
  skillName: string;
  /** Max Nature rating — drives the bubble count. */
  max: number;
  /** True when the L pip count has reached `max` and the viewer can edit. */
  isFull: boolean;
  /** Click handler for the up-arrow — commits LearnSkill. */
  onLearn: () => void;
}): JSX.Element {
  return (
    <div
      class="vk-advance"
      aria-label="learning track"
      data-testid={`tb-skill-learning-track-${props.skillId}`}
    >
      <div class="vk-advance__stack">
        <div class="vk-advance__row">
          <span class="vk-advance__legend" aria-hidden="true">
            L
          </span>
          <Show when={props.max > 0} fallback={<span class="vk-advance__empty">—</span>}>
            <kit.DotsField
              characterId={props.characterId}
              trait={Skills}
              path={["entries", props.skillId, "learningTests"]}
              max={props.max}
            />
          </Show>
        </div>
      </div>
      <Show when={props.isFull}>
        <button
          type="button"
          class="vk-advance__improve"
          title={`Learn ${props.skillName}`}
          aria-label={`Learn ${props.skillName}`}
          data-testid={`tb-skill-learn-arrow-${props.skillId}`}
          onClick={() => props.onLearn()}
        >
          ↑
        </button>
      </Show>
    </div>
  );
}

/**
 * Pin / unpin toggle for one ability or skill. Reads the live
 * `PinnedRolls` trait to decide visual state (filled vs outline) and
 * dispatches `TogglePinnedRoll` on click. Hidden for non-editors so
 * non-owners don't think they can rearrange another player's bar.
 */
function PinToggleButton(props: { characterId: string; entry: PinnedRollEntryT }): JSX.Element {
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);
  const pinned = useTrait(props.characterId, PinnedRolls);
  const isPinned = createMemo<boolean>(() => {
    const v = pinned();
    const entries = v?.entries ?? [
      { kind: "ability", ability: "will" } as PinnedRollEntryT,
      { kind: "ability", ability: "health" } as PinnedRollEntryT,
    ];
    const targetKey = pinnedRollKey(props.entry);
    return entries.some((e) => pinnedRollKey(e) === targetKey);
  });
  const labelFor = (entry: PinnedRollEntryT): string =>
    entry.kind === "ability" ? entry.ability : entry.skillId;
  const toggle = () => {
    if (!canEdit()) return;
    client.dispatch(
      TogglePinnedRoll({
        characterId: props.characterId,
        entry: props.entry,
      }) as CommandInstance,
    );
  };
  return (
    <Show when={canEdit()}>
      <button
        type="button"
        title={
          isPinned()
            ? `Unpin ${labelFor(props.entry)} from actions bar`
            : `Pin ${labelFor(props.entry)} to actions bar`
        }
        aria-label={isPinned() ? `Unpin ${labelFor(props.entry)}` : `Pin ${labelFor(props.entry)}`}
        aria-pressed={isPinned()}
        data-testid={`tb-pin-toggle-${props.entry.kind}-${labelFor(props.entry)}`}
        onClick={toggle}
        style={{
          display: "inline-flex",
          "align-items": "center",
          "justify-content": "center",
          "min-width": "1.2rem",
          height: "1.2rem",
          padding: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          "font-family": "var(--font-display)",
          "font-size": "0.85rem",
          "font-weight": "600",
          "line-height": 1,
          color: isPinned() ? "var(--color-fg)" : "var(--color-fg-muted)",
          opacity: isPinned() ? 1 : 0.4,
        }}
      >
        {isPinned() ? "■" : "□"}
      </button>
    </Show>
  );
}

/**
 * Specialty toggle for one skill. Single-select across the character's
 * skill list — clicking a different skill's button replaces the
 * previous specialty automatically (the command sets, doesn't add).
 * Hidden for non-editors.
 */
function SpecialtyToggleButton(props: {
  characterId: string;
  skillId: string;
  skillName: string;
}): JSX.Element {
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);
  const specialty = useTraitPath(props.characterId, Skills, ["specialtySkillId"]);
  const isSpecialty = createMemo<boolean>(() => specialty() === props.skillId);
  const toggle = () => {
    if (!canEdit()) return;
    client.dispatch(
      SetSpecialtySkill({
        characterId: props.characterId,
        skillId: isSpecialty() ? null : props.skillId,
      }) as CommandInstance,
    );
  };
  return (
    <Show when={canEdit()}>
      <button
        type="button"
        title={
          isSpecialty()
            ? `Clear ${props.skillName} as specialty`
            : `Mark ${props.skillName} as specialty`
        }
        aria-label={
          isSpecialty() ? `Clear ${props.skillName} specialty` : `Mark ${props.skillName} specialty`
        }
        aria-pressed={isSpecialty()}
        data-testid={`tb-specialty-toggle-${props.skillId}`}
        onClick={toggle}
        style={{
          display: "inline-flex",
          "align-items": "center",
          "justify-content": "center",
          "min-width": "1.2rem",
          height: "1.2rem",
          padding: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          "font-size": "0.95rem",
          "line-height": 1,
          color: isSpecialty() ? "var(--color-fg)" : "var(--color-fg-muted)",
          opacity: isSpecialty() ? 1 : 0.4,
        }}
      >
        {isSpecialty() ? "★" : "☆"}
      </button>
    </Show>
  );
}

export const TbAbilitiesSkillsTabFill: CharacterSheetTab = {
  id: qualifiedName("@vtt/system-torchbearer/tab-abilities-skills") as CharacterSheetTab["id"],
  label: "Abilities & Skills",
  priority: 80,
  render: ({ characterId }) => AbilitiesSkillsTab({ characterId }),
};
