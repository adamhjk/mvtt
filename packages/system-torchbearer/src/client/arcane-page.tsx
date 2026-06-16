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

// Arcane workbench page. Modeled after the Items page: lists every
// spell entity in the world (the catalog plus any homebrew or forked
// entries), with a fuzzy filter, a circle/school grouping, and a
// detail editor on the right. GMs can create new spells, edit any
// field on an existing spell, or remove ad-hoc / homebrew entries.

import { type CommandInstance, type EntityId } from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { definePageProvider, RetargetTab } from "@vtt/shell-workbench/shared";
import { kit } from "@vtt/characters/client";
import { BookCitation } from "@vtt/books/client";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import {
  CreateBlankSpell,
  EditSpellField,
  RemoveSpell,
  SpellCatalogIndex,
  SpellDerivedFrom,
  SpellIdentity,
  SPELL_SCHOOLS,
  TbSpellCasting,
  TbSpellHomebrewProse,
  TbSpellLearning,
  type SpellCircle,
  type SpellSchool,
} from "../shared/index.js";
import { tbCanonicalBookAbbreviation } from "../data/seed.js";
import { fuzzyMatch } from "./monsters-picker.js";
import { CircleDots } from "./spell-picker.js";

const ARCANE_KIND = "@vtt/system-torchbearer/arcane";

/**
 * Arcane page provider — lists every spell catalog entity (anything
 * carrying SpellIdentity). Mirrors the Items page: hub view (full
 * scrollable list with fuzzy filter + grouping) on null entityId,
 * detail editor when an entity is selected.
 */
export const ArcanePageProvider = definePageProvider({
  kind: ARCANE_KIND,
  icon: "sparkles",
  label: "Arcane",
  reads: [SpellIdentity],
  list: ({ world }) => {
    return world.query([SpellIdentity]).map((row) => {
      const ident = row.values.SpellIdentity as { name: string };
      return {
        id: row.id,
        label: ident.name || "(unnamed spell)",
      };
    });
  },
  defaultEntity: () => null,
  render: ({ tabId, entityId }) => <ArcanePage tabId={tabId} entityId={entityId} />,
});

function ArcanePage(props: { tabId: string; entityId: string | null }): JSX.Element {
  return (
    <Show when={props.entityId} fallback={<ArcaneHub tabId={props.tabId} />}>
      {(idAcc) => <ArcaneDetail spellId={idAcc()} tabId={props.tabId} />}
    </Show>
  );
}

interface SpellRow {
  id: string;
  name: string;
  circle: SpellCircle;
  school: SpellSchool;
  pageRef: { canonicalId: string; page: number } | null;
  origin: "catalog" | "homebrew" | "deprecated";
  templateId: string | null;
}

/* -------------------------------------------------------------------------
 * Hub — scrollable list with fuzzy filter, circle/school facets
 * ----------------------------------------------------------------------- */

function ArcaneHub(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const me = kit.useMe();
  const [filter, setFilter] = createSignal("");
  const [circleFilter, setCircleFilter] = createSignal<"all" | SpellCircle>("all");
  const [schoolFilter, setSchoolFilter] = createSignal<"all" | SpellSchool>("all");
  const [originFilter, setOriginFilter] = createSignal<
    "all" | "catalog" | "homebrew" | "deprecated"
  >("all");

  const idents = useQuery([SpellIdentity]);
  const indexes = useQuery([SpellCatalogIndex]);

  const indexedIds = createMemo<Set<string>>(() => {
    const out = new Set<string>();
    for (const idx of indexes()) {
      const v = idx.values.SpellCatalogIndex as {
        entries: Record<string, string>;
      };
      for (const id of Object.values(v.entries)) {
        out.add(id);
      }
    }
    return out;
  });

  const spells = createMemo<SpellRow[]>(() => {
    const set = indexedIds();
    const rows: SpellRow[] = [];
    for (const row of idents()) {
      const ident = row.values.SpellIdentity as {
        name: string;
        circle: SpellCircle;
        school: SpellSchool;
        pageRef: { canonicalId: string; page: number } | null;
      };
      const derived = client.world.get(row.id, [SpellDerivedFrom]) as
        | {
            SpellDerivedFrom: {
              templateId: string;
              deprecated?: boolean;
            };
          }
        | undefined;
      const isCatalog = set.has(row.id);
      const templateId = derived?.SpellDerivedFrom.templateId ?? null;
      let origin: SpellRow["origin"];
      if (derived?.SpellDerivedFrom.deprecated) origin = "deprecated";
      else if (isCatalog) origin = "catalog";
      else origin = "homebrew";
      rows.push({
        id: row.id,
        name: ident.name,
        circle: ident.circle,
        school: ident.school,
        pageRef: ident.pageRef,
        origin,
        templateId,
      });
    }
    return rows;
  });

  const filtered = createMemo(() => {
    const q = filter().trim();
    const c = circleFilter();
    const s = schoolFilter();
    const o = originFilter();
    return spells()
      .filter((r) => {
        if (c !== "all" && r.circle !== c) return false;
        if (s !== "all" && r.school !== s) return false;
        if (o !== "all" && r.origin !== o) return false;
        if (q.length > 0 && !fuzzyMatch(r.name, q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.circle !== b.circle) return a.circle - b.circle;
        return a.name.localeCompare(b.name);
      });
  });

  const isGm = createMemo(() => me()?.role === "gm");

  const open = (spellId: string): void => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: ARCANE_KIND,
        entityId: spellId as EntityId,
      }) as CommandInstance,
    );
  };

  const createBlank = (): void => {
    client.dispatch(CreateBlankSpell({ name: "New spell" }) as CommandInstance);
  };

  return (
    <div
      data-testid="arcane-hub"
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.6rem",
        padding: "1rem",
        height: "100%",
        "min-height": 0,
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "0.6rem",
          "flex-wrap": "wrap",
        }}
      >
        <h2 style={{ margin: 0, "font-size": "1.1rem" }}>Arcane</h2>
        <span style={{ color: "var(--color-fg-muted)", "font-size": "0.8rem" }}>
          {filtered().length} of {spells().length} spells
        </span>
        <Show when={isGm()}>
          <button
            type="button"
            data-testid="arcane-new-spell"
            onClick={createBlank}
            style={{
              "margin-left": "auto",
              padding: "0.35rem 0.6rem",
              "border-radius": "var(--radius-control)",
              border: "1px solid var(--color-accent)",
              background: "var(--color-accent-soft)",
              color: "var(--color-accent)",
              "font-size": "0.8rem",
              cursor: "pointer",
            }}
          >
            + New spell
          </button>
        </Show>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "0.5rem",
          "flex-wrap": "wrap",
        }}
      >
        <input
          type="text"
          value={filter()}
          placeholder="Search by name…"
          autocomplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          spellcheck={false}
          onInput={(e) => setFilter(e.currentTarget.value)}
          style={{
            flex: "1 1 14rem",
            padding: "0.4rem 0.55rem",
            "border-radius": "var(--radius-control)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-fg)",
            "font-size": "0.85rem",
          }}
        />
        <select
          value={circleFilter()}
          onChange={(e) =>
            setCircleFilter(
              e.currentTarget.value === "all"
                ? "all"
                : (parseInt(e.currentTarget.value, 10) as SpellCircle),
            )
          }
          style={selectStyle()}
        >
          <option value="all">All circles</option>
          <For each={[1, 2, 3, 4, 5] as const}>{(n) => <option value={n}>Circle {n}</option>}</For>
        </select>
        <select
          value={schoolFilter()}
          onChange={(e) => setSchoolFilter(e.currentTarget.value as "all" | SpellSchool)}
          style={selectStyle()}
        >
          <option value="all">All schools</option>
          <For each={SPELL_SCHOOLS}>{(school) => <option value={school}>{school}</option>}</For>
        </select>
        <select
          value={originFilter()}
          onChange={(e) =>
            setOriginFilter(e.currentTarget.value as "all" | "catalog" | "homebrew" | "deprecated")
          }
          style={selectStyle()}
        >
          <option value="all">All origins</option>
          <option value="catalog">Catalog</option>
          <option value="homebrew">Homebrew</option>
          <option value="deprecated">Deprecated</option>
        </select>
      </div>

      {/* Scrollable list */}
      <div
        data-testid="arcane-spell-list"
        style={{
          flex: "1 1 auto",
          "min-height": 0,
          "overflow-y": "auto",
          display: "flex",
          "flex-direction": "column",
          gap: "0.3rem",
          "padding-right": "0.4rem",
        }}
      >
        <Show
          when={filtered().length > 0}
          fallback={
            <p
              style={{
                "font-size": "0.8rem",
                "font-style": "italic",
                color: "var(--color-fg-muted)",
                margin: 0,
              }}
            >
              no matching spells
            </p>
          }
        >
          <For each={filtered()}>
            {(s) => (
              <div
                role="button"
                data-testid={`arcane-row-${s.id}`}
                onClick={() => open(s.id)}
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "0.6rem",
                  padding: "0.4rem 0.55rem",
                  "border-radius": "var(--radius-control)",
                  background: "var(--color-surface-elevated)",
                  border: "1px solid var(--color-border-muted)",
                  cursor: "pointer",
                  "font-size": "0.85rem",
                }}
              >
                <span style={{ "font-weight": "500", "min-width": "12rem" }}>
                  {s.name || "(unnamed)"}
                </span>
                <CircleDots circle={s.circle} />
                <span style={{ color: "var(--color-fg-muted)" }}>{s.school}</span>
                <span
                  style={{
                    color:
                      s.origin === "deprecated"
                        ? "var(--color-fg-error)"
                        : s.origin === "homebrew"
                          ? "var(--color-accent)"
                          : "var(--color-fg-muted)",
                    "font-size": "0.7rem",
                    "margin-left": "auto",
                  }}
                >
                  {s.origin}
                </span>
                <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
                  <Show when={s.pageRef}>
                    {(ref) => (
                      <BookCitation
                        canonicalId={ref().canonicalId}
                        page={ref().page}
                        label={pageLabel(ref().canonicalId, ref().page)}
                      />
                    )}
                  </Show>
                </span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Detail — editor for a single spell
 * ----------------------------------------------------------------------- */

function ArcaneDetail(props: { spellId: string; tabId: string }): JSX.Element {
  const client = useClient();
  const me = kit.useMe();
  const ident = useTrait(props.spellId, SpellIdentity);
  const casting = useTrait(props.spellId, TbSpellCasting);
  const learning = useTrait(props.spellId, TbSpellLearning);
  const homebrew = useTrait(props.spellId, TbSpellHomebrewProse);
  const derived = useTrait(props.spellId, SpellDerivedFrom);
  const isGm = createMemo(() => me()?.role === "gm");
  const isHomebrew = createMemo(() => derived() === undefined);

  const back = (): void => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: ARCANE_KIND,
        entityId: null,
      }) as CommandInstance,
    );
  };

  const remove = (): void => {
    if (!confirm("Remove this spell from the catalog?")) return;
    client.dispatch(RemoveSpell({ spellId: props.spellId as EntityId }) as CommandInstance);
    back();
  };

  const editIdentity = (path: ReadonlyArray<string>, value: unknown): void => {
    client.dispatch(
      EditSpellField({
        spellId: props.spellId as EntityId,
        trait: "SpellIdentity",
        path: [...path],
        value,
      }) as CommandInstance,
    );
  };
  const editCasting = (path: ReadonlyArray<string>, value: unknown): void => {
    client.dispatch(
      EditSpellField({
        spellId: props.spellId as EntityId,
        trait: "TbSpellCasting",
        path: [...path],
        value,
      }) as CommandInstance,
    );
  };
  const editLearning = (path: ReadonlyArray<string>, value: unknown): void => {
    client.dispatch(
      EditSpellField({
        spellId: props.spellId as EntityId,
        trait: "TbSpellLearning",
        path: [...path],
        value,
      }) as CommandInstance,
    );
  };
  const editHomebrew = (path: ReadonlyArray<string>, value: unknown): void => {
    client.dispatch(
      EditSpellField({
        spellId: props.spellId as EntityId,
        trait: "TbSpellHomebrewProse",
        path: [...path],
        value,
      }) as CommandInstance,
    );
  };

  return (
    <div
      data-testid={`arcane-detail-${props.spellId}`}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.8rem",
        padding: "1rem",
        height: "100%",
        "min-height": 0,
        "overflow-y": "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "0.5rem",
        }}
      >
        <button type="button" onClick={back} data-testid="arcane-back" style={btnStyle()}>
          ← All spells
        </button>
        <Show when={isGm() && isHomebrew()}>
          <button
            type="button"
            data-testid="arcane-remove"
            onClick={remove}
            style={{
              ...btnStyle(),
              "margin-left": "auto",
              "border-color": "var(--color-fg-error)",
              color: "var(--color-fg-error)",
            }}
          >
            Remove
          </button>
        </Show>
      </div>

      {/* Identity */}
      <Section title="Identity">
        <Field label="Name">
          <input
            type="text"
            value={ident()?.name ?? ""}
            disabled={!isGm()}
            onChange={(e) => editIdentity(["name"], e.currentTarget.value)}
            style={inputStyle()}
          />
        </Field>
        <Field label="Circle">
          <select
            value={ident()?.circle ?? 1}
            disabled={!isGm()}
            onChange={(e) =>
              editIdentity(["circle"], parseInt(e.currentTarget.value, 10) as SpellCircle)
            }
            style={selectStyle()}
          >
            <For each={[1, 2, 3, 4, 5] as const}>
              {(n) => <option value={n}>Circle {n}</option>}
            </For>
          </select>
        </Field>
        <Field label="School">
          <select
            value={ident()?.school ?? "Other"}
            disabled={!isGm()}
            onChange={(e) => editIdentity(["school"], e.currentTarget.value as SpellSchool)}
            style={selectStyle()}
          >
            <For each={SPELL_SCHOOLS}>{(school) => <option value={school}>{school}</option>}</For>
          </select>
        </Field>
        <Field label="Page reference">
          <Show
            when={ident()?.pageRef}
            fallback={
              <span
                style={{
                  "font-size": "0.8rem",
                  color: "var(--color-fg-muted)",
                  "font-style": "italic",
                }}
              >
                — none —
              </span>
            }
          >
            {(ref) => (
              <BookCitation
                canonicalId={ref().canonicalId}
                page={ref().page}
                label={pageLabel(ref().canonicalId, ref().page)}
              />
            )}
          </Show>
        </Field>
      </Section>

      {/* Casting */}
      <Section title="Casting (DH p.93–94)">
        <Field label="Kind">
          <select
            value={casting()?.kind ?? "fixed"}
            disabled={!isGm()}
            onChange={(e) => editCasting(["kind"], e.currentTarget.value)}
            style={selectStyle()}
          >
            <option value="fixed">Fixed Ob</option>
            <option value="factors">Factors</option>
            <option value="versus">Versus</option>
          </select>
        </Field>
        <Show when={casting()?.kind === "fixed"}>
          <Field label="Fixed Ob">
            <input
              type="number"
              min={0}
              max={10}
              value={casting()?.fixedOb ?? ""}
              disabled={!isGm()}
              placeholder="(blank — set per cast)"
              onChange={(e) => {
                const raw = e.currentTarget.value;
                editCasting(["fixedOb"], raw === "" ? null : parseInt(raw, 10));
              }}
              style={inputStyle()}
            />
          </Field>
        </Show>
        <Show when={casting()?.kind === "versus"}>
          <Field label="Versus skill">
            <input
              type="text"
              value={casting()?.versusSkill ?? ""}
              disabled={!isGm()}
              placeholder="e.g. arcanist, will"
              onChange={(e) => editCasting(["versusSkill"], e.currentTarget.value || null)}
              style={inputStyle()}
            />
          </Field>
        </Show>
        <Field label="Casting time">
          <select
            value={casting()?.castingTime ?? "action"}
            disabled={!isGm()}
            onChange={(e) => editCasting(["castingTime"], e.currentTarget.value)}
            style={selectStyle()}
          >
            <option value="free">Free</option>
            <option value="action">Action</option>
            <option value="one-turn">One turn</option>
            <option value="multi-turn">Multi-turn</option>
          </select>
        </Field>
        <Field label="Duration">
          <input
            type="text"
            value={casting()?.duration ?? ""}
            disabled={!isGm()}
            onChange={(e) => editCasting(["duration"], e.currentTarget.value)}
            style={inputStyle()}
          />
        </Field>
        <Field label="Materials">
          <input
            type="text"
            value={casting()?.materials ?? ""}
            disabled={!isGm()}
            placeholder="e.g. A handful of coarse salt"
            onChange={(e) => editCasting(["materials"], e.currentTarget.value)}
            style={inputStyle()}
          />
        </Field>
        <Field label="Focus">
          <input
            type="text"
            value={casting()?.focus ?? ""}
            disabled={!isGm()}
            placeholder="e.g. A silver bell"
            onChange={(e) => editCasting(["focus"], e.currentTarget.value)}
            style={inputStyle()}
          />
        </Field>
      </Section>

      {/* Learning */}
      <Section title="Learning / Scribing (DH p.92, p.96)">
        <Field label="Scholar Ob (scribe)">
          <input
            type="number"
            min={0}
            max={10}
            value={learning()?.scribeOb ?? 2}
            disabled={!isGm()}
            onChange={(e) => editLearning(["scribeOb"], parseInt(e.currentTarget.value, 10))}
            style={inputStyle()}
          />
        </Field>
        <Field label="Lore Master Ob (learn)">
          <input
            type="number"
            min={0}
            max={10}
            value={learning()?.learnOb ?? 2}
            disabled={!isGm()}
            onChange={(e) => editLearning(["learnOb"], parseInt(e.currentTarget.value, 10))}
            style={inputStyle()}
          />
        </Field>
      </Section>

      {/* Homebrew prose — only shown when no canonical pageRef. */}
      <Show when={isHomebrew() || homebrew()}>
        <Section title="Effect (homebrew)">
          <p
            style={{
              "font-size": "0.75rem",
              color: "var(--color-fg-muted)",
              margin: 0,
            }}
          >
            For homebrew spells without a rulebook page reference, write the effect prose here.
            Canon spells leave this blank and rely on the page citation chip.
          </p>
          <textarea
            value={homebrew()?.effect ?? ""}
            disabled={!isGm()}
            rows={4}
            onChange={(e) => editHomebrew(["effect"], e.currentTarget.value)}
            style={{
              ...inputStyle(),
              "min-height": "5rem",
              "font-family": "inherit",
            }}
          />
          <textarea
            value={homebrew()?.casting ?? ""}
            disabled={!isGm()}
            placeholder="Casting prose (optional — per-spell mechanical rules)"
            rows={3}
            onChange={(e) => editHomebrew(["casting"], e.currentTarget.value)}
            style={{
              ...inputStyle(),
              "min-height": "4rem",
              "font-family": "inherit",
            }}
          />
        </Section>
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * tiny presentation helpers
 * ----------------------------------------------------------------------- */

function Section(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <section
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.4rem",
        padding: "0.6rem 0.7rem",
        "border-radius": "var(--radius-control)",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border-muted)",
      }}
    >
      <h3 style={{ margin: 0, "font-size": "0.85rem", "font-weight": "600" }}>{props.title}</h3>
      {props.children}
    </section>
  );
}

function Field(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <label
      style={{
        display: "grid",
        "grid-template-columns": "10rem 1fr",
        "align-items": "center",
        gap: "0.5rem",
        "font-size": "0.8rem",
      }}
    >
      <span style={{ color: "var(--color-fg-muted)" }}>{props.label}</span>
      {props.children}
    </label>
  );
}

function inputStyle(): JSX.CSSProperties {
  return {
    padding: "0.35rem 0.5rem",
    "border-radius": "var(--radius-control)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-elevated)",
    color: "var(--color-fg)",
    "font-size": "0.85rem",
  };
}

function selectStyle(): JSX.CSSProperties {
  return {
    padding: "0.35rem 0.5rem",
    "border-radius": "var(--radius-control)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-fg)",
    "font-size": "0.8rem",
  };
}

function btnStyle(): JSX.CSSProperties {
  return {
    padding: "0.35rem 0.6rem",
    "border-radius": "var(--radius-control)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-elevated)",
    color: "var(--color-fg)",
    "font-size": "0.8rem",
    cursor: "pointer",
  };
}

function pageLabel(canonicalId: string, page: number): string {
  const abbrev = tbCanonicalBookAbbreviation(canonicalId);
  return abbrev ? `${abbrev} p.${page}` : `p.${page}`;
}
