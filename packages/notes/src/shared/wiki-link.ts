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

/**
 * Wiki-link grammar — single source of truth for both the editor-side
 * Lezer extension (lands in client code) and the canonical server-side
 * parser used by `PageBodyParseSystem` to extract outgoing links and
 * derive backlinks.
 *
 * Grammar:
 *
 *   wikiLink = ('!')?  '[['  (kindPrefix | sigilPrefix)?  body
 *                       ('#' anchor)?  ('|' alias)?  ']]'
 *
 *   kindPrefix  = identifier ':'        // e.g. "note:", "character:"
 *   sigilPrefix = sigil                 // e.g. "@" for character (registered)
 *   body        = [^|#\]]+              // plus any character that isn't ']' alone
 *   anchor      = [^|\]]+
 *   alias       = [^\]]+
 *
 * The default kind (when no prefix is present) is "note" — see the
 * design doc. Sigil → kind resolution is done at parse-call time by
 * looking up the registered sigil set.
 *
 * Whitespace is tolerated immediately inside `[[ … ]]` boundaries
 * (people sometimes type `[[ Goblin Cave ]]`); leading/trailing space
 * on body/anchor/alias is trimmed.
 */

export interface WikiLinkRef {
  /** True for `![[…]]` (embed); false for `[[…]]` (reference). */
  readonly embed: boolean;
  /**
   * Resolved kind name. Either the explicit `kind:` prefix, or the kind
   * registered for the matched sigil, or the default kind ("note") when
   * neither is present.
   */
  readonly kind: string;
  /**
   * The body — opaque to the grammar. For the default kind it's a note
   * title (when typed by hand) or a stable id (post-normalisation). For
   * `character` it's a character name or id. Every kind parses its own
   * body via its registered `parse(body, anchor)` function.
   */
  readonly body: string;
  /** The portion after `#`, or null if no anchor was given. */
  readonly anchor: string | null;
  /** The portion after `|`, or null if no alias was given. */
  readonly alias: string | null;
  /**
   * Source range in the original text — `[start, endExclusive)`.
   * Lezer-side decoration uses this; canonical-side `LinkAdded`
   * extraction ignores it.
   */
  readonly range: readonly [number, number];
  /** The exact source span (including `[[` / `]]` / `!`). */
  readonly raw: string;
}

export interface ParseOptions {
  /**
   * Sigil → kind map (e.g. `{ "@": "character" }`). Plugins register
   * their sigils via `defineLinkKind`; the registry consolidates them
   * and passes the map here. Sigils are single non-alphanumeric chars.
   */
  readonly sigils?: Readonly<Record<string, string>>;
  /**
   * Kind name returned when no `kind:` prefix and no registered sigil
   * matches. Defaults to `"note"`.
   */
  readonly defaultKind?: string;
  /**
   * Set of *known* kind names. When provided, `kind:body` is only
   * treated as a kind prefix if `kind` is in the set — otherwise the
   * literal `kind:body` is the body itself. Lets us forbid bogus
   * `[[foo:bar]]` from being misparsed as kind=foo. When omitted, any
   * `<ident>:<rest>` pattern is treated as a kind prefix.
   */
  readonly knownKinds?: ReadonlySet<string>;
}

const DEFAULT_KIND = "note";

/**
 * The single source-of-truth regex. Matches both `[[…]]` and `![[…]]`.
 * Group 1 captures the optional `!` (embed marker). Group 2 captures
 * everything between `[[` and `]]` (the inner). We don't try to slice
 * the inner inside the regex — separating concerns keeps the regex
 * readable and the post-processor unit-testable in isolation.
 */
const LINK_RE = /(!)?\[\[((?:(?!]]).){1,1024})]]/g;

/**
 * Parse a single inner-of-brackets string into the typed pieces.
 * Exposed for testing; consumers normally call `parseLinks`.
 */
export function parseInner(
  inner: string,
  opts: ParseOptions = {},
): {
  kind: string;
  body: string;
  anchor: string | null;
  alias: string | null;
} | null {
  const trimmed = inner.trim();
  if (trimmed.length === 0) return null;

  // 1. Pull off optional alias (`|alias`). Pipe is unambiguous because
  //    body and anchor disallow it.
  const pipeIdx = trimmed.indexOf("|");
  const aliasPart =
    pipeIdx >= 0 ? trimmed.slice(pipeIdx + 1).trim() : null;
  const headPart = pipeIdx >= 0 ? trimmed.slice(0, pipeIdx) : trimmed;
  if (aliasPart !== null && aliasPart.length === 0) return null;

  // 2. Pull off optional anchor (`#anchor`).
  const hashIdx = headPart.indexOf("#");
  const anchorPart =
    hashIdx >= 0 ? headPart.slice(hashIdx + 1).trim() : null;
  const beforeAnchor = hashIdx >= 0 ? headPart.slice(0, hashIdx) : headPart;
  if (anchorPart !== null && anchorPart.length === 0) return null;

  // 3. Resolve kind: explicit `kind:`, or registered sigil, or default.
  const sigils = opts.sigils ?? {};
  const knownKinds = opts.knownKinds ?? null;
  const defaultKind = opts.defaultKind ?? DEFAULT_KIND;

  const beforeAnchorTrimmed = beforeAnchor.trim();
  if (beforeAnchorTrimmed.length === 0) return null;

  // Sigil match: first non-whitespace char is a registered sigil.
  const firstChar = beforeAnchorTrimmed[0]!;
  if (Object.prototype.hasOwnProperty.call(sigils, firstChar)) {
    const body = beforeAnchorTrimmed.slice(1).trim();
    if (body.length === 0) return null;
    return {
      kind: sigils[firstChar]!,
      body,
      anchor: anchorPart,
      alias: aliasPart,
    };
  }

  // kind: prefix.
  const colonIdx = beforeAnchorTrimmed.indexOf(":");
  if (colonIdx > 0) {
    const candidate = beforeAnchorTrimmed.slice(0, colonIdx).trim();
    const isIdent = /^[a-zA-Z][\w-]*$/.test(candidate);
    if (isIdent && (!knownKinds || knownKinds.has(candidate))) {
      const body = beforeAnchorTrimmed.slice(colonIdx + 1).trim();
      if (body.length === 0) return null;
      return {
        kind: candidate,
        body,
        anchor: anchorPart,
        alias: aliasPart,
      };
    }
  }

  return {
    kind: defaultKind,
    body: beforeAnchorTrimmed,
    anchor: anchorPart,
    alias: aliasPart,
  };
}

/**
 * Find every wiki-link in `text`. Returns them in source order with
 * resolved kind, parsed body/anchor/alias, and source ranges.
 *
 * Skips matches *inside fenced code blocks* and *inside backtick-
 * delimited inline code*. Anything else (paragraphs, lists, tables,
 * blockquotes, headings) is fair game.
 */
export function parseLinks(
  text: string,
  opts: ParseOptions = {},
): WikiLinkRef[] {
  const out: WikiLinkRef[] = [];
  const masked = maskCode(text);
  let match: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((match = LINK_RE.exec(masked)) !== null) {
    const start = match.index;
    const raw = match[0];
    const end = start + raw.length;
    const embed = match[1] === "!";
    const inner = match[2]!;
    const parsed = parseInner(inner, opts);
    if (!parsed) continue;
    out.push({
      embed,
      kind: parsed.kind,
      body: parsed.body,
      anchor: parsed.anchor,
      alias: parsed.alias,
      range: [start, end],
      raw,
    });
  }
  return out;
}

/**
 * Replace fenced-code-block bodies and inline-backtick spans with
 * spaces of equal length so the link regex can't pick up `[[…]]`
 * literals inside code samples. Preserves byte offsets so reported
 * ranges still index the original text correctly.
 */
function maskCode(text: string): string {
  const chars = text.split("");
  let i = 0;
  let inFence = false;
  let fenceMarker: string | null = null;

  // Walk lines for fenced blocks, then scrub inline backticks per
  // line in non-fence regions.
  const lines = text.split("\n");
  let cursor = 0;
  for (const line of lines) {
    const lineStart = cursor;
    const lineEnd = cursor + line.length;
    const fenceMatch = /^([ ]{0,3})(`{3,}|~{3,})/.exec(line);
    if (inFence) {
      // Mask the whole line as code.
      for (i = lineStart; i < lineEnd; i++) {
        if (chars[i] !== "\n") chars[i] = " ";
      }
      if (fenceMatch && fenceMarker !== null && line.trim().startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = null;
      }
    } else if (fenceMatch) {
      inFence = true;
      fenceMarker = fenceMatch[2]!;
      for (i = lineStart; i < lineEnd; i++) {
        if (chars[i] !== "\n") chars[i] = " ";
      }
    } else {
      // Scrub inline backtick spans on this line.
      let j = lineStart;
      while (j < lineEnd) {
        if (chars[j] === "`") {
          // Count run length.
          const runStart = j;
          while (j < lineEnd && chars[j] === "`") j++;
          const runLen = j - runStart;
          // Look for a matching closing run on the same line.
          let k = j;
          while (k < lineEnd) {
            if (chars[k] === "`") {
              const closeStart = k;
              while (k < lineEnd && chars[k] === "`") k++;
              if (k - closeStart === runLen) {
                // Mask runStart .. k inclusive.
                for (let m = runStart; m < k; m++) {
                  if (chars[m] !== "\n") chars[m] = " ";
                }
                break;
              }
            } else {
              k++;
            }
          }
          if (k >= lineEnd) {
            // No matching close — leave the run alone.
          }
          j = k;
        } else {
          j++;
        }
      }
    }
    cursor = lineEnd + 1; // +1 for the consumed '\n'
  }
  return chars.join("");
}

/**
 * Build the canonical normalised storage form of a link, given a
 * resolved id (and optional anchor + alias). Used by the editor when
 * a user-typed `[[Goblin Cave]]` is rewritten to `[[note:e42|Goblin
 * Cave]]` on save.
 */
export function formatLink(args: {
  kind: string;
  body: string;
  anchor?: string | null;
  alias?: string | null;
  embed?: boolean;
}): string {
  const head = `${args.kind}:${args.body}`;
  const withAnchor = args.anchor ? `${head}#${args.anchor}` : head;
  const withAlias = args.alias ? `${withAnchor}|${args.alias}` : withAnchor;
  return `${args.embed ? "!" : ""}[[${withAlias}]]`;
}
