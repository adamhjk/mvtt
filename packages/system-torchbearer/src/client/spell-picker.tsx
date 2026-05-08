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

// Fuzzy-search picker for spells. Mirrors the bestiary picker's
// subsequence-fuzzy approach: every char in the query (in order, not
// necessarily adjacent) must appear in the candidate name. Cheap and
// good enough for a catalog of ~80 spells.

import { useQuery } from "@vtt/substrate/client";
import { BookCitation } from "@vtt/books/client";
import {
  createMemo,
  createSignal,
  For,
  Show,
  type JSX,
} from "solid-js";
import {
  SpellCatalogIndex,
  SpellIdentity,
  type SpellCircle,
  type SpellSchool,
} from "../shared/spells/spell-traits.js";
import { tbCanonicalBookAbbreviation } from "../data/seed.js";
import { fuzzyMatch } from "./bestiary-picker.js";

export interface SpellCandidate {
  readonly id: string;
  readonly name: string;
  readonly circle: SpellCircle;
  readonly school: SpellSchool;
  readonly pageRef: { canonicalId: string; page: number } | null;
}

/**
 * Hook that resolves the catalog spell entities present in the world
 * into a stable list of `SpellCandidate`. Reactive on
 * `SpellCatalogIndex` changes (new seed) and on per-spell
 * `SpellIdentity` writes (a fork-and-edit).
 */
export function useSpellCatalog(): () => ReadonlyArray<SpellCandidate> {
  const indexRows = useQuery([SpellCatalogIndex]);
  const identityRows = useQuery([SpellIdentity]);
  return createMemo(() => {
    const indexedIds = new Set<string>();
    for (const row of indexRows()) {
      const v = row.values.SpellCatalogIndex as { entries: Record<string, string> };
      for (const id of Object.values(v.entries)) indexedIds.add(id);
    }
    const out: SpellCandidate[] = [];
    for (const row of identityRows()) {
      if (!indexedIds.has(row.id)) continue;
      const ident = row.values.SpellIdentity as {
        name: string;
        circle: SpellCircle;
        school: SpellSchool;
        pageRef: { canonicalId: string; page: number } | null;
      };
      out.push({
        id: row.id,
        name: ident.name,
        circle: ident.circle,
        school: ident.school,
        pageRef: ident.pageRef,
      });
    }
    out.sort((a, b) => {
      if (a.circle !== b.circle) return a.circle - b.circle;
      return a.name.localeCompare(b.name);
    });
    return out;
  });
}

/**
 * Filter a list of spells by an arbitrary query. Empty query returns
 * the full list.
 */
export function filterSpellsByQuery(
  spells: ReadonlyArray<SpellCandidate>,
  query: string,
): ReadonlyArray<SpellCandidate> {
  const q = query.trim();
  if (q.length === 0) return spells;
  return spells.filter((s) => fuzzyMatch(s.name, q));
}

/* -------------------------------------------------------------------------
 * <SpellPicker> — single-select fuzzy picker
 * ----------------------------------------------------------------------- */

export function SpellPicker(props: {
  /** Optional override list (e.g. spells in a particular spell book). */
  candidates?: () => ReadonlyArray<SpellCandidate>;
  /** Currently-selected spell id (null = nothing chosen). */
  selected: () => string | null;
  setSelected: (id: string | null) => void;
  /** Optional placeholder text in the search input. */
  placeholder?: string;
  /** Optional id list to exclude (e.g. spells already in the book). */
  excludeIds?: () => ReadonlySet<string>;
  /** Call when the user activates a row (Enter or click). */
  onActivate?: (id: string) => void;
  testid?: string;
}): JSX.Element {
  const catalog = useSpellCatalog();
  const [query, setQuery] = createSignal("");
  const candidates = createMemo(() => {
    const all = props.candidates ? props.candidates() : catalog();
    const exclude = props.excludeIds ? props.excludeIds() : new Set<string>();
    const filtered = all.filter((s) => !exclude.has(s.id));
    return filterSpellsByQuery(filtered, query());
  });

  return (
    <div
      data-testid={props.testid ?? "spell-picker"}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.4rem",
      }}
    >
      <input
        type="text"
        value={query()}
        placeholder={props.placeholder ?? "Search spells…"}
        autocomplete="off"
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
        spellcheck={false}
        onInput={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const first = candidates()[0];
            if (first) {
              props.setSelected(first.id);
              props.onActivate?.(first.id);
            }
          } else if (e.key === "Escape") {
            setQuery("");
          }
        }}
        style={{
          padding: "0.4rem 0.5rem",
          "border-radius": "var(--radius-control)",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-fg)",
          "font-size": "0.85rem",
        }}
      />
      <ul
        role="listbox"
        style={{
          "list-style": "none",
          padding: 0,
          margin: 0,
          display: "flex",
          "flex-direction": "column",
          gap: "0.2rem",
          "max-height": "20rem",
          "overflow-y": "auto",
        }}
      >
        <Show
          when={candidates().length > 0}
          fallback={
            <li
              style={{
                "font-size": "0.8rem",
                color: "var(--color-fg-muted)",
                "font-style": "italic",
                padding: "0.3rem",
              }}
            >
              no matches
            </li>
          }
        >
          <For each={candidates()}>
            {(s) => (
              <li
                role="option"
                aria-selected={props.selected() === s.id}
                data-testid={`spell-option-${s.id}`}
                onClick={() => {
                  props.setSelected(s.id);
                  props.onActivate?.(s.id);
                }}
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "0.5rem",
                  padding: "0.35rem 0.5rem",
                  "border-radius": "var(--radius-control)",
                  background:
                    props.selected() === s.id
                      ? "var(--color-accent-soft)"
                      : "var(--color-surface-elevated)",
                  border:
                    props.selected() === s.id
                      ? "1px solid var(--color-accent)"
                      : "1px solid var(--color-border-muted)",
                  cursor: "pointer",
                  "font-size": "0.8rem",
                }}
              >
                <span style={{ "font-weight": "500", "min-width": "11rem" }}>
                  {s.name}
                </span>
                <CircleDots circle={s.circle} />
                <span style={{ color: "var(--color-fg-muted)" }}>{s.school}</span>
                <span
                  // Clicking the citation chip should open the
                  // rulebook, NOT activate the picker row. Stop the
                  // event from bubbling so the row's onClick doesn't
                  // also fire and pick the spell.
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    "margin-left": "auto",
                    "font-size": "0.7rem",
                    display: "inline-flex",
                  }}
                >
                  <Show
                    when={s.pageRef}
                    fallback={
                      <span style={{ color: "var(--color-fg-muted)" }}>
                        —
                      </span>
                    }
                  >
                    {(ref) => (
                      <BookCitation
                        canonicalId={ref().canonicalId}
                        page={ref().page}
                        label={
                          tbCanonicalBookAbbreviation(ref().canonicalId)
                            ? `${tbCanonicalBookAbbreviation(ref().canonicalId)} p.${ref().page}`
                            : `p.${ref().page}`
                        }
                      />
                    )}
                  </Show>
                </span>
              </li>
            )}
          </For>
        </Show>
      </ul>
    </div>
  );
}

/**
 * Visual circle indicator: 1–5 partial circles drawn with the same
 * dot-style as the kit's DotsField, but always read-only and always
 * the same colour. Pure decoration on top of the textual name.
 */
export function CircleDots(props: { circle: SpellCircle }): JSX.Element {
  return (
    <span
      aria-label={`circle ${props.circle}`}
      title={`Circle ${props.circle}`}
      style={{
        display: "inline-flex",
        gap: "0.1rem",
        "font-size": "0.75rem",
        color: "var(--color-fg-muted)",
        "font-variant-numeric": "tabular-nums",
      }}
    >
      <For each={[1, 2, 3, 4, 5]}>
        {(n) => (
          <span style={{ opacity: n <= props.circle ? 1 : 0.25 }}>●</span>
        )}
      </For>
    </span>
  );
}
