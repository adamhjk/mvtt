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

// Shared monsters fuzzy-search rack used by both the conflict-declare
// inline picker and the Monsters home page. The rack itself is the
// scrolling card list grouped by monster type (when unfiltered) or
// flattened (when filtered); selection paints exactly one row in
// solid accent. Parents own state and pass accessors / setters in.

import { createMemo, For, Show, type JSX } from "solid-js";
import { TB_MONSTER_TEMPLATES } from "../shared/monsters.js";

/**
 * Subsequence-style fuzzy match: every char in the query (in order,
 * not necessarily adjacent) must appear in the candidate name.
 * "vmpr" matches "Vampire Lord"; "dor" matches "Dragefolk"; "x"
 * matches nothing in the catalog. Cheap (linear over both inputs) and
 * good enough for the ~40-entry monster catalog.
 */
export function fuzzyMatch(name: string, query: string): boolean {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  let i = 0;
  for (let j = 0; j < n.length && i < q.length; j += 1) {
    if (n.charCodeAt(j) === q.charCodeAt(i)) i += 1;
  }
  return i === q.length;
}

export interface MonsterCandidate {
  readonly id: string;
  readonly name: string;
  readonly nature: { readonly rating: number };
  readonly might: number;
  readonly type: string;
}

/**
 * Filter `TB_MONSTER_TEMPLATES` against an arbitrary query, returning
 * the templates that pass the subsequence fuzzy match. An empty query
 * returns the full catalog (so callers don't need to special-case it).
 */
export function filterCatalogByQuery(query: string): ReadonlyArray<MonsterCandidate> {
  const q = query.trim();
  if (q.length === 0) return TB_MONSTER_TEMPLATES;
  return TB_MONSTER_TEMPLATES.filter((t) => fuzzyMatch(t.name, q));
}

/**
 * Monsters card rack. When the user is searching, the matching
 * candidates render as a flat list. When the rack is unfiltered, we
 * group by monster `type` (undead/troll/beast/…) with sticky group
 * headers — same scrollroll, but the wall-of-names breaks into
 * scannable sections so a future catalog of 100+ creatures stays
 * navigable. Group order is alphabetical-by-type for stability;
 * within a group, monsters keep their catalog order.
 *
 * Selection paints exactly one row in solid accent regardless of
 * grouping. The component assumes a non-empty list — parents render
 * an empty-state fallback themselves.
 */
export function MonstersRack(props: {
  candidates: () => ReadonlyArray<MonsterCandidate>;
  selected: () => string | null;
  setSelected: (id: string | null) => void;
  query: () => string;
  /** Override `data-testid` on the listbox container. */
  testid?: string;
  /** Per-row testid prefix; defaults to `"monsters-option"`. */
  rowTestidPrefix?: string;
}): JSX.Element {
  const isFiltered = createMemo(() => props.query().trim().length > 0);

  const grouped = createMemo<
    ReadonlyArray<{
      type: string;
      label: string;
      members: ReadonlyArray<MonsterCandidate>;
    }>
  >(() => {
    const buckets = new Map<string, Array<MonsterCandidate>>();
    for (const t of props.candidates()) {
      const key = (t.type ?? "other").toLowerCase();
      const list = buckets.get(key) ?? [];
      list.push(t);
      buckets.set(key, list);
    }
    const out: Array<{
      type: string;
      label: string;
      members: ReadonlyArray<MonsterCandidate>;
    }> = [];
    for (const [key, members] of buckets) {
      out.push({
        type: key,
        label: key.charAt(0).toUpperCase() + key.slice(1),
        members,
      });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  });

  const rowPrefix = (): string => props.rowTestidPrefix ?? "monsters-option";

  return (
    <div
      class="overflow-y-auto"
      role="listbox"
      aria-label="Monster templates"
      data-testid={props.testid ?? "monsters-options"}
      style={{
        "max-height": "22rem",
        border: "1px solid var(--color-border-muted)",
        "border-radius": "var(--radius-control)",
        "background-color": "var(--color-surface-sunken, var(--color-surface))",
      }}
    >
      <Show
        when={isFiltered()}
        fallback={
          <For each={grouped()}>
            {(group) => (
              <section>
                <header
                  class="sticky top-0 z-10"
                  style={{
                    "background-color": "var(--color-surface-elevated)",
                    "border-bottom": "1px solid var(--color-border-muted)",
                    padding: "0.3rem 0.7rem 0.3rem 0.85rem",
                    "font-family": "var(--font-display)",
                    "font-size": "0.6rem",
                    "letter-spacing": "0.2em",
                    "text-transform": "uppercase",
                    color: "var(--color-fg-muted)",
                    display: "flex",
                    "align-items": "baseline",
                    "justify-content": "space-between",
                  }}
                >
                  <span>{group.label}</span>
                  <span
                    class="tabular-nums"
                    style={{
                      "font-family": "var(--font-mono)",
                      "font-size": "0.6rem",
                      color: "var(--color-fg-subtle)",
                      "letter-spacing": "0.04em",
                    }}
                  >
                    {group.members.length}
                  </span>
                </header>
                <ul>
                  <For each={group.members}>
                    {(t, i) => (
                      <MonstersRow
                        candidate={t}
                        isLast={i() === group.members.length - 1}
                        selected={() => props.selected() === t.id}
                        onPick={() => props.setSelected(t.id)}
                        testidPrefix={rowPrefix()}
                      />
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
        }
      >
        <ul>
          <For each={props.candidates()}>
            {(t, i) => (
              <MonstersRow
                candidate={t}
                isLast={i() === props.candidates().length - 1}
                selected={() => props.selected() === t.id}
                onPick={() => props.setSelected(t.id)}
                testidPrefix={rowPrefix()}
              />
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function MonstersRow(props: {
  candidate: MonsterCandidate;
  isLast: boolean;
  selected: () => boolean;
  onPick: () => void;
  testidPrefix: string;
}): JSX.Element {
  return (
    <li
      role="option"
      aria-selected={props.selected()}
      onClick={props.onPick}
      data-testid={`${props.testidPrefix}-${props.candidate.id}`}
      class="cursor-pointer transition-colors relative"
      style={{
        display: "grid",
        "grid-template-columns": "0.4rem 1fr auto",
        "align-items": "center",
        "column-gap": "0.7rem",
        padding: "0.45rem 0.7rem 0.45rem 0",
        "border-bottom": props.isLast ? "0" : "1px solid var(--color-border-muted)",
        "background-color": props.selected() ? "var(--color-accent)" : "transparent",
        color: props.selected() ? "var(--color-accent-fg)" : "var(--color-fg)",
      }}
      onMouseEnter={(e) => {
        if (props.selected()) return;
        (e.currentTarget as HTMLLIElement).style.backgroundColor = "var(--color-surface-elevated)";
      }}
      onMouseLeave={(e) => {
        if (props.selected()) return;
        (e.currentTarget as HTMLLIElement).style.backgroundColor = "transparent";
      }}
    >
      <span
        aria-hidden="true"
        style={{
          "align-self": "stretch",
          "background-color": props.selected() ? "var(--color-accent-fg)" : "transparent",
          width: "0.25rem",
          "margin-left": "0.25rem",
        }}
      />
      <span class="flex items-baseline gap-2 min-w-0">
        <Show when={props.selected()}>
          <span
            aria-hidden="true"
            style={{
              "font-family": "var(--font-mono)",
              "font-size": "0.7rem",
              opacity: "0.85",
            }}
          >
            ▸
          </span>
        </Show>
        <span
          class="truncate"
          style={{
            "font-family": "var(--font-display)",
            "font-size": "0.92rem",
            "font-weight": props.selected() ? 600 : 500,
          }}
        >
          {props.candidate.name}
        </span>
      </span>
      <span
        class="tabular-nums whitespace-nowrap"
        style={{
          "font-family": "var(--font-mono)",
          "font-size": "0.7rem",
          "letter-spacing": "0.04em",
          color: props.selected() ? "var(--color-accent-fg)" : "var(--color-fg-muted)",
          opacity: props.selected() ? 0.9 : 1,
        }}
      >
        N{props.candidate.nature.rating} · M{props.candidate.might}
      </span>
    </li>
  );
}

/**
 * Search input that drives a `MonstersRack`. Renders a `▸` prefix
 * marker, a clear-button × on the right when there's a query, and
 * wires arrow-key roving-selection plus Escape-to-clear plus
 * Enter-to-commit. The parent owns the query/selected/onCommit
 * state — this component is just the input affordance.
 */
export function MonstersSearchInput(props: {
  query: () => string;
  setQuery: (next: string) => void;
  selected: () => string | null;
  setSelected: (id: string | null) => void;
  candidates: () => ReadonlyArray<MonsterCandidate>;
  onCommit?: () => void;
  busy?: () => boolean;
  testid?: string;
  placeholder?: string;
}): JSX.Element {
  const moveSelection = (dir: 1 | -1): void => {
    const list = props.candidates();
    if (list.length === 0) return;
    const cur = props.selected();
    const idx = list.findIndex((t) => t.id === cur);
    if (idx === -1) {
      const next = dir === 1 ? list[0]! : list[list.length - 1]!;
      props.setSelected(next.id);
      return;
    }
    const nextIdx = (idx + dir + list.length) % list.length;
    props.setSelected(list[nextIdx]!.id);
  };

  return (
    <div class="relative">
      <span
        aria-hidden="true"
        class="absolute left-2 top-1/2 -translate-y-1/2"
        style={{
          "font-family": "var(--font-mono)",
          "font-size": "0.7rem",
          color: "var(--color-fg-subtle)",
          "letter-spacing": "0.05em",
        }}
      >
        ▸
      </span>
      <input
        type="text"
        value={props.query()}
        placeholder={props.placeholder ?? "filter by name…"}
        onInput={(e) => props.setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            moveSelection(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            moveSelection(-1);
          } else if (e.key === "Enter" && props.selected()) {
            e.preventDefault();
            if (!props.busy?.() && props.onCommit) props.onCommit();
          } else if (e.key === "Escape") {
            props.setQuery("");
          }
        }}
        class="w-full rounded-(--radius-control) outline-none transition-colors"
        style={{
          "padding-left": "1.6rem",
          "padding-right": props.query().length > 0 ? "1.8rem" : "0.55rem",
          "padding-top": "0.4rem",
          "padding-bottom": "0.4rem",
          "background-color": "var(--color-surface-sunken, var(--color-surface))",
          border: "1px solid var(--color-border-muted)",
          "font-family": "var(--font-display)",
          "font-size": "0.85rem",
          color: "var(--color-fg)",
        }}
        onFocus={(e) => {
          (e.currentTarget as HTMLInputElement).style.borderColor = "var(--color-accent)";
        }}
        onBlur={(e) => {
          (e.currentTarget as HTMLInputElement).style.borderColor = "var(--color-border-muted)";
        }}
        data-testid={props.testid ?? "monsters-search"}
        autocomplete="off"
        spellcheck={false}
        name="monsters-search"
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
        disabled={props.busy?.() ?? false}
      />
      <Show when={props.query().length > 0}>
        <button
          type="button"
          onClick={() => props.setQuery("")}
          aria-label="clear filter"
          class="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm px-1.5 py-0.5 hover:opacity-100 transition-opacity"
          style={{
            "font-family": "var(--font-mono)",
            "font-size": "0.7rem",
            color: "var(--color-fg-subtle)",
            opacity: "0.6",
          }}
        >
          ×
        </button>
      </Show>
    </div>
  );
}
