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
 * Set-design block grammar — the in-note format for Courtney Campbell's
 * "set design" room-keying technique (Hack & Slash blog), adapted to a
 * fenced markdown code block. Source form:
 *
 *     ```setdesign
 *     Old Library 7)
 *     ---
 *     **Bookshelves** N+E walls -> sagging, collapsed
 *     **Oak Desk** SW -> drawers dumped
 *       -> locked drawer -> DC 15 Thieves' / DC 18 Str
 *         -> scroll case -> spell scroll (detect magic)
 *           -> note (Elvish): "Vault key with captain."
 *
 *     Giant Rats (3) -> behind collapsed N shelves
 *       (_HP 7, 6, 5_)
 *       -> attack if shelves disturbed
 *     ```
 *
 * Rules:
 *
 *  - The first line followed by a `---` separator becomes the block's
 *    header. Otherwise the block has no header and every line is part
 *    of the tree.
 *
 *  - Indentation by spaces determines nesting. Two spaces of additional
 *    indent (or any positive delta from the parent) descends a level.
 *    We don't enforce a specific unit — we use raw column count and
 *    attach each line to the most recent ancestor at strictly lower
 *    indent.
 *
 *  - A leading `->`, `→`, `|->`, or `|→` on a line is decorative and
 *    consumed silently; it doesn't change the line's tree position.
 *    Indentation alone determines parent/child relationships.
 *
 *  - Within a line, `->` and `→` separate chained nouns: the line
 *    `Bookshelves -> sagging -> collapsed` produces three segments
 *    rendered with arrows between them.
 *
 *  - `**bold**`, `*italic*`, `_italic_`, `` `code` ``, and `[[wikilink]]`
 *    survive into the rendered output — the remark side re-parses each
 *    line's segments as markdown phrasing.
 *
 *  - Blank lines are visual separators only. They don't appear in the
 *    parsed tree, but `blankBefore: true` is set on the next sibling so
 *    the renderer can add extra spacing.
 *
 * The parser is pure and DOM-free; it lives in shared/ so the server's
 * link-extraction passes (and unit tests) can use it without dragging
 * in remark.
 */

export interface SetDesignNode {
  /**
   * The line as written, with the leading arrow prefix (`->` / `|->`)
   * stripped and surrounding whitespace trimmed. Internal arrows
   * are preserved — the renderer splits this further into chained
   * segments at render time.
   */
  readonly text: string;
  /** True when the source line above this one was blank — render hint. */
  readonly blankBefore: boolean;
  readonly children: ReadonlyArray<SetDesignNode>;
}

export interface SetDesignBlock {
  readonly header: string | null;
  readonly root: ReadonlyArray<SetDesignNode>;
}

const ARROW_LINE_PREFIX = /^\s*\|?\s*(?:->|→)\s*/;
const HEADER_RULE = /^-{3,}\s*$/;

/**
 * Parse a `setdesign` code-fence body into a tree. The input is the
 * raw text between the opening and closing fences (the fences and
 * the lang tag are not included).
 */
export function parseSetDesign(source: string): SetDesignBlock {
  const rawLines = source.split("\n");

  // Header: first non-blank line followed by a `---` separator.
  let header: string | null = null;
  let bodyStart = 0;
  {
    // Skip leading blanks.
    let i = 0;
    while (i < rawLines.length && rawLines[i]!.trim().length === 0) i++;
    if (i + 1 < rawLines.length && HEADER_RULE.test(rawLines[i + 1]!.trim())) {
      header = rawLines[i]!.trim();
      bodyStart = i + 2;
    }
  }

  // Walk remaining lines: track indentation, build tree, mark blank-
  // separated siblings.
  interface Item {
    indent: number;
    text: string;
    blankBefore: boolean;
  }
  const items: Item[] = [];
  let pendingBlank = false;
  for (let li = bodyStart; li < rawLines.length; li++) {
    const line = rawLines[li]!;
    if (line.trim().length === 0) {
      pendingBlank = true;
      continue;
    }
    const indentMatch = line.match(/^[ \t]*/);
    const indent = indentMatch ? expandTabs(indentMatch[0]).length : 0;
    const stripped = line.slice(indentMatch?.[0].length ?? 0);
    const withoutPrefix = stripped.replace(ARROW_LINE_PREFIX, "").trimEnd();
    items.push({ indent, text: withoutPrefix, blankBefore: pendingBlank });
    pendingBlank = false;
  }

  // Build the tree by popping a parent stack down to the nearest
  // ancestor with strictly lower indent.
  interface Frame {
    indent: number;
    children: SetDesignNode[];
  }
  const root: SetDesignNode[] = [];
  const stack: Frame[] = [{ indent: -1, children: root }];
  for (const item of items) {
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= item.indent) {
      stack.pop();
    }
    const node: SetDesignNode & { children: SetDesignNode[] } = {
      text: item.text,
      blankBefore: item.blankBefore,
      children: [],
    };
    stack[stack.length - 1]!.children.push(node);
    stack.push({ indent: item.indent, children: node.children });
  }
  return { header, root };
}

/**
 * Split a single line's text into arrow-separated segments. Used by
 * the renderer to produce one inline phrasing run per segment with
 * arrow glyphs between them. Empty segments (from trailing arrows,
 * which authors sometimes leave dangling) are dropped.
 */
export function splitSegments(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/\s*(?:->|→)\s*/)) {
    const trimmed = part.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

function expandTabs(s: string): string {
  // Treat a tab as two spaces — matches the editor's indentUnit and
  // the markdown convention.
  return s.replace(/\t/g, "  ");
}
