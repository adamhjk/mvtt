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

import { type CommandInstance, type EntityId } from "@vtt/substrate";
import { useClient, useQuery } from "@vtt/substrate/client";
import { canWrite, Permissions } from "@vtt/permissions/shared";
import { definePageProvider, RetargetTab } from "@vtt/shell-workbench/shared";
import { createMemo, createSignal, createResource, For, onMount, Show, type JSX } from "solid-js";
import { Note, Page } from "../shared/traits.js";
import { NotesUiState } from "../shared/ui-state.js";
import { CreateNote, DeleteNote } from "../shared/commands.js";
import { NoteCreated } from "../shared/events.js";
import { NoteView } from "./NoteView.jsx";
import { useMe } from "./use-me.js";

export const NOTES_KIND = "@vtt/notes/notes";

/**
 * The Notes PageProvider — one tab per Note entity. Empty branch is
 * the management hub: list every note + an inline create form. Mirrors
 * the Characters / Scenes pattern for consistency.
 */
export const NotesPageProvider = definePageProvider({
  kind: NOTES_KIND,
  icon: "book-open",
  label: "Notes",
  reads: [Note],
  list: ({ world }) => {
    return world.query([Note]).map((row) => {
      const n = row.values.Note as { title: string };
      return { id: row.id, label: n.title };
    });
  },
  defaultEntity: ({ world }) => {
    const first = world.query([Note])[0];
    return first?.id ?? null;
  },
  render: ({ tabId, entityId }) => {
    return <NotesPage tabId={tabId} entityId={entityId} />;
  },
  // The note's own title is conveyed by the tab label; what's worth
  // surfacing for share is *which sub-page* of the note the sender is on
  // — that's the bit a recipient otherwise wouldn't know to navigate to.
  summarizeTabState: ({ sentinelId, world }) => {
    if (!world.has(sentinelId)) return null;
    const got = world.get(sentinelId, [NotesUiState]) as
      | { UiState: { activePageId: string | null } }
      | undefined;
    const activePageId = got?.UiState.activePageId ?? null;
    if (activePageId == null) return null;
    const page = world.get(activePageId as EntityId, [Page]) as
      | { Page: { title: string } }
      | undefined;
    if (!page) return null;
    return `page “${page.Page.title}”`;
  },
});

function NotesPage(props: { tabId: string; entityId: string | null }): JSX.Element {
  return (
    <Show
      when={props.entityId}
      fallback={
        <section class="flex h-full flex-col gap-3">
          <NotesHub tabId={props.tabId} />
        </section>
      }
    >
      {(idAcc) => <NoteView noteId={idAcc() as EntityId} tabId={props.tabId} />}
    </Show>
  );
}

function NotesHub(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const noteRows = useQuery([Note, Permissions]);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [showExport, setShowExport] = createSignal(false);
  const [showImport, setShowImport] = createSignal(false);

  const notes = createMemo(() =>
    noteRows()
      .map((row) => ({
        id: row.id,
        title: (row.values.Note as { title: string }).title,
        permissions: row.values.Permissions as Parameters<typeof canWrite>[1] | undefined,
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  // FTS search — only fires on non-empty query. Returns null when the
  // input is empty so the UI falls back to the full list.
  const [searchHits] = createResource(
    () => {
      const q = searchQuery().trim();
      const wid = client.worldId();
      if (!q || !wid) return null;
      return { q, wid };
    },
    async (key) => {
      if (!key) return null;
      const url = `/api/worlds/${key.wid}/notes/search?q=${encodeURIComponent(key.q)}`;
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) return null;
        const body = (await res.json()) as {
          hits: Array<{
            noteId: string;
            pageId: string;
            noteTitle: string;
            pageTitle: string;
            snippet: string;
          }>;
        };
        return body.hits;
      } catch {
        return null;
      }
    },
  );

  const canRemove = (n: { permissions?: Parameters<typeof canWrite>[1] }) =>
    canWrite(me(), n.permissions);

  const open = (noteId: string) => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: NOTES_KIND,
        entityId: noteId,
      }) as CommandInstance,
    );
  };

  const remove = (noteId: string, title: string) => {
    if (!window.confirm(`Delete "${title}" and all its pages?`)) return;
    client.dispatch(DeleteNote({ noteId }) as CommandInstance);
  };

  return (
    <div class="flex h-full items-start justify-center overflow-y-auto py-10">
      <div class="flex w-full max-w-lg flex-col gap-6 px-5">
        <Show
          when={notes().length > 0}
          fallback={
            <div class="flex flex-col items-center gap-5 text-center">
              <p
                class="font-display text-2xl tracking-tight text-fg-muted"
                style={{ "font-family": "var(--font-display)" }}
              >
                No notes yet — write the first one, or import an adventure.
              </p>
              <Show
                when={me()}
                fallback={<p class="text-xs text-fg-subtle">sign in to create a note…</p>}
              >
                <CreateNoteForm tabId={props.tabId} />
                <Show when={me()?.role === "gm"}>
                  <button
                    type="button"
                    onClick={() => setShowImport(true)}
                    class="rounded-(--radius-control) border border-border bg-surface px-3 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-fg transition"
                    data-testid="import-adventure-button-empty"
                    title="Import a .advt.zip bundle into this world"
                  >
                    Import adventure…
                  </button>
                </Show>
              </Show>
            </div>
          }
        >
          <header class="flex items-baseline justify-between gap-3">
            <h2
              class="font-display text-xl tracking-tight text-fg"
              style={{ "font-family": "var(--font-display)" }}
            >
              Notes
            </h2>
            <div class="flex items-baseline gap-3">
              <Show when={me()?.role === "gm"}>
                <button
                  type="button"
                  onClick={() => setShowImport(true)}
                  class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition"
                  data-testid="import-adventure-button"
                  title="Import a .advt.zip bundle into this world"
                >
                  Import adventure…
                </button>
                <button
                  type="button"
                  onClick={() => setShowExport(true)}
                  class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition"
                  data-testid="pack-adventure-button"
                  title="Pack the selected notes (and their referenced assets) into a .advt.zip"
                >
                  Pack adventure…
                </button>
              </Show>
              <span class="font-display text-[0.62rem] uppercase tracking-[0.16em] text-fg-subtle">
                {notes().length} total
              </span>
            </div>
          </header>
          <input
            type="search"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="Search every note's body…"
            class="w-full rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            autocomplete="off"
            spellcheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
          />
          <Show when={searchQuery().trim().length > 0}>
            <Show
              when={searchHits() && searchHits()!.length > 0}
              fallback={
                <p class="text-xs text-fg-subtle italic">
                  {searchHits.loading ? "Searching…" : "No matches."}
                </p>
              }
            >
              <ul class="flex flex-col gap-1">
                <For each={searchHits()!}>
                  {(hit) => (
                    <li class="flex flex-col gap-1 rounded-(--radius-control) border border-border-muted bg-surface-elevated px-3 py-2">
                      <button
                        type="button"
                        onClick={() => open(hit.noteId)}
                        class="text-left text-sm text-fg hover:text-accent transition"
                      >
                        <span class="font-display">{hit.noteTitle}</span>
                        <span class="text-fg-subtle"> › {hit.pageTitle}</span>
                      </button>
                      <p class="text-xs text-fg-muted" innerHTML={hit.snippet} />
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
          <ul class="flex flex-col gap-1" classList={{ hidden: searchQuery().trim().length > 0 }}>
            <For each={notes()}>
              {(n) => (
                <li class="group flex items-center gap-3 rounded-(--radius-control) border border-border-muted bg-surface-elevated px-3 py-2">
                  <button
                    type="button"
                    onClick={() => open(n.id)}
                    class="flex-1 truncate text-left text-sm text-fg hover:text-accent transition"
                    title="Open this note"
                  >
                    {n.title}
                  </button>
                  <span class="font-mono text-[0.6rem] text-fg-subtle">{n.id}</span>
                  <button
                    type="button"
                    onClick={() => open(n.id)}
                    class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition"
                  >
                    Open
                  </button>
                  <Show when={canRemove(n)}>
                    <button
                      type="button"
                      onClick={() => remove(n.id, n.title)}
                      class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-subtle hover:border-danger hover:text-danger transition"
                      title={`Delete "${n.title}"`}
                    >
                      Remove
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={me()}>
            <div class="mt-2 flex flex-col gap-3 border-t border-border-muted pt-5">
              <h3 class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
                Create new note
              </h3>
              <CreateNoteForm tabId={props.tabId} />
            </div>
          </Show>
        </Show>
      </div>
      <Show when={showExport()}>
        <ExportAdventureModal
          notes={notes()}
          worldId={client.worldId() ?? ""}
          onClose={() => setShowExport(false)}
        />
      </Show>
      <Show when={showImport()}>
        <ImportAdventureModal
          worldId={client.worldId() ?? ""}
          onClose={() => setShowImport(false)}
        />
      </Show>
    </div>
  );
}

/**
 * "Import adventure…" modal — pick a `.advt.zip` file, POST the raw
 * bytes to `/api/worlds/<wid>/adventures/import`, surface the result
 * inline. The server walks the bundle, materialises notes + pages,
 * uploads any bundled assets as fresh `Asset` entities, and reports a
 * count of each so the GM knows what landed.
 *
 * GM-only — gated upstream by the button visibility, and again
 * server-side in `handleAdventureImport`. v1 always does a fresh
 * import: if the bundle was previously imported, the server creates
 * a new set of notes alongside the existing ones (additive). A
 * future enhancement runs `/check-update` first when an
 * `AdventureProvenance` for the bundleId already exists in the world
 * and opens the existing `update-dialog.tsx` for confirmation.
 */
function ImportAdventureModal(props: { worldId: string; onClose: () => void }): JSX.Element {
  const [file, setFile] = createSignal<File | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [result, setResult] = createSignal<{
    notesCreated: number;
    pagesCreated: number;
    assetsUploaded: number;
    bundleId: string;
    version: string;
  } | null>(null);
  let fileInput: HTMLInputElement | undefined;

  const submit = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setResult(null);
    const f = file();
    if (!f) {
      setError("Pick a `.advt.zip` file first.");
      return;
    }
    if (!props.worldId) {
      setError("Not connected to a world.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/worlds/${encodeURIComponent(props.worldId)}/adventures/import`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/zip" },
          body: f,
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `import failed (${res.status})`);
      }
      const body = (await res.json()) as {
        notesCreated: number;
        pagesCreated: number;
        assetsUploaded: number;
        bundleId: string;
        version: string;
      };
      setResult(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      class="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4"
      onClick={props.onClose}
      data-testid="import-adventure-modal"
    >
      <div
        class="flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-(--radius-card) border border-border bg-surface-elevated p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 class="text-base font-semibold tracking-tight text-fg">Import adventure</h2>
          <p class="mt-1 text-xs text-fg-muted">
            Pick a `.advt.zip` bundle. The notes + pages it carries are added to this world; any
            bundled assets (portraits, backgrounds, PDFs) are uploaded as fresh `Asset` entities.
            Re-importing the same bundle creates a new copy alongside the existing one.
          </p>
        </header>
        <form
          onSubmit={submit}
          class="flex flex-col gap-3"
          autocomplete="off"
          data-form-type="other"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
        >
          <label class="flex flex-col gap-1 text-xs text-fg-muted">
            <span>Bundle file</span>
            <input
              ref={fileInput}
              type="file"
              accept=".zip,application/zip,.advt"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0] ?? null;
                setFile(f);
                setError(null);
                setResult(null);
              }}
              data-testid="import-file"
              class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent file:mr-3 file:rounded-(--radius-control) file:border-0 file:bg-surface-elevated file:px-2 file:py-1 file:text-xs file:text-fg-muted hover:file:bg-surface"
            />
          </label>

          <Show when={file() && !result()}>
            <p class="text-[0.7rem] text-fg-subtle">
              {file()!.name} · {(file()!.size / 1024).toFixed(0)} KB
            </p>
          </Show>

          <Show when={error()}>
            <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
              {error()}
            </p>
          </Show>

          <Show when={result()}>
            {(r) => (
              <div class="flex flex-col gap-1 rounded-(--radius-control) border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-fg">
                <span class="font-medium">Imported successfully.</span>
                <span class="text-fg-muted">
                  {r().notesCreated} notes · {r().pagesCreated} pages · {r().assetsUploaded} assets
                </span>
                <span class="text-fg-subtle">
                  bundle <code class="font-mono">{r().bundleId}</code> v{r().version}
                </span>
              </div>
            )}
          </Show>

          <div class="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={props.onClose}
              class="rounded-(--radius-control) border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-surface transition"
            >
              {result() ? "Done" : "Cancel"}
            </button>
            <Show when={!result()}>
              <button
                type="submit"
                disabled={busy() || !file()}
                class="rounded-(--radius-control) bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
                data-testid="import-submit"
              >
                {busy() ? "Importing…" : "Import"}
              </button>
            </Show>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * "Pack adventure…" modal — pick which notes go into the bundle,
 * fill in metadata, hit Export. The server walks the selected notes
 * for `[[asset:…]]` references and includes the bytes automatically;
 * the client receives the zip as a blob and triggers a download.
 *
 * GM-only — gated upstream by the button visibility, and again
 * server-side in `handleAdventureExport`. The modal stays a thin
 * shell over the existing HTTP endpoint so the export flow can keep
 * evolving (reference closure, asset captures, multi-bundle update
 * paths) without re-wiring the UI.
 */
function ExportAdventureModal(props: {
  notes: ReadonlyArray<{ id: EntityId; title: string }>;
  worldId: string;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = createSignal("New adventure");
  const [version, setVersion] = createSignal("0.1.0");
  const [summary, setSummary] = createSignal("");
  const [author, setAuthor] = createSignal("");
  // Default to packing every note — explicitly de-selecting is the
  // common shape (whittle down a big world to one storyline) and
  // Select-all-by-default keeps the GM from forgetting an aux note.
  const [selectedIds, setSelectedIds] = createSignal<Set<EntityId>>(
    new Set<EntityId>(props.notes.map((n) => n.id)),
  );
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const allSelected = createMemo(() => selectedIds().size === props.notes.length);
  const noneSelected = createMemo(() => selectedIds().size === 0);

  const toggle = (id: EntityId): void => {
    setSelectedIds((cur) => {
      const next = new Set<EntityId>(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = (): void => {
    setSelectedIds(new Set<EntityId>(props.notes.map((n) => n.id)));
  };
  const clearAll = (): void => {
    setSelectedIds(new Set<EntityId>());
  };

  const submit = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (noneSelected()) {
      setError("Pick at least one note to pack.");
      return;
    }
    if (!props.worldId) {
      setError("Not connected to a world.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/worlds/${encodeURIComponent(props.worldId)}/adventures/export`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name().trim() || "Untitled adventure",
            version: version().trim() || "0.1.0",
            summary: summary().trim(),
            author: author().trim(),
            noteIds: [...selectedIds()],
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `export failed (${res.status})`);
      }
      const blob = await res.blob();
      // Build a download anchor and click it. Same shape every browser
      // accepts; revoke the URL after the click so the blob can be GC'd.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitiseFilename(name().trim() || "adventure")}.advt.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      props.onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      class="fixed inset-0 z-40 grid place-items-center bg-black/40 px-4"
      onClick={props.onClose}
      data-testid="pack-adventure-modal"
    >
      <div
        class="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-(--radius-card) border border-border bg-surface-elevated p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 class="text-base font-semibold tracking-tight text-fg">Pack adventure</h2>
          <p class="mt-1 text-xs text-fg-muted">
            Bundle notes + every `[[asset:…]]` they reference into a single `.advt.zip` file. Import
            it on another mvtt instance (or your own backup world) to recreate the cast and content.
          </p>
        </header>
        <form
          onSubmit={submit}
          class="flex min-h-0 flex-1 flex-col gap-3"
          autocomplete="off"
          data-form-type="other"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
        >
          <div class="grid grid-cols-2 gap-3">
            <label class="flex flex-col gap-1 text-xs text-fg-muted">
              <span>Name</span>
              <input
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                required
                maxlength={240}
                class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                data-testid="pack-name"
              />
            </label>
            <label class="flex flex-col gap-1 text-xs text-fg-muted">
              <span>Version</span>
              <input
                type="text"
                value={version()}
                onInput={(e) => setVersion(e.currentTarget.value)}
                required
                maxlength={60}
                placeholder="0.1.0"
                class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                data-testid="pack-version"
              />
            </label>
          </div>
          <label class="flex flex-col gap-1 text-xs text-fg-muted">
            <span>Summary (optional)</span>
            <input
              type="text"
              value={summary()}
              onInput={(e) => setSummary(e.currentTarget.value)}
              maxlength={2000}
              class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-fg-muted">
            <span>Author (optional)</span>
            <input
              type="text"
              value={author()}
              onInput={(e) => setAuthor(e.currentTarget.value)}
              maxlength={240}
              class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </label>

          <div class="flex flex-col gap-2 rounded-(--radius-control) border border-border-muted bg-surface p-3">
            <div class="flex items-baseline justify-between gap-2">
              <span class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
                Notes ({selectedIds().size}/{props.notes.length})
              </span>
              <div class="flex gap-2 text-[0.65rem]">
                <button
                  type="button"
                  onClick={selectAll}
                  disabled={allSelected()}
                  class="text-fg-muted hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Select all
                </button>
                <span class="text-fg-subtle">·</span>
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={noneSelected()}
                  class="text-fg-muted hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
              </div>
            </div>
            <ul class="flex max-h-60 flex-col gap-1 overflow-y-auto" data-testid="pack-notes-list">
              <For each={props.notes}>
                {(n) => (
                  <li>
                    <label class="flex items-center gap-2 rounded-(--radius-control) px-1 py-0.5 text-sm text-fg hover:bg-surface-elevated">
                      <input
                        type="checkbox"
                        checked={selectedIds().has(n.id)}
                        onChange={() => toggle(n.id)}
                      />
                      <span class="flex-1 truncate">{n.title}</span>
                      <span class="font-mono text-[0.6rem] text-fg-subtle">{n.id}</span>
                    </label>
                  </li>
                )}
              </For>
            </ul>
            <p class="text-[0.65rem] text-fg-subtle italic">
              Assets referenced as `[[asset:…]]` in the selected note bodies are packed
              automatically — uploaded images, sound files, etc.
            </p>
          </div>

          <Show when={error()}>
            <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
              {error()}
            </p>
          </Show>

          <div class="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={props.onClose}
              class="rounded-(--radius-control) border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-surface transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy() || noneSelected()}
              class="rounded-(--radius-control) bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
              data-testid="pack-export"
            >
              {busy() ? "Packing…" : "Export"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Strip filesystem-unsafe characters from the user-typed adventure
 * name before using it as the download filename. Server applies the
 * same sanitisation to the `Content-Disposition` header; client mirrors
 * it so a refused-by-OS download doesn't leave the user wondering.
 */
function sanitiseFilename(s: string): string {
  return (
    s
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "adventure"
  );
}

/**
 * Inline create form. Subscribes to NoteCreated once before dispatch,
 * captures existing note ids, and on the first matching event diffs
 * the world's Note query to identify the freshly-spawned entity so
 * this tab can retarget onto it. Mirrors Characters/Scenes exactly.
 */
function CreateNoteForm(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const [title, setTitle] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let inputEl: HTMLInputElement | undefined;

  onMount(() => {
    inputEl?.focus();
  });

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (busy()) return;
    const trimmed = title().trim();
    if (trimmed.length === 0) return;
    setBusy(true);

    const beforeIds = new Set(client.world.query([Note]).map((r) => r.id));
    const off = client.bus.on(NoteCreated.name, () => {
      off();
      const fresh = client.world.query([Note]).find((r) => !beforeIds.has(r.id));
      if (fresh) {
        client.dispatch(
          RetargetTab({
            tabId: props.tabId,
            pageKind: NOTES_KIND,
            entityId: fresh.id,
          }) as CommandInstance,
        );
      }
      setTitle("");
      setBusy(false);
    });

    client.dispatch(CreateNote({ title: trimmed }) as CommandInstance);
  };

  return (
    <form
      onSubmit={submit}
      class="flex w-full flex-col gap-3"
      autocomplete="off"
      data-form-type="other"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
    >
      <label class="flex flex-col gap-1 text-left">
        <span class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
          Title
        </span>
        <input
          ref={inputEl}
          type="text"
          name="note-title"
          value={title()}
          onInput={(e) => setTitle(e.currentTarget.value)}
          placeholder="e.g. Goblin Cave"
          maxLength={200}
          autocomplete="off"
          spellcheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 font-display text-base text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
      </label>
      <button
        type="submit"
        disabled={busy() || title().trim().length === 0}
        class="rounded-(--radius-control) bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
      >
        {busy() ? "Creating…" : "Create note"}
      </button>
    </form>
  );
}
