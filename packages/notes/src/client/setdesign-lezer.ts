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

/**
 * Hand-built Lezer parser for the body of a ```setdesign fence.
 *
 * Plugs into `@lezer/markdown`'s `parseCode` extension as the nested
 * parser for the `setdesign` info string. Emits a typed syntax tree
 * the editor can use for highlighting, folding, indent computation,
 * structural navigation, and live-preview decoration.
 *
 * Tree shape:
 *
 *   SetdesignDoc
 *     SetdesignHeader?
 *       Text run
 *       SetdesignHeaderRule
 *     SetdesignBranch*       ← foldable, indent-defining
 *       SetdesignLine
 *         SetdesignIndent?
 *         SetdesignLinePrefix?   (leading `->` / `|->`)
 *         SetdesignSegment ( SetdesignArrow SetdesignSegment )*
 *           ( SetdesignBold | SetdesignItalic | SetdesignCode |
 *             SetdesignWikiLink | SetdesignText )*
 *       SetdesignBranch*     (children: lines with strictly greater indent)
 *
 * Parsing strategy:
 *
 *  1. Walk the input by line. Detect the optional header (line[0]
 *     non-blank + line[1] = `---+`).
 *  2. For the body, build the branch tree by indent. Each Line becomes
 *     a leaf; deeper-indented Lines become children of a wrapping
 *     SetdesignBranch nested under the previous shallower Line.
 *  3. For each Line, tokenize its content into Indent / LinePrefix /
 *     Segments (split on internal arrows) / Arrows.
 *  4. For each Segment, scan inline-markdown delimiters (**bold**,
 *     *italic*, _italic_, `code`, [[wikilink]]) and emit nested
 *     inline nodes.
 *
 * The parser is non-incremental — every call re-parses the full
 * fence content. Fence bodies are bounded (typically tens of lines,
 * rarely hundreds) so the cost is negligible compared to the rest
 * of the markdown parse.
 */

import {
  Parser,
  Tree,
  NodeType,
  NodeSet,
  type PartialParse,
  type Input,
} from "@lezer/common";
import { styleTags, tags as t } from "@lezer/highlight";
import {
  defineLanguageFacet,
  foldNodeProp,
  indentNodeProp,
  languageDataProp,
} from "@codemirror/language";

// ---------- Node IDs ----------

/**
 * Node IDs are dense indices into the NodeSet. ID 0 is reserved by
 * Lezer for `NodeType.none` (used as the document-error type).
 */
export const enum SD {
  None = 0,
  Doc,
  Header,
  HeaderRule,
  Branch,
  Line,
  Indent,
  LinePrefix,
  Segment,
  Arrow,
  Bold,
  BoldMark,
  Italic,
  ItalicMark,
  Code,
  CodeMark,
  WikiLink,
  WikiLinkMark,
  WikiLinkBody,
  StatBlock,
  Text,
}

const NODE_NAMES: readonly string[] = [
  "",
  "SetdesignDoc",
  "SetdesignHeader",
  "SetdesignHeaderRule",
  "SetdesignBranch",
  "SetdesignLine",
  "SetdesignIndent",
  "SetdesignLinePrefix",
  "SetdesignSegment",
  "SetdesignArrow",
  "SetdesignBold",
  "SetdesignBoldMark",
  "SetdesignItalic",
  "SetdesignItalicMark",
  "SetdesignCode",
  "SetdesignCodeMark",
  "SetdesignWikiLink",
  "SetdesignWikiLinkMark",
  "SetdesignWikiLinkBody",
  "SetdesignStatBlock",
  "SetdesignText",
];

// ---------- NodeSet + props ----------

const nodeTypes: NodeType[] = NODE_NAMES.map((name, id) =>
  id === SD.None
    ? NodeType.none
    : NodeType.define({
        id,
        name,
        top: id === SD.Doc,
      }),
);

const baseNodeSet = new NodeSet(nodeTypes);

/**
 * Language-data facet attached to the `SetdesignDoc` top node (via
 * `languageDataProp` on the nodeSet, see below). The host editor's
 * `closeBrackets()` extension reads this through
 * `EditorState.languageDataAt(pos, "closeBrackets")` and uses the
 * `brackets` list to decide which characters auto-pair. We add `*`
 * and `_` (markdown bold/italic markers) and `` ` `` on top of the
 * standard punctuation so authors can type `*`, `**`, `_`, `` ` ``,
 * and `[` and have the closing delimiter inserted automatically —
 * with the skip-over and selection-wrap behavior `closeBrackets`
 * already implements correctly.
 */
const setdesignLanguageFacet = defineLanguageFacet({
  closeBrackets: {
    brackets: ["(", "[", "{", "'", '"', "`", "*", "_"],
  },
});

/**
 * Highlight tags. The editor's existing `markdownHighlightStyle` in
 * CodeMirrorEditor.tsx maps these to design-token colors, so the
 * arrows, bold markers, wiki-links, and stat blocks get styled the
 * same way the surrounding markdown does — no per-color duplication.
 */
const setdesignNodeSet = baseNodeSet
  .extend(
    styleTags({
      SetdesignHeader: t.heading2,
      SetdesignHeaderRule: t.contentSeparator,
      SetdesignArrow: t.operator,
      SetdesignLinePrefix: t.operator,
      "SetdesignBold/...": t.strong,
      SetdesignBoldMark: t.punctuation,
      "SetdesignItalic/...": t.emphasis,
      SetdesignItalicMark: t.punctuation,
      "SetdesignCode/...": t.monospace,
      SetdesignCodeMark: t.punctuation,
      "SetdesignWikiLink/...": t.link,
      SetdesignWikiLinkMark: t.punctuation,
      "SetdesignStatBlock/...": t.emphasis,
      SetdesignText: t.content,
    }),
  )
  .extend(
    foldNodeProp.add({
      SetdesignBranch: (node) => {
        // Fold from end of the first line in the branch to the end
        // of the branch. The branch's first child is the parent
        // Line; the rest are nested children.
        const firstLine = node.firstChild;
        if (!firstLine) return null;
        if (firstLine.to >= node.to) return null;
        return { from: firstLine.to, to: node.to };
      },
    }),
  )
  .extend(
    indentNodeProp.add({
      // For a child-line inside a SetdesignBranch, the desired indent
      // is the column of the branch's first Line + 2 (one nest step).
      // `column` here is best-effort: the indent service walks the
      // line, so we just say "match the deepest open branch + 2."
      SetdesignBranch: (cx) => {
        const lineIndent = cx.lineIndent(cx.node.from, 1);
        return lineIndent + 2;
      },
      SetdesignDoc: (cx) => cx.baseIndent,
    }),
  )
  // Attach the setdesign language-data facet to the top node so
  // `EditorState.languageDataAt(pos)` inside a setdesign fence
  // returns our config — chiefly the `closeBrackets` brackets list
  // (`*`, `_`, `` ` ``, `[`) which the editor's `closeBrackets()`
  // extension reads to decide what to auto-pair. Outside the fence,
  // the host markdown language's defaults remain in effect.
  .extend(
    languageDataProp.add({
      SetdesignDoc: setdesignLanguageFacet,
    }),
  );

// ---------- Parser ----------

class SetdesignParser extends Parser {
  createParse(
    input: Input,
    _fragments: readonly unknown[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    return new SetdesignParse(input, ranges);
  }
}

class SetdesignParse implements PartialParse {
  readonly parsedPos: number;
  stoppedAt: number | null = null;
  private readonly tree: Tree;

  constructor(
    input: Input,
    ranges: readonly { from: number; to: number }[],
  ) {
    // We treat the fence body as a single contiguous run for
    // parsing — multi-range nested fences would need stitching.
    const from = ranges[0]?.from ?? 0;
    const to = ranges[ranges.length - 1]?.to ?? from;
    const text = input.read(from, to);
    this.tree = buildTree(text, to - from);
    this.parsedPos = to;
  }

  advance(): Tree | null {
    return this.tree;
  }

  stopAt(pos: number): void {
    this.stoppedAt = pos;
  }
}

export const setdesignParser = new SetdesignParser();

/** The `NodeSet` used by the setdesign parser — exported so commands
 * walking the syntax tree can resolve our typed nodes via name. */
export const setdesignNodes = setdesignNodeSet;

// ---------- Tree construction ----------

/**
 * Buffer entry layout for `Tree.build`: [typeId, from, to, size].
 * `size` is 4 * (1 + descendant-count). Parents come AFTER children
 * in postfix order.
 */
type BufferBuilder = {
  push: (typeId: number, from: number, to: number, childrenSize: number) => void;
  buffer: number[];
};

function makeBufferBuilder(): BufferBuilder {
  const buffer: number[] = [];
  return {
    buffer,
    push(typeId, from, to, childrenSize) {
      buffer.push(typeId, from, to, childrenSize + 4);
    },
  };
}

function buildTree(text: string, totalLength: number): Tree {
  const b = makeBufferBuilder();
  emitDoc(b, text);
  return Tree.build({
    buffer: b.buffer,
    nodeSet: setdesignNodeSet,
    topID: SD.Doc,
    length: totalLength,
  });
}

// ---------- Line-level + branch tree ----------

interface LineToken {
  /** Indent column (count of leading spaces; tabs = 2 spaces). */
  indent: number;
  /** Absolute offset of line start in the input. */
  lineStart: number;
  /** Absolute offset of the line's content end (before any `\n`). */
  lineEnd: number;
  /** Raw line text (no trailing `\n`). */
  text: string;
  /** True for blank-only lines (won't appear as branches). */
  blank: boolean;
}

function tokenizeLines(text: string): LineToken[] {
  const out: LineToken[] = [];
  let pos = 0;
  while (pos <= text.length) {
    const nl = text.indexOf("\n", pos);
    const end = nl === -1 ? text.length : nl;
    const lineText = text.slice(pos, end);
    const trimmed = lineText.trim();
    let indent = 0;
    for (const ch of lineText) {
      if (ch === " ") indent++;
      else if (ch === "\t") indent += 2;
      else break;
    }
    out.push({
      indent,
      lineStart: pos,
      lineEnd: end,
      text: lineText,
      blank: trimmed.length === 0,
    });
    if (nl === -1) break;
    pos = nl + 1;
  }
  return out;
}

function emitDoc(b: BufferBuilder, text: string): void {
  if (text.length === 0) {
    b.push(SD.Doc, 0, 0, 0);
    return;
  }
  const lines = tokenizeLines(text);

  // Header: first non-blank line followed by a `---+` rule line.
  let bodyStart = 0;
  let headerSize = 0;
  {
    let i = 0;
    while (i < lines.length && lines[i]!.blank) i++;
    if (
      i + 1 < lines.length &&
      !lines[i]!.blank &&
      /^-{3,}\s*$/.test(lines[i + 1]!.text.trim())
    ) {
      headerSize = emitHeader(b, lines[i]!, lines[i + 1]!);
      bodyStart = i + 2;
    }
  }

  // Body: build branches by indent.
  const bodyLines = lines.slice(bodyStart).filter((l) => !l.blank);
  const branchesSize = emitBranches(b, bodyLines, 0, bodyLines.length);

  const docFrom = 0;
  const docTo = text.length;
  b.push(SD.Doc, docFrom, docTo, headerSize + branchesSize);
}

function emitHeader(
  b: BufferBuilder,
  titleLine: LineToken,
  ruleLine: LineToken,
): number {
  // The header inner doesn't carry further structure (it's just a
  // text run + a rule). Position the rule node within the header
  // span so its node prop hits work cleanly.
  let inner = 0;
  // Emit the rule as a child of the header.
  b.push(SD.HeaderRule, ruleLine.lineStart, ruleLine.lineEnd, 0);
  inner += 4;
  const headerFrom = titleLine.lineStart;
  const headerTo = ruleLine.lineEnd;
  b.push(SD.Header, headerFrom, headerTo, inner);
  return 4 + inner;
}

/**
 * Emit a flat list of branches at the current scope. Each branch
 * wraps one Line plus any deeper-indented descendants.
 *
 * Returns the total buffer-size of emitted nodes (in number-array
 * entries — i.e., 4 per node, including descendants).
 */
function emitBranches(
  b: BufferBuilder,
  lines: LineToken[],
  start: number,
  end: number,
): number {
  let pos = start;
  let totalSize = 0;
  while (pos < end) {
    const head = lines[pos]!;
    // Find the extent of this branch: while subsequent lines are
    // strictly more indented than `head`, they belong to it.
    let childEnd = pos + 1;
    while (childEnd < end && lines[childEnd]!.indent > head.indent) {
      childEnd++;
    }
    // Branch span: from this line's start to the end of the deepest
    // child line.
    const branchFrom = head.lineStart;
    const branchTo =
      childEnd > pos + 1
        ? lines[childEnd - 1]!.lineEnd
        : head.lineEnd;

    let innerSize = 0;
    // Emit the head line first (children come before parent).
    innerSize += emitLine(b, head);
    // Then emit nested branches (each containing one descendant line
    // and its own children).
    if (childEnd > pos + 1) {
      innerSize += emitBranches(b, lines, pos + 1, childEnd);
    }
    b.push(SD.Branch, branchFrom, branchTo, innerSize);
    totalSize += 4 + innerSize;
    pos = childEnd;
  }
  return totalSize;
}

// ---------- Per-line tokenization ----------

const ARROW_LINE_PREFIX_RE = /^(\s*)(\|?\s*(?:->|→))/;
const INTERNAL_ARROW_RE = /\s*(?:->|→)\s*/g;

function emitLine(b: BufferBuilder, line: LineToken): number {
  const lineFrom = line.lineStart;
  const lineTo = line.lineEnd;
  let inner = 0;

  // Indent.
  let pos = 0;
  while (pos < line.text.length && (line.text[pos] === " " || line.text[pos] === "\t")) {
    pos++;
  }
  if (pos > 0) {
    b.push(SD.Indent, lineFrom, lineFrom + pos, 0);
    inner += 4;
  }

  // Line prefix (leading -> or |->).
  const afterIndent = line.text.slice(pos);
  const prefixMatch = ARROW_LINE_PREFIX_RE.exec(afterIndent);
  let segmentStart = pos;
  if (prefixMatch && prefixMatch[2]) {
    const prefixOffset = pos + (prefixMatch[1]?.length ?? 0);
    const prefixLen = prefixMatch[2].length;
    b.push(
      SD.LinePrefix,
      lineFrom + prefixOffset,
      lineFrom + prefixOffset + prefixLen,
      0,
    );
    inner += 4;
    segmentStart = pos + prefixMatch[0].length;
    // Skip whitespace after the prefix.
    while (
      segmentStart < line.text.length &&
      line.text[segmentStart] === " "
    ) {
      segmentStart++;
    }
  }

  // Segments split on internal arrows.
  const segContent = line.text.slice(segmentStart);
  inner += emitSegments(b, segContent, lineFrom + segmentStart);

  b.push(SD.Line, lineFrom, lineTo, inner);
  return 4 + inner;
}

function emitSegments(
  b: BufferBuilder,
  segText: string,
  baseOffset: number,
): number {
  if (segText.length === 0) return 0;
  let inner = 0;
  let cursor = 0;
  INTERNAL_ARROW_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let prevEnd = 0;
  const arrowRanges: Array<{ start: number; end: number }> = [];
  while ((match = INTERNAL_ARROW_RE.exec(segText)) !== null) {
    arrowRanges.push({ start: match.index, end: match.index + match[0].length });
  }

  for (let i = 0; i <= arrowRanges.length; i++) {
    const segStart = i === 0 ? 0 : arrowRanges[i - 1]!.end;
    const segEnd = i === arrowRanges.length ? segText.length : arrowRanges[i]!.start;
    const slice = segText.slice(segStart, segEnd);
    const trimmedLen = slice.trimEnd().length;
    if (segStart < segEnd && trimmedLen > 0) {
      const absStart = baseOffset + segStart;
      const absEnd = baseOffset + segStart + trimmedLen;
      const segInner = emitInline(b, slice.slice(0, trimmedLen), absStart);
      b.push(SD.Segment, absStart, absEnd, segInner);
      inner += 4 + segInner;
    }
    if (i < arrowRanges.length) {
      const arrow = arrowRanges[i]!;
      b.push(
        SD.Arrow,
        baseOffset + arrow.start,
        baseOffset + arrow.end,
        0,
      );
      inner += 4;
    }
    cursor = segEnd;
  }
  void prevEnd;
  void cursor;
  return inner;
}

// ---------- Inline markup ----------

/**
 * Scan a segment for inline markup. Recognizes (in priority order):
 *
 *   `code`            (backtick-delimited monospace)
 *   [[...]] / ![[..]]  (wiki-link, optionally embed-marked)
 *   **...**           (bold)
 *   _..._ / *...*     (italic)
 *   (_..._)           (stat block — parens around italic)
 *
 * Non-matching characters accumulate into `SetdesignText` runs.
 *
 * Returns the total size (in 4-tuples) of emitted nodes.
 */
function emitInline(
  b: BufferBuilder,
  text: string,
  baseOffset: number,
): number {
  let inner = 0;
  let i = 0;
  let runStart = 0;

  const flushText = (until: number) => {
    if (until > runStart) {
      b.push(SD.Text, baseOffset + runStart, baseOffset + until, 0);
      inner += 4;
    }
  };

  while (i < text.length) {
    const ch = text[i]!;

    // Wiki-link: optional `!`, then `[[…]]`.
    if (ch === "[" || (ch === "!" && text[i + 1] === "[" && text[i + 2] === "[")) {
      const hasBang = ch === "!";
      const openAt = hasBang ? i + 1 : i;
      if (text[openAt] === "[" && text[openAt + 1] === "[") {
        const close = text.indexOf("]]", openAt + 2);
        if (close >= 0) {
          flushText(i);
          const linkFrom = baseOffset + i;
          const linkTo = baseOffset + close + 2;
          let linkInner = 0;
          // Open mark — `[[` (and optional preceding `!`).
          b.push(
            SD.WikiLinkMark,
            baseOffset + i,
            baseOffset + openAt + 2,
            0,
          );
          linkInner += 4;
          // Body.
          if (close > openAt + 2) {
            b.push(
              SD.WikiLinkBody,
              baseOffset + openAt + 2,
              baseOffset + close,
              0,
            );
            linkInner += 4;
          }
          // Close mark — `]]`.
          b.push(
            SD.WikiLinkMark,
            baseOffset + close,
            baseOffset + close + 2,
            0,
          );
          linkInner += 4;
          b.push(SD.WikiLink, linkFrom, linkTo, linkInner);
          inner += 4 + linkInner;
          i = close + 2;
          runStart = i;
          continue;
        }
      }
    }

    // Inline code: `…`.
    if (ch === "`") {
      const close = text.indexOf("`", i + 1);
      if (close > i) {
        flushText(i);
        const from = baseOffset + i;
        const to = baseOffset + close + 1;
        let codeInner = 0;
        b.push(SD.CodeMark, baseOffset + i, baseOffset + i + 1, 0);
        codeInner += 4;
        if (close > i + 1) {
          b.push(SD.Text, baseOffset + i + 1, baseOffset + close, 0);
          codeInner += 4;
        }
        b.push(SD.CodeMark, baseOffset + close, baseOffset + close + 1, 0);
        codeInner += 4;
        b.push(SD.Code, from, to, codeInner);
        inner += 4 + codeInner;
        i = close + 1;
        runStart = i;
        continue;
      }
    }

    // Bold: **…**.
    if (ch === "*" && text[i + 1] === "*") {
      const close = text.indexOf("**", i + 2);
      if (close > i + 1) {
        flushText(i);
        const from = baseOffset + i;
        const to = baseOffset + close + 2;
        let boldInner = 0;
        b.push(SD.BoldMark, baseOffset + i, baseOffset + i + 2, 0);
        boldInner += 4;
        if (close > i + 2) {
          boldInner += emitInline(b, text.slice(i + 2, close), baseOffset + i + 2);
        }
        b.push(SD.BoldMark, baseOffset + close, baseOffset + close + 2, 0);
        boldInner += 4;
        b.push(SD.Bold, from, to, boldInner);
        inner += 4 + boldInner;
        i = close + 2;
        runStart = i;
        continue;
      }
    }

    // Italic: *…* (single asterisk, not part of **) or _…_.
    if ((ch === "*" || ch === "_") && text[i + 1] !== ch) {
      const close = text.indexOf(ch, i + 1);
      if (close > i && (close + 1 >= text.length || text[close + 1] !== ch)) {
        // Don't treat *…** as italic — that would conflict with bold.
        flushText(i);
        const from = baseOffset + i;
        const to = baseOffset + close + 1;
        let itInner = 0;
        b.push(SD.ItalicMark, baseOffset + i, baseOffset + i + 1, 0);
        itInner += 4;
        if (close > i + 1) {
          itInner += emitInline(b, text.slice(i + 1, close), baseOffset + i + 1);
        }
        b.push(SD.ItalicMark, baseOffset + close, baseOffset + close + 1, 0);
        itInner += 4;
        b.push(SD.Italic, from, to, itInner);
        inner += 4 + itInner;
        i = close + 1;
        runStart = i;
        continue;
      }
    }

    i++;
  }
  flushText(text.length);
  return inner;
}

// ---------- Re-exports ----------

export const setdesignNodeNames = NODE_NAMES;
