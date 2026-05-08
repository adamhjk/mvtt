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

import { onMount, onCleanup, type JSX } from "solid-js";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  tooltips,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  syntaxHighlighting,
  bracketMatching,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import {
  autocompletion,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { type Registry, type World } from "@vtt/substrate";
import { buildLinkKindIndex } from "../shared/index.js";
import {
  Note,
  Page,
  BelongsToNote,
  Headings,
} from "../shared/traits.js";
import type { EntityId } from "@vtt/substrate";

/**
 * Solid wrapper around CodeMirror 6. The wiki-link grammar's
 * incremental side rides on top of `@codemirror/lang-markdown`'s
 * Lezer parser — for v1 we don't add a custom Lezer extension; the
 * markdown grammar handles standard formatting and the `[[…]]`
 * substring is rendered as plain text. Live-preview decoration that
 * swaps rendered widgets for `[[…]]` ranges lands as a follow-up
 * (everything underneath this component is ready for it).
 *
 * What's wired today:
 *  - markdown syntax highlighting
 *  - history (undo/redo) + default keymap
 *  - `[[` autocomplete that consults the link-kind registry
 *  - paste/drop handler for image upload
 *
 * The component owns the editor lifecycle. The parent passes:
 *  - `initial` body
 *  - `onChange(next)` for every keystroke (parent debounces SetDraftBody)
 *  - `onCheckpoint(next)` for periodic durable saves
 *  - `world`, `registry`, `worldId` for autocomplete + paste-upload
 */
export interface CodeMirrorHandle {
  /** Returns the current editor body — used for final save on Done. */
  getValue(): string;
  /** Replace contents wholesale (e.g. on a remote-driven body update). */
  setValue(next: string): void;
  /** Imperatively destroy the editor (also called on unmount). */
  destroy(): void;
}

export function CodeMirrorEditor(props: {
  initial: string;
  onChange?: (next: string) => void;
  world: World;
  registry: Registry;
  worldId: string;
  /** Bind a handle the parent can call into. */
  ref?: (handle: CodeMirrorHandle) => void;
}): JSX.Element {
  let host!: HTMLDivElement;
  let view: EditorView | null = null;

  onMount(() => {
    const wikiCompletions = (
      ctx: CompletionContext,
    ): CompletionResult | null => {
      // Find the `[[…` trigger ending at the cursor.
      const trigger = ctx.matchBefore(/\[\[[^\]\n]{0,160}/);
      if (!trigger) return null;
      const inner = trigger.text.slice(2); // text between `[[` and cursor

      // Locate the LAST `>` in `inner` and skip any following spaces;
      // everything after that is the segment the user is currently
      // filtering on. CM's built-in filter compares
      // `state.sliceDoc(from, to)` against each option's label, so we
      // set `from` to the segment start and label options with bare
      // segment text (page title, heading text, ...). That way
      // "[[gg > i" filters labels against just "i", not "gg > i".
      const lastGt = inner.lastIndexOf(">");
      let segStart = lastGt < 0 ? 0 : lastGt + 1;
      while (segStart < inner.length && inner[segStart] === " ") segStart++;
      const filterFrom = trigger.from + 2 + segStart;

      const segments = inner.split(">");
      const depth = segments.length - 1; // 0 = note, 1 = page, 2 = heading

      // Replacement helper: rewrites the WHOLE `[[…` token (back to
      // the original `[[`) with the normalised storage form, even
      // though `from` points at the current segment for filter
      // purposes. Resolves the actual `[[` start by scanning back
      // from `from` at apply-time (handles edits between result
      // construction and selection).
      const buildApply =
        (replacement: string) =>
        (
          view: EditorView,
          _completion: { label: string },
          from: number,
          to: number,
        ) => {
          const back = view.state.sliceDoc(Math.max(0, from - 200), from);
          const lastBracketsRel = back.lastIndexOf("[[");
          const start =
            lastBracketsRel >= 0
              ? from - (back.length - lastBracketsRel)
              : from;
          view.dispatch({
            changes: { from: start, to, insert: replacement },
            selection: { anchor: start + replacement.length },
            userEvent: "input.complete",
          });
        };

      const options: Array<{
        label: string;
        detail?: string;
        apply: ReturnType<typeof buildApply>;
        type?: string;
      }> = [];

      const world = props.world;
      const emptyResult: CompletionResult = {
        from: filterFrom,
        to: ctx.pos,
        options: [],
        validFor: /^[^\]\n>]*$/,
      };

      if (depth === 0) {
        for (const row of world.query([Note])) {
          const v = row.values.Note as { title: string };
          const replacement = `[[note:${row.id}|${v.title}]]`;
          options.push({
            label: v.title,
            detail: "Note",
            apply: buildApply(replacement),
            type: "note",
          });
        }
        // Other registered link kinds (asset, character, scene). Only
        // surfaced at depth 0 — they don't share the note-path syntax.
        const idx = buildLinkKindIndex(props.registry);
        const segText = inner.slice(segStart);
        for (const kind of idx.all) {
          if (kind.name === "note") continue;
          let suggestions: ReturnType<typeof kind.autocomplete>;
          try {
            suggestions = kind.autocomplete(segText, world, props.registry);
          } catch {
            continue;
          }
          for (const s of suggestions) {
            const display =
              s.display.length > 0 ? s.display : `${s.kind}:${s.body}`;
            const replacement = `[[${s.kind}:${s.body}|${display}]]`;
            options.push({
              label: display,
              detail: s.badge ?? s.kind,
              apply: buildApply(replacement),
              type: s.kind,
            });
          }
        }
        // "+ create new note" — depth 0, non-empty segment, flat title
        const trimmed = segText.trim();
        if (trimmed.length > 0) {
          options.push({
            label: `+ create new note: "${trimmed}"`,
            detail: "create",
            apply: buildApply(`[[note:${trimmed}|${trimmed}]]`),
            type: "create",
          });
        }
      } else if (depth === 1) {
        const noteText = segments[0]!.trim();
        const noteId = resolveNoteByName(world, noteText);
        if (noteId === null) return ctx.explicit ? emptyResult : null;
        const noteTitle =
          (world.get(noteId, [Note]) as { Note: { title: string } } | undefined)
            ?.Note.title ?? noteText;
        for (const row of world.query([Page, BelongsToNote])) {
          const back = row.values.BelongsToNote as { noteId: EntityId };
          if (back.noteId !== noteId) continue;
          const p = row.values.Page as { title: string };
          const replacement = `[[note:${noteId}>${row.id}|${noteTitle} › ${p.title}]]`;
          options.push({
            label: p.title,
            detail: "Page",
            apply: buildApply(replacement),
            type: "note",
          });
        }
      } else if (depth === 2) {
        const noteText = segments[0]!.trim();
        const pageText = segments[1]!.trim();
        const noteId = resolveNoteByName(world, noteText);
        if (noteId === null) return ctx.explicit ? emptyResult : null;
        const pageId = resolvePageOfNote(world, noteId, pageText);
        if (pageId === null) return ctx.explicit ? emptyResult : null;
        const noteTitle =
          (world.get(noteId, [Note]) as { Note: { title: string } } | undefined)
            ?.Note.title ?? noteText;
        const pageTitle =
          (world.get(pageId, [Page]) as { Page: { title: string } } | undefined)
            ?.Page.title ?? pageText;
        const headings =
          (world.get(pageId, [Headings]) as
            | { Headings: { items: Array<{ id: string; text: string }> } }
            | undefined)?.Headings.items ?? [];
        for (const h of headings) {
          const replacement = `[[note:${noteId}>${pageId}>${h.id}|${noteTitle} › ${pageTitle} › ${h.text}]]`;
          options.push({
            label: h.text,
            detail: "Heading",
            apply: buildApply(replacement),
            type: "note",
          });
        }
      }

      if (options.length === 0 && !ctx.explicit) return null;
      return {
        from: filterFrom,
        to: ctx.pos,
        options,
        // Valid only while the user keeps typing inside the current
        // segment — typing `>` changes depth and re-queries us so
        // page/heading suggestions appear at the right level.
        validFor: /^[^\]\n>]*$/,
      };
    };

    const pasteHandler = EditorView.domEventHandlers({
      paste(e, vw) {
        const items = e.clipboardData?.items;
        if (!items) return false;
        const file = (() => {
          for (const it of items) {
            if (it.kind === "file") {
              const f = it.getAsFile();
              if (f && /^image\//.test(f.type)) return f;
            }
          }
          return null;
        })();
        if (!file) return false;
        e.preventDefault();
        void uploadAndInsert(file, vw, props.worldId);
        return true;
      },
      drop(e, vw) {
        const file = (() => {
          const items = e.dataTransfer?.files;
          if (!items) return null;
          for (const f of items) {
            if (/^image\//.test(f.type)) return f;
          }
          return null;
        })();
        if (!file) return false;
        e.preventDefault();
        void uploadAndInsert(file, vw, props.worldId);
        return true;
      },
    });

    const updateListener = EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        props.onChange?.(u.state.doc.toString());
      }
    });

    const editable = new Compartment();
    void editable;

    view = new EditorView({
      state: EditorState.create({
        doc: props.initial,
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          lineNumbers(),
          bracketMatching(),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(markdownHighlightStyle),
          autocompletion({
            override: [wikiCompletions],
            activateOnTyping: true,
            closeOnBlur: true,
            defaultKeymap: true,
          }),
          // Render autocomplete + matching-bracket tooltips against
          // document.body so they escape any ancestor `overflow: hidden`
          // that would otherwise clip the popup.
          tooltips({ position: "fixed", parent: document.body }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
          pasteHandler,
          updateListener,
          editorTheme,
        ],
      }),
      parent: host,
    });

    const handle: CodeMirrorHandle = {
      getValue: () => view?.state.doc.toString() ?? "",
      setValue: (next) => {
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
        });
      },
      destroy: () => {
        view?.destroy();
        view = null;
      },
    };
    props.ref?.(handle);
  });

  onCleanup(() => {
    view?.destroy();
    view = null;
  });

  return (
    <div
      ref={host!}
      class="flex-1 min-h-0 w-full overflow-hidden rounded-(--radius-control) border border-border-muted bg-surface text-fg"
    />
  );
}

/**
 * Editor chrome that follows the design tokens — `light-dark()` on
 * the underlying tokens means the same theme works in both light and
 * dark modes. The `dark: true` flag is *not* set here: passing a
 * theme as light/dark would need a reactive re-mount on theme change,
 * and since every property below resolves through tokens we don't
 * need CodeMirror's internal dark/light branching.
 *
 * Selection and accent colors blend the accent token with low alpha
 * via `color-mix` so the same value reads on both surfaces — a fixed
 * tint like GitHub's `#264f78` washed out badly on a white surface.
 */
const editorTheme = EditorView.theme({
  "&": {
    fontSize: "14px",
    height: "100%",
    color: "var(--color-fg)",
    backgroundColor: "var(--color-surface)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-content": {
    fontFamily:
      "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
    padding: "10px 12px",
    caretColor: "var(--color-accent)",
    lineHeight: "1.55",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeft: "2px solid var(--color-accent)",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "var(--color-accent)",
  },
  "&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 28%, transparent)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--color-surface-elevated)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-fg-subtle)",
    borderRight: "1px solid var(--color-border-muted)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--color-surface-elevated)",
    color: "var(--color-fg-muted)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--color-surface-elevated)",
    border: "1px solid var(--color-border)",
    color: "var(--color-fg)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--color-accent)",
    color: "var(--color-accent-fg)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li .cm-completionDetail": {
    color: "var(--color-fg-subtle)",
    fontStyle: "italic",
    marginLeft: "8px",
  },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 22%, transparent)",
    color: "var(--color-fg)",
  },
});

/**
 * Markdown syntax highlighting. Tokens-only — colors resolve through
 * `var(--color-*)` so the same highlight palette reads on light and
 * dark surfaces. Heading sizes scale to mirror the rendered output.
 *
 * Foreground tags like `strong` / `emphasis` use the body color with
 * weight or italic so plain text and emphasized text share the same
 * legibility baseline; the markdown markers themselves (`#`, `*`,
 * etc.) get the muted-subtle color so they recede.
 */
const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, color: "var(--color-accent)", fontSize: "1.5em", fontWeight: "700" },
  { tag: t.heading2, color: "var(--color-accent)", fontSize: "1.3em", fontWeight: "700" },
  { tag: t.heading3, color: "var(--color-accent)", fontSize: "1.15em", fontWeight: "700" },
  { tag: t.heading4, color: "var(--color-accent)", fontWeight: "700" },
  { tag: t.heading5, color: "var(--color-accent)", fontWeight: "700" },
  { tag: t.heading6, color: "var(--color-accent)", fontWeight: "700" },
  { tag: t.strong, color: "var(--color-fg)", fontWeight: "700" },
  { tag: t.emphasis, color: "var(--color-fg)", fontStyle: "italic" },
  { tag: t.strikethrough, color: "var(--color-fg-subtle)", textDecoration: "line-through" },
  { tag: t.link, color: "var(--color-accent)", textDecoration: "underline" },
  { tag: t.url, color: "var(--color-accent)" },
  { tag: t.monospace, color: "var(--color-fg)", backgroundColor: "var(--color-surface-sunken)" },
  { tag: [t.literal, t.string], color: "var(--color-fg)" },
  { tag: t.quote, color: "var(--color-fg-muted)", fontStyle: "italic" },
  { tag: t.list, color: "var(--color-fg-muted)" },
  { tag: t.processingInstruction, color: "var(--color-fg-subtle)" },
  { tag: t.contentSeparator, color: "var(--color-border)" },
  { tag: t.meta, color: "var(--color-fg-subtle)" },
  // Markdown markers (`#`, `*`, `_`, ``` ` ``` etc.)
  { tag: t.punctuation, color: "var(--color-fg-subtle)" },
  { tag: t.atom, color: "var(--color-accent)" },
  { tag: t.tagName, color: "var(--color-accent)" },
]);

function resolveNoteByName(
  world: World,
  raw: string,
): EntityId | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (/^e\d+$/.test(trimmed) && world.has(trimmed as EntityId)) {
    const got = world.get(trimmed as EntityId, [Note]);
    return got ? (trimmed as EntityId) : null;
  }
  const needle = trimmed.toLowerCase();
  for (const row of world.query([Note])) {
    const v = row.values.Note as { title: string };
    if (v.title.toLowerCase() === needle) return row.id;
  }
  return null;
}

function resolvePageOfNote(
  world: World,
  noteId: EntityId,
  raw: string,
): EntityId | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (/^e\d+$/.test(trimmed) && world.has(trimmed as EntityId)) {
    const got = world.get(trimmed as EntityId, [BelongsToNote]) as
      | { BelongsToNote: { noteId: EntityId } }
      | undefined;
    return got && got.BelongsToNote.noteId === noteId
      ? (trimmed as EntityId)
      : null;
  }
  const needle = trimmed.toLowerCase();
  for (const row of world.query([Page, BelongsToNote])) {
    const back = row.values.BelongsToNote as { noteId: EntityId };
    if (back.noteId !== noteId) continue;
    const p = row.values.Page as { title: string };
    if (p.title.toLowerCase() === needle) return row.id;
  }
  return null;
}

async function uploadAndInsert(
  file: File,
  view: EditorView,
  worldId: string,
): Promise<void> {
  const url = `/api/worlds/${worldId}/assets/upload`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": file.type,
        "x-filename": file.name,
      },
      body: file,
      credentials: "same-origin",
    });
    if (!res.ok) {
      console.error("[notes] image upload failed:", res.status);
      return;
    }
    const body = (await res.json()) as { assetId: string };
    const insert = `![[asset:${body.assetId}]]`;
    const pos = view.state.selection.main.head;
    view.dispatch({
      changes: { from: pos, insert },
      selection: { anchor: pos + insert.length },
    });
  } catch (err) {
    console.error("[notes] image upload error:", err);
  }
}
