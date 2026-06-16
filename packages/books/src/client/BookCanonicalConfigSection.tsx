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
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { createMemo, For, Show, type JSX } from "solid-js";
import { SetBookCanonical } from "../shared/commands.js";
import { BookCanonical, CanonicalBookCatalog } from "../shared/traits.js";
import { type BookConfigSection, type BookConfigSectionRenderArgs } from "../shared/slot.js";
import { useMe } from "./use-me.js";

/**
 * "What rulebook is this?" picker. GM-only. Lets the GM declare that
 * this Book entity is the canonical Scholar's Guide / Loremaster's
 * Manual / etc., so plugin content with deep-link citations resolves
 * to the GM's actual uploaded PDF.
 *
 * The dropdown's options come from CanonicalBookCatalog sentinels
 * (one per registering plugin); options already claimed by another
 * Book in this world are disabled. The currently-bound id appears as
 * the selected option (and stays selectable so re-selecting it is a
 * no-op rather than appearing missing). When no plugin has registered
 * any canonical books, the section is omitted.
 *
 * Higher priority than PdfConfigSection so it sorts above the PDF
 * upload — "what is this book?" is more contextual than "what bytes
 * are loaded?".
 */
export const BookCanonicalConfigSection: BookConfigSection = {
  id: qualifiedName("@vtt/books/config-canonical"),
  priority: 90,
  render: (args: BookConfigSectionRenderArgs): JSX.Element => {
    return <BookCanonicalConfigBody bookId={args.bookId} />;
  },
};

function BookCanonicalConfigBody(props: { bookId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const isGm = () => me()?.role === "gm";

  const catalogRows = useQuery([CanonicalBookCatalog]);
  const claimedRows = useQuery([BookCanonical]);
  const myBinding = useTrait(props.bookId, BookCanonical);

  const allEntries = createMemo(() => {
    const out: Array<{ id: string; name: string; pluginName: string }> = [];
    for (const row of catalogRows()) {
      const v = row.values.CanonicalBookCatalog as {
        pluginName: string;
        entries: ReadonlyArray<{ id: string; name: string }>;
      };
      for (const e of v.entries) {
        out.push({ id: e.id, name: e.name, pluginName: v.pluginName });
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  });

  /** Map canonicalId → bookId of *some other* Book that already claims it. */
  const claimedByOther = createMemo(() => {
    const out = new Map<string, string>();
    for (const row of claimedRows()) {
      if (row.id === props.bookId) continue;
      const v = row.values.BookCanonical as { canonicalId: string };
      out.set(v.canonicalId, row.id);
    }
    return out;
  });

  const currentId = () => myBinding()?.canonicalId ?? "";

  const onSelect = (raw: string) => {
    const next = raw === "" ? null : raw;
    client.dispatch(
      SetBookCanonical({
        bookId: props.bookId as EntityId,
        canonicalId: next,
      }) as CommandInstance,
    );
  };

  return (
    <Show when={allEntries().length > 0}>
      <label class="flex flex-col gap-2">
        <span class="font-display text-[0.6rem] uppercase tracking-[0.2em] text-fg-subtle">
          Rulebook
        </span>
        <select
          aria-label="canonical rulebook"
          disabled={!isGm()}
          value={currentId()}
          onChange={(e) => onSelect(e.currentTarget.value)}
          class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 font-display text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">(none — generic book)</option>
          <For each={allEntries()}>
            {(e) => {
              const claimedElsewhere = () => claimedByOther().has(e.id);
              return (
                <option value={e.id} disabled={claimedElsewhere()}>
                  {claimedElsewhere() ? `${e.name} (already bound)` : e.name}
                </option>
              );
            }}
          </For>
        </select>
        <p class="text-[0.7rem] text-fg-subtle">
          Plugin content (e.g. monster stat blocks) deep-links into this PDF when the canonical role
          is set.
        </p>
      </label>
    </Show>
  );
}
