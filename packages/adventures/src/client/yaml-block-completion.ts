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

import type {
  EditorCompletionContext,
  EditorCompletionSourceFactory,
} from "@vtt/notes/shared";
import {
  buildBlockKindIndex,
  type AnyBlockKindDef,
} from "../shared/block-kinds.js";
import { computeBlockCompletions } from "./block-autocomplete.js";

/**
 * Re-typed snippet of CodeMirror's CompletionContext / CompletionResult
 * shape — we don't import @codemirror/autocomplete here to avoid a
 * runtime dep cycle. CodeMirror passes this object verbatim; we read
 * `pos`, `state.doc`, and `matchBefore`.
 */
interface CmCompletionContext {
  readonly pos: number;
  readonly explicit: boolean;
  readonly state: {
    readonly doc: { toString(): string; lineAt(pos: number): { from: number; to: number; text: string; number: number }; length: number };
  };
  matchBefore(re: RegExp): { from: number; to: number; text: string } | null;
}

interface CmCompletionResult {
  readonly from: number;
  readonly to: number;
  readonly options: ReadonlyArray<{
    label: string;
    detail?: string;
    type?: string;
    boost?: number;
    apply?: string;
  }>;
}

interface FenceContext {
  readonly kind: AnyBlockKindDef;
  readonly bodyStart: number; // first char inside the fence
  readonly bodyText: string;
  readonly cursorOffsetInBody: number;
  readonly infoString: string;
}

/**
 * Detect whether the cursor sits inside a registered fenced block.
 * Returns the kind def + the body text up to the cursor, plus the
 * info-string from the opening fence line.
 */
function fenceAtCursor(
  doc: string,
  pos: number,
  kindIndex: ReturnType<typeof buildBlockKindIndex>,
): FenceContext | null {
  // Walk backwards from the cursor to find the most recent ` ``` ` line
  // at column 0. Track every fence we cross and check parity: an odd
  // count means we're inside one.
  const before = doc.slice(0, pos);
  const fences = [...before.matchAll(/^(```+)\s*([^\n]*)$/gm)];
  if (fences.length === 0 || fences.length % 2 === 0) return null;
  const opening = fences[fences.length - 1]!;
  const infoLine = (opening[2] ?? "").trim();
  if (!infoLine) return null;
  const firstSpace = infoLine.indexOf(" ");
  const kindName = firstSpace > 0 ? infoLine.slice(0, firstSpace) : infoLine;
  const infoString = firstSpace > 0 ? infoLine.slice(firstSpace + 1).trim() : "";
  const kindDef = kindIndex.byName.get(kindName);
  if (!kindDef) return null;
  // Body starts after the opening fence's trailing newline.
  const openEnd = opening.index! + opening[0].length;
  const bodyStart = openEnd + 1; // skip the `\n` after the fence
  const bodyText = doc.slice(bodyStart, pos);
  const cursorOffsetInBody = bodyText.length;
  return { kind: kindDef, bodyStart, bodyText, cursorOffsetInBody, infoString };
}

/**
 * Walk the YAML body up to the cursor and produce the path + slot type.
 * v1: a tiny line-based tracker that handles the common author shapes
 * (object keys, array `- ` items, simple `key: value` pairs). It's not
 * a full YAML parser — it keeps state line-by-line.
 *
 * Returns:
 *   path:  array of object keys / `*` for array elements walked into
 *   slot:  "key" if the cursor is at the start of a line (object key
 *           position) or right after `- ` (array element key position),
 *          "value" if after `: `,
 *          "info" if before the body started (cursor on the opening
 *           fence line — handled separately).
 *   query: substring the user has typed at the cursor for filtering.
 */
function pathAtCursor(
  bodyText: string,
): { path: string[]; slot: "key" | "value"; query: string } {
  const lines = bodyText.split("\n");
  // The path stack: at each indent depth, the most recent key (or "*"
  // for array element). The cursor's depth is determined by leading
  // whitespace on the current (last) line.
  type Frame = { indent: number; key: string };
  const stack: Frame[] = [];
  let pendingArrayKey: string | null = null;
  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i]!;
    const indent = line.match(/^(\s*)/)![1]!.length;
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("- ")) {
      // Array element: push "*" + parse the rest if it's `key: value`.
      stack.push({ indent, key: "*" });
      const rest = trimmed.slice(2).trim();
      if (rest.includes(":")) {
        const [k] = rest.split(":");
        if (k && k.trim()) {
          stack.push({ indent: indent + 2, key: k.trim() });
        }
      }
    } else if (trimmed === "-") {
      stack.push({ indent, key: "*" });
    } else {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        if (value === "" || value === "|" || value === ">") {
          // Block-style — children belong under this key
          stack.push({ indent, key });
        } else {
          // Inline value — key consumed
          pendingArrayKey = key; // not strictly needed; reset
          stack.push({ indent, key });
          stack.pop();
        }
      }
    }
  }
  // Now interpret the current (last) line.
  const cur = lines[lines.length - 1] ?? "";
  const curIndent = cur.match(/^(\s*)/)![1]!.length;
  while (stack.length > 0 && stack[stack.length - 1]!.indent >= curIndent) {
    stack.pop();
  }
  const trimmed = cur.trim();
  void pendingArrayKey;
  // Determine slot + query.
  // Cases on the current line:
  //   - empty / pure whitespace: key slot, empty query
  //   - "ke" (no colon): key slot, query "ke"
  //   - "key:" or "key: ": value slot, empty query
  //   - "key: val": value slot, query "val"
  //   - "- " or "-": key slot, empty query (inside an array element)
  //   - "- ke": key slot, query "ke"
  //   - "- key:": value slot, empty query
  let slot: "key" | "value" = "key";
  let query = "";
  if (trimmed.startsWith("- ")) {
    const after = trimmed.slice(2);
    const colon = after.indexOf(":");
    stack.push({ indent: curIndent, key: "*" });
    if (colon === -1) {
      slot = "key";
      query = after;
    } else {
      slot = "value";
      query = after.slice(colon + 1).trim();
      // Descend into the keyed field for value completions.
      stack.push({ indent: curIndent + 2, key: after.slice(0, colon).trim() });
    }
  } else if (trimmed === "-") {
    slot = "key";
    query = "";
    stack.push({ indent: curIndent, key: "*" });
  } else {
    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      slot = "key";
      query = trimmed;
    } else {
      slot = "value";
      query = trimmed.slice(colon + 1).trim();
      // Descend into the keyed field for value completions.
      stack.push({ indent: curIndent + 2, key: trimmed.slice(0, colon).trim() });
    }
  }
  const path = stack.map((f) => f.key);
  return { path, slot, query };
}

/**
 * Build the CodeMirror autocomplete source for fenced YAML blocks.
 * Wired into the notes editor via `EditorCompletionSourcesSlot`.
 */
export function buildBlockYamlCompletionSource(
  ctx: EditorCompletionContext,
): (cmCtx: CmCompletionContext) => CmCompletionResult | null {
  return (cmCtx) => {
    const kindIndex = buildBlockKindIndex(ctx.registry);
    if (kindIndex.all.length === 0) return null;
    const doc = cmCtx.state.doc.toString();
    // Fence info-string slot: cursor sits on an opening fence line —
    // either at the very end of ` ``` ` or on a partial kind name
    // (` ```ch|`). Suggest every registered block kind so the GM
    // discovers what's available without memorising the list.
    const infoMatch = cmCtx.matchBefore(/^[ ]{0,3}`{3,}([A-Za-z][\w-]*)?/);
    if (infoMatch) {
      // Only fire when we're actually on the opening fence (not on
      // a `\`\`\`` that's already inside a fence body). Walk back to
      // verify parity.
      const before = doc.slice(0, cmCtx.pos);
      const fenceLines = [...before.matchAll(/^(```+)\s*([^\n]*)$/gm)];
      // The fence we're typing IS one of those matches; we want
      // every fence STRICTLY BEFORE this one to be closed (even count).
      // The current opening fence is the last match in `before`; count
      // the rest. If that count is even, we're starting a new fence.
      const priorFences = fenceLines.slice(0, -1);
      if (priorFences.length % 2 === 0) {
        // Extract the partial kind text (the part of the match after
        // the backticks). If it ends with a stray closing line, bail.
        const wholeMatch = infoMatch.text;
        const partial = wholeMatch.replace(/^[ ]{0,3}`{3,}/, "");
        const options: Array<{
          label: string;
          detail?: string;
          type?: string;
          boost?: number;
          apply?: string;
        }> = [];
        const needle = partial.toLowerCase();
        for (const k of kindIndex.all) {
          if (needle.length > 0 && !k.name.toLowerCase().startsWith(needle)) {
            continue;
          }
          options.push({
            label: k.name,
            apply: k.name + " ",
            type: "type",
            ...(k.description ? { detail: k.description } : {}),
          });
        }
        if (options.length > 0) {
          return {
            from: cmCtx.pos - partial.length,
            to: cmCtx.pos,
            options,
          };
        }
      }
    }
    const fence = fenceAtCursor(doc, cmCtx.pos, kindIndex);
    if (!fence) return null;
    // Don't compete with [[…]] autocomplete — let the wiki-link
    // source own that.
    if (cmCtx.matchBefore(/\[\[[^\]\n]{0,160}/)) return null;
    const { path, slot, query } = pathAtCursor(fence.bodyText);
    const completions = computeBlockCompletions({
      kind: fence.kind,
      slot,
      path,
      query,
      allKinds: kindIndex.all,
      ctx: { world: ctx.world, registry: ctx.registry },
    });
    if (completions.length === 0) return null;
    const from = cmCtx.pos - query.length;
    return {
      from,
      to: cmCtx.pos,
      options: completions.map((c) => {
        const opt: {
          label: string;
          detail?: string;
          type?: string;
          boost?: number;
          apply?: string;
        } = {
          label: c.label ?? c.value,
          apply: slot === "key" ? `${c.value}: ` : c.value,
        };
        if (c.detail !== undefined) opt.detail = c.detail;
        if (c.source) opt.type = c.source;
        if (c.priority !== undefined) opt.boost = -c.priority; // lower priority → higher boost
        return opt;
      }),
    };
  };
}

/** Slot fill exported for plugin registration. */
export const yamlBlockCompletionFactory: EditorCompletionSourceFactory = {
  name: "adventures-yaml-block",
  build: (ctx) => buildBlockYamlCompletionSource(ctx),
};
