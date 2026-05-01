// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { type CommandInstance, type EntityId } from "@vtt/substrate";
import { useClient, useQuery } from "@vtt/substrate/client";
import { OwnedBy } from "@vtt/permissions/shared";
import {
  definePageProvider,
  RetargetTab,
} from "@vtt/shell-workbench/shared";
import {
  createMemo,
  createSignal,
  createResource,
  For,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { Note } from "../shared/traits.js";
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
});

function NotesPage(props: {
  tabId: string;
  entityId: string | null;
}): JSX.Element {
  return (
    <Show
      when={props.entityId}
      fallback={
        <section class="flex h-full flex-col gap-3">
          <NotesHub tabId={props.tabId} />
        </section>
      }
    >
      {(idAcc) => (
        <NoteView noteId={idAcc() as EntityId} tabId={props.tabId} />
      )}
    </Show>
  );
}

function NotesHub(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const noteRows = useQuery([Note, OwnedBy]);
  const [searchQuery, setSearchQuery] = createSignal("");

  const notes = createMemo(() =>
    noteRows()
      .map((row) => ({
        id: row.id,
        title: (row.values.Note as { title: string }).title,
        ownerUserId: (row.values.OwnedBy as { userId: string }).userId,
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
      const url = `/api/worlds/${key.wid}/notes/search?q=${encodeURIComponent(
        key.q,
      )}`;
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

  const canRemove = (ownerUserId: string) => {
    const m = me();
    if (!m) return false;
    return m.role === "gm" || m.userId === ownerUserId;
  };

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
                No notes yet — write the first one.
              </p>
              <Show
                when={me()}
                fallback={
                  <p class="text-xs text-fg-subtle">
                    sign in to create a note…
                  </p>
                }
              >
                <CreateNoteForm tabId={props.tabId} />
              </Show>
            </div>
          }
        >
          <header class="flex items-baseline justify-between">
            <h2
              class="font-display text-xl tracking-tight text-fg"
              style={{ "font-family": "var(--font-display)" }}
            >
              Notes
            </h2>
            <span class="font-display text-[0.62rem] uppercase tracking-[0.16em] text-fg-subtle">
              {notes().length} total
            </span>
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
                      <p
                        class="text-xs text-fg-muted"
                        innerHTML={hit.snippet}
                      />
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
          <ul
            class="flex flex-col gap-1"
            classList={{ hidden: searchQuery().trim().length > 0 }}
          >
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
                  <span class="font-mono text-[0.6rem] text-fg-subtle">
                    {n.id}
                  </span>
                  <button
                    type="button"
                    onClick={() => open(n.id)}
                    class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition"
                  >
                    Open
                  </button>
                  <Show when={canRemove(n.ownerUserId)}>
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
    </div>
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
      const fresh = client.world
        .query([Note])
        .find((r) => !beforeIds.has(r.id));
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
