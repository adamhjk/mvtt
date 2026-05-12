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

// Invocations workbench page. Templated on Arcane: lists every
// invocation catalog entity (canon + homebrew + forked entries), with
// a fuzzy filter, circle / tradition / origin facets, and a detail
// editor on the right. GMs create blank entries, edit any field on an
// existing invocation, or remove ad-hoc / homebrew entries.

import { type CommandInstance, type EntityId } from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import {
  definePageProvider,
  RetargetTab,
} from "@vtt/shell-workbench/shared";
import { kit } from "@vtt/characters/client";
import { BookCitation } from "@vtt/books/client";
import {
  createMemo,
  createSignal,
  For,
  Show,
  type JSX,
} from "solid-js";
import {
  CreateBlankInvocation,
  EditInvocationField,
  RemoveInvocation,
  INVOCATION_TRADITIONS,
  InvocationCatalogIndex,
  InvocationDerivedFrom,
  InvocationIdentity,
  TbInvocationHomebrewProse,
  TbInvocationPerforming,
  type InvocationCircle,
  type InvocationRitualKind,
  type InvocationTradition,
} from "../shared/index.js";
import { tbCanonicalBookAbbreviation } from "../data/seed.js";
import { fuzzyMatch } from "./bestiary-picker.js";
import { CircleDots } from "./spell-picker.js";

export const INVOCATIONS_KIND = "@vtt/system-torchbearer/invocations";

/**
 * Invocations page provider — lists every invocation catalog entity
 * (anything carrying InvocationIdentity). Hub view (full scrollable
 * list with fuzzy filter + facets) on null entityId, detail editor
 * when an entity is selected. Mirrors `ArcanePageProvider` row-by-row
 * so behaviour stays patternable between the two arcane surfaces.
 */
export const InvocationsPageProvider = definePageProvider({
  kind: INVOCATIONS_KIND,
  icon: "scroll-unfurled",
  label: "Invocations",
  reads: [InvocationIdentity],
  list: ({ world }) => {
    return world.query([InvocationIdentity]).map((row) => {
      const ident = row.values.InvocationIdentity as { name: string };
      return {
        id: row.id,
        label: ident.name || "(unnamed invocation)",
      };
    });
  },
  defaultEntity: () => null,
  render: ({ tabId, entityId }) => (
    <InvocationsPage tabId={tabId} entityId={entityId} />
  ),
});

function InvocationsPage(props: {
  tabId: string;
  entityId: string | null;
}): JSX.Element {
  return (
    <Show
      when={props.entityId}
      fallback={<InvocationsHub tabId={props.tabId} />}
    >
      {(idAcc) => (
        <InvocationDetail invocationId={idAcc()} tabId={props.tabId} />
      )}
    </Show>
  );
}

interface InvocationRow {
  id: string;
  name: string;
  circle: InvocationCircle;
  traditions: ReadonlyArray<InvocationTradition>;
  pageRef: { canonicalId: string; page: number } | null;
  origin: "catalog" | "homebrew" | "deprecated";
  templateId: string | null;
}

/* -------------------------------------------------------------------------
 * Hub — scrollable list with fuzzy filter, circle/tradition/origin facets
 * ----------------------------------------------------------------------- */

function InvocationsHub(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const me = kit.useMe();
  const [filter, setFilter] = createSignal("");
  const [circleFilter, setCircleFilter] = createSignal<
    "all" | InvocationCircle
  >("all");
  const [traditionFilter, setTraditionFilter] = createSignal<
    "all" | InvocationTradition
  >("all");
  const [originFilter, setOriginFilter] = createSignal<
    "all" | "catalog" | "homebrew" | "deprecated"
  >("all");

  const idents = useQuery([InvocationIdentity]);
  const indexes = useQuery([InvocationCatalogIndex]);

  const indexedIds = createMemo<Set<string>>(() => {
    const out = new Set<string>();
    for (const idx of indexes()) {
      const v = idx.values.InvocationCatalogIndex as {
        entries: Record<string, string>;
      };
      for (const id of Object.values(v.entries)) {
        out.add(id);
      }
    }
    return out;
  });

  const invocations = createMemo<InvocationRow[]>(() => {
    const set = indexedIds();
    const rows: InvocationRow[] = [];
    for (const row of idents()) {
      const ident = row.values.InvocationIdentity as {
        name: string;
        circle: InvocationCircle;
        traditions: ReadonlyArray<InvocationTradition>;
        pageRef: { canonicalId: string; page: number } | null;
      };
      const derived = client.world.get(row.id, [InvocationDerivedFrom]) as
        | {
            InvocationDerivedFrom: {
              templateId: string;
              deprecated?: boolean;
            };
          }
        | undefined;
      const isCatalog = set.has(row.id);
      const templateId = derived?.InvocationDerivedFrom.templateId ?? null;
      let origin: InvocationRow["origin"];
      if (derived?.InvocationDerivedFrom.deprecated) origin = "deprecated";
      else if (isCatalog) origin = "catalog";
      else origin = "homebrew";
      rows.push({
        id: row.id,
        name: ident.name,
        circle: ident.circle,
        traditions: ident.traditions,
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
    const t = traditionFilter();
    const o = originFilter();
    return invocations()
      .filter((r) => {
        if (c !== "all" && r.circle !== c) return false;
        if (t !== "all" && !r.traditions.includes(t)) return false;
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

  const open = (invocationId: string): void => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: INVOCATIONS_KIND,
        entityId: invocationId as EntityId,
      }) as CommandInstance,
    );
  };

  const createBlank = (): void => {
    client.dispatch(
      CreateBlankInvocation({ name: "New invocation" }) as CommandInstance,
    );
  };

  return (
    <div
      data-testid="invocations-hub"
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
        <h2 style={{ margin: 0, "font-size": "1.1rem" }}>Invocations</h2>
        <span
          style={{ color: "var(--color-fg-muted)", "font-size": "0.8rem" }}
        >
          {filtered().length} of {invocations().length} invocations
        </span>
        <Show when={isGm()}>
          <button
            type="button"
            data-testid="invocations-new"
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
            + New invocation
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
                : (parseInt(e.currentTarget.value, 10) as InvocationCircle),
            )
          }
          style={selectStyle()}
        >
          <option value="all">All circles</option>
          <For each={[1, 2, 3, 4, 5] as const}>
            {(n) => <option value={n}>Circle {n}</option>}
          </For>
        </select>
        <select
          value={traditionFilter()}
          onChange={(e) =>
            setTraditionFilter(
              e.currentTarget.value as "all" | InvocationTradition,
            )
          }
          style={selectStyle()}
        >
          <option value="all">All traditions</option>
          <For each={INVOCATION_TRADITIONS}>
            {(tradition) => <option value={tradition}>{tradition}</option>}
          </For>
        </select>
        <select
          value={originFilter()}
          onChange={(e) =>
            setOriginFilter(
              e.currentTarget.value as
                | "all"
                | "catalog"
                | "homebrew"
                | "deprecated",
            )
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
        data-testid="invocations-list"
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
              no matching invocations
            </p>
          }
        >
          <For each={filtered()}>
            {(r) => (
              <div
                role="button"
                data-testid={`invocations-row-${r.id}`}
                onClick={() => open(r.id)}
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
                <span
                  style={{ "font-weight": "500", "min-width": "12rem" }}
                >
                  {r.name || "(unnamed)"}
                </span>
                <CircleDots circle={r.circle} />
                <span style={{ color: "var(--color-fg-muted)" }}>
                  {r.traditions.length > 0
                    ? r.traditions.join(", ")
                    : "—"}
                </span>
                <span
                  style={{
                    color:
                      r.origin === "deprecated"
                        ? "var(--color-fg-error)"
                        : r.origin === "homebrew"
                          ? "var(--color-accent)"
                          : "var(--color-fg-muted)",
                    "font-size": "0.7rem",
                    "margin-left": "auto",
                  }}
                >
                  {r.origin}
                </span>
                <span
                  onClick={(e) => e.stopPropagation()}
                  style={{ display: "inline-flex" }}
                >
                  <Show when={r.pageRef}>
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
 * Detail — editor for a single invocation
 * ----------------------------------------------------------------------- */

function InvocationDetail(props: {
  invocationId: string;
  tabId: string;
}): JSX.Element {
  const client = useClient();
  const me = kit.useMe();
  const ident = useTrait(props.invocationId, InvocationIdentity);
  const performing = useTrait(props.invocationId, TbInvocationPerforming);
  const homebrew = useTrait(props.invocationId, TbInvocationHomebrewProse);
  const derived = useTrait(props.invocationId, InvocationDerivedFrom);
  const isGm = createMemo(() => me()?.role === "gm");
  const isHomebrew = createMemo(() => derived() === undefined);

  const back = (): void => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: INVOCATIONS_KIND,
        entityId: null,
      }) as CommandInstance,
    );
  };

  const remove = (): void => {
    if (!confirm("Remove this invocation from the catalog?")) return;
    client.dispatch(
      RemoveInvocation({
        invocationId: props.invocationId as EntityId,
      }) as CommandInstance,
    );
    back();
  };

  const editIdentity = (path: ReadonlyArray<string>, value: unknown): void => {
    client.dispatch(
      EditInvocationField({
        invocationId: props.invocationId as EntityId,
        trait: "InvocationIdentity",
        path: [...path],
        value,
      }) as CommandInstance,
    );
  };
  const editPerforming = (
    path: ReadonlyArray<string>,
    value: unknown,
  ): void => {
    client.dispatch(
      EditInvocationField({
        invocationId: props.invocationId as EntityId,
        trait: "TbInvocationPerforming",
        path: [...path],
        value,
      }) as CommandInstance,
    );
  };
  const editHomebrew = (path: ReadonlyArray<string>, value: unknown): void => {
    client.dispatch(
      EditInvocationField({
        invocationId: props.invocationId as EntityId,
        trait: "TbInvocationHomebrewProse",
        path: [...path],
        value,
      }) as CommandInstance,
    );
  };

  /**
   * Multi-select toggle for the identity's `traditions` array. The
   * EditInvocationField command only takes a single value, so we read
   * the current array, flip the toggled tradition in or out, and write
   * the whole array back.
   */
  const toggleTradition = (tradition: InvocationTradition): void => {
    const current = ident()?.traditions ?? [];
    const next = current.includes(tradition)
      ? current.filter((t) => t !== tradition)
      : [...current, tradition];
    editIdentity(["traditions"], next);
  };

  return (
    <div
      data-testid={`invocations-detail-${props.invocationId}`}
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
        <button
          type="button"
          onClick={back}
          data-testid="invocations-back"
          style={btnStyle()}
        >
          ← All invocations
        </button>
        <Show when={isGm() && isHomebrew()}>
          <button
            type="button"
            data-testid="invocations-remove"
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
              editIdentity(
                ["circle"],
                parseInt(e.currentTarget.value, 10) as InvocationCircle,
              )
            }
            style={selectStyle()}
          >
            <For each={[1, 2, 3, 4, 5] as const}>
              {(n) => <option value={n}>Circle {n}</option>}
            </For>
          </select>
        </Field>
        <Field label="Traditions">
          <div
            style={{
              display: "inline-flex",
              gap: "0.4rem",
              "flex-wrap": "wrap",
            }}
          >
            <For each={INVOCATION_TRADITIONS}>
              {(tradition) => {
                const checked = createMemo(() =>
                  (ident()?.traditions ?? []).includes(tradition),
                );
                return (
                  <label
                    style={{
                      display: "inline-flex",
                      "align-items": "center",
                      gap: "0.25rem",
                      "font-size": "0.8rem",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked()}
                      disabled={!isGm()}
                      onChange={() => toggleTradition(tradition)}
                    />
                    {tradition}
                  </label>
                );
              }}
            </For>
          </div>
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

      {/* Performing */}
      <Section title="Performing (DH p.98–100)">
        <Field label="Ritual kind">
          <select
            value={performing()?.ritualKind ?? "fixed"}
            disabled={!isGm()}
            onChange={(e) =>
              editPerforming(
                ["ritualKind"],
                e.currentTarget.value as InvocationRitualKind,
              )
            }
            style={selectStyle()}
          >
            <option value="fixed">Fixed Ob</option>
            <option value="factors">Factors</option>
            <option value="versus">Versus</option>
            <option value="skill-swap">Skill swap (no roll)</option>
          </select>
        </Field>
        <Show when={performing()?.ritualKind === "fixed"}>
          <Field label="Fixed Ob">
            <input
              type="number"
              min={0}
              max={10}
              value={performing()?.fixedOb ?? ""}
              disabled={!isGm()}
              placeholder="(blank — set per ritual)"
              onChange={(e) => {
                const raw = e.currentTarget.value;
                editPerforming(
                  ["fixedOb"],
                  raw === "" ? null : parseInt(raw, 10),
                );
              }}
              style={inputStyle()}
            />
          </Field>
        </Show>
        <Show when={performing()?.ritualKind === "versus"}>
          <Field label="Versus">
            <input
              type="text"
              value={performing()?.versusAgainst ?? ""}
              disabled={!isGm()}
              placeholder="e.g. nature, will"
              onChange={(e) =>
                editPerforming(
                  ["versusAgainst"],
                  e.currentTarget.value || null,
                )
              }
              style={inputStyle()}
            />
          </Field>
        </Show>
        <Field label="Invocation time (no relic)">
          <input
            type="number"
            min={0}
            max={10}
            value={performing()?.invocationTime.noRelic ?? 1}
            disabled={!isGm()}
            onChange={(e) =>
              editPerforming(
                ["invocationTime", "noRelic"],
                parseInt(e.currentTarget.value, 10),
              )
            }
            style={inputStyle()}
          />
        </Field>
        <Field label="Invocation time (with relic)">
          <input
            type="number"
            min={0}
            max={10}
            value={performing()?.invocationTime.withRelic ?? 0}
            disabled={!isGm()}
            onChange={(e) =>
              editPerforming(
                ["invocationTime", "withRelic"],
                parseInt(e.currentTarget.value, 10),
              )
            }
            style={inputStyle()}
          />
        </Field>
        <Field label="Duration">
          <input
            type="text"
            value={performing()?.duration ?? ""}
            disabled={!isGm()}
            onChange={(e) =>
              editPerforming(["duration"], e.currentTarget.value)
            }
            style={inputStyle()}
          />
        </Field>
        <Field label="Burden (no relic)">
          <input
            type="number"
            min={0}
            max={10}
            value={performing()?.immortalBurden.noRelic ?? 2}
            disabled={!isGm()}
            onChange={(e) =>
              editPerforming(
                ["immortalBurden", "noRelic"],
                parseInt(e.currentTarget.value, 10),
              )
            }
            style={inputStyle()}
          />
        </Field>
        <Field label="Burden (with relic)">
          <input
            type="number"
            min={0}
            max={10}
            value={performing()?.immortalBurden.withRelic ?? 1}
            disabled={!isGm()}
            onChange={(e) =>
              editPerforming(
                ["immortalBurden", "withRelic"],
                parseInt(e.currentTarget.value, 10),
              )
            }
            style={inputStyle()}
          />
        </Field>
        <Field label="Relic name">
          <input
            type="text"
            value={performing()?.relicName ?? ""}
            disabled={!isGm()}
            onChange={(e) =>
              editPerforming(["relicName"], e.currentTarget.value)
            }
            style={inputStyle()}
          />
        </Field>
        <Field label="Relic slot">
          <input
            type="text"
            value={performing()?.relicSlot ?? ""}
            disabled={!isGm()}
            placeholder="e.g. handR, neck, pocket"
            onChange={(e) =>
              editPerforming(["relicSlot"], e.currentTarget.value)
            }
            style={inputStyle()}
          />
        </Field>
        <Field label="Sacramental">
          <input
            type="text"
            value={performing()?.sacramental ?? ""}
            disabled={!isGm()}
            placeholder="optional — +1D when present (DH p.100)"
            onChange={(e) =>
              editPerforming(["sacramental"], e.currentTarget.value)
            }
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
            For homebrew invocations without a rulebook page reference,
            write the effect prose here. Canon entries leave this blank
            and rely on the page citation chip.
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
            value={homebrew()?.ritual ?? ""}
            disabled={!isGm()}
            placeholder="Ritual prose (optional — per-invocation mechanical rules)"
            rows={3}
            onChange={(e) => editHomebrew(["ritual"], e.currentTarget.value)}
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
 * tiny presentation helpers — duplicated from arcane-page.tsx rather
 * than hoisted: the two pages live their own visual lives and a
 * future tweak to one shouldn't ripple to the other without intent.
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
      <h3
        style={{ margin: 0, "font-size": "0.85rem", "font-weight": "600" }}
      >
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function Field(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <label
      style={{
        display: "grid",
        "grid-template-columns": "12rem 1fr",
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
