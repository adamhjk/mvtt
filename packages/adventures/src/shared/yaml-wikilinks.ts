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
 * YAML's flow syntax steals the `[` and `:` characters, which is fatal
 * for wiki-links: bare `- [[item:hammer]]` parses as
 * `[[{"item":"hammer"}]]` — three nested arrays with a mapping inside.
 * Authors then have to quote every link as `"[[item:hammer]]"` which
 * is noisy and easy to forget.
 *
 * This module preprocesses a YAML body to replace each `[[…]]` and
 * `![[…]]` literal with a sentinel token (a normal YAML-safe string),
 * runs `js-yaml` on the modified body, then walks the parsed value
 * tree and restores each token to the original wiki-link string.
 *
 * The contract: parsing `prepareYaml(body)` with js-yaml and then
 * passing the result to `restoreWikiLinks(value, table)` yields the
 * same shape as if the user had quoted every wiki-link by hand.
 *
 * Limitations:
 *   - Wiki-links inside double-quoted strings are NOT pre-escaped
 *     (they don't need to be — they already parse as strings). We
 *     still walk the parsed tree to restore tokens, so a quoted
 *     `"[[item:x]]"` round-trips as itself.
 *   - The sentinel uses Unicode codepoints unlikely to occur in real
 *     content (`` private-use area) so it's near-impossible to
 *     collide with author-written text.
 */

const SENTINEL_PREFIX = "WIKILINK_";
const SENTINEL_SUFFIX = "";
const SENTINEL_RE = new RegExp(`${SENTINEL_PREFIX}(\\d+)${SENTINEL_SUFFIX}`, "g");

export interface WikiLinkTable {
  readonly tokens: ReadonlyArray<string>;
}

/**
 * Walk the YAML body and replace each wiki-link literal (`[[…]]` and
 * `![[…]]`) with a sentinel token. The token form is a regular
 * unquoted string so YAML treats it as a scalar value, no matter
 * where it appears (list element, mapping value, flow style, …).
 *
 * Returns the rewritten body plus a table indexed by token number to
 * the original wiki-link source.
 */
export function prepareYaml(body: string): {
  body: string;
  table: WikiLinkTable;
} {
  const tokens: string[] = [];
  // Capture group 1 is the optional `!` (embed marker); group 2 is
  // the inner. We don't separate them — we restore the literal
  // source span verbatim, so the inner+outer come back intact.
  const re = /(!?)\[\[((?:(?!]]).){1,1024})]]/g;
  const rewritten = body.replace(re, (match) => {
    const idx = tokens.length;
    tokens.push(match);
    return `${SENTINEL_PREFIX}${idx}${SENTINEL_SUFFIX}`;
  });
  return { body: rewritten, table: { tokens } };
}

/**
 * Walk a parsed value tree and replace every sentinel string with the
 * original wiki-link source. Recurses into arrays + object values.
 *
 * Strings that contain a sentinel but aren't *just* the sentinel
 * (e.g. quantifier syntax `"2× <sentinel>"`) get the sentinel
 * substituted in place — the consumer's transform layer handles the
 * rest of the parse.
 */
export function restoreWikiLinks<T>(value: T, table: WikiLinkTable): T {
  return restore(value, table.tokens) as T;
}

function restore(value: unknown, tokens: ReadonlyArray<string>): unknown {
  if (typeof value === "string") {
    return restoreString(value, tokens);
  }
  if (Array.isArray(value)) {
    return value.map((v) => restore(v, tokens));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = restore(v, tokens);
    }
    return out;
  }
  return value;
}

function restoreString(s: string, tokens: ReadonlyArray<string>): string {
  // Fast path: the whole string is exactly one sentinel.
  SENTINEL_RE.lastIndex = 0;
  const onlyMatch = SENTINEL_RE.exec(s);
  if (onlyMatch && onlyMatch[0].length === s.length) {
    const idx = parseInt(onlyMatch[1]!, 10);
    return tokens[idx] ?? s;
  }
  // Substitution path: substring(s) appear in a larger composite
  // (e.g. quantifier prefix `2× …`). Replace each token in place.
  SENTINEL_RE.lastIndex = 0;
  return s.replace(SENTINEL_RE, (_full, num: string) => {
    const idx = parseInt(num, 10);
    return tokens[idx] ?? _full;
  });
}
