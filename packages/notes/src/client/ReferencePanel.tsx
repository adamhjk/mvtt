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
  createMemo,
  createSignal,
  For,
  Show,
  type JSX,
} from "solid-js";
import { useClient } from "@vtt/substrate/client";
import {
  NotesReferenceSlot,
  type ReferenceProvider,
  type ReferenceSection,
} from "../shared/index.js";

/**
 * Side panel for the note editor — shows a scannable cheatsheet built
 * from every `NotesReferenceSlot` fill.
 *
 * Sections are grouped by `section.group`, sorted within each group
 * by (order, title). Clicking the "Insert" button on a section's
 * example pastes the example body at the editor cursor — `onInsert`
 * is the callback NoteEditor wires up to its CodeMirror handle.
 *
 * The panel is intentionally read-only and cheap: providers run once
 * when the panel opens (cached via `createMemo`) and the rendered
 * tree is plain markup. Re-running providers per render would defeat
 * any non-trivial reference work (e.g. enumerating hundreds of link
 * targets) for no benefit.
 */
export function ReferencePanel(props: {
  /** Called when the user clicks an "Insert" button next to an example. */
  onInsert?: (text: string) => void;
  /** Called when the user clicks the close button. */
  onClose?: () => void;
}): JSX.Element {
  const client = useClient();
  const [filter, setFilter] = createSignal("");

  // Build the section list once per panel open. Providers are pure
  // functions over (world, registry); we don't subscribe to anything
  // reactive, so this is a one-shot computation.
  const allSections = createMemo<ReferenceSection[]>(() => {
    const fills =
      (client.registry.fills.get(NotesReferenceSlot.name) ?? []) as ReadonlyArray<ReferenceProvider>;
    const out: ReferenceSection[] = [];
    for (const provider of fills) {
      try {
        const sections = provider.build({
          world: client.world,
          registry: client.registry,
        });
        for (const s of sections) out.push(s);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[notes] reference provider "${provider.name}" failed:`,
          (err as Error).message,
        );
      }
    }
    return out;
  });

  // Group sections by `group`, preserving insertion order of the first
  // section in each group; sort within group by (order, title).
  const grouped = createMemo(() => {
    const q = filter().trim().toLowerCase();
    const groups = new Map<string, ReferenceSection[]>();
    for (const s of allSections()) {
      if (q.length > 0) {
        const haystack = [
          s.title,
          s.summary ?? "",
          s.example ?? "",
          ...(s.fields ?? []).map((f) => `${f.path} ${f.description ?? ""}`),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      const list = groups.get(s.group) ?? [];
      list.push(s);
      groups.set(s.group, list);
    }
    const out: Array<{ group: string; sections: ReferenceSection[] }> = [];
    for (const [group, list] of groups) {
      list.sort((a, b) => {
        const ao = a.order ?? 0;
        const bo = b.order ?? 0;
        if (ao !== bo) return ao - bo;
        return a.title.localeCompare(b.title);
      });
      out.push({ group, sections: list });
    }
    return out;
  });

  return (
    <aside
      class="flex h-full min-h-0 w-[26rem] max-w-[40vw] flex-col gap-2 border-l border-border-muted bg-surface-elevated p-3"
      aria-label="Note syntax reference"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
          Syntax reference
        </span>
        <Show when={props.onClose}>
          <button
            type="button"
            onClick={() => props.onClose?.()}
            class="rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-[0.62rem] uppercase tracking-wider text-fg-muted hover:border-accent hover:text-fg transition"
            aria-label="Close reference panel"
          >
            Close
          </button>
        </Show>
      </div>
      <input
        type="text"
        placeholder="Filter…"
        value={filter()}
        onInput={(e) => setFilter(e.currentTarget.value)}
        class="rounded-(--radius-control) border border-border-muted bg-surface px-2 py-1 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
        autocomplete="off"
        spellcheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
      />
      <div class="flex-1 min-h-0 overflow-y-auto pr-1">
        <For each={grouped()}>
          {(g) => (
            <section class="mb-4">
              <h4 class="mb-2 text-[0.62rem] uppercase tracking-[0.18em] text-fg-subtle">
                {g.group}
              </h4>
              <For each={g.sections}>
                {(s) => (
                  <SectionView section={s} onInsert={props.onInsert} />
                )}
              </For>
            </section>
          )}
        </For>
        <Show when={grouped().length === 0}>
          <div class="rounded-(--radius-control) border border-dashed border-border-muted p-3 text-xs text-fg-subtle">
            No reference sections registered. Load a game-system plugin (e.g.
            <code class="mx-1 rounded bg-surface-sunken px-1 py-0.5 font-mono text-[0.7rem]">
              @vtt/system-torchbearer
            </code>
            ) to see fenced-block syntax here.
          </div>
        </Show>
      </div>
    </aside>
  );
}

function SectionView(props: {
  section: ReferenceSection;
  onInsert?: (text: string) => void;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <article
      class="mb-3 rounded-(--radius-control) border border-border-muted bg-surface"
      data-testid={`reference-section-${props.section.id}`}
    >
      <header class="flex items-center justify-between gap-2 border-b border-border-muted px-2 py-1.5">
        <div class="flex flex-col">
          <code class="font-mono text-sm font-semibold text-fg">
            {props.section.title}
          </code>
          <Show when={props.section.summary}>
            <span class="text-xs text-fg-muted">{props.section.summary}</span>
          </Show>
        </div>
        <Show when={props.section.fields && props.section.fields.length > 0}>
          <button
            type="button"
            onClick={() => setExpanded(!expanded())}
            class="rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-[0.62rem] uppercase tracking-wider text-fg-muted hover:border-accent hover:text-fg transition"
            aria-expanded={expanded()}
          >
            {expanded() ? "Hide fields" : "Show fields"}
          </button>
        </Show>
      </header>
      <Show when={props.section.example}>
        <div class="border-b border-border-muted bg-surface-sunken px-2 py-1.5">
          <pre class="overflow-x-auto whitespace-pre font-mono text-[0.7rem] leading-snug text-fg">
            {props.section.example}
          </pre>
          <Show when={props.onInsert && props.section.example}>
            <button
              type="button"
              onClick={() =>
                props.onInsert?.((props.section.example ?? "") + "\n")
              }
              class="mt-1 rounded-(--radius-control) border border-accent bg-accent px-2 py-0.5 text-[0.62rem] uppercase tracking-wider text-accent-fg hover:bg-accent-hover transition"
            >
              Insert at cursor
            </button>
          </Show>
        </div>
      </Show>
      <Show when={expanded() && props.section.fields && props.section.fields.length > 0}>
        <ul class="divide-y divide-border-muted text-[0.72rem]">
          <For each={props.section.fields}>
            {(f) => (
              <li class="px-2 py-1.5">
                <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <code class="font-mono font-semibold text-fg break-all">
                    {f.path}
                  </code>
                  <Show when={f.required}>
                    <span
                      class="rounded bg-surface-sunken px-1 text-[0.6rem] uppercase tracking-wider text-fg-subtle"
                      title="required"
                    >
                      req
                    </span>
                  </Show>
                  <span class="text-fg-muted break-all">{f.type}</span>
                </div>
                <Show when={f.default !== undefined}>
                  <div class="mt-0.5 text-[0.68rem] text-fg-subtle">
                    default:{" "}
                    <code class="font-mono text-fg-muted">{f.default}</code>
                  </div>
                </Show>
                <Show when={f.description}>
                  <div class="mt-0.5 text-[0.68rem] text-fg-subtle">
                    {f.description}
                  </div>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </article>
  );
}
