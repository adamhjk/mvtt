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

import {
  qualifiedName,
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import { useClient, useQuery } from "@vtt/substrate/client";
import { FocusTab, OpenPageInNewTab } from "@vtt/shell-workbench/shared";
import { useWorkspace } from "@vtt/shell-workbench/client";
import { type Accessor, createMemo, Show, type JSX } from "solid-js";
import { BookCanonical } from "../shared/traits.js";
import { publishBookNav } from "../shared/pending-nav.js";

const BOOKS_PAGE_KIND = qualifiedName("@vtt/books/books");

/**
 * Reactive lookup: returns the EntityId of the Book currently bound to
 * `canonicalId`, or `null` if no Book in this world holds the role.
 *
 * Subscribes to `BookCanonical` queries so consumers re-render the
 * moment the GM (un)binds a rulebook in the Config tab. Worlds have
 * a small number of Book entities, so the linear scan is cheap; if it
 * ever isn't, materialize a sentinel index and read from it here
 * instead — the hook signature stays the same.
 */
export function useCanonicalBook(
  canonicalId: string | Accessor<string>,
): Accessor<EntityId | null> {
  const rows = useQuery([BookCanonical]);
  return createMemo(() => {
    const target = typeof canonicalId === "function" ? canonicalId() : canonicalId;
    for (const row of rows()) {
      const v = row.values.BookCanonical as { canonicalId: string };
      if (v.canonicalId === target) return row.id as EntityId;
    }
    return null;
  });
}

/**
 * Inline citation for plugin content. Click navigates a bound Book to
 * the cited page and focuses the resulting tab so the GM can read the
 * rule immediately:
 *
 *   - If a tab is already open for this Book in any pane, the page
 *     hint is published through `pendingBookNav` so the existing
 *     projection view jumps to the cited page in place, and a
 *     `FocusTab` command makes that tab + its pane active. The
 *     citation-source tab is preserved (still in `pane.tabIds`) so
 *     the reader can flip back; only the active-tab focus shifts.
 *   - If no tab is open for this Book, a *new* tab is added to the
 *     active pane (`OpenPageInNewTab`, which sets the new tab as
 *     active in the pane). The page hint follows so the freshly-
 *     mounted projection lands on the cited page.
 *
 * The blanket "find-or-create dedup" behaviour of `OpenPage` is
 * avoided in favour of `FocusTab` for the existing-tab case. The
 * difference matters when the existing book tab is in a *different*
 * pane than the citation: `FocusTab` shifts pane focus to that
 * existing pane, leaving the citation-source pane's other tabs
 * untouched (`OpenPage` would do the same here, so the practical
 * delta lives in clearer intent — the citation's job is "go look at
 * the book," not "ensure-tab-exists").
 *
 * When the canonicalId isn't bound to any Book in the current world,
 * the component renders the label as plain text — no link, no
 * disabled-button affordance — so a player who has no PDF still sees
 * "LMM p.261" in their stat block UI and can ask the GM about it.
 *
 * `label` is what the user sees. Default is `"p.<page>"`. Callers
 * usually want a richer label like "LMM p.261" with the book
 * abbreviation for context.
 */
export function BookCitation(props: {
  canonicalId: string;
  page: number;
  label?: string;
  /** Optional aria-label override for screen-readers. */
  ariaLabel?: string;
  /** Pass-through className for callers that want their own styling. */
  className?: string;
}): JSX.Element {
  const client = useClient();
  const bookId = useCanonicalBook(() => props.canonicalId);
  const workspace = useWorkspace();

  const text = () => props.label ?? `p.${props.page}`;
  const aria = () =>
    props.ariaLabel ?? `open ${props.canonicalId} at page ${props.page}`;

  /**
   * Find an existing tab targeting this Book. Walks `state.tabs` (a
   * flat record) and `state.panes` (also flat) to recover the
   * containing `paneId` so we can dispatch `FocusTab`. Cheap: a
   * workspace has a handful of tabs and panes.
   */
  const findExistingBookTab = (
    id: EntityId,
  ): { paneId: string; tabId: string } | null => {
    const ws = workspace.state();
    if (!ws) return null;
    for (const tab of Object.values(ws.tabs)) {
      if (tab.pageKind !== BOOKS_PAGE_KIND || tab.entityId !== id) continue;
      for (const pane of Object.values(ws.panes)) {
        if (pane.tabIds.includes(tab.id)) {
          return { paneId: pane.paneId, tabId: tab.id };
        }
      }
    }
    return null;
  };

  const open = () => {
    const id = bookId();
    if (id === null) return;
    // Order matters: publish the page hint *before* dispatching any
    // tab command so the projection view (mounted fresh by
    // OpenPageInNewTab or already on screen for an existing tab)
    // picks the signal up in its own createEffect when its renderer
    // is ready.
    publishBookNav({ bookId: id, page: props.page });
    const existing = findExistingBookTab(id);
    if (existing) {
      // Flip focus to the existing book tab — both within its pane
      // and at the workspace level. The `pendingBookNav` signal that
      // just fired will be consumed by the projection's effect once
      // the tab gains focus and renders.
      client.dispatch(
        FocusTab({
          paneId: existing.paneId,
          tabId: existing.tabId,
        }) as CommandInstance,
      );
      return;
    }
    client.dispatch(
      OpenPageInNewTab({
        pageKind: BOOKS_PAGE_KIND,
        entityId: id,
      }) as CommandInstance,
    );
  };

  return (
    <Show
      when={bookId() !== null}
      fallback={
        <span
          class={
            props.className ??
            "font-display text-[0.65rem] uppercase tracking-[0.18em] text-fg-subtle"
          }
          data-canonical-id={props.canonicalId}
          data-canonical-page={props.page}
          data-canonical-bound="false"
        >
          {text()}
        </span>
      }
    >
      <button
        type="button"
        onClick={open}
        aria-label={aria()}
        data-canonical-id={props.canonicalId}
        data-canonical-page={props.page}
        data-canonical-bound="true"
        class={
          props.className ??
          "inline-flex items-center gap-1 rounded-(--radius-control) border border-border bg-surface-sunken px-1.5 py-0.5 font-display text-[0.65rem] uppercase tracking-[0.18em] text-fg-muted hover:bg-surface hover:text-accent transition"
        }
      >
        <span aria-hidden="true">↗</span>
        {text()}
      </button>
    </Show>
  );
}
