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
import { kit } from "@vtt/characters/client";
import type { CharacterSheetTab } from "@vtt/characters/shared";
import { SetField } from "@vtt/characters/shared";
import { useClient, useTrait } from "@vtt/substrate/client";
import { createMemo, For, Show, type JSX } from "solid-js";
import {
  AlliesEnemies,
  CharacterTraits,
  Identity,
  LevelBenefits,
  Pools,
  RawAbilities,
  SetSpecialtySkill,
  Skills,
  WhoYouAreNotes,
} from "../shared/index.js";
import { getSkill } from "../shared/skills.js";
import { RuleRef } from "./rule-ref.js";
import {
  classesForStock,
  lookupClassStockOption,
  namesMatch,
  stocksForClass,
  type ClassStockOption,
} from "./class-stock-options.js";
import {
  abilityStartingValue,
  lookupClassDefaults,
  lookupStockNatureDefaults,
  type ClassDefaults,
} from "./tb-class-defaults.js";
import {
  nextSkillRating,
  TB_SOCIAL_GRACES_SKILLS,
  TB_SPECIALTY_SKILLS,
  TB_UPBRINGING_SKILLS,
} from "./tb-burning-options.js";
import {
  hometownsForStock,
  lookupHometownDefaults,
  type HometownDefaults,
} from "./tb-hometown-defaults.js";

/**
 * Levels 1-10 fate / persona spend thresholds and "Additional
 * Benefits" notes pulled verbatim from DH p.112. The "additional"
 * column lists rule-text bonuses every class earns at that level
 * (the +1D Resources at L1, Earn creed + Circles bonus at L3, +1
 * Precedence at L6) — these are class-agnostic, so we hard-code them
 * alongside the spend table.
 */
interface LevelRow {
  readonly level: number;
  readonly fate: number;
  readonly persona: number;
  readonly note?: string;
}
const LEVEL_TABLE: ReadonlyArray<LevelRow> = [
  { level: 1, fate: 0, persona: 0, note: "+1D to Resources in your hometown" },
  { level: 2, fate: 3, persona: 3 },
  { level: 3, fate: 7, persona: 6, note: "Earn creed; +1D to Circles in your hometown" },
  { level: 4, fate: 14, persona: 12 },
  { level: 5, fate: 22, persona: 20 },
  { level: 6, fate: 31, persona: 30, note: "+1 Precedence" },
  { level: 7, fate: 41, persona: 42 },
  { level: 8, fate: 52, persona: 56 },
  { level: 9, fate: 64, persona: 72 },
  { level: 10, fate: 78, persona: 98 },
];

function WhoYouAreTab(props: { characterId: string }): JSX.Element {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}>
      <kit.SheetSection title="Who You Are">
        <ClassStockRow characterId={props.characterId} />
        <kit.SheetGroup layout="grid" cols={2}>
          <kit.FieldRow label="Age">
            <kit.NumberField characterId={props.characterId} trait={Identity} path={["age"]} min={0} max={999} />
          </kit.FieldRow>
          <kit.FieldRow label="Level">
            <kit.NumberField characterId={props.characterId} trait={Identity} path={["level"]} min={1} max={10} />
          </kit.FieldRow>
          <kit.FieldRow label="Home">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["home"]} placeholder="Hometown" />
          </kit.FieldRow>
          <kit.FieldRow label="Raiment">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["raiment"]} placeholder="What you wear that marks you" />
          </kit.FieldRow>
          <kit.FieldRow label="Parents">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["parents"]} placeholder="Family of origin" />
          </kit.FieldRow>
          <kit.FieldRow label="Mentor">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["mentor"]} placeholder="A 7th-level character who trains you" />
          </kit.FieldRow>
          <kit.FieldRow label="Friend">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["friend"]} placeholder="A friend you can rely on" />
          </kit.FieldRow>
          <kit.FieldRow label="Enemy">
            <kit.TextField characterId={props.characterId} trait={Identity} path={["enemy"]} placeholder="A rival or antagonist" />
          </kit.FieldRow>
        </kit.SheetGroup>
      </kit.SheetSection>

      <kit.SheetSection title="Levels & Benefits">
        <LevelBenefitsHeader characterId={props.characterId} />
        <LevelBenefitsTable characterId={props.characterId} />
      </kit.SheetSection>

      <kit.SheetSection title="Allies & Enemies">
        <p style={{ "font-size": "0.85rem", color: "var(--color-fg-muted)", margin: 0 }}>
          Relationships you accumulate in play. Track name, where they live, and current standing.
        </p>
        <kit.EntryRowsField<AlliesEnemiesEntry>
          characterId={props.characterId}
          trait={AlliesEnemies}
          path={["entries"]}
          columns={[
            { key: "name", type: "text", label: "Name", width: "minmax(8rem, 1.4fr)", placeholder: "who they are", maxLength: 80 },
            { key: "location", type: "text", label: "Location", width: "minmax(8rem, 1fr)", placeholder: "where to find them", maxLength: 80 },
            { key: "status", type: "text", label: "Status", width: "minmax(8rem, 1fr)", placeholder: "ally · enemy · debt …", maxLength: 80 },
          ]}
          seedEntry={(name) => ({ name, location: "", status: "" })}
          addPlaceholder="add an ally or enemy…"
          emptyHint="No allies or enemies yet — note one below as the campaign unfolds."
        />
      </kit.SheetSection>

      <kit.SheetSection title="Notes">
        <kit.TextAreaField
          characterId={props.characterId}
          trait={WhoYouAreNotes}
          path={["notes"]}
          rows={6}
          placeholder="Backstory scraps, GM hooks, anything else you want to remember…"
        />
      </kit.SheetSection>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Stock + Class dropdowns — two cross-filtered selects. Picking a
 * stock narrows the class options to those that pair with it; picking
 * a class narrows the stock options the same way. When the
 * combination matches a canonical row, deep-link chips appear pointing
 * at the class chapter, the level-benefits table, and (for Troll
 * Changeling variants) the LMM stock chapter.
 * ----------------------------------------------------------------------- */

function ClassStockRow(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);
  const identity = useTrait(props.characterId, Identity);
  const stock = createMemo(() => identity()?.stock ?? "");
  const klass = createMemo(() => identity()?.class ?? "");
  const matched = createMemo<ClassStockOption | null>(() =>
    lookupClassStockOption(stock(), klass()),
  );

  // Cross-filter: each dropdown's options are constrained by the
  // other axis's current value. Selecting an option that conflicts
  // with the existing value on the other axis clears that other
  // axis so the user re-picks (rather than leaving the sheet in an
  // inconsistent stock+class pair).
  const stockOptions = createMemo(() => stocksForClass(klass()));
  const classOptions = createMemo(() => classesForStock(stock()));

  const writeIdentityField = (path: "stock" | "class", value: string): void => {
    client.dispatch(
      SetField({
        characterId: props.characterId as EntityId,
        trait: Identity.name,
        path: [path],
        value,
      }),
    );
  };

  // Each dropdown's options are filtered by the OTHER axis's current
  // value (see `stockOptions` / `classOptions` memos). The user
  // unblocks the cross-axis by re-picking the placeholder ("— pick
  // stock —" / "— pick class —") on the side they want to change.
  const onStockChange = (next: string): void => {
    writeIdentityField("stock", next);
  };
  const onClassChange = (next: string): void => {
    writeIdentityField("class", next);
  };

  return (
    <>
      <kit.SheetGroup layout="grid" cols={2}>
        <kit.FieldRow label="Stock">
          <select
            class="vk-input"
            data-testid="stock-select"
            disabled={!canEdit()}
            value={
              stockOptions().find((s) => namesMatch(s, stock())) ?? stock() ?? ""
            }
            onChange={(e) => onStockChange(e.currentTarget.value)}
          >
            <option value="">— pick stock —</option>
            <For each={stockOptions()}>
              {(s) => <option value={s}>{s}</option>}
            </For>
          </select>
          <Show when={matched()?.stockPageRef}>
            {(s) => (
              <RuleRef book={s().book} page={s().page} />
            )}
          </Show>
        </kit.FieldRow>
        <kit.FieldRow label="Class">
          <select
            class="vk-input"
            data-testid="class-select"
            disabled={!canEdit()}
            value={
              classOptions().find((c) => namesMatch(c, klass())) ?? klass() ?? ""
            }
            onChange={(e) => onClassChange(e.currentTarget.value)}
          >
            <option value="">— pick class —</option>
            <For each={classOptions()}>
              {(c) => <option value={c}>{c}</option>}
            </For>
          </select>
          <Show when={matched()}>
            {(o) => (
              <RuleRef
                book={o().classPageRef.book}
                page={o().classPageRef.page}
              />
            )}
          </Show>
        </kit.FieldRow>
      </kit.SheetGroup>
      <ApplyClassDefaultsButton characterId={props.characterId} />
      <CharacterBurningSection characterId={props.characterId} />
    </>
  );
}

/* -------------------------------------------------------------------------
 * Character Burning — DH p.29-31 follow-up pickers
 *
 * Once the class step is done, four more "pick from a list" decisions
 * fill out the burning chapter:
 *   - Human Upbringing (DH p.29) — Humans & Troll Changelings only
 *   - Where Is Your Home? (DH p.30) — settlement + trait
 *   - Social Graces (DH p.30) — every character
 *   - Specialty (DH p.31) — every character; reuses Skills.specialtySkillId
 *
 * Each picker is a dropdown; selecting an option dispatches the
 * corresponding skill bump (and trait append for hometown). Pickers
 * never undo a previous selection — picking Persuader after Manipulator
 * bumps Persuader and leaves Manipulator alone, matching how the
 * class-defaults button treats prior edits.
 * ----------------------------------------------------------------------- */

function CharacterBurningSection(props: { characterId: string }): JSX.Element {
  const canEdit = kit.useCanEdit(props.characterId);
  return (
    <Show when={canEdit()}>
      <kit.SheetGroup layout="grid" cols={2}>
        <HumanUpbringingPicker characterId={props.characterId} />
        <SocialGracesPicker characterId={props.characterId} />
        <SpecialtyPicker characterId={props.characterId} />
        <HometownPickerPair characterId={props.characterId} />
      </kit.SheetGroup>
    </Show>
  );
}

/**
 * Lookup-by-id label helper. Falls back to the bare id when the catalog
 * doesn't know the skill (shouldn't happen given the option lists are
 * authored from skills.ts) so the dropdown still renders something.
 */
function skillLabel(id: string): string {
  return getSkill(id)?.name ?? id;
}

function isHumanOrChangeling(stock: string): boolean {
  const s = stock.trim().toLowerCase();
  return s === "human" || s === "troll changeling";
}

function HumanUpbringingPicker(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const identity = useTrait(props.characterId, Identity);
  const skills = useTrait(props.characterId, Skills);
  const current = createMemo(() => identity()?.upbringingSkillId ?? "");
  const visible = createMemo(() =>
    isHumanOrChangeling(identity()?.stock ?? ""),
  );

  const onChange = (id: string): void => {
    if (id.length === 0) return;
    const characterId = props.characterId as EntityId;
    const skillRating = skills()?.entries?.[id]?.rating ?? 0;
    client.dispatch(
      SetField({
        characterId,
        trait: Skills.name,
        path: ["entries", id, "rating"],
        value: nextSkillRating(skillRating, 3),
      }),
    );
    client.dispatch(
      SetField({
        characterId,
        trait: Identity.name,
        path: ["upbringingSkillId"],
        value: id,
      }),
    );
  };

  return (
    <Show when={visible()}>
      <kit.FieldRow label="Upbringing">
        <select
          class="vk-input"
          data-testid="tb-upbringing-picker"
          value={current()}
          onChange={(e) => onChange(e.currentTarget.value)}
        >
          <option value="">— pick upbringing —</option>
          <For each={TB_UPBRINGING_SKILLS}>
            {(id) => <option value={id}>{skillLabel(id)}</option>}
          </For>
        </select>
        <RuleRef book="DH" page={29} />
      </kit.FieldRow>
    </Show>
  );
}

function SocialGracesPicker(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const identity = useTrait(props.characterId, Identity);
  const skills = useTrait(props.characterId, Skills);
  const current = createMemo(() => identity()?.socialGracesSkillId ?? "");

  const onChange = (id: string): void => {
    if (id.length === 0) return;
    const characterId = props.characterId as EntityId;
    const skillRating = skills()?.entries?.[id]?.rating ?? 0;
    client.dispatch(
      SetField({
        characterId,
        trait: Skills.name,
        path: ["entries", id, "rating"],
        value: nextSkillRating(skillRating, 2),
      }),
    );
    client.dispatch(
      SetField({
        characterId,
        trait: Identity.name,
        path: ["socialGracesSkillId"],
        value: id,
      }),
    );
  };

  return (
    <kit.FieldRow label="Social Graces">
      <select
        class="vk-input"
        data-testid="tb-social-graces-picker"
        value={current()}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        <option value="">— pick social graces —</option>
        <For each={TB_SOCIAL_GRACES_SKILLS}>
          {(id) => <option value={id}>{skillLabel(id)}</option>}
        </For>
      </select>
      <RuleRef book="DH" page={30} />
    </kit.FieldRow>
  );
}

function SpecialtyPicker(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const skills = useTrait(props.characterId, Skills);
  const current = createMemo(() => skills()?.specialtySkillId ?? "");

  const onChange = (id: string): void => {
    if (id.length === 0) return;
    const characterId = props.characterId as EntityId;
    const skillRating = skills()?.entries?.[id]?.rating ?? 0;
    client.dispatch(
      SetField({
        characterId,
        trait: Skills.name,
        path: ["entries", id, "rating"],
        value: nextSkillRating(skillRating, 2),
      }),
    );
    // Use the existing domain command rather than a raw SetField — the
    // SpecialtyToggleButton on the Abilities & Skills tab dispatches
    // the same command, so the server-side handler stays the single
    // source of truth for "skill X is the specialty."
    client.dispatch(
      SetSpecialtySkill({
        characterId,
        skillId: id,
      }) as CommandInstance,
    );
  };

  return (
    <kit.FieldRow label="Specialty">
      <select
        class="vk-input"
        data-testid="tb-specialty-picker"
        value={current()}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        <option value="">— pick specialty —</option>
        <For each={TB_SPECIALTY_SKILLS}>
          {(id) => <option value={id}>{skillLabel(id)}</option>}
        </For>
      </select>
      <RuleRef book="DH" page={31} />
    </kit.FieldRow>
  );
}

function HometownPickerPair(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const identity = useTrait(props.characterId, Identity);
  const skills = useTrait(props.characterId, Skills);
  const traits = useTrait(props.characterId, CharacterTraits);
  const currentStock = createMemo(() => identity()?.stock ?? "");
  const currentHomeKey = createMemo<string>(() => {
    const match = lookupHometownDefaults(identity()?.home ?? "");
    return match?.key ?? "";
  });
  const currentHometown = createMemo<HometownDefaults | null>(() =>
    lookupHometownDefaults(identity()?.home ?? ""),
  );
  // The trait dropdown's current value is whichever of the hometown's
  // two listed traits is already on the sheet. Free-text traits typed
  // by the player (or class/Huldrekall) aren't candidates — only the
  // two hometown options.
  const currentHomeTrait = createMemo<string>(() => {
    const home = currentHometown();
    if (!home) return "";
    const entries = traits()?.entries ?? [];
    const match = home.traits.find((name) =>
      entries.some((t) => t.name.toLowerCase() === name.toLowerCase()),
    );
    return match ?? "";
  });

  const visibleHometowns = createMemo(() => hometownsForStock(currentStock()));
  // If the stored hometown is filtered out for the current stock
  // (e.g. home="Elfhome" but stock just changed to Dwarf), clamp the
  // select to "" so the dropdown shows its placeholder rather than
  // an unselectable option. The Identity.home string itself stays
  // untouched — the player can pick a new hometown to overwrite it.
  const selectedHomeKey = createMemo<string>(() => {
    const key = currentHomeKey();
    if (key.length === 0) return "";
    if (visibleHometowns().some((h) => h.key === key)) return key;
    return "";
  });

  const onHomeChange = (key: string): void => {
    if (key.length === 0) return;
    const home = lookupHometownDefaults(key);
    if (!home) return;
    const characterId = props.characterId as EntityId;
    // Snapshot the current skill ratings before dispatching any of
    // the three SetFields. `client.dispatch` enqueues a WS send and
    // does not synchronously update the local world, so re-reading
    // `skills()` inside the loop would just return the same pre-dispatch
    // snapshot anyway — but binding it once makes the read-vs-write
    // ordering explicit and avoids any future surprise if the local
    // world ever gains optimistic apply between dispatches.
    const skillEntries = skills()?.entries ?? {};
    client.dispatch(
      SetField({
        characterId,
        trait: Identity.name,
        path: ["home"],
        value: home.label,
      }),
    );
    for (const skillId of home.skills) {
      const skillRating = skillEntries[skillId]?.rating ?? 0;
      client.dispatch(
        SetField({
          characterId,
          trait: Skills.name,
          path: ["entries", skillId, "rating"],
          value: nextSkillRating(skillRating, 2),
        }),
      );
    }
  };

  const onTraitChange = (name: string): void => {
    if (name.length === 0) return;
    const characterId = props.characterId as EntityId;
    const entries = traits()?.entries ?? [];
    if (entries.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      return; // Already present; rules say "start it at level 1" not "bump it."
    }
    client.dispatch(
      SetField({
        characterId,
        trait: CharacterTraits.name,
        path: ["entries"],
        value: [
          ...entries,
          {
            name,
            level: 1,
            beneficialUses: 0,
            checks: 0,
            usedAgainst: false,
          },
        ],
      }),
    );
  };

  return (
    <>
      <kit.FieldRow label="Hometown">
        <select
          class="vk-input"
          data-testid="tb-hometown-picker"
          value={selectedHomeKey()}
          onChange={(e) => onHomeChange(e.currentTarget.value)}
        >
          <option value="">— pick hometown —</option>
          <For each={visibleHometowns()}>
            {(h) => <option value={h.key}>{h.label}</option>}
          </For>
        </select>
        <RuleRef book="DH" page={30} />
      </kit.FieldRow>
      {/* Gate the trait sub-picker on the *visible* hometown key
          (the one currently selectable for this stock), not just on
          `currentHometown()`. Otherwise, after a player picks Elfhome
          as an Elf and then switches stock to Dwarf, the dropdown
          clamps to "" but `currentHometown()` still resolves Elfhome
          from the stored `Identity.home` string — and the trait sub-
          picker would happily offer Calm / Quiet to a Dwarf. */}
      <Show when={selectedHomeKey().length > 0 && currentHometown()}>
        {(home) => (
          <kit.FieldRow label="Hometown trait">
            <select
              class="vk-input"
              data-testid="tb-hometown-trait-picker"
              value={currentHomeTrait()}
              onChange={(e) => onTraitChange(e.currentTarget.value)}
            >
              <option value="">— pick trait —</option>
              <For each={home().traits}>
                {(name) => <option value={name}>{name}</option>}
              </For>
            </select>
          </kit.FieldRow>
        )}
      </Show>
    </>
  );
}

/* -------------------------------------------------------------------------
 * Apply starting stats — one-click seeding of class-prescribed values
 * from DH p.26-27 into the abilities, nature, skills, and traits
 * traits. The button is only visible when both stock and class match
 * a row in `TB_CLASS_DEFAULTS`; player-supplied non-default values are
 * preserved (the button skips any field already non-zero / non-empty).
 * ----------------------------------------------------------------------- */

function ApplyClassDefaultsButton(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const canEdit = kit.useCanEdit(props.characterId);
  const identity = useTrait(props.characterId, Identity);
  const abilities = useTrait(props.characterId, RawAbilities);
  const skills = useTrait(props.characterId, Skills);
  const traits = useTrait(props.characterId, CharacterTraits);

  const defaults = createMemo<ClassDefaults | null>(() =>
    lookupClassDefaults(identity()?.stock ?? "", identity()?.class ?? ""),
  );
  const natureDefaults = createMemo(() =>
    lookupStockNatureDefaults(identity()?.stock ?? ""),
  );

  /**
   * Compute the list of SetField writes the button *would* dispatch
   * given the current trait state. Skips fields the player has
   * already customized — Will rating already > 0 stays, a skill rated
   * 3 stays, an existing trait list keeps everything in it.
   */
  const plannedWrites = createMemo<ReadonlyArray<CommandInstance>>(() => {
    const d = defaults();
    if (!d) return [];
    const out: CommandInstance[] = [];
    const characterId = props.characterId as EntityId;
    const setField = (
      trait: string,
      path: ReadonlyArray<string | number>,
      value: unknown,
    ): void => {
      out.push(
        SetField({
          characterId,
          trait,
          path: path as Array<string | number>,
          value,
        }),
      );
    };

    const abil = abilities();
    if ((abil?.will.rating ?? 0) === 0) {
      setField(RawAbilities.name, ["will", "rating"], abilityStartingValue(d.will));
    }
    if ((abil?.health.rating ?? 0) === 0) {
      setField(RawAbilities.name, ["health", "rating"], abilityStartingValue(d.health));
    }

    const nature = natureDefaults();
    if (nature) {
      if ((abil?.nature.rating ?? 0) === 0) {
        setField(RawAbilities.name, ["nature", "rating"], nature.rating);
      }
      if ((abil?.nature.maximum ?? 0) === 0) {
        setField(RawAbilities.name, ["nature", "maximum"], nature.rating);
      }
      if ((abil?.nature.descriptors ?? []).length === 0) {
        setField(RawAbilities.name, ["nature", "descriptors"], nature.descriptors);
      }
    }

    for (const s of d.skills) {
      const entry = skills()?.entries?.[s.id];
      if ((entry?.rating ?? 0) === 0) {
        setField(Skills.name, ["entries", s.id, "rating"], s.rating);
      }
    }

    const traitEntries = traits()?.entries ?? [];
    const has = (name: string): boolean =>
      traitEntries.some((t) => t.name.toLowerCase() === name.toLowerCase());
    const toAppend: Array<{ name: string }> = [];
    if (!has(d.classTrait)) toAppend.push({ name: d.classTrait });
    // Stock-level required trait (currently only Huldrekall for Troll
    // Changeling). Appended alongside the class trait in one write so
    // a changeling shaman walks away with both Between Two Worlds and
    // Huldrekall after a single click.
    const extra = nature?.additionalTrait;
    if (extra && !has(extra.name)) toAppend.push({ name: extra.name });
    if (toAppend.length > 0) {
      setField(CharacterTraits.name, ["entries"], [
        ...traitEntries,
        ...toAppend.map((t) => ({
          name: t.name,
          level: 1,
          beneficialUses: 0,
          checks: 0,
          usedAgainst: false,
        })),
      ]);
    }

    return out;
  });

  const apply = (): void => {
    for (const cmd of plannedWrites()) {
      client.dispatch(cmd);
    }
  };

  return (
    <Show when={canEdit() && defaults() !== null}>
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          "align-items": "center",
          "flex-wrap": "wrap",
        }}
      >
        <button
          type="button"
          class="vk-input"
          data-testid="apply-class-defaults"
          disabled={plannedWrites().length === 0}
          title={
            plannedWrites().length === 0
              ? "Class starting stats already applied"
              : `Fill in ${defaults()!.classTrait} class starting stats (DH p.${defaults()!.classTraitPage.page})`
          }
          onClick={() => apply()}
          style={{ "white-space": "nowrap" }}
        >
          Apply starting stats
        </button>
        <span
          style={{
            "font-size": "0.75rem",
            color: "var(--color-fg-muted)",
          }}
        >
          Fills Will, Health, Nature, skills, and the class trait from
          the printed class row. Already-edited fields are preserved.
        </span>
      </div>
    </Show>
  );
}

/* -------------------------------------------------------------------------
 * LevelBenefitsHeader — short helper text + the levels-chapter chip
 * (DH p.112) plus, when a class is set, a "class levels" chip that
 * deep-links to the class-specific level-benefits table (Burglar →
 * DH p.113, Theurge → DH p.125, Skald → LMM p.19, etc.).
 * ----------------------------------------------------------------------- */

function LevelBenefitsHeader(props: { characterId: string }): JSX.Element {
  const identity = useTrait(props.characterId, Identity);
  const matched = createMemo<ClassStockOption | null>(() =>
    lookupClassStockOption(
      identity()?.stock ?? "",
      identity()?.class ?? "",
    ),
  );
  return (
    <p
      style={{
        "font-size": "0.85rem",
        color: "var(--color-fg-muted)",
        margin: 0,
        display: "flex",
        gap: "0.4rem",
        "align-items": "center",
        "flex-wrap": "wrap",
      }}
    >
      <span>
        Spend totals required to advance and a place to jot the benefit
        you chose at each level.
      </span>
      <RuleRef book="DH" page={112} />
      <Show when={matched()}>
        {(o) => (
          <span
            data-testid="class-levels-chip"
            style={{
              display: "inline-flex",
              gap: "0.3rem",
              "align-items": "center",
            }}
          >
            <span>class levels:</span>
            <RuleRef
              book={o().levelPageRef.book}
              page={o().levelPageRef.page}
            />
          </span>
        )}
      </Show>
    </p>
  );
}

/* -------------------------------------------------------------------------
 * Levels 1-10 spend / benefit table
 * ----------------------------------------------------------------------- */

function LevelBenefitsTable(props: { characterId: string }): JSX.Element {
  const identity = useTrait(props.characterId, Identity);
  const pools = useTrait(props.characterId, Pools);
  const currentLevel = createMemo(() => identity()?.level ?? 1);
  const fateSpent = createMemo(() => pools()?.fate.totalSpent ?? 0);
  const personaSpent = createMemo(() => pools()?.persona.totalSpent ?? 0);

  /**
   * Pick the highest level row whose fate + persona thresholds are
   * met by the current spend. That's the level the character has
   * "earned" — DH p.112 levels them up on the next return to town.
   * Returns 0 when no row qualifies (still at level 1 with no spend).
   */
  const earnedLevel = createMemo(() => {
    let earned = 0;
    for (const row of LEVEL_TABLE) {
      if (fateSpent() >= row.fate && personaSpent() >= row.persona) {
        earned = row.level;
      }
    }
    return earned;
  });

  /** The next level row the character can advance to, or null at L10 / not-yet-earned. */
  const nextLevel = createMemo(() => currentLevel() + 1);
  const readyToLevelUp = createMemo(
    () => earnedLevel() >= nextLevel() && nextLevel() <= 10,
  );

  return (
    <table
      data-testid="level-benefits-table"
      style={{
        "border-collapse": "collapse",
        width: "100%",
        "font-size": "0.8rem",
      }}
    >
      <thead>
        <tr style={{ "text-align": "left" }}>
          <Th></Th>
          <Th>Lv.</Th>
          <Th align="right">Fate</Th>
          <Th align="right">Persona</Th>
          <Th>Standard benefit</Th>
          <Th>Your chosen benefit</Th>
        </tr>
      </thead>
      <tbody>
        <For each={LEVEL_TABLE}>
          {(row, idx) => {
            const isCurrent = createMemo(() => row.level === currentLevel());
            const isReady = createMemo(
              () => row.level === nextLevel() && readyToLevelUp(),
            );
            return (
              <tr
                data-level={row.level}
                data-ready={isReady() ? "true" : undefined}
                style={{
                  "border-top": "1px solid var(--color-border-muted)",
                  background: isReady()
                    ? "var(--color-accent-soft)"
                    : isCurrent()
                      ? "var(--color-surface-elevated)"
                      : "transparent",
                }}
              >
                <Td>
                  <Show
                    when={isReady()}
                    fallback={
                      <Show when={isCurrent()}>
                        <span
                          aria-label={`Level ${row.level} (current)`}
                          title="Current level"
                          style={{
                            color: "var(--color-fg-muted)",
                            "font-size": "0.75rem",
                          }}
                        >
                          ●
                        </span>
                      </Show>
                    }
                  >
                    <span
                      data-testid={`level-up-arrow-${row.level}`}
                      aria-label={`Ready to advance to level ${row.level}`}
                      title={`Ready to advance to level ${row.level} — return to town to level up (DH p.112)`}
                      style={{
                        color: "var(--color-accent)",
                        "font-weight": "600",
                        "font-size": "0.95rem",
                        "line-height": 1,
                      }}
                    >
                      ↑
                    </span>
                  </Show>
                </Td>
                <Td>
                  <span style={{ "font-weight": "500" }}>{row.level}</span>
                </Td>
                <Td align="right">
                  <span style={{ "font-variant-numeric": "tabular-nums" }}>
                    {row.fate}
                  </span>
                </Td>
                <Td align="right">
                  <span style={{ "font-variant-numeric": "tabular-nums" }}>
                    {row.persona}
                  </span>
                </Td>
                <Td>
                  <Show
                    when={row.note}
                    fallback={
                      <span style={{ color: "var(--color-fg-subtle)" }}>—</span>
                    }
                  >
                    <span style={{ color: "var(--color-fg-muted)" }}>
                      {row.note}
                    </span>
                  </Show>
                </Td>
                <Td>
                  <kit.TextField
                    characterId={props.characterId}
                    trait={LevelBenefits}
                    path={["benefits", idx()]}
                    placeholder={
                      row.level === 1
                        ? "starting class benefit"
                        : "e.g. Soft Step"
                    }
                    maxLength={240}
                  />
                </Td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  );
}

function Th(props: {
  children?: JSX.Element;
  align?: "left" | "right";
}): JSX.Element {
  return (
    <th
      style={{
        "font-family": "var(--font-display)",
        "font-size": "0.7rem",
        "letter-spacing": "0.06em",
        "text-transform": "uppercase",
        color: "var(--color-fg-muted)",
        padding: "0.3rem 0.5rem",
        "text-align": props.align ?? "left",
      }}
    >
      {props.children}
    </th>
  );
}

function Td(props: {
  children: JSX.Element;
  align?: "left" | "right";
}): JSX.Element {
  return (
    <td
      style={{
        padding: "0.3rem 0.5rem",
        "text-align": props.align ?? "left",
        "vertical-align": "middle",
      }}
    >
      {props.children}
    </td>
  );
}

interface AlliesEnemiesEntry extends Record<string, unknown> {
  name: string;
  location: string;
  status: string;
}

export const TbWhoYouAreTabFill: CharacterSheetTab = {
  id: qualifiedName("@vtt/system-torchbearer/tab-who-you-are") as CharacterSheetTab["id"],
  label: "Who You Are",
  // Tabs sort by descending priority; pick descending values so the
  // printed-sheet order (Who → What For → Abilities → Traits → Inventory → Arcane → Invocations)
  // appears left-to-right.
  priority: 100,
  render: ({ characterId }) => WhoYouAreTab({ characterId }),
};
