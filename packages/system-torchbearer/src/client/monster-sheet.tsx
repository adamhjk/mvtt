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
import { kit } from "@vtt/characters/client";
import { Character, SetField } from "@vtt/characters/shared";
import { ItemIdentity } from "@vtt/items/shared";
import { createMemo, For, onMount, Show, type JSX } from "solid-js";
import {
  Conditions,
  NatureCheck,
  RawAbilities,
  TownAbilities,
} from "../shared/index.js";
import {
  TbMonster,
  TbMonsterSpecialRules,
  TbMonsterWeapons,
} from "../shared/monster-traits.js";
import { TbCarries } from "../shared/items/index.js";
import {
  ALL_CONFLICT_TYPES,
  TB_CONFLICT_TYPES,
  type ConflictType,
} from "../conflict/shared/conflict-types.js";

const MONSTER_SHEET_STYLE_ID = "tb-monster-sheet-styles";

/**
 * Stylesheet for the monster sheet — single scroll, no tabs. Sections
 * use the kit's `<SheetSection>` so the visual rhythm matches the PC
 * sheet. The stat strip is a 3-up grid; the disposition table is
 * data-table-like; the weapons table mirrors the printed SG layout
 * (action columns with +1D / +1s / — display).
 */
const MONSTER_SHEET_CSS = `
.tb-monster-sheet {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-surface);
  color: var(--color-fg);
}
.tb-monster-sheet__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem 1.25rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.tb-monster-sheet__statbar {
  display: grid;
  grid-template-columns: repeat(3, minmax(6rem, 1fr));
  gap: 0.75rem;
  background: var(--color-surface-elevated, var(--color-surface));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control, 0.5rem);
  padding: 0.6rem 0.75rem;
}
.tb-monster-sheet__stat {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: center;
}
.tb-monster-sheet__stat-rollable {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  cursor: pointer;
  padding: 0.2rem 0.4rem;
  border-radius: var(--radius-control, 0.4rem);
}
.tb-monster-sheet__stat-rollable:hover {
  background: var(--color-bg-hover, var(--color-surface-elevated));
}
.tb-monster-sheet__stat-label {
  font-family: var(--font-display);
  font-size: 0.65rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--color-fg-muted);
}
.tb-monster-sheet__stat-value {
  font-family: var(--font-display);
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--color-fg);
}
.tb-monster-sheet__type-row {
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
  align-items: baseline;
}
.tb-monster-sheet__type-pill {
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
.tb-monster-sheet__instinct {
  font-style: italic;
  color: var(--color-fg-muted);
  font-size: 0.95rem;
}
.tb-monster-sheet__dispo-table {
  display: grid;
  grid-template-columns: 1fr auto;
  column-gap: 1rem;
  row-gap: 0.3rem;
  font-size: 0.9rem;
}
.tb-monster-sheet__dispo-conf {
  color: var(--color-fg);
}
.tb-monster-sheet__dispo-val {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  text-align: right;
  color: var(--color-fg);
}
.tb-monster-sheet__weapons {
  display: grid;
  grid-template-columns:
    minmax(8rem, 1.5fr)
    minmax(8rem, 1.4fr)
    repeat(4, 3rem);
  column-gap: 0.5rem;
  row-gap: 0.35rem;
  font-size: 0.85rem;
}
.tb-monster-sheet__weapons-head {
  font-family: var(--font-display);
  font-size: 0.65rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-fg-muted);
  border-bottom: 1px solid var(--color-border-muted);
  padding-bottom: 0.2rem;
}
.tb-monster-sheet__weapons-cell {
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.tb-monster-sheet__weapons-cell--name {
  text-align: left;
  font-weight: 600;
  color: var(--color-fg);
}
.tb-monster-sheet__weapons-cell--conflicts {
  text-align: left;
  color: var(--color-fg-muted);
  font-size: 0.78rem;
}
.tb-monster-sheet__weapons-cell--empty {
  color: var(--color-fg-subtle, var(--color-fg-muted));
}
.tb-monster-sheet__rule {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.35rem 0;
  border-bottom: 1px dashed var(--color-border-muted);
}
.tb-monster-sheet__rule:last-child { border-bottom: 0; }
.tb-monster-sheet__rule-name {
  font-family: var(--font-display);
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-fg);
}
.tb-monster-sheet__rule-text {
  font-size: 0.85rem;
  line-height: 1.4;
  color: var(--color-fg-muted);
}
.tb-monster-sheet__conditions {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.tb-monster-sheet__cond-chip {
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--color-border-muted);
  background: var(--color-surface-elevated, var(--color-surface));
  font-family: var(--font-display);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  color: var(--color-fg-muted);
}
.tb-monster-sheet__cond-chip[data-on="true"] {
  background: var(--color-danger-bg, var(--color-warning-bg, var(--color-bg-hover)));
  color: var(--color-danger-fg, var(--color-fg));
  border-color: var(--color-danger, var(--color-border));
}
.tb-monster-sheet__inventory {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.tb-monster-sheet__inv-row {
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
  font-size: 0.85rem;
  align-items: center;
}
.tb-monster-sheet__inv-slot {
  font-family: var(--font-display);
  font-size: 0.65rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-fg-muted);
  min-width: 4rem;
}
.tb-monster-sheet__inv-empty {
  font-style: italic;
  color: var(--color-fg-muted);
  font-size: 0.85rem;
}
`;

function injectMonsterSheetStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(MONSTER_SHEET_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = MONSTER_SHEET_STYLE_ID;
  el.textContent = MONSTER_SHEET_CSS;
  document.head.appendChild(el);
}

const CONDITION_KEYS = [
  ["hungryThirsty", "Hungry & Thirsty"],
  ["angry", "Angry"],
  ["afraid", "Afraid"],
  ["exhausted", "Exhausted"],
  ["injured", "Injured"],
  ["sick", "Sick"],
  ["dead", "Dead"],
] as const;

const CONFLICT_OPTIONS: ReadonlyArray<{ value: ConflictType; label: string }> =
  ALL_CONFLICT_TYPES.map((id) => ({
    value: id,
    label: TB_CONFLICT_TYPES[id].label,
  }));


/**
 * Monster character sheet — single scrolling column. Reuses the
 * characters kit verbatim (`<TextField>`, `<NumberField>`,
 * `<EntryListField>`, `<SheetSection>`, `useCanEdit`) so PCs and
 * monsters share visual + interaction grammar. Weapon rows render the
 * SG p.178 layout: name + applicable conflicts + four action-bonus
 * columns (A / D / F / M).
 */
export function MonsterSheet(props: { characterId: string }): JSX.Element {
  onMount(injectMonsterSheetStyles);
  const character = useTrait(props.characterId, Character);

  return (
    <Show
      when={character()}
      fallback={
        <div class="flex h-full items-center justify-center text-xs text-fg-subtle">
          monster not found
        </div>
      }
    >
      <div class="tb-monster-sheet" data-monster-id={props.characterId}>
        <div class="tb-monster-sheet__scroll">
          <IdentitySection characterId={props.characterId} />
          <StatBlockSection characterId={props.characterId} />
          <DispositionsSection characterId={props.characterId} />
          <ConditionsSection characterId={props.characterId} />
          <ArmorSection characterId={props.characterId} />
          <WeaponsSection characterId={props.characterId} />
          <SpecialRulesSection characterId={props.characterId} />
          <InstinctSection characterId={props.characterId} />
          <InventorySection characterId={props.characterId} />
        </div>
      </div>
    </Show>
  );
}

function IdentitySection(props: { characterId: string }): JSX.Element {
  const monster = useTrait(props.characterId, TbMonster);
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
      <kit.FieldRow label="Type">
        <kit.TextField
          characterId={props.characterId}
          trait={TbMonster}
          path={["type"]}
          maxLength={40}
          placeholder="e.g. undead"
        />
      </kit.FieldRow>
      <Show when={monster()}>
        <div class="tb-monster-sheet__type-row">
          <span class="tb-monster-sheet__type-pill" data-testid="monster-type-pill">
            {(monster()!.type ?? "").toUpperCase()}
          </span>
        </div>
      </Show>
    </kit.SheetSection>
  );
}

function StatBlockSection(props: { characterId: string }): JSX.Element {
  const abilities = useTrait(props.characterId, RawAbilities);
  const town = useTrait(props.characterId, TownAbilities);
  const nature = createMemo(() => abilities()?.nature.rating ?? 0);
  const might = createMemo(() => town()?.might ?? 0);
  const precedence = createMemo(() => town()?.precedence ?? 0);

  return (
    <kit.SheetSection title="Stat Block">
      <div
        class="tb-monster-sheet__statbar"
        role="group"
        aria-label="Monster stat block"
      >
        <div
          class="tb-monster-sheet__stat"
          data-testid="monster-nature-stat"
        >
          <kit.RollableLabel
            characterId={props.characterId}
            rollable={NatureCheck.name}
            ariaLabel="Roll Nature"
            class="tb-monster-sheet__stat-rollable"
          >
            <span class="tb-monster-sheet__stat-label">Nature</span>
            <span
              class="tb-monster-sheet__stat-value"
              data-testid="monster-nature-value"
            >
              {nature()}
            </span>
          </kit.RollableLabel>
        </div>
        <div class="tb-monster-sheet__stat">
          <span class="tb-monster-sheet__stat-label">Might</span>
          <span
            class="tb-monster-sheet__stat-value"
            data-testid="monster-might-value"
          >
            {might()}
          </span>
        </div>
        <div class="tb-monster-sheet__stat">
          <span class="tb-monster-sheet__stat-label">Precedence</span>
          <span
            class="tb-monster-sheet__stat-value"
            data-testid="monster-precedence-value"
          >
            {precedence()}
          </span>
        </div>
      </div>
      <kit.FieldRow label="Nature">
        <kit.NumberField
          characterId={props.characterId}
          trait={RawAbilities}
          path={["nature", "rating"]}
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

function DispositionsSection(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const monster = useTrait(props.characterId, TbMonster);
  const canEdit = kit.useCanEdit(props.characterId);
  const rows = createMemo(() => monster()?.dispositions ?? []);

  const writeRows = (next: ReadonlyArray<unknown>) => {
    client.dispatch(
      SetField({
        characterId: props.characterId,
        trait: TbMonster.name as unknown as string,
        path: ["dispositions"],
        value: next,
      }) as CommandInstance,
    );
  };

  const addRow = () => {
    const used = new Set(rows().map((r) => r.conflictType));
    const next = ALL_CONFLICT_TYPES.find((c) => !used.has(c)) ?? "other";
    writeRows([...rows(), { conflictType: next, value: 1 }]);
  };

  const removeRow = (i: number) => {
    writeRows(rows().filter((_, idx) => idx !== i));
  };

  return (
    <kit.SheetSection title="Hit Points">
      <p
        style={{
          "font-size": "0.78rem",
          color: "var(--color-fg-muted)",
          margin: 0,
        }}
      >
        Predetermined disposition per conflict type. Conflict types
        not listed roll Nature (within Nature) or half Nature (outside
        Nature) at conflict-declare time. SG p.172.
      </p>
      <Show
        when={rows().length > 0}
        fallback={
          <div
            class="tb-monster-sheet__inv-empty"
            data-testid="monster-dispo-empty"
          >
            no predetermined dispositions
          </div>
        }
      >
        <For each={rows()}>
          {(row, i) => (
            <div
              style={{
                display: "grid",
                "grid-template-columns": "1fr 5rem auto",
                gap: "0.5rem",
                "align-items": "center",
              }}
              data-testid={`monster-dispo-row-${i()}`}
            >
              <kit.SelectField
                characterId={props.characterId}
                trait={TbMonster}
                path={["dispositions", i(), "conflictType"]}
                options={CONFLICT_OPTIONS as { value: string; label: string }[]}
              />
              <kit.NumberField
                characterId={props.characterId}
                trait={TbMonster}
                path={["dispositions", i(), "value"]}
                min={0}
                max={60}
              />
              <Show when={canEdit()}>
                <button
                  type="button"
                  class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-subtle hover:border-danger hover:text-danger transition"
                  onClick={() => removeRow(i())}
                  aria-label={`remove disposition ${i() + 1}`}
                  data-testid={`monster-dispo-remove-${i()}`}
                >
                  ×
                </button>
              </Show>
            </div>
          )}
        </For>
      </Show>
      <Show when={canEdit()}>
        <div style={{ display: "flex", "justify-content": "flex-end" }}>
          <button
            type="button"
            onClick={addRow}
            class="rounded-(--radius-control) border border-border bg-surface px-3 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg transition"
            data-testid="monster-dispo-add"
          >
            + add disposition
          </button>
        </div>
      </Show>
    </kit.SheetSection>
  );
}

function ConditionsSection(props: { characterId: string }): JSX.Element {
  const conditions = useTrait(props.characterId, Conditions);

  return (
    <kit.SheetSection title="Conditions">
      <p
        style={{
          "font-size": "0.78rem",
          color: "var(--color-fg-muted)",
          margin: 0,
        }}
      >
        Monsters are never fresh. Hungry/thirsty, afraid and exhausted
        impose −1s to disposition; injured and sick impose −1D to
        Nature each. SG p.177.
      </p>
      <div class="tb-monster-sheet__conditions">
        <For each={CONDITION_KEYS}>
          {([key, label]) => (
            <span
              class="tb-monster-sheet__cond-chip"
              data-on={
                conditions()?.[
                  key as keyof NonNullable<ReturnType<typeof conditions>>
                ]
                  ? "true"
                  : "false"
              }
              data-testid={`monster-cond-${key}`}
            >
              {label}
            </span>
          )}
        </For>
      </div>
    </kit.SheetSection>
  );
}

function ArmorSection(props: { characterId: string }): JSX.Element {
  return (
    <kit.SheetSection title="Armor">
      <kit.FieldRow label="Worn">
        <kit.TextField
          characterId={props.characterId}
          trait={TbMonster}
          path={["armorDescription"]}
          maxLength={240}
          placeholder="e.g. Chain or plate (in combat as appropriate)"
        />
      </kit.FieldRow>
    </kit.SheetSection>
  );
}

function WeaponsSection(props: { characterId: string }): JSX.Element {
  const client = useClient();
  const weaponsTrait = useTrait(props.characterId, TbMonsterWeapons);
  const canEdit = kit.useCanEdit(props.characterId);
  const entries = createMemo(() => weaponsTrait()?.entries ?? []);

  const writeEntries = (next: ReadonlyArray<unknown>) => {
    client.dispatch(
      SetField({
        characterId: props.characterId,
        trait: TbMonsterWeapons.name as unknown as string,
        path: ["entries"],
        value: next,
      }) as CommandInstance,
    );
  };

  const addRow = () => {
    const blank = {
      name: "New Weapon",
      conflicts: [],
      bonuses: {
        attack: { type: "dice", value: 0 },
        defend: { type: "dice", value: 0 },
        feint: { type: "dice", value: 0 },
        maneuver: { type: "dice", value: 0 },
      },
    };
    writeEntries([...entries(), blank]);
  };

  const removeRow = (i: number) => {
    writeEntries(entries().filter((_, idx) => idx !== i));
  };

  return (
    <kit.SheetSection title="Weapons">
      <p
        style={{
          "font-size": "0.78rem",
          color: "var(--color-fg-muted)",
          margin: 0,
        }}
      >
        Monstrous weapons (SG p.173). Each weapon binds to one or more
        conflict types and grants action-bonus columns A / D / F / M.
        Real weapons (sword, polearm) live in Inventory.
      </p>
      <Show
        when={entries().length > 0}
        fallback={
          <div
            class="tb-monster-sheet__inv-empty"
            data-testid="monster-weapons-empty"
          >
            no monstrous weapons listed
          </div>
        }
      >
        <For each={entries()}>
          {(_w, i) => <WeaponRow characterId={props.characterId} index={i()} />}
        </For>
      </Show>
      <Show when={canEdit()}>
        <div style={{ display: "flex", "justify-content": "flex-end", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={addRow}
            class="rounded-(--radius-control) border border-border bg-surface px-3 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg transition"
            data-testid="monster-weapon-add"
          >
            + add weapon
          </button>
        </div>
      </Show>
      <Show when={canEdit() && entries().length > 0}>
        <details>
          <summary
            style={{
              "font-size": "0.7rem",
              color: "var(--color-fg-muted)",
              cursor: "pointer",
            }}
          >
            Remove a weapon
          </summary>
          <div style={{ display: "flex", "flex-wrap": "wrap", gap: "0.3rem", "margin-top": "0.4rem" }}>
            <For each={entries()}>
              {(w, i) => (
                <button
                  type="button"
                  onClick={() => removeRow(i())}
                  class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-subtle hover:border-danger hover:text-danger transition"
                  data-testid={`monster-weapon-remove-${i()}`}
                >
                  × {w.name}
                </button>
              )}
            </For>
          </div>
        </details>
      </Show>
    </kit.SheetSection>
  );
}

/**
 * One row of the monstrous-weapons table. Each cell is a kit input
 * bound to a deep path on `TbMonsterWeapons.entries[i]` so SetField
 * dispatches with a precise path-edit. The conflicts list is exposed
 * as a tag-style EntryListField (one entry per applicable conflict
 * type) — the schema's z.enum will reject non-canonical strings.
 */
function WeaponRow(props: { characterId: string; index: number }): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.3rem",
        padding: "0.4rem 0",
        "border-bottom": "1px dashed var(--color-border-muted)",
      }}
      data-testid={`monster-weapon-row-${props.index}`}
    >
      <kit.FieldRow label="Name">
        <kit.TextField
          characterId={props.characterId}
          trait={TbMonsterWeapons}
          path={["entries", props.index, "name"]}
          maxLength={60}
        />
      </kit.FieldRow>
      <kit.FieldStack label="Conflicts">
        <WeaponConflictsCheckboxes
          characterId={props.characterId}
          weaponIndex={props.index}
        />
      </kit.FieldStack>
      <div
        style={{
          display: "grid",
          "grid-template-columns": "repeat(4, 1fr)",
          gap: "0.4rem",
        }}
      >
        <ActionBonusCell
          characterId={props.characterId}
          index={props.index}
          action="attack"
          label="Attack"
        />
        <ActionBonusCell
          characterId={props.characterId}
          index={props.index}
          action="defend"
          label="Defend"
        />
        <ActionBonusCell
          characterId={props.characterId}
          index={props.index}
          action="feint"
          label="Feint"
        />
        <ActionBonusCell
          characterId={props.characterId}
          index={props.index}
          action="maneuver"
          label="Maneuver"
        />
      </div>
    </div>
  );
}

/**
 * Multi-select checkbox grid for the conflict types a monstrous weapon
 * applies to. Bound to `TbMonsterWeapons.entries[i].conflicts` (a
 * `ConflictType[]`). Toggling a box dispatches a `SetField` with the
 * full updated array — same shape as `EntryListField` so the schema's
 * z.enum guarantees value validity.
 *
 * Free-text wouldn't satisfy the eventual "show this monster's weapons
 * grouped by conflict type when a conflict is declared" wiring; the
 * select-style UI keeps the data structurally usable downstream.
 */
function WeaponConflictsCheckboxes(props: {
  characterId: string;
  weaponIndex: number;
}): JSX.Element {
  const client = useClient();
  const weaponsTrait = useTrait(props.characterId, TbMonsterWeapons);
  const canEdit = kit.useCanEdit(props.characterId);
  const conflicts = createMemo<ReadonlyArray<ConflictType>>(() => {
    const entry = weaponsTrait()?.entries?.[props.weaponIndex];
    return (entry?.conflicts ?? []) as ReadonlyArray<ConflictType>;
  });

  const toggle = (id: ConflictType) => {
    const cur = new Set(conflicts());
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    client.dispatch(
      SetField({
        characterId: props.characterId,
        trait: TbMonsterWeapons.name as unknown as string,
        path: ["entries", props.weaponIndex, "conflicts"],
        value: ALL_CONFLICT_TYPES.filter((c) => cur.has(c)),
      }) as CommandInstance,
    );
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-wrap": "wrap",
        gap: "0.4rem",
      }}
    >
      <For each={CONFLICT_OPTIONS}>
        {(opt) => (
          <label
            style={{
              display: "inline-flex",
              "align-items": "center",
              gap: "0.3rem",
              "font-size": "0.78rem",
              color: "var(--color-fg-muted)",
              opacity: canEdit() ? 1 : 0.6,
            }}
          >
            <input
              type="checkbox"
              checked={conflicts().includes(opt.value)}
              disabled={!canEdit()}
              onChange={() => toggle(opt.value)}
              data-testid={`monster-weapon-${props.weaponIndex}-conflict-${opt.value}`}
            />
            {opt.label}
          </label>
        )}
      </For>
    </div>
  );
}

function ActionBonusCell(props: {
  characterId: string;
  index: number;
  action: "attack" | "defend" | "feint" | "maneuver";
  label: string;
}): JSX.Element {
  return (
    <kit.FieldStack label={props.label}>
      <div style={{ display: "flex", gap: "0.3rem", "align-items": "center" }}>
        <kit.NumberField
          characterId={props.characterId}
          trait={TbMonsterWeapons}
          path={[
            "entries",
            props.index,
            "bonuses",
            props.action,
            "value",
          ]}
          min={-5}
          max={5}
        />
        <kit.SelectField
          characterId={props.characterId}
          trait={TbMonsterWeapons}
          path={[
            "entries",
            props.index,
            "bonuses",
            props.action,
            "type",
          ]}
          options={[
            { value: "dice", label: "D" },
            { value: "rerolls", label: "R" },
            { value: "success", label: "s" },
          ]}
        />
      </div>
    </kit.FieldStack>
  );
}

function SpecialRulesSection(props: { characterId: string }): JSX.Element {
  return (
    <kit.SheetSection title="Special Rules">
      <kit.EntryRowsField
        characterId={props.characterId}
        trait={TbMonsterSpecialRules}
        path={["entries"]}
        emptyHint="no special rules"
        addPlaceholder="rule name (e.g. Vampirism)"
        seedEntry={(primary) => ({ name: primary, text: "" })}
        columns={[
          {
            type: "text",
            key: "name",
            label: "Rule",
            width: "minmax(8rem, 0.6fr)",
            maxLength: 80,
          },
          {
            type: "text",
            key: "text",
            label: "Effect",
            width: "minmax(0, 1fr)",
            maxLength: 2000,
            placeholder: "free-text rule body…",
            multiline: true,
          },
        ]}
      />
    </kit.SheetSection>
  );
}

function InstinctSection(props: { characterId: string }): JSX.Element {
  const monster = useTrait(props.characterId, TbMonster);
  return (
    <kit.SheetSection title="Instinct">
      <Show
        when={(monster()?.instinct ?? "").trim().length > 0}
        fallback={null}
      >
        <div class="tb-monster-sheet__instinct" data-testid="monster-instinct-display">
          “{monster()!.instinct}”
        </div>
      </Show>
      <kit.FieldRow label="Edit">
        <kit.TextField
          characterId={props.characterId}
          trait={TbMonster}
          path={["instinct"]}
          maxLength={280}
          placeholder="Always X."
        />
      </kit.FieldRow>
    </kit.SheetSection>
  );
}

function InventorySection(props: { characterId: string }): JSX.Element {
  const carries = useTrait(props.characterId, TbCarries);
  const entries = createMemo(() => carries()?.entries ?? []);

  return (
    <kit.SheetSection title="Inventory">
      <Show
        when={entries().length > 0}
        fallback={
          <div class="tb-monster-sheet__inv-empty" data-testid="monster-inventory-empty">
            nothing equipped
          </div>
        }
      >
        <div class="tb-monster-sheet__inventory" role="list">
          <For each={entries()}>
            {(entry) => (
              <InventoryRow itemId={entry.itemId} slot={entry.slot} />
            )}
          </For>
        </div>
      </Show>
    </kit.SheetSection>
  );
}

function InventoryRow(props: { itemId: string; slot: string }): JSX.Element {
  const identity = useTrait(props.itemId, ItemIdentity);
  return (
    <div class="tb-monster-sheet__inv-row" role="listitem">
      <span class="tb-monster-sheet__inv-slot">{props.slot}</span>
      <span data-testid="monster-inventory-item-name">
        {identity()?.name ?? `<unknown item ${props.itemId}>`}
      </span>
    </div>
  );
}

