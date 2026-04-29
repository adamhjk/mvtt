import {
  type CommandInstance,
} from "@vtt/substrate";
import { Surface, useClient, useQuery } from "@vtt/substrate/client";
import {
  definePageProvider,
  RetargetTab,
} from "@vtt/shell-workbench/shared";
import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js";
import { Book } from "../shared/index.js";
import { CreateBook, RemoveBook } from "../shared/commands.js";
import { BookCreated } from "../shared/events.js";
import { BookCanvasSurface } from "../shared/surfaces.js";
import { BooksDock } from "./BooksDock.js";
import { useMe } from "./use-me.js";

const BOOKS_KIND = "@vtt/books/books";

/**
 * The Books PageProvider. Each Book entity becomes one selectable
 * Page; `render()` mounts the canvas full-bleed inside the
 * workbench's pane, with a collapsible bottom dock for Config /
 * future projection plugin tabs.
 *
 * Empty-entity branch (`entityId === null`): show an empty-state with
 * the create form (GM) or a waiting message (player). After
 * CreateBook fires, the form retargets its own tab to the freshly-
 * spawned Book so the user lands directly on it without leaving an
 * empty tab behind.
 */
export const BooksPageProvider = definePageProvider({
  kind: BOOKS_KIND,
  icon: "book",
  label: "Books",
  reads: [Book],
  list: ({ world }) => {
    return world.query([Book]).map((row) => {
      const b = row.values.Book as { name: string };
      return {
        id: row.id,
        label: b.name,
      };
    });
  },
  defaultEntity: ({ world }) => {
    const first = world.query([Book])[0];
    return first?.id ?? null;
  },
  render: ({ tabId, entityId, uiState, setUiState }) => {
    return (
      <BookPage
        tabId={tabId}
        entityId={entityId}
        uiState={uiState}
        setUiState={setUiState}
      />
    );
  },
});

function BookPage(props: {
  tabId: string;
  entityId: string | null;
  uiState: unknown;
  setUiState: (next: unknown) => void;
}): JSX.Element {
  return (
    <Show
      when={props.entityId}
      fallback={
        <section class="flex h-full flex-col gap-3 px-5 py-4">
          <EmptyState tabId={props.tabId} />
        </section>
      }
    >
      {(idAcc) => (
        <BookBody
          bookId={idAcc()}
          uiState={props.uiState}
          setUiState={props.setUiState}
        />
      )}
    </Show>
  );
}

function BookBody(props: {
  bookId: string;
  uiState: unknown;
  setUiState: (next: unknown) => void;
}): JSX.Element {
  return (
    <section class="flex h-full min-h-0 flex-col">
      <div class="relative min-h-0 flex-1 overflow-hidden">
        <Surface
          name={BookCanvasSurface.name}
          context={{ bookId: props.bookId }}
        />
      </div>
      <BooksDock
        bookId={props.bookId}
        uiState={props.uiState}
        setUiState={props.setUiState}
      />
    </section>
  );
}

/**
 * Book-management hub shown when the tab has no entityId. Lists every
 * existing book with Open + (GM-only) Remove controls, plus the GM-
 * only create form below. Mirrors scene's empty state.
 */
function EmptyState(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const isGm = () => me()?.role === "gm";
  const bookRows = useQuery([Book]);
  const books = createMemo(() =>
    bookRows()
      .map((row) => ({
        id: row.id,
        name: (row.values.Book as { name: string }).name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  const open = (bookId: string) => {
    client.dispatch(
      RetargetTab({
        tabId: props.tabId,
        pageKind: BOOKS_KIND,
        entityId: bookId,
      }) as CommandInstance,
    );
  };

  const remove = (bookId: string, name: string) => {
    if (
      !window.confirm(
        `Remove "${name}"? Any uploaded content for this book will also be removed.`,
      )
    ) {
      return;
    }
    client.dispatch(RemoveBook({ bookId }) as CommandInstance);
  };

  return (
    <div class="flex h-full items-start justify-center overflow-y-auto py-10">
      <div class="flex w-full max-w-lg flex-col gap-6">
        <Show
          when={books().length > 0}
          fallback={
            <div class="flex flex-col items-center gap-5 text-center">
              <p
                class="font-display text-2xl tracking-tight text-fg-muted"
                style={{ "font-family": "var(--font-display)" }}
              >
                <Show when={isGm()} fallback="No books yet">
                  No books yet — open one up.
                </Show>
              </p>
              <Show
                when={isGm()}
                fallback={
                  <p class="text-xs text-fg-subtle">
                    waiting for the GM to add a book…
                  </p>
                }
              >
                <CreateBookForm tabId={props.tabId} />
              </Show>
            </div>
          }
        >
          <header class="flex items-baseline justify-between">
            <h2
              class="font-display text-xl tracking-tight text-fg"
              style={{ "font-family": "var(--font-display)" }}
            >
              Books
            </h2>
            <span class="font-display text-[0.62rem] uppercase tracking-[0.16em] text-fg-subtle">
              {books().length} total
            </span>
          </header>
          <ul class="flex flex-col gap-1">
            <For each={books()}>
              {(b) => (
                <li class="group flex items-center gap-3 rounded-(--radius-control) border border-border-muted bg-surface-elevated px-3 py-2">
                  <button
                    type="button"
                    onClick={() => open(b.id)}
                    class="flex-1 truncate text-left text-sm text-fg hover:text-accent transition"
                    title="Open this book in the current tab"
                  >
                    {b.name}
                  </button>
                  <span class="font-mono text-[0.6rem] text-fg-subtle">
                    {b.id}
                  </span>
                  <button
                    type="button"
                    onClick={() => open(b.id)}
                    class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition"
                  >
                    Open
                  </button>
                  <Show when={isGm()}>
                    <button
                      type="button"
                      onClick={() => remove(b.id, b.name)}
                      class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-[0.65rem] text-fg-subtle hover:border-danger hover:text-danger transition"
                      title={`Remove "${b.name}"`}
                    >
                      Remove
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={isGm()}>
            <div class="mt-2 flex flex-col gap-3 border-t border-border-muted pt-5">
              <h3 class="font-display text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
                Create new book
              </h3>
              <CreateBookForm tabId={props.tabId} />
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

/**
 * Inline create form. Subscribes to BookCreated once before dispatch,
 * captures the existing Book-entity ids, and on the first matching
 * event diffs the world's Book query to identify the new entity. Then
 * dispatches RetargetTab so this same tab points at the fresh book.
 */
function CreateBookForm(props: { tabId: string }): JSX.Element {
  const client = useClient();
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let inputEl: HTMLInputElement | undefined;

  onMount(() => {
    inputEl?.focus();
  });

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (busy()) return;
    const trimmed = name().trim() || "untitled book";
    setError(null);
    setBusy(true);

    const beforeIds = new Set(
      client.world.query([Book]).map((r) => r.id),
    );

    const off = client.bus.on(BookCreated.name, () => {
      off();
      const fresh = client.world
        .query([Book])
        .find((r) => !beforeIds.has(r.id));
      if (fresh) {
        client.dispatch(
          RetargetTab({
            tabId: props.tabId,
            pageKind: BOOKS_KIND,
            entityId: fresh.id,
          }) as CommandInstance,
        );
      }
      setName("");
      setBusy(false);
    });

    const handle = client.dispatch(
      CreateBook({
        name: trimmed,
      }) as CommandInstance,
    );
    // The bus subscription only fires on the success path. If the
    // server nacks the command (validation, unknown command,
    // disconnect) BookCreated never arrives — clear busy and surface
    // the reason so the form doesn't hang at "Creating…" forever.
    void handle.ack.then((ack) => {
      if (!ack.ok) {
        off();
        setBusy(false);
        setError(ack.reason ?? "create failed");
      }
    });
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
          Name
        </span>
        <input
          ref={inputEl}
          type="text"
          name="book-name"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          placeholder="e.g. Player's Handbook"
          maxLength={160}
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
        disabled={busy()}
        class="rounded-(--radius-control) bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover transition disabled:opacity-50"
      >
        {busy() ? "Creating…" : "Create book"}
      </button>
      <Show when={error()}>
        <p class="rounded-(--radius-control) border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
          {error()}
        </p>
      </Show>
    </form>
  );
}
