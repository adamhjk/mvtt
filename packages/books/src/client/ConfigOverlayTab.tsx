import { qualifiedName, type CommandInstance } from "@vtt/substrate";
import { useClient, useTrait } from "@vtt/substrate/client";
import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { Book } from "../shared/traits.js";
import { UpdateBook } from "../shared/commands.js";
import {
  BookConfigSectionsSlot,
  type BookConfigSection,
  type BookOverlayTab,
  type BookOverlayTabRenderArgs,
} from "../shared/slot.js";
import { useMe } from "./use-me.js";

/**
 * Config dock tab. Rename the active book. Auto-saves on blur.
 *
 * Reactive sync mirrors scene's ConfigOverlayTab — local input signal
 * for typing responsiveness, plus a `createEffect` that re-seeds local
 * when the trait changes from elsewhere (multi-device, undo, another
 * GM). The "editing" flag prevents the prop sync from clobbering the
 * user's in-progress edit.
 *
 * Players see a read-only view; UpdateBook is GM-only on the server.
 */
export const ConfigOverlayTab: BookOverlayTab = {
  id: qualifiedName("@vtt/books/dock-config"),
  label: "Config",
  icon: "⚙",
  priority: 100,
  render: (args: BookOverlayTabRenderArgs): JSX.Element => {
    return <ConfigTabBody bookId={args.bookId} />;
  },
};

function ConfigTabBody(props: { bookId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const isGm = () => me()?.role === "gm";
  const book = useTrait(props.bookId, Book);

  const update = (patch: { name?: string }) => {
    client.dispatch(
      UpdateBook({
        bookId: props.bookId,
        ...patch,
      }) as CommandInstance,
    );
  };

  // Plugin-contributed config sections (e.g. @vtt/pdf-book's PDF
  // upload). Sorted priority desc, label asc — matching the dock's
  // tab ordering convention so authoring two slots feels consistent.
  const sections = createMemo<BookConfigSection[]>(() => {
    const fills = client.registry.fillsForSlot(
      BookConfigSectionsSlot,
    ) as BookConfigSection[];
    return [...fills].sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return a.id.localeCompare(b.id);
    });
  });

  return (
    <Show
      when={book()}
      fallback={<div class="text-xs text-fg-subtle">no book loaded</div>}
    >
      {(b) => (
        <div class="flex h-full flex-col gap-5 overflow-y-auto">
          <Section label="Name">
            <NameField
              value={b().name}
              disabled={!isGm()}
              onCommit={(name) => update({ name })}
            />
          </Section>
          {/* Slot-filled sections (PDF upload, future projection
              settings). Each section renders its own labeled
              wrapper. */}
          <For each={sections()}>
            {(s) => s.render({ bookId: props.bookId }) as JSX.Element}
          </For>
        </div>
      )}
    </Show>
  );
}

function Section(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <label class="flex flex-col gap-2">
      <span class="font-display text-[0.6rem] uppercase tracking-[0.2em] text-fg-subtle">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

function NameField(props: {
  value: string;
  disabled: boolean;
  onCommit: (next: string) => void;
}): JSX.Element {
  const [local, setLocal] = createSignal(props.value);
  const [editing, setEditing] = createSignal(false);
  let lastDispatched: string | null = null;

  createEffect(() => {
    const next = props.value;
    if (editing()) return;
    if (lastDispatched !== null) {
      if (next === lastDispatched) lastDispatched = null;
      return;
    }
    setLocal(next);
  });

  const commit = () => {
    const trimmed = local().trim();
    if (trimmed.length === 0) {
      setLocal(props.value);
      setEditing(false);
      return;
    }
    if (trimmed === props.value) {
      setEditing(false);
      return;
    }
    lastDispatched = trimmed;
    props.onCommit(trimmed);
    setEditing(false);
  };

  return (
    <input
      type="text"
      value={local()}
      maxLength={160}
      disabled={props.disabled}
      autocomplete="off"
      spellcheck={false}
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      onFocus={() => setEditing(true)}
      onInput={(e) => setLocal(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.currentTarget as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setLocal(props.value);
          setEditing(false);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      class="rounded-(--radius-control) border border-border bg-surface px-3 py-2 font-display text-base text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}
