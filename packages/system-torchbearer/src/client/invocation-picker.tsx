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

// Fuzzy-search picker for invocations. Mirrors `SpellPicker`.

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
  InvocationCatalogIndex,
  InvocationIdentity,
  type InvocationCircle,
  type InvocationTradition,
} from "../shared/invocations/invocation-traits.js";
import { tbCanonicalBookAbbreviation } from "../data/seed.js";
import { fuzzyMatch } from "./monsters-picker.js";
import { CircleDots } from "./spell-picker.js";

export interface InvocationCandidate {
  readonly id: string;
  readonly name: string;
  readonly circle: InvocationCircle;
  readonly traditions: ReadonlyArray<InvocationTradition>;
  readonly pageRef: { canonicalId: string; page: number } | null;
}

/**
 * Hook that resolves the catalog invocation entities present in the
 * world into a stable list of `InvocationCandidate`. Reactive on
 * `InvocationCatalogIndex` changes (new seed) and on per-invocation
 * `InvocationIdentity` writes.
 */
export function useInvocationCatalog(): () => ReadonlyArray<InvocationCandidate> {
  const indexRows = useQuery([InvocationCatalogIndex]);
  const identityRows = useQuery([InvocationIdentity]);
  return createMemo(() => {
    const indexedIds = new Set<string>();
    for (const row of indexRows()) {
      const v = row.values.InvocationCatalogIndex as {
        entries: Record<string, string>;
      };
      for (const id of Object.values(v.entries)) indexedIds.add(id);
    }
    const out: InvocationCandidate[] = [];
    for (const row of identityRows()) {
      if (!indexedIds.has(row.id)) continue;
      const ident = row.values.InvocationIdentity as {
        name: string;
        circle: InvocationCircle;
        traditions: ReadonlyArray<InvocationTradition>;
        pageRef: { canonicalId: string; page: number } | null;
      };
      out.push({
        id: row.id,
        name: ident.name,
        circle: ident.circle,
        traditions: ident.traditions,
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

export function filterInvocationsByQuery(
  invocations: ReadonlyArray<InvocationCandidate>,
  query: string,
): ReadonlyArray<InvocationCandidate> {
  const q = query.trim();
  if (q.length === 0) return invocations;
  return invocations.filter((s) => fuzzyMatch(s.name, q));
}

export function InvocationPicker(props: {
  candidates?: () => ReadonlyArray<InvocationCandidate>;
  selected: () => string | null;
  setSelected: (id: string | null) => void;
  placeholder?: string;
  excludeIds?: () => ReadonlySet<string>;
  onActivate?: (id: string) => void;
  testid?: string;
}): JSX.Element {
  const catalog = useInvocationCatalog();
  const [query, setQuery] = createSignal("");
  const candidates = createMemo(() => {
    const all = props.candidates ? props.candidates() : catalog();
    const exclude = props.excludeIds ? props.excludeIds() : new Set<string>();
    const filtered = all.filter((s) => !exclude.has(s.id));
    return filterInvocationsByQuery(filtered, query());
  });

  return (
    <div
      data-testid={props.testid ?? "invocation-picker"}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.4rem",
      }}
    >
      <input
        type="text"
        value={query()}
        placeholder={props.placeholder ?? "Search invocations…"}
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
                data-testid={`invocation-option-${s.id}`}
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
                <span style={{ "font-weight": "500", "min-width": "12rem" }}>
                  {s.name}
                </span>
                <CircleDots circle={s.circle} />
                <span
                  style={{
                    color: "var(--color-fg-muted)",
                    "font-size": "0.7rem",
                    "font-variant": "small-caps",
                  }}
                >
                  {s.traditions.join("/")}
                </span>
                <span
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
