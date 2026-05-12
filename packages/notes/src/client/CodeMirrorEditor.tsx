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
import {
  EditorState,
  Compartment,
  RangeSetBuilder,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  tooltips,
  Decoration,
  WidgetType,
  ViewPlugin,
  type ViewUpdate,
  type DecorationSet,
  type Command,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { parseCode } from "@lezer/markdown";
import {
  HighlightStyle,
  syntaxHighlighting,
  bracketMatching,
  syntaxTree,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { type Registry, type World } from "@vtt/substrate";
import { EditorCompletionSourcesSlot } from "../shared/editor-completions.js";
import { buildLinkKindIndex } from "../shared/index.js";
import {
  Note,
  Page,
  BelongsToNote,
  Headings,
} from "../shared/traits.js";
import type { EntityId } from "@vtt/substrate";
import { setdesignParser } from "./setdesign-lezer.js";

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
  /**
   * Insert `text` at the current selection (or replace it if non-empty).
   * The caret lands at the end of the inserted text. Used by the
   * reference panel's "Insert at cursor" button.
   */
  insertAtCursor(text: string): void;
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
      //
      // Also consumes any trailing `]]` that `closeBrackets` may
      // have auto-paired when the user typed `[[`. The completion
      // replacement already includes its own `]]`, so without this
      // we'd leave behind a stray pair, producing `…]]]]`.
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
          // Eat a trailing `]]` (left behind by auto-pair) so the
          // completion's own closing brackets aren't doubled up.
          const after = view.state.sliceDoc(to, to + 2);
          const adjustedTo = after === "]]" ? to + 2 : to;
          view.dispatch({
            changes: { from: start, to: adjustedTo, insert: replacement },
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
        const idx = buildLinkKindIndex(props.registry);
        const segText = inner.slice(segStart);

        // Detect an explicit kind prefix or sigil. When present, we
        // route the query exclusively to that kind and strip the
        // prefix before passing it down — without this, typing
        // `[[npc:Skar` passes `"npc:Skar"` to every kind's matcher,
        // and `name.includes("npc:skar")` returns nothing for an NPC
        // actually named "Skarra".
        //
        // Three accepted forms:
        //   `kind:body`  — explicit kind (registered name); strip
        //                   `kind:` and search that kind only.
        //   `<sigil>body` — first char is a registered sigil; strip
        //                   the sigil and search the matching kind.
        //   bare        — no prefix; query every kind, plus Notes.
        let kindFilter: typeof idx.all[number] | null = null;
        let bodyQuery = segText;
        let bodyFilterFrom = filterFrom;
        const colonIdx = segText.indexOf(":");
        if (colonIdx > 0) {
          const candidate = segText.slice(0, colonIdx);
          const matched = idx.byName.get(candidate);
          if (matched) {
            kindFilter = matched;
            bodyQuery = segText.slice(colonIdx + 1);
            bodyFilterFrom = filterFrom + colonIdx + 1;
          }
        }
        if (!kindFilter && segText.length > 0) {
          const firstChar = segText[0]!;
          const sigilKind = idx.bySigil.get(firstChar);
          if (sigilKind) {
            kindFilter = sigilKind;
            bodyQuery = segText.slice(1);
            bodyFilterFrom = filterFrom + 1;
          }
        }

        if (!kindFilter) {
          // Bare query — include Notes plus every registered kind.
          //
          // Suggestions store the *name* form `[[kind:body]]` (no
          // `|display` trailer), since the body is now the
          // human-readable name and the chip renderer can rederive the
          // display from the resolved entity. Name-based storage
          // survives bundle import (where entity ids change) — the id
          // form would dangle on the target world. The `asset:` kind
          // is the deliberate exception: filenames aren't unique and
          // the bundle importer rewrites `[[asset:<id>]]` refs.
          for (const row of world.query([Note])) {
            const v = row.values.Note as { title: string };
            const replacement = `[[note:${v.title}]]`;
            options.push({
              label: v.title,
              detail: "Note",
              apply: buildApply(replacement),
              type: "note",
            });
          }
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
              const replacement = `[[${s.kind}:${s.body}]]`;
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
              apply: buildApply(`[[note:${trimmed}]]`),
              type: "create",
            });
          }
        } else {
          // Kind-prefixed query — only this kind. Note kind gets a
          // special path because it has its own note/page/heading
          // grammar; the body-only form here just searches note titles.
          if (kindFilter.name === "note") {
            for (const row of world.query([Note])) {
              const v = row.values.Note as { title: string };
              const replacement = `[[note:${v.title}]]`;
              options.push({
                label: v.title,
                detail: "Note",
                apply: buildApply(replacement),
                type: "note",
              });
            }
          } else {
            let suggestions: ReturnType<typeof kindFilter.autocomplete>;
            try {
              suggestions = kindFilter.autocomplete(
                bodyQuery,
                world,
                props.registry,
              );
            } catch {
              suggestions = [];
            }
            for (const s of suggestions) {
              const display =
                s.display.length > 0 ? s.display : `${s.kind}:${s.body}`;
              const replacement = `[[${s.kind}:${s.body}]]`;
              options.push({
                label: display,
                detail: s.badge ?? s.kind,
                apply: buildApply(replacement),
                type: s.kind,
              });
            }
          }
          // Tell CodeMirror to filter against just the body part
          // (past the `kind:` prefix or sigil) so the labels — bare
          // entity names like "Skarra" — actually match what the user
          // is typing.
          return {
            from: bodyFilterFrom,
            to: ctx.pos,
            options,
            validFor: /^[^\]\n>]*$/,
          };
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
          const replacement = `[[note:${noteTitle}>${p.title}]]`;
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
          const replacement = `[[note:${noteTitle}>${pageTitle}>${h.text}]]`;
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
          // `parseCode` plumbs through `@lezer/markdown` so the body
          // of a ```setdesign fence is parsed by our hand-built
          // Lezer parser. The resulting subtree carries the
          // `Setdesign*` node types from `setdesign-lezer.ts`, which
          // already have styleTags, foldNodeProp, and indentNodeProp
          // attached — so highlighting, folding, and indent flow
          // through the markdown language without further wiring.
          markdown({
            base: markdownLanguage,
            extensions: [
              parseCode({
                codeParser: (info) => {
                  // `info` is the WHOLE fence info-string (e.g.
                  // "character Skarra Wormtongue"). The language token
                  // is just the first word.
                  const lang = info.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
                  if (lang === "setdesign") return setdesignParser;
                  const STATIC_YAML = new Set([
                    "character",
                    "monster",
                    "item",
                    "encounter",
                    "loot",
                    "npc",
                  ]);
                  if (
                    STATIC_YAML.has(lang) ||
                    yamlBlockKinds(props.registry).has(lang)
                  ) {
                    return yamlLanguage.parser;
                  }
                  return null;
                },
              }),
            ],
          }),
          syntaxHighlighting(markdownHighlightStyle),
          // YAML tokens get their own scoped highlight style so the
          // rules only fire inside fenced YAML blocks, not against
          // markdown's `t.string` / `t.content` etc. (which would
          // bleed colour into prose).
          syntaxHighlighting(yamlHighlightStyle),
          foldGutter(),
          setdesignLiveChips,
          // `closeBrackets()` reads the bracket list from the
          // innermost language at the cursor — inside a ```setdesign
          // fence that's the `setdesign` language we attached via
          // `languageDataProp`, so `[`, `_`, `` ` ``, and the
          // punctuation pairs all auto-pair (with proper skip-over
          // and selection-wrap). Outside the fence, the markdown
          // defaults apply.
          closeBrackets(),
          // `*` is owned by a dedicated input handler — see
          // `setdesignStarHandler` below for the why. Must run as
          // an input handler (not closeBrackets) so the two-star
          // bold trigger can place the caret between two pairs.
          EditorView.inputHandler.of((view, from, to, text) =>
            setdesignStarHandler(view, from, to, text),
          ),
          autocompletion({
            override: [
              wikiCompletions,
              setdesignCompletions,
              ...buildExternalCompletionSources(props),
            ],
            activateOnTyping: true,
            closeOnBlur: true,
            defaultKeymap: true,
          }),
          // Render autocomplete + matching-bracket tooltips against
          // document.body so they escape any ancestor `overflow: hidden`
          // that would otherwise clip the popup.
          tooltips({ position: "fixed", parent: document.body }),
          // Keybindings:
          //  - Enter: setdesignEnter (tree-aware; preserves indent;
          //    adds extra step after `->`).
          //  - Tab / Shift-Tab inside fence: indent / outdent line.
          //  - Cmd-B / Mod-B / Cmd-I: wrap selection in `**…**` / `*…*`.
          //
          // Each binding returns false when not applicable so the
          // default keymap (later in this array) handles the
          // fallback case unchanged.
          keymap.of([
            { key: "Enter", run: setdesignEnter },
            { key: "Tab", run: setdesignTab },
            { key: "Shift-Tab", run: setdesignShiftTab },
            // Tab handling for any other fenced block (YAML in
            // character/monster/item/encounter/loot). The setdesign
            // bindings above return false when not in their fence so
            // these run next.
            { key: "Tab", run: fenceTab },
            { key: "Shift-Tab", run: fenceShiftTab },
            { key: "Mod-b", run: setdesignWrapBold },
            { key: "Mod-i", run: setdesignWrapItalic },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            ...foldKeymap,
          ]),
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
      insertAtCursor: (text) => {
        if (!view) return;
        const sel = view.state.selection.main;
        view.focus();
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length },
          userEvent: "input.paste",
          scrollIntoView: true,
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
  { tag: t.literal, color: "var(--color-fg)" },
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

/**
 * YAML-scoped highlight style — only fires inside @codemirror/lang-yaml
 * nodes, so markdown's `t.string` / `t.content` etc. in prose stay
 * unaffected. Colours come from `--color-syntax-*` tokens in
 * tokens.css; see there for the design rationale (5 families rotated
 * ~90° around the colour wheel for separation under colour-vision
 * deficiency). The grammar emits modifier-wrapped tags
 * (`tags.definition(tags.propertyName)`, `tags.special(tags.string)`,
 * `tags.lineComment`) — `HighlightStyle` rules need to target the
 * *exact* wrapped form, not the base tag, so we list both shapes.
 */
const yamlHighlightStyle = HighlightStyle.define(
  [
    { tag: t.propertyName, color: "var(--color-syntax-key)", fontWeight: "600" },
    { tag: t.definition(t.propertyName), color: "var(--color-syntax-key)", fontWeight: "600" },
    { tag: t.number, color: "var(--color-syntax-constant)" },
    { tag: t.bool, color: "var(--color-syntax-constant)" },
    { tag: t.keyword, color: "var(--color-syntax-constant)" },
    { tag: t.null, color: "var(--color-syntax-constant)" },
    { tag: t.string, color: "var(--color-syntax-string)" },
    { tag: t.special(t.string), color: "var(--color-syntax-string)" },
    { tag: t.content, color: "var(--color-syntax-string)" },
    { tag: t.attributeValue, color: "var(--color-syntax-string)" },
    { tag: t.labelName, color: "var(--color-syntax-meta)" },
    { tag: t.typeName, color: "var(--color-syntax-meta)" },
    { tag: t.lineComment, color: "var(--color-syntax-comment)", fontStyle: "italic" },
    { tag: t.comment, color: "var(--color-syntax-comment)", fontStyle: "italic" },
    { tag: t.separator, color: "var(--color-syntax-punctuation)" },
    { tag: t.squareBracket, color: "var(--color-syntax-punctuation)" },
    { tag: t.brace, color: "var(--color-syntax-punctuation)" },
    { tag: t.meta, color: "var(--color-syntax-comment)" },
  ],
  { scope: yamlLanguage },
);

/**
 * Fence-info regex for an open ``` fence: `lang` is captured. We only
 * accept up to three leading spaces (CommonMark's fence rule) and one
 * info word — the markdown grammar tolerates more, but real fences
 * authored in mvtt notes are tight, and over-tolerant matching here
 * would mis-detect ``` lines that happen to be embedded in narrative.
 */
const FENCE_RE = /^[ ]{0,3}(`{3,}|~{3,})\s*([^\s`~]*)/;

/**
 * Decide whether the caret at `pos` sits inside a ```setdesign fence.
 *
 * Strategy: walk backwards line by line. The first fence delimiter
 * found is the most recent fence above the cursor:
 *
 *  - If its info string is `setdesign`, the cursor is inside a
 *    setdesign fence (the opener hasn't been closed yet).
 *  - If its info string is anything else (or empty), it is either a
 *    different-language opener or a close fence — in both cases the
 *    cursor is NOT inside a setdesign fence.
 *
 * This heuristic skips the (rare) authoring pattern of unlabeled
 * `` ``` `` open + content + close, which is acceptable here.
 */
export function isInsideSetdesignFence(
  state: EditorState,
  pos: number,
): boolean {
  const doc = state.doc;
  let line = doc.lineAt(pos);
  // If the cursor IS on a fence line itself, treat it as not inside —
  // the user is editing the marker, not the content.
  if (FENCE_RE.test(line.text)) return false;
  let cur = line.number - 1;
  while (cur >= 1) {
    line = doc.line(cur);
    const m = FENCE_RE.exec(line.text);
    if (m) {
      const info = (m[2] ?? "").toLowerCase();
      return info === "setdesign";
    }
    cur--;
  }
  return false;
}

/**
 * Completion source for in-fence set-design snippets.
 *
 * Surfaces a small palette of structural tokens (bold visible element,
 * arrow, branch arrow, stat block, header separator) that match the
 * grammar described in `shared/set-design.ts`. The source fires when
 * the cursor is inside a ```setdesign fence and either the user has
 * typed a partial token (matched against the snippet labels) or
 * explicitly opened completions (Ctrl-Space).
 *
 * Defers to the wiki-link completion when the user is typing a
 * `[[…` token — that source already works inside the fence and
 * returns the right kind-specific suggestions; competing here would
 * just produce noise.
 */
/**
 * Build the per-editor list of external completion sources contributed
 * by other plugins via `EditorCompletionSourcesSlot`. The result is a
 * fresh array each editor mount; sources are functions stable across
 * the editor's lifetime.
 */
function buildExternalCompletionSources(props: {
  world: import("@vtt/substrate").World;
  registry: import("@vtt/substrate").Registry;
  worldId: string;
}): Array<(ctx: CompletionContext) => CompletionResult | null | Promise<CompletionResult | null>> {
  const fills = (props.registry.fills.get(EditorCompletionSourcesSlot.name) ?? []) as ReadonlyArray<
    import("../shared/index.js").EditorCompletionSourceFactory
  >;
  const out: Array<(ctx: CompletionContext) => CompletionResult | null | Promise<CompletionResult | null>> = [];
  for (const f of fills) {
    try {
      const built = f.build({
        world: props.world,
        registry: props.registry,
        worldId: props.worldId,
      });
      if (typeof built === "function") {
        out.push(built as (ctx: CompletionContext) => CompletionResult | null);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[notes] editor completion source ${f.name} failed to build:`, (err as Error).message);
    }
  }
  return out;
}

/**
 * Build the set of fence info-string kinds whose body should be
 * parsed with the YAML grammar (for syntax highlighting). Drives off
 * `@vtt/adventures/block-kinds` registry fills — the slot is owned
 * by adventures and filled by game-system plugins.
 *
 * Cached on the Registry instance so we don't rebuild every parse
 * pass; invalidated implicitly by registry replacement (rare).
 */
const YAML_KIND_CACHE = new WeakMap<
  import("@vtt/substrate").Registry,
  Set<string>
>();
function yamlBlockKinds(
  registry: import("@vtt/substrate").Registry,
): Set<string> {
  const cached = YAML_KIND_CACHE.get(registry);
  if (cached) return cached;
  const out = new Set<string>();
  // Read the slot fills directly by name to avoid a hard dependency
  // on @vtt/adventures here. Each fill is a BlockKindDef carrying a
  // `name` string (the fence kind).
  const fills = (registry.fills.get(
    "@vtt/adventures/block-kinds" as never,
  ) ?? []) as ReadonlyArray<{
    name?: string;
  }>;
  for (const fill of fills) {
    if (typeof fill.name === "string") out.add(fill.name.toLowerCase());
  }
  YAML_KIND_CACHE.set(registry, out);
  return out;
}

function setdesignCompletions(
  ctx: CompletionContext,
): CompletionResult | null {
  if (!isInsideSetdesignFence(ctx.state, ctx.pos)) return null;
  if (ctx.matchBefore(/\[\[[^\]\n]{0,160}/)) return null;

  const word = ctx.matchBefore(/[A-Za-z][\w-]*/);
  if (!word && !ctx.explicit) return null;

  // Tree-aware classification: where in the setdesign block is the
  // cursor? `visible` and `header` only make sense at the start of a
  // line (no segment text yet); everything else fires anywhere. We
  // detect "line start" via raw doc text (cheap) because the syntax
  // tree may be slightly stale during typing.
  const line = ctx.state.doc.lineAt(ctx.pos);
  const beforeCursor = line.text.slice(0, ctx.pos - line.from);
  const isLineStart = /^\s*$/.test(
    word ? beforeCursor.slice(0, word.from - line.from) : beforeCursor,
  );

  // `header` is even more restricted: it should only appear when the
  // user is plausibly typing the rule under a single-line title. We
  // surface it whenever we're at line start, since the cost of
  // surfacing it elsewhere is low (it's still a valid token).
  const doc = setdesignDocAt(ctx.state, ctx.pos);
  void doc; // reserved for future, more nuanced placement decisions

  const options: Completion[] = [];
  if (isLineStart) {
    options.push(
      snippetCompletion("**${name}**", {
        label: "visible",
        detail: "**bold visible element**",
        type: "keyword",
      }),
      snippetCompletion("---", {
        label: "header",
        detail: "header separator under title",
        type: "keyword",
      }),
    );
  }
  options.push(
    snippetCompletion(" -> ${}", {
      label: "arrow",
      detail: " -> (renders as →)",
      type: "keyword",
    }),
    snippetCompletion(" |-> ${}", {
      label: "branch",
      detail: " |-> (branch from chain)",
      type: "keyword",
    }),
    snippetCompletion("(_${stats}_)", {
      label: "stats",
      detail: "(_stat block_)",
      type: "keyword",
    }),
  );

  return {
    from: word ? word.from : ctx.pos,
    to: ctx.pos,
    options,
    validFor: /^[A-Za-z][\w-]*$/,
  };
}

/**
 * Locate the SetdesignDoc node enclosing `pos`, if any. Walks the
 * syntax tree to find a `SetdesignDoc` that contains the position.
 * Returns null when the cursor isn't inside one. This is the tree-
 * aware companion to `isInsideSetdesignFence` — both are kept because
 * the regex path is faster for hot paths (input handlers) where the
 * tree might be slightly stale, while this one is precise for
 * commands that already need to walk the tree anyway.
 */
function setdesignDocAt(state: EditorState, pos: number): {
  from: number;
  to: number;
} | null {
  const tree = syntaxTree(state);
  let cur = tree.resolveInner(pos, -1);
  while (cur) {
    if (cur.type.name === "SetdesignDoc") {
      return { from: cur.from, to: cur.to };
    }
    if (!cur.parent) break;
    cur = cur.parent;
  }
  return null;
}

/**
 * Smart Enter inside a ```setdesign fence. Preserves the previous
 * line's indentation; if the previous line ends with a chain arrow
 * (`->` / `→`), adds one extra two-space indent step so the child is
 * automatically placed under the chain's tail.
 *
 * Returns `false` (and lets the default Enter handler run) when:
 *  - the caret isn't inside a setdesign fence, or
 *  - the active selection spans multiple characters (replace-on-Enter),
 *  - the document is currently in a completion context that should
 *    consume Enter for selection — `completionKeymap` runs *after*
 *    this binding, so we let CM's normal flow handle that case by
 *    refusing here when the next-line behavior would just be a
 *    plain newline anyway (no indent).
 */
export const setdesignEnter: Command = (view) => {
  const state = view.state;
  // An active completion popup must keep Enter for option selection —
  // bail so `completionKeymap`'s Enter binding gets it.
  if (completionStatus(state) === "active") return false;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const pos = sel.head;
  if (!isInsideSetdesignFence(state, pos)) return false;

  const line = state.doc.lineAt(pos);
  const lineText = line.text;
  const beforeCursor = lineText.slice(0, pos - line.from);
  const indentMatch = /^[ \t]*/.exec(lineText);
  const baseIndent = indentMatch ? indentMatch[0] : "";
  const endsWithArrow = /(?:->|→)\s*$/.test(beforeCursor);
  const extra = endsWithArrow ? "  " : "";
  const insert = "\n" + baseIndent + extra;

  view.dispatch({
    changes: { from: pos, to: pos, insert },
    selection: { anchor: pos + insert.length },
    userEvent: "input",
    scrollIntoView: true,
  });
  return true;
};

// ---------- Tab / Shift-Tab inside fence ----------

/**
 * Inside a setdesign fence, Tab indents the current line by two
 * spaces (one nest step). Outside, falls through to default Tab
 * (insert tab character).
 */
const setdesignTab: Command = (view) => {
  const state = view.state;
  const sel = state.selection.main;
  if (!isInsideSetdesignFence(state, sel.head)) return false;
  return indentMore(view);
};

/**
 * Tab indent inside ANY fenced code block (YAML-bodied character /
 * monster / item / encounter / loot, plus any future kind). Keeps
 * markdown's default tab behaviour (nothing) outside fences — Tab in
 * markdown prose moves focus, which is the platform convention.
 *
 * Why a fence-wide handler instead of relying on `indentWithTab` from
 * @codemirror/commands: that binding would steal Tab globally, which
 * breaks the cursor-anywhere accessibility expectation for prose.
 * Scoped to fences keeps markdown prose unaffected.
 */
const fenceTab: Command = (view) => {
  const state = view.state;
  const sel = state.selection.main;
  if (!isInsideAnyFence(state, sel.head)) return false;
  return indentMore(view);
};

const fenceShiftTab: Command = (view) => {
  const state = view.state;
  const sel = state.selection.main;
  if (!isInsideAnyFence(state, sel.head)) return false;
  return indentLess(view);
};

/**
 * Detect whether the caret sits inside ANY fenced code block (open
 * ``` … ``` pair). Walks backward line-by-line; the first fence
 * delimiter seen "above" the cursor without a matching close means
 * we're inside.
 */
function isInsideAnyFence(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  let inside = false;
  for (let n = 1; n < line.number; n += 1) {
    const l = state.doc.line(n);
    if (FENCE_RE.test(l.text)) inside = !inside;
  }
  // If pos is on the opening fence line itself, we're NOT inside (the
  // info string lives on that line).
  if (FENCE_RE.test(line.text)) return false;
  return inside;
}

/**
 * Mirror of `setdesignTab`. Outside the fence, lets Shift-Tab fall
 * through (the default keymap doesn't bind it, so it becomes a
 * no-op — that's fine).
 */
const setdesignShiftTab: Command = (view) => {
  const state = view.state;
  const sel = state.selection.main;
  if (!isInsideSetdesignFence(state, sel.head)) return false;
  return indentLess(view);
};

// ---------- Cmd-B / Cmd-I wrap ----------

function wrapWithDelimiter(view: EditorView, delim: string): boolean {
  const state = view.state;
  const sel = state.selection.main;
  if (!isInsideSetdesignFence(state, sel.head)) return false;
  if (sel.empty) {
    // No selection: insert empty pair with cursor between.
    const insert = delim + delim;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: sel.from + delim.length },
      userEvent: "input.wrap",
    });
    return true;
  }
  const selected = state.sliceDoc(sel.from, sel.to);
  // Toggle: if already wrapped, strip the delimiters.
  if (
    selected.startsWith(delim) &&
    selected.endsWith(delim) &&
    selected.length >= delim.length * 2
  ) {
    const stripped = selected.slice(delim.length, -delim.length);
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: stripped },
      selection: { anchor: sel.from, head: sel.from + stripped.length },
      userEvent: "input.unwrap",
    });
    return true;
  }
  const insert = delim + selected + delim;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + delim.length, head: sel.from + delim.length + selected.length },
    userEvent: "input.wrap",
  });
  return true;
}

const setdesignWrapBold: Command = (view) => wrapWithDelimiter(view, "**");
const setdesignWrapItalic: Command = (view) => wrapWithDelimiter(view, "_");

// ---------- `*` / `**` input handler ----------

/**
 * Owns the `*` key inside ```setdesign fences. Two reasons we can't
 * just register `*` in the `closeBrackets` brackets list:
 *
 *  1. `*` is ambiguous between italic (single delimiter) and bold
 *     (double delimiter). `closeBrackets`'s symmetric-pair model
 *     would auto-pair every `*` as italic, making it impossible to
 *     type `**…**` without fighting the editor.
 *  2. The desired bold-open behavior is "second `*` produces
 *     `**|**`" (caret between two `**` pairs) — that's not a
 *     pair-stack, it's an asymmetric two-character expansion that
 *     the close-brackets state machine can't express.
 *
 * Behavior implemented here:
 *
 *  - First `*` (no `*` immediately before): inserted as-is. No pair.
 *  - Second `*` (`*` immediately before cursor, and the next char is
 *    NOT `*`): expand to `**|**` — i.e., insert `*` plus the closing
 *    `**` so the doc has four stars and the caret lands between the
 *    second and third.
 *  - Typed `*` when the next char is already `*`: skip-over. Caret
 *    advances by one without inserting. Handles both close-of-bold
 *    (`…**|**` → `…****|`) and close-of-italic where the user
 *    already typed both stars.
 *  - Anything else (no relevant `*` context): fall through (returns
 *    false) so the default text-insert runs.
 */
function setdesignStarHandler(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (text !== "*") return false;
  if (from !== to) return false;
  const state = view.state;
  if (!isInsideSetdesignFence(state, from)) return false;

  const prevChar = state.sliceDoc(Math.max(0, from - 1), from);
  const nextChar = state.sliceDoc(from, from + 1);

  // Skip-over: typing `*` when the next char is already `*` —
  // advance the caret without inserting.
  if (nextChar === "*") {
    view.dispatch({
      selection: { anchor: from + 1 },
      userEvent: "input.type",
      scrollIntoView: true,
    });
    return true;
  }

  // Two-star bold open: prev char is `*`, next char is not `*`.
  // Insert `*` (the typed char) plus the closing `**` so the caret
  // lands between the bold-open and bold-close.
  if (prevChar === "*") {
    view.dispatch({
      changes: { from, to, insert: "*" + "**" },
      selection: { anchor: from + 1 },
      userEvent: "input.type",
      scrollIntoView: true,
    });
    return true;
  }

  // Single `*` with no special context — fall through.
  return false;
}

// ---------- Live wiki-link chips ----------

/**
 * Widget that displays the wiki-link's display value as a chip.
 * Clicking the chip moves the caret into the source so the user
 * can edit. Hovering doesn't expand — that's a follow-up.
 */
class WikiChipWidget extends WidgetType {
  constructor(
    private readonly bodyText: string,
    private readonly isEmbed: boolean,
  ) {
    super();
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-setdesign-chip";
    el.dataset.embed = this.isEmbed ? "1" : "0";
    el.textContent = this.bodyText;
    return el;
  }
  eq(other: WidgetType): boolean {
    return (
      other instanceof WikiChipWidget &&
      other.bodyText === this.bodyText &&
      other.isEmbed === this.isEmbed
    );
  }
  ignoreEvent(): boolean {
    // Let click events through so caret-on-click moves into the
    // source range, exposing the underlying `[[…]]` for editing.
    return false;
  }
}

/**
 * Build decorations that replace each `SetdesignWikiLink` node with
 * a chip widget, UNLESS the caret is currently inside (or touching)
 * the link's range — in that case we show the raw source so the
 * user can edit it. Same idiom Obsidian's live preview uses.
 */
function buildSetdesignChips(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sel = view.state.selection.main;
  for (const { from: vFrom, to: vTo } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: vFrom,
      to: vTo,
      enter(node) {
        if (node.type.name !== "SetdesignWikiLink") return;
        // Skip when caret is inside the link span (so the user can edit).
        if (sel.from <= node.to && sel.to >= node.from) return;
        const raw = view.state.sliceDoc(node.from, node.to);
        const isEmbed = raw.startsWith("!");
        const inner = raw.replace(/^!?\[\[/, "").replace(/]]$/, "");
        // Body is whatever comes before `|` (alias) or `#` (anchor),
        // and after any `kind:` prefix.
        const aliasIdx = inner.indexOf("|");
        const headPart = aliasIdx >= 0 ? inner.slice(0, aliasIdx) : inner;
        const aliasPart = aliasIdx >= 0 ? inner.slice(aliasIdx + 1).trim() : "";
        const colonIdx = headPart.indexOf(":");
        const bodyRaw =
          colonIdx > 0 && /^[a-zA-Z][\w-]*$/.test(headPart.slice(0, colonIdx).trim())
            ? headPart.slice(colonIdx + 1).trim()
            : headPart.trim();
        const display = aliasPart.length > 0 ? aliasPart : bodyRaw;
        builder.add(
          node.from,
          node.to,
          Decoration.replace({
            widget: new WikiChipWidget(display, isEmbed),
            inclusive: false,
          }),
        );
      },
    });
  }
  return builder.finish();
}

const setdesignLiveChips = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildSetdesignChips(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildSetdesignChips(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

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
