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

import { type CommandInstance, type EntityId, qualifiedName } from "@vtt/substrate";
import { useClient, useTrait, useQuery } from "@vtt/substrate/client";
import { definePageProvider, OpenPage } from "@vtt/shell-workbench/shared";
import { Asset } from "@vtt/assets/shared";
import { Identity, Online } from "@vtt/identity/shared";
import { Book, publishBookNav } from "@vtt/books/shared";
import { PdfDocument } from "@vtt/pdf-book/shared";
import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js";
import {
  clearRulesQuery,
  IndexRules,
  pendingRulesQuery,
  publishRulesQuery,
  RemoveRulesCorpus,
  RulesCorpus,
} from "../shared/index.js";

const KIND = qualifiedName("@vtt/rules-corpus/rules");
const BOOKS_PAGE_KIND = qualifiedName("@vtt/books/books");

interface SearchHit {
  corpusId: string;
  chunkId: string;
  pdfPage: number;
  pdfPageEnd: number | null;
  printedPage: string | number | null;
  printedPageEnd: string | number | null;
  headingPath: string[];
  snippet: string;
}

/**
 * Page provider for the Rules workbench page. The default (entityId-
 * less) view is a single cross-corpus search box — searching one
 * rulebook at a time forces the user to know which book holds which
 * rule, which defeats the point. Per-corpus admin (status, Remove) is
 * still reachable by selecting a specific corpus from the rail.
 */
export const RulesPageProvider = definePageProvider({
  kind: KIND,
  icon: "book-open-text",
  label: "Rules",
  // Book + PdfDocument are read so the rail label reactively follows
  // the GM-set Book name (which is what users actually recognise) and
  // refreshes if a Book gets renamed or its PDF rebound.
  reads: [RulesCorpus, Book, PdfDocument],
  list: ({ world }) => {
    // Build asset → bookName index once per `list` call. Cheap; this
    // runs only when one of the `reads` traits changes.
    const bookNameByAsset = new Map<string, string>();
    for (const row of world.query([Book, PdfDocument])) {
      const name = (row.values.Book as { name: string }).name;
      const assetId = (row.values.PdfDocument as { assetId: string }).assetId;
      bookNameByAsset.set(assetId, name);
    }
    return world.query([RulesCorpus]).map((row) => {
      const c = row.values.RulesCorpus as {
        assetId: string;
        title: string | null;
        status: string;
        tags: string[];
      };
      // Prefer the GM-set Book name (the in-game label users see in
      // the Books rail and chat); fall back to the corpus title (PDF
      // metadata / filename) only when no Book is bound. The corpus
      // title is sometimes the bare entity-id stub like "e3" when
      // the asset has no embedded PDF metadata, which is meaningless
      // in the rail.
      const label = bookNameByAsset.get(c.assetId) ?? c.title ?? "(untitled corpus)";
      return {
        id: row.id,
        label,
        hint: c.status === "ready" ? c.tags.join(",") : c.status,
      };
    });
  },
  defaultEntity: () => null,
  render: ({ entityId }) => {
    if (!entityId) {
      return <RulesSearchAllView />;
    }
    return <RulesCorpusView corpusId={entityId} />;
  },
  // Lets users invoke `rules: <query>` from the command palette to
  // open the cross-corpus search view with the query pre-filled and
  // executed. The palette parses the prefix and calls
  // `publishPaletteQuery(rest)` immediately before dispatching
  // OpenPage; `RulesSearchAllView` consumes via `pendingRulesQuery`.
  palettePrefix: "rules",
  publishPaletteQuery: publishRulesQuery,
});

/**
 * Resolves the current connection's role by matching `Online.clientId`
 * to `client.clientId()`. Mirrors the pattern in pdf-book/use-me.
 */
function useMyRole() {
  const client = useClient();
  const players = useQuery([Identity, Online]);
  return createMemo(() => {
    const list = players();
    const cid = client.clientId();
    if (!cid) return null;
    const found = list.find((p) => (p.values.Online as { clientId: string }).clientId === cid);
    if (!found) return null;
    const id = found.values.Identity as { role: string };
    return id.role;
  });
}

/**
 * GM-only helper: lists application/pdf assets that *aren't* already
 * indexed and offers a one-click "Index" button per asset. Awaits the
 * dispatch ack so we can surface validator failures as visible errors
 * (otherwise rejection is silent and the GM thinks nothing happened).
 */
function RulesIndexHelper(): JSX.Element {
  const client = useClient();
  const role = useMyRole();
  const isGm = () => role() === "gm";
  const assets = useQuery([Asset]);
  const corpora = useQuery([RulesCorpus]);
  const [busyAssetId, setBusyAssetId] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const indexedAssetIds = createMemo(() => {
    const set = new Set<string>();
    for (const row of corpora()) {
      const c = row.values.RulesCorpus as { assetId: string };
      set.add(c.assetId);
    }
    return set;
  });
  const candidatePdfs = createMemo(() =>
    assets()
      .filter((row) => {
        const a = row.values.Asset as { mime: string };
        return a.mime === "application/pdf" && !indexedAssetIds().has(row.id);
      })
      .map((row) => ({
        assetId: row.id,
        filename: (row.values.Asset as { filename: string | null }).filename,
      })),
  );
  const onIndex = async (assetId: EntityId) => {
    setError(null);
    setBusyAssetId(assetId);
    try {
      const handle = client.dispatch(IndexRules({ assetId, tags: [] }) as CommandInstance);
      const ack = await handle.ack;
      if (!ack.ok) {
        setError(ack.reason ?? "dispatch rejected");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyAssetId(null);
    }
  };
  return (
    <div class="mt-2 flex w-full max-w-md flex-col gap-1.5">
      <Show when={!isGm()}>
        <p class="rounded-(--radius-control) border border-border bg-surface-sunken px-3 py-2 text-left text-xs text-fg-muted">
          Only the GM may index rulebooks. (You're seeing this page because the rules library is
          world-readable.)
        </p>
      </Show>
      <Show when={isGm() && candidatePdfs().length === 0}>
        <p class="rounded-(--radius-control) border border-border bg-surface-sunken px-3 py-2 text-left text-xs text-fg-muted">
          No unindexed application/pdf assets in this world. Upload a PDF on the Assets page first.
        </p>
      </Show>
      <Show when={isGm() && candidatePdfs().length > 0}>
        <p class="font-display text-[0.6rem] uppercase tracking-[0.18em] text-fg-subtle">
          unindexed PDF assets
        </p>
        <For each={candidatePdfs()}>
          {(c) => (
            <button
              type="button"
              onClick={() => void onIndex(c.assetId as EntityId)}
              disabled={busyAssetId() !== null}
              class="rounded-(--radius-control) border border-border bg-surface px-3 py-1.5 text-left text-xs hover:bg-surface-hover disabled:opacity-50"
            >
              <span class="font-mono">{c.filename ?? c.assetId}</span>{" "}
              <span class="text-fg-subtle">
                {busyAssetId() === c.assetId ? "→ Dispatching…" : "→ Index"}
              </span>
            </button>
          )}
        </For>
      </Show>
      <Show when={error()}>
        <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-3 py-2 text-left text-xs text-danger">
          {error()}
        </p>
      </Show>
    </div>
  );
}

/**
 * Default view: single search across every ready corpus in the world.
 * Each hit card is a button that opens the underlying PDF in a Books
 * tab at `pdfPage` — provided some Book entity is bound to the hit's
 * asset via `PdfDocument`. If no Book exists for the asset the card
 * falls back to a non-clickable read-only hit (no auto-create — that's
 * a deliberate GM gesture in the Books page).
 */
function RulesSearchAllView(): JSX.Element {
  const client = useClient();
  const corpora = useQuery([RulesCorpus]);
  const [query, setQuery] = createSignal("");
  const [hits, setHits] = createSignal<SearchHit[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const readyCount = createMemo(() => {
    let n = 0;
    for (const row of corpora()) {
      const c = row.values.RulesCorpus as { status: string };
      if (c.status === "ready") n += 1;
    }
    return n;
  });
  const runSearch = async (raw: string): Promise<void> => {
    setError(null);
    const q = raw.trim();
    if (q.length === 0) {
      setHits([]);
      return;
    }
    const worldId = client.worldId();
    if (!worldId) {
      setError("not connected");
      return;
    }
    setBusy(true);
    try {
      const url =
        `/api/worlds/${encodeURIComponent(worldId)}/rules/search` +
        `?q=${encodeURIComponent(q)}` +
        `&limit=25`;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `search failed (${res.status})`);
      }
      const body = (await res.json()) as { hits: SearchHit[] };
      setHits(body.hits);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onSearch = (e: Event) => {
    e.preventDefault();
    void runSearch(query());
  };
  // Consume palette-published `rules: <query>` invocations. Bumping
  // the nonce on each publish guarantees re-running the same query
  // re-fires the search; the clear is nonce-guarded so a stale clear
  // can't blow away a fresh one (rapid double-invoke).
  createEffect(() => {
    const pending = pendingRulesQuery();
    if (!pending) return;
    const { query: q, nonce } = pending;
    setQuery(q);
    void runSearch(q);
    clearRulesQuery(nonce);
  });
  return (
    <div class="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <header class="flex items-baseline gap-3">
        <h2 class="font-display text-lg">Rules search</h2>
        <span class="font-display text-[0.65rem] uppercase tracking-[0.18em] text-fg-subtle">
          {readyCount()} indexed corpora
        </span>
      </header>
      <Show when={readyCount() === 0}>
        <div class="flex flex-col items-center gap-4 rounded-(--radius-control) border border-border bg-surface-sunken p-6 text-center">
          <p class="font-display text-sm uppercase tracking-[0.18em] text-fg-subtle">
            No rules corpora yet
          </p>
          <p class="max-w-md text-sm text-fg-muted">
            Upload a rulebook PDF via the Assets page, then click "Index" below. Extraction runs in
            a subprocess (30s–a few minutes) and the result becomes searchable here.
          </p>
          <RulesIndexHelper />
        </div>
      </Show>
      <Show when={readyCount() > 0}>
        <form onSubmit={onSearch} class="flex gap-2">
          <input
            type="text"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="search every indexed rulebook…"
            autocomplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
            spellcheck={false}
            class="flex-1 rounded-(--radius-control) border border-border bg-surface px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={busy()}
            class="rounded-(--radius-control) bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
          >
            {busy() ? "…" : "Search"}
          </button>
        </form>
        <Show when={error()}>
          <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error()}
          </p>
        </Show>
        <Show when={hits().length > 0}>
          <ol class="flex flex-col gap-3">
            <For each={hits()}>{(hit) => <SearchHitCard hit={hit} showCorpus />}</For>
          </ol>
        </Show>
        <details class="rounded-(--radius-control) border border-border bg-surface-sunken px-3 py-2 text-xs">
          <summary class="cursor-pointer font-display uppercase tracking-[0.15em] text-fg-subtle">
            Index another PDF
          </summary>
          <div class="mt-2">
            <RulesIndexHelper />
          </div>
        </details>
      </Show>
    </div>
  );
}

/**
 * Per-corpus admin: status, page count, errors, Remove. Search itself
 * is always cross-corpus (see `RulesSearchAllView`) — scoping a search
 * to one rulebook forces the user to know which book holds which
 * rule, defeating the point of having an index. This view is reached
 * from the rail when the GM wants to manage a specific corpus.
 */
function RulesCorpusView(props: { corpusId: string }): JSX.Element {
  const client = useClient();
  const corpus = useTrait(props.corpusId, RulesCorpus);
  const books = useQuery([Book]);
  const pdfDocs = useQuery([PdfDocument]);
  const role = useMyRole();
  const isGm = () => role() === "gm";
  // Same lookup the search hit cards use — the Book's GM-set name is
  // the label users recognise. Fall back to the corpus title only when
  // no Book is bound to this corpus's asset.
  const bookName = createMemo(() => {
    const c = corpus();
    if (!c) return null;
    const id = findBookIdForAsset(books, pdfDocs, c.assetId);
    if (!id) return null;
    const row = books().find((r) => r.id === id);
    if (!row) return null;
    return (row.values.Book as { name: string }).name;
  });
  const headerLabel = () => bookName() ?? corpus()?.title ?? "(untitled)";

  const [query, setQuery] = createSignal("");
  const [hits, setHits] = createSignal<SearchHit[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const onRemove = () => {
    if (!confirm("Remove this corpus? Chunks and images on disk will be deleted.")) return;
    client.dispatch(RemoveRulesCorpus({ corpusId: props.corpusId as EntityId }) as CommandInstance);
  };

  const onSearch = async (e: Event) => {
    e.preventDefault();
    setError(null);
    const q = query().trim();
    if (q.length === 0) {
      setHits([]);
      return;
    }
    const worldId = client.worldId();
    if (!worldId) {
      setError("not connected");
      return;
    }
    setBusy(true);
    try {
      // `corpusId` query param scopes the search to this rulebook
      // only — same route as the cross-corpus path, the server picks
      // the single-corpus FTS5 query when the param is present.
      const url =
        `/api/worlds/${encodeURIComponent(worldId)}/rules/search` +
        `?q=${encodeURIComponent(q)}` +
        `&corpusId=${encodeURIComponent(props.corpusId)}` +
        `&limit=25`;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `search failed (${res.status})`);
      }
      const body = (await res.json()) as { hits: SearchHit[] };
      setHits(body.hits);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <header class="flex items-baseline gap-3">
        <h2 class="font-display text-lg">{headerLabel()}</h2>
        <span class="font-display text-[0.65rem] uppercase tracking-[0.18em] text-fg-subtle">
          status: {corpus()?.status ?? "unknown"}
          <Show when={corpus()?.pageCount}> · {corpus()!.pageCount} pages</Show>
        </span>
        <Show when={isGm()}>
          <button
            type="button"
            onClick={onRemove}
            class="ml-auto rounded-(--radius-control) border border-danger/40 px-2 py-1 text-[0.7rem] text-danger hover:bg-danger/10"
          >
            Remove
          </button>
        </Show>
      </header>

      <Show when={corpus()?.status === "failed"}>
        <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          extraction failed: {corpus()?.error ?? "unknown error"}
        </p>
      </Show>
      <Show when={corpus()?.status === "pending" || corpus()?.status === "indexing"}>
        <p class="rounded-(--radius-control) border border-border bg-surface-sunken px-3 py-2 text-xs text-fg-muted">
          extraction in progress…
        </p>
      </Show>

      <Show when={corpus()?.status === "ready"}>
        <form onSubmit={onSearch} class="flex gap-2">
          <input
            type="text"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder={`search ${headerLabel()}…`}
            autocomplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
            spellcheck={false}
            class="flex-1 rounded-(--radius-control) border border-border bg-surface px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={busy()}
            class="rounded-(--radius-control) bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
          >
            {busy() ? "…" : "Search"}
          </button>
        </form>

        <Show when={error()}>
          <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error()}
          </p>
        </Show>

        <Show when={hits().length > 0}>
          <ol class="flex flex-col gap-3">
            <For each={hits()}>{(hit) => <SearchHitCard hit={hit} />}</For>
          </ol>
        </Show>
      </Show>

      <Show when={isGm()}>
        <details class="rounded-(--radius-control) border border-border bg-surface-sunken px-3 py-2 text-xs">
          <summary class="cursor-pointer font-display uppercase tracking-[0.15em] text-fg-subtle">
            Index another PDF
          </summary>
          <div class="mt-2">
            <RulesIndexHelper />
          </div>
        </details>
      </Show>
    </div>
  );
}

/**
 * Find the Book entity bound to `assetId` via `PdfDocument`. Returns
 * the bookId, or null if no Book wraps this asset yet — meaning the
 * GM hasn't created one + bound the PDF on the Books page. We don't
 * auto-create here: binding a Book is a deliberate GM gesture that
 * also picks the in-game name, default visibility, etc.
 */
function findBookIdForAsset(
  books: ReturnType<typeof useQuery>,
  pdfDocs: ReturnType<typeof useQuery>,
  assetId: string,
): string | null {
  const bookIds = new Set(books().map((row) => row.id));
  for (const row of pdfDocs()) {
    const v = row.values.PdfDocument as { assetId: string };
    if (v.assetId === assetId && bookIds.has(row.id)) return row.id;
  }
  return null;
}

function SearchHitCard(props: { hit: SearchHit; showCorpus?: boolean }): JSX.Element {
  const client = useClient();
  const corpus = useTrait(props.hit.corpusId, RulesCorpus);
  const books = useQuery([Book]);
  const pdfDocs = useQuery([PdfDocument]);
  const bookId = createMemo(() => {
    const c = corpus();
    if (!c) return null;
    return findBookIdForAsset(books, pdfDocs, c.assetId);
  });
  const heading = () => props.hit.headingPath.join(" → ") || "(unnamed)";
  const printed = () => {
    const p = props.hit.printedPage;
    if (p === null || p === undefined) return "p.?";
    const end = props.hit.printedPageEnd;
    return end !== null && end !== undefined ? `p.${p}–${end}` : `p.${p}`;
  };
  const bookName = createMemo(() => {
    const id = bookId();
    if (!id) return null;
    const row = books().find((r) => r.id === id);
    if (!row) return null;
    return (row.values.Book as { name: string }).name;
  });
  // Display name for the source: prefer the Book entity's GM-set name
  // (the in-game label users will recognise), fall back to the corpus
  // title (PDF metadata / filename) only when no Book is bound. The
  // raw corpus title can be the entity-id stub like "e3" when the PDF
  // has no metadata, which is meaningless to a player.
  const sourceLabel = () => bookName() ?? corpus()?.title ?? "(untitled)";
  const onOpen = () => {
    const id = bookId();
    if (!id) return;
    // Publish the page hint *before* dispatching OpenPage so the
    // freshly-mounted (or focused) PdfReader sees the pending nav as
    // soon as its doc is ready. Same pattern as the wiki-link kind.
    publishBookNav({ bookId: id as EntityId, page: props.hit.pdfPage });
    client.dispatch(
      OpenPage({
        pageKind: BOOKS_PAGE_KIND,
        entityId: id as EntityId,
      }) as CommandInstance,
    );
  };
  const titleLine = () => (
    <Show when={props.showCorpus}>
      <p class="font-display text-sm text-fg">{sourceLabel()}</p>
    </Show>
  );
  const subLine = () => (
    <p class="font-display text-xs uppercase tracking-[0.15em] text-fg-subtle">
      {heading()} · printed {printed()} · PDF p.{props.hit.pdfPage}
    </p>
  );
  const body = () => (
    <div
      class="mt-2 text-sm text-fg leading-relaxed"
      // FTS5 returns HTML-marked snippets with <mark> tags; safe because
      // the source is server-controlled FTS5 output and the server
      // escapes the body on insertion.
      innerHTML={props.hit.snippet}
    />
  );
  return (
    <li>
      <Show
        when={bookId() !== null}
        fallback={
          <div class="rounded-(--radius-control) border border-border bg-surface p-3">
            {titleLine()}
            {subLine()}
            {body()}
            <p class="mt-2 text-[0.65rem] uppercase tracking-[0.15em] text-fg-subtle">
              No Book bound for this PDF — open the Books page to wire one up.
            </p>
          </div>
        }
      >
        <button
          type="button"
          onClick={onOpen}
          class="block w-full rounded-(--radius-control) border border-border bg-surface p-3 text-left transition hover:border-accent/60 hover:bg-surface-hover"
        >
          {titleLine()}
          {subLine()}
          {body()}
          <p class="mt-2 text-[0.65rem] uppercase tracking-[0.15em] text-accent">
            → open in Books at p.{props.hit.pdfPage}
          </p>
        </button>
      </Show>
    </li>
  );
}
