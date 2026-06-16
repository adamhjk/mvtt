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

import { qualifiedName, type EntityId } from "@vtt/substrate";
import { useQuery } from "@vtt/substrate/client";
import { useFollowLink } from "@vtt/shell-workbench/client";
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
 * Inline citation for plugin content. Click navigates the workbench
 * to the bound Book at the cited page using the standard wikilink
 * verb (`useFollowLink`):
 *
 *   - plain click  → smart retarget. Focus an exact-match Book tab
 *                    if one's open, else flip the best same-kind
 *                    (Books) tab in another pane to this book, else
 *                    open new in the active pane.
 *   - Cmd/Ctrl     → force new tab in the active pane.
 *   - Shift        → force new split (book lands beside the source).
 *
 * The page hint is published through `pendingBookNav` *before* the
 * dispatch so the projection view (whether mounted fresh or
 * already on screen) consumes the signal in its own createEffect when
 * its renderer is ready.
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
  const bookId = useCanonicalBook(() => props.canonicalId);
  const follow = useFollowLink();

  const text = () => props.label ?? `p.${props.page}`;
  const aria = () => props.ariaLabel ?? `open ${props.canonicalId} at page ${props.page}`;

  const open = (e: MouseEvent) => {
    const id: EntityId | null = bookId();
    if (id === null) return;
    // Order matters: publish the page hint *before* dispatching any
    // tab command so the projection view (mounted fresh by a new
    // tab/split, retargeted in place, or already on screen) picks
    // the signal up in its own createEffect when its renderer is
    // ready.
    publishBookNav({ bookId: id, page: props.page });
    follow({ pageKind: BOOKS_PAGE_KIND, entityId: id }, e);
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
