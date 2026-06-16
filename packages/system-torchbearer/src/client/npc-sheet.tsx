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

import { type CommandInstance } from "@vtt/substrate";
import { useClient, useTrait } from "@vtt/substrate/client";
import { BookCitation } from "@vtt/books/client";
import { ActiveToggle, kit } from "@vtt/characters/client";
import { Character, SetField, Team } from "@vtt/characters/shared";
import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js";
import {
  ALL_SKILLS,
  CharacterTraits,
  CirclesCheck,
  Conditions,
  HealthCheck,
  NatureCheck,
  RawAbilities,
  ResourcesCheck,
  SkillCheck,
  Skills,
  TownAbilities,
  WillCheck,
  Wises,
  getSkill,
  type SkillEntry,
} from "../shared/index.js";
import { TbNpc } from "../shared/npc-traits.js";
import { TbInventoryView } from "./tab-inventory.js";
import { tbCanonicalBookAbbreviation } from "../data/seed.js";

/**
 * Render label for a `<BookCitation>` from a TB pageRef. Resolves the
 * canonicalId to a TB abbreviation when known (`"SG p.201"`); falls
 * back to a generic `"p.<page>"` for unknown books.
 */
function citationLabel(canonicalId: string, page: number): string {
  const abbrev = tbCanonicalBookAbbreviation(canonicalId);
  return abbrev !== null ? `${abbrev} p.${page}` : `p.${page}`;
}

const NPC_SHEET_STYLE_ID = "tb-npc-sheet-styles";

/**
 * Stylesheet for the NPC sheet — single scroll, no tabs. Closely
 * mirrors the monster sheet so the GM gets one mental model for any
 * NPC-side stat block. The "stat strip" is a 2x4 grid showing each of
 * the rated abilities (Will, Health, Nature, Resources, Circles,
 * Precedence, Might) plus a header row.
 */
const NPC_SHEET_CSS = `
.tb-npc-sheet {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-surface);
  color: var(--color-fg);
}
.tb-npc-sheet__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem 1.25rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.tb-npc-sheet__statbar {
  display: grid;
  grid-template-columns: repeat(4, minmax(5rem, 1fr));
  gap: 0.6rem;
  background: var(--color-surface-elevated, var(--color-surface));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control, 0.5rem);
  padding: 0.6rem 0.75rem;
}
.tb-npc-sheet__stat {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  align-items: center;
  padding: 0.2rem 0.4rem;
  border-radius: var(--radius-control, 0.4rem);
}
.tb-npc-sheet__stat-rollable {
  cursor: pointer;
}
.tb-npc-sheet__stat-rollable:hover {
  background: var(--color-bg-hover, var(--color-surface-elevated));
}
.tb-npc-sheet__stat-label {
  font-family: var(--font-display);
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-fg-muted);
}
.tb-npc-sheet__stat-value {
  font-family: var(--font-display);
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--color-fg);
}
.tb-npc-sheet__role-row {
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
  align-items: baseline;
  flex-wrap: wrap;
}
.tb-npc-sheet__role-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: var(--color-bg-hover, var(--color-surface-elevated));
  border: 1px solid var(--color-border-muted);
  font-family: var(--font-display);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  color: var(--color-fg);
}
.tb-npc-sheet__skills {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.tb-npc-sheet__skill-row {
  display: grid;
  grid-template-columns: 1fr 4rem auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.2rem 0;
  border-bottom: 1px dashed var(--color-border-muted);
}
.tb-npc-sheet__skill-row:last-child { border-bottom: 0; }
.tb-npc-sheet__skill-name {
  font-size: 0.9rem;
  color: var(--color-fg);
  font-weight: 600;
}
.tb-npc-sheet__skill-rating {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  text-align: right;
  font-size: 0.95rem;
}
.tb-npc-sheet__add-skill {
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 0.4rem;
}
.tb-npc-sheet__empty {
  font-style: italic;
  color: var(--color-fg-muted);
  font-size: 0.85rem;
}
.tb-npc-sheet__conditions {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.tb-npc-sheet__cond-chip {
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--color-border-muted);
  background: var(--color-surface-elevated, var(--color-surface));
  font-family: var(--font-display);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  color: var(--color-fg-muted);
}
.tb-npc-sheet__cond-chip[data-on="true"] {
  background: var(--color-danger-bg, var(--color-warning-bg, var(--color-bg-hover)));
  color: var(--color-danger-fg, var(--color-fg));
  border-color: var(--color-danger, var(--color-border));
}
.tb-npc-sheet__team-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--color-fg-muted);
}
`;

function injectNpcSheetStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(NPC_SHEET_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = NPC_SHEET_STYLE_ID;
  el.textContent = NPC_SHEET_CSS;
  document.head.appendChild(el);
}

const CONDITION_KEYS = [
  ["fresh", "Fresh"],
  ["hungryThirsty", "Hungry & Thirsty"],
  ["angry", "Angry"],
  ["afraid", "Afraid"],
  ["exhausted", "Exhausted"],
  ["injured", "Injured"],
  ["sick", "Sick"],
  ["dead", "Dead"],
] as const;

/**
 * NPC character sheet — single scrolling column, simplified relative
 * to the PC sheet. Reuses the characters kit primitives so visual
 * grammar stays consistent.
 *
 * Shows only the rated skills (rating > 0); a dropdown below the list
 * adds new ones from the canonical catalog. Wises and traits are
 * minimal entry-list editors. Inventory is the free-text gear list
 * from the rulebook entry — NPCs deliberately don't carry the deep
 * tracking PCs and monsters use.
 */
export function NpcSheet(props: { characterId: string }): JSX.Element {
  onMount(injectNpcSheetStyles);
  const character = useTrait(props.characterId, Character);

  return (
    <Show
      when={character()}
      fallback={
        <div class="flex h-full items-center justify-center text-xs text-fg-subtle">
          NPC not found
        </div>
      }
    >
      <div class="tb-npc-sheet" data-npc-id={props.characterId}>
        <div class="tb-npc-sheet__scroll">
          <IdentitySection characterId={props.characterId} />
          <StatBlockSection characterId={props.characterId} />
          <SkillsSection characterId={props.characterId} />
          <WisesSection characterId={props.characterId} />
          <TraitsSection characterId={props.characterId} />
          <ConditionsSection characterId={props.characterId} />
          <GearSection characterId={props.characterId} />
          <DescriptionSection characterId={props.characterId} />
        </div>
      </div>
    </Show>
  );
}

function IdentitySection(props: { characterId: string }): JSX.Element {
  const npc = useTrait(props.characterId, TbNpc);
  const team = useTrait(props.characterId, Team);
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);

  const flipTeam = () => {
    const next = team()?.kind === "party" ? "enemy" : "party";
    client.dispatch(
      SetField({
        characterId: props.characterId,
        trait: Team.name,
        path: ["kind"],
        value: next,
      }) as CommandInstance,
    );
  };

  return (
    <kit.SheetSection>
      <kit.FieldRow label="Name">
        <kit.TextField
          characterId={props.characterId}
          trait={Character}
          path={["name"]}
          maxLength={120}
        />
      </kit.FieldRow>
      <kit.FieldRow label="Role">
        <kit.TextField
          characterId={props.characterId}
          trait={TbNpc}
          path={["role"]}
          maxLength={120}
          placeholder="e.g. Alchemist"
        />
      </kit.FieldRow>
      <Show when={npc()}>
        <div class="tb-npc-sheet__role-row">
          <span class="tb-npc-sheet__role-pill" data-testid="npc-role-pill">
            {(npc()!.role ?? "").toUpperCase()}
          </span>
          <Show when={npc()!.pageRef}>
            {(ref) => (
              <BookCitation
                canonicalId={ref().canonicalId}
                page={ref().page}
                label={citationLabel(ref().canonicalId, ref().page)}
              />
            )}
          </Show>
          <Show when={canEdit()}>
            <ActiveToggle characterId={props.characterId} size="md" />
          </Show>
          <span class="tb-npc-sheet__team-toggle" data-testid="npc-team-display">
            Side:&nbsp;
            <strong>{team()?.kind === "party" ? "Party" : "Enemy"}</strong>
            <Show when={canEdit()}>
              <button
                type="button"
                onClick={flipTeam}
                class="rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-[0.7rem] text-fg-muted hover:border-accent hover:text-fg transition"
                data-testid="npc-team-flip"
              >
                Flip
              </button>
            </Show>
          </span>
        </div>
      </Show>
    </kit.SheetSection>
  );
}

function StatBlockSection(props: { characterId: string }): JSX.Element {
  const abilities = useTrait(props.characterId, RawAbilities);
  const town = useTrait(props.characterId, TownAbilities);
  const will = createMemo(() => abilities()?.will.rating ?? 0);
  const health = createMemo(() => abilities()?.health.rating ?? 0);
  const nature = createMemo(() => abilities()?.nature.rating ?? 0);
  const resources = createMemo(() => town()?.resources.rating ?? 0);
  const circles = createMemo(() => town()?.circles.rating ?? 0);
  const might = createMemo(() => town()?.might ?? 0);
  const precedence = createMemo(() => town()?.precedence ?? 0);

  return (
    <kit.SheetSection title="Stat Block">
      <div class="tb-npc-sheet__statbar" role="group" aria-label="NPC stat block">
        <RollableStat
          characterId={props.characterId}
          rollable={WillCheck.name}
          ariaLabel="Roll Will"
          label="Will"
          value={will()}
          testId="npc-will"
        />
        <RollableStat
          characterId={props.characterId}
          rollable={HealthCheck.name}
          ariaLabel="Roll Health"
          label="Health"
          value={health()}
          testId="npc-health"
        />
        <RollableStat
          characterId={props.characterId}
          rollable={NatureCheck.name}
          ariaLabel="Roll Nature"
          label="Nature"
          value={nature()}
          testId="npc-nature"
        />
        <RollableStat
          characterId={props.characterId}
          rollable={ResourcesCheck.name}
          ariaLabel="Roll Resources"
          label="Resources"
          value={resources()}
          testId="npc-resources"
        />
        <RollableStat
          characterId={props.characterId}
          rollable={CirclesCheck.name}
          ariaLabel="Roll Circles"
          label="Circles"
          value={circles()}
          testId="npc-circles"
        />
        <PlainStat label="Might" value={might()} testId="npc-might" />
        <PlainStat label="Precedence" value={precedence()} testId="npc-precedence" />
      </div>
      <kit.SheetGroup layout="grid" cols={2}>
        <kit.FieldRow label="Will">
          <kit.NumberField
            characterId={props.characterId}
            trait={RawAbilities}
            path={["will", "rating"]}
            min={0}
            max={10}
          />
        </kit.FieldRow>
        <kit.FieldRow label="Health">
          <kit.NumberField
            characterId={props.characterId}
            trait={RawAbilities}
            path={["health", "rating"]}
            min={0}
            max={10}
          />
        </kit.FieldRow>
        <kit.FieldRow label="Nature">
          <kit.NumberField
            characterId={props.characterId}
            trait={RawAbilities}
            path={["nature", "rating"]}
            min={0}
            max={20}
          />
        </kit.FieldRow>
        <kit.FieldRow label="Resources">
          <kit.NumberField
            characterId={props.characterId}
            trait={TownAbilities}
            path={["resources", "rating"]}
            min={0}
            max={20}
          />
        </kit.FieldRow>
        <kit.FieldRow label="Circles">
          <kit.NumberField
            characterId={props.characterId}
            trait={TownAbilities}
            path={["circles", "rating"]}
            min={0}
            max={20}
          />
        </kit.FieldRow>
        <kit.FieldRow label="Might">
          <kit.NumberField
            characterId={props.characterId}
            trait={TownAbilities}
            path={["might"]}
            min={0}
            max={8}
          />
        </kit.FieldRow>
        <kit.FieldRow label="Precedence">
          <kit.NumberField
            characterId={props.characterId}
            trait={TownAbilities}
            path={["precedence"]}
            min={0}
            max={10}
          />
        </kit.FieldRow>
      </kit.SheetGroup>
      <kit.FieldStack label="Nature descriptors">
        <kit.EntryListField
          characterId={props.characterId}
          trait={RawAbilities}
          path={["nature", "descriptors"]}
          maxEntryLength={40}
          emptyPlaceholder="add a descriptor…"
        />
      </kit.FieldStack>
    </kit.SheetSection>
  );
}

function RollableStat(props: {
  characterId: string;
  rollable: string;
  ariaLabel: string;
  label: string;
  value: number;
  testId: string;
}): JSX.Element {
  return (
    <kit.RollableLabel
      characterId={props.characterId}
      rollable={props.rollable}
      ariaLabel={props.ariaLabel}
      class="tb-npc-sheet__stat tb-npc-sheet__stat-rollable"
    >
      <span class="tb-npc-sheet__stat-label">{props.label}</span>
      <span class="tb-npc-sheet__stat-value" data-testid={`${props.testId}-value`}>
        {props.value}
      </span>
    </kit.RollableLabel>
  );
}

function PlainStat(props: { label: string; value: number; testId: string }): JSX.Element {
  return (
    <div class="tb-npc-sheet__stat">
      <span class="tb-npc-sheet__stat-label">{props.label}</span>
      <span class="tb-npc-sheet__stat-value" data-testid={`${props.testId}-value`}>
        {props.value}
      </span>
    </div>
  );
}

/**
 * Skills section — shows only the rated skills (rating > 0). Clicking
 * the name rolls the skill via SkillCheck. Below the list, a
 * dropdown lets the GM add a new skill from the canonical catalog,
 * picking a rating 1–6. Removing a skill resets it to 0 (the entry
 * stays in the trait but disappears from the rendered list).
 */
function SkillsSection(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const skillsTrait = useTrait(props.characterId, Skills);
  const canEdit = kit.useCanEdit(props.characterId);
  const sortedSkills = createMemo<ReadonlyArray<SkillEntry>>(() =>
    [...ALL_SKILLS].sort((a, b) => a.name.localeCompare(b.name)),
  );

  const ratedSkills = createMemo<ReadonlyArray<{ skill: SkillEntry; rating: number }>>(() => {
    const entries = skillsTrait()?.entries ?? {};
    const out: Array<{ skill: SkillEntry; rating: number }> = [];
    for (const s of sortedSkills()) {
      const e = entries[s.id];
      if (!e) continue;
      const r = e.rating ?? 0;
      if (r > 0) out.push({ skill: s, rating: r });
    }
    return out;
  });

  // The dropdown only shows skills not yet rated, so the GM can't
  // accidentally re-add a skill they're already showing in the list.
  const unratedSkills = createMemo<ReadonlyArray<SkillEntry>>(() => {
    const entries = skillsTrait()?.entries ?? {};
    return sortedSkills().filter((s) => (entries[s.id]?.rating ?? 0) === 0);
  });

  const [pickSkill, setPickSkill] = createSignal<string>(unratedSkills()[0]?.id ?? "");
  const [pickRating, setPickRating] = createSignal<number>(2);

  const setSkillRating = (skillId: string, rating: number): void => {
    client.dispatch(
      SetField({
        characterId: props.characterId,
        trait: Skills.name,
        path: ["entries", skillId, "rating"],
        value: rating,
      }) as CommandInstance,
    );
  };

  const addSkill = (): void => {
    const skillId = pickSkill();
    if (!skillId) return;
    if (!getSkill(skillId)) return;
    setSkillRating(skillId, pickRating());
    // After adding, advance the dropdown to the next available skill.
    const next = unratedSkills().find((s) => s.id !== skillId);
    if (next) setPickSkill(next.id);
  };

  return (
    <kit.SheetSection title="Skills">
      <Show
        when={ratedSkills().length > 0}
        fallback={
          <div class="tb-npc-sheet__empty" data-testid="npc-skills-empty">
            no skills rated
          </div>
        }
      >
        <div class="tb-npc-sheet__skills">
          <For each={ratedSkills()}>
            {(row) => (
              <div class="tb-npc-sheet__skill-row" data-testid={`npc-skill-row-${row.skill.id}`}>
                <kit.RollableLabel
                  characterId={props.characterId}
                  rollable={SkillCheck.name}
                  opts={{ skillId: row.skill.id }}
                  ariaLabel={`Roll ${row.skill.name}`}
                  class="tb-npc-sheet__skill-name"
                >
                  {row.skill.name}
                </kit.RollableLabel>
                <span class="tb-npc-sheet__skill-rating">{row.rating}</span>
                <Show when={canEdit()}>
                  <button
                    type="button"
                    onClick={() => setSkillRating(row.skill.id, 0)}
                    class="rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-[0.65rem] text-fg-subtle hover:border-danger hover:text-danger transition"
                    aria-label={`remove ${row.skill.name}`}
                    data-testid={`npc-skill-remove-${row.skill.id}`}
                  >
                    ×
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={canEdit() && unratedSkills().length > 0}>
        <div class="tb-npc-sheet__add-skill">
          <select
            value={pickSkill()}
            onChange={(e) => setPickSkill(e.currentTarget.value)}
            data-testid="npc-skill-add-select"
            class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-sm"
          >
            <For each={unratedSkills()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
          </select>
          <select
            value={String(pickRating())}
            onChange={(e) => setPickRating(Math.max(1, Math.min(6, +e.currentTarget.value)))}
            data-testid="npc-skill-add-rating"
            class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-sm"
          >
            <For each={[1, 2, 3, 4, 5, 6]}>{(n) => <option value={String(n)}>{n}</option>}</For>
          </select>
          <button
            type="button"
            onClick={addSkill}
            class="rounded-(--radius-control) border border-border bg-surface px-3 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg transition"
            data-testid="npc-skill-add-submit"
          >
            + add skill
          </button>
        </div>
      </Show>
    </kit.SheetSection>
  );
}

/**
 * Wises — simple list of wise names. Bound to `Wises.entries[i].name`
 * via deep-path SetField. New wises get an empty pass/fail/fate/persona
 * row so the schema parses; the simplified sheet doesn't surface those
 * tracking checkboxes.
 */
function WisesSection(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const wises = useTrait(props.characterId, Wises);
  const canEdit = kit.useCanEdit(props.characterId);
  const entries = createMemo(() => wises()?.entries ?? []);
  const [draft, setDraft] = createSignal("");

  const writeEntries = (
    next: ReadonlyArray<{
      name: string;
      pass: boolean;
      fail: boolean;
      fate: boolean;
      persona: boolean;
    }>,
  ): void => {
    client.dispatch(
      SetField({
        characterId: props.characterId,
        trait: Wises.name,
        path: ["entries"],
        value: next,
      }) as CommandInstance,
    );
  };

  const addWise = (): void => {
    const name = draft().trim();
    if (!name) return;
    if (entries().some((e) => e.name === name)) {
      setDraft("");
      return;
    }
    writeEntries([...entries(), { name, pass: false, fail: false, fate: false, persona: false }]);
    setDraft("");
  };

  const removeWise = (i: number): void => {
    writeEntries(entries().filter((_, idx) => idx !== i));
  };

  return (
    <kit.SheetSection title="Wises">
      <Show
        when={entries().length > 0}
        fallback={
          <div class="tb-npc-sheet__empty" data-testid="npc-wises-empty">
            no wises
          </div>
        }
      >
        <ul
          style={{
            display: "flex",
            "flex-wrap": "wrap",
            gap: "0.4rem",
            margin: 0,
            padding: 0,
            "list-style": "none",
          }}
        >
          <For each={entries()}>
            {(w, i) => (
              <li class="tb-npc-sheet__role-pill" data-testid={`npc-wise-${i()}`}>
                {w.name}
                <Show when={canEdit()}>
                  <button
                    type="button"
                    onClick={() => removeWise(i())}
                    class="ml-2 text-fg-subtle hover:text-danger transition"
                    aria-label={`remove wise ${w.name}`}
                    data-testid={`npc-wise-remove-${i()}`}
                  >
                    ×
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={canEdit()}>
        <div class="tb-npc-sheet__add-skill">
          <input
            type="text"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addWise();
              }
            }}
            placeholder="e.g. Forest-wise"
            maxLength={80}
            autocomplete="off"
            spellcheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            class="flex-1 rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-sm"
            data-testid="npc-wise-add-input"
          />
          <button
            type="button"
            onClick={addWise}
            class="rounded-(--radius-control) border border-border bg-surface px-3 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg transition"
            data-testid="npc-wise-add-submit"
          >
            + add wise
          </button>
        </div>
      </Show>
    </kit.SheetSection>
  );
}

/**
 * Traits — TB-traits with name + level. The simplified sheet renders
 * these as `Name (level)` chips with a dropdown to add a new one. We
 * deliberately don't surface beneficialUses/checks/usedAgainst
 * tracking since NPCs don't earn fate/persona the way PCs do.
 */
function TraitsSection(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const traitsTrait = useTrait(props.characterId, CharacterTraits);
  const canEdit = kit.useCanEdit(props.characterId);
  const entries = createMemo(() => traitsTrait()?.entries ?? []);
  const [draftName, setDraftName] = createSignal("");
  const [draftLevel, setDraftLevel] = createSignal<number>(1);

  const writeEntries = (
    next: ReadonlyArray<{
      name: string;
      level: number;
      beneficialUses: number;
      checks: number;
      usedAgainst: boolean;
    }>,
  ): void => {
    client.dispatch(
      SetField({
        characterId: props.characterId,
        trait: CharacterTraits.name,
        path: ["entries"],
        value: next,
      }) as CommandInstance,
    );
  };

  const addTrait = (): void => {
    const name = draftName().trim();
    if (!name) return;
    if (entries().some((e) => e.name === name)) {
      setDraftName("");
      return;
    }
    writeEntries([
      ...entries(),
      {
        name,
        level: Math.max(1, Math.min(3, draftLevel())),
        beneficialUses: 0,
        checks: 0,
        usedAgainst: false,
      },
    ]);
    setDraftName("");
    setDraftLevel(1);
  };

  const removeTrait = (i: number): void => {
    writeEntries(entries().filter((_, idx) => idx !== i));
  };

  return (
    <kit.SheetSection title="Traits">
      <Show
        when={entries().length > 0}
        fallback={
          <div class="tb-npc-sheet__empty" data-testid="npc-traits-empty">
            no traits
          </div>
        }
      >
        <ul
          style={{
            display: "flex",
            "flex-wrap": "wrap",
            gap: "0.4rem",
            margin: 0,
            padding: 0,
            "list-style": "none",
          }}
        >
          <For each={entries()}>
            {(t, i) => (
              <li class="tb-npc-sheet__role-pill" data-testid={`npc-trait-${i()}`}>
                {t.name} ({t.level})
                <Show when={canEdit()}>
                  <button
                    type="button"
                    onClick={() => removeTrait(i())}
                    class="ml-2 text-fg-subtle hover:text-danger transition"
                    aria-label={`remove trait ${t.name}`}
                    data-testid={`npc-trait-remove-${i()}`}
                  >
                    ×
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={canEdit()}>
        <div class="tb-npc-sheet__add-skill">
          <input
            type="text"
            value={draftName()}
            onInput={(e) => setDraftName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTrait();
              }
            }}
            placeholder="e.g. Bitter"
            maxLength={60}
            autocomplete="off"
            spellcheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            class="flex-1 rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-sm"
            data-testid="npc-trait-add-name"
          />
          <select
            value={String(draftLevel())}
            onChange={(e) => setDraftLevel(Math.max(1, Math.min(3, +e.currentTarget.value)))}
            data-testid="npc-trait-add-level"
            class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-sm"
          >
            <For each={[1, 2, 3]}>{(n) => <option value={String(n)}>Lv {n}</option>}</For>
          </select>
          <button
            type="button"
            onClick={addTrait}
            class="rounded-(--radius-control) border border-border bg-surface px-3 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg transition"
            data-testid="npc-trait-add-submit"
          >
            + add trait
          </button>
        </div>
      </Show>
    </kit.SheetSection>
  );
}

function ConditionsSection(props: { characterId: string }): JSX.Element {
  const conditions = useTrait(props.characterId, Conditions);
  const canEdit = kit.useCanEdit(props.characterId);
  const client = useClient();

  const flip = (key: string): void => {
    if (!canEdit()) return;
    const cur = conditions();
    if (!cur) return;
    const v = (cur as Record<string, boolean>)[key];
    client.dispatch(
      SetField({
        characterId: props.characterId,
        trait: Conditions.name,
        path: [key],
        value: !v,
      }) as CommandInstance,
    );
  };

  return (
    <kit.SheetSection title="Conditions">
      <div class="tb-npc-sheet__conditions">
        <For each={CONDITION_KEYS}>
          {([key, label]) => (
            <button
              type="button"
              class="tb-npc-sheet__cond-chip"
              data-on={
                conditions()?.[key as keyof NonNullable<ReturnType<typeof conditions>>]
                  ? "true"
                  : "false"
              }
              data-testid={`npc-cond-${key}`}
              onClick={() => flip(key)}
              disabled={!canEdit()}
            >
              {label}
            </button>
          )}
        </For>
      </div>
    </kit.SheetSection>
  );
}

/**
 * Gear — mounts the same inventory view PCs use, against the NPC's
 * holder id. The full kit ships verbatim: catalog quick-add (search,
 * pick a slot pill, equip), per-slot panels with move/drop/unequip,
 * loose pool, ground pool. Item entities equipped here are real
 * catalog references, so the conflict weapon picker and the armor
 * pipeline read them like any PC's gear.
 *
 * Re-using the PC inventory tab is the simplest way to keep equip-
 * gear flows consistent across PCs, NPCs, and (future) monsters
 * without forking a "simpler" affordance that drifts from the real
 * one. The only thing the NPC sheet doesn't surface is the inventory
 * tab's tab-bar entry — we mount the view body directly.
 */
function GearSection(props: { characterId: string }): JSX.Element {
  return (
    <kit.SheetSection title="Gear">
      <div data-testid="npc-gear-inventory">
        <TbInventoryView characterId={props.characterId} />
      </div>
    </kit.SheetSection>
  );
}

function DescriptionSection(props: { characterId: string }): JSX.Element {
  const npc = useTrait(props.characterId, TbNpc);
  return (
    <kit.SheetSection title="Description">
      <Show when={npc()?.pageRef}>
        {(ref) => (
          <div data-testid="npc-description-citation">
            <BookCitation
              canonicalId={ref().canonicalId}
              page={ref().page}
              label={citationLabel(ref().canonicalId, ref().page)}
              ariaLabel={`open NPC entry in ${ref().canonicalId} at page ${ref().page}`}
            />
          </div>
        )}
      </Show>
      <kit.FieldStack label="Notes">
        <kit.TextAreaField
          characterId={props.characterId}
          trait={TbNpc}
          path={["description"]}
          rows={6}
          placeholder="GM notes — personality, situation, current motivation, plot hooks…"
        />
      </kit.FieldStack>
    </kit.SheetSection>
  );
}
