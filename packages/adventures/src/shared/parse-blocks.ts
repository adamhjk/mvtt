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
 * One fenced block extracted from a markdown body. The `kind` is the
 * first word of the info string (e.g. "npc Greta the Smith" → kind
 * "npc"). The `info` is the full info-string after the kind word
 * (the canonical name). `body` is the YAML between the fences.
 */
export interface FencedBlock {
  readonly kind: string;
  readonly info: string;
  readonly body: string;
  readonly blockKey: string;
  readonly rangeStart: number;
  readonly rangeEnd: number;
}

/**
 * Slugify a fence info string into a stable `blockKey`. Strategy:
 * - NFKD normalize and strip diacritics (`Görm` → `Gorm`).
 * - Lowercase.
 * - Replace any run of non-alphanumerics with a single hyphen.
 * - Trim hyphens off the ends.
 *
 * Collisions within a single page are suffixed `-2`, `-3`, … by the
 * caller (`scanFencedBlocks`).
 *
 * See `design/adventures.md` § "Open decisions" #7.
 */
export function slugifyInfo(info: string): string {
  // U+0300..U+036F is the Unicode "Combining Diacritical Marks" block;
  // NFKD decomposition splits e.g. "ö" into "o" + U+0308, which this
  // strips to leave plain "o".
  const normalized = info
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  const lowered = normalized.toLowerCase();
  const hyphenated = lowered.replace(/[^a-z0-9]+/g, "-");
  return hyphenated.replace(/^-+|-+$/g, "") || "block";
}

// Match a fenced block. Body is either empty (zero chars between
// opening fence's trailing newline and the closing fence) or
// `<content>\n` (terminated by a newline before the closing fence).
// This captures empty-body fences (`\`\`\`x\n\`\`\``) which appear
// when the GM creates a fence and hasn't typed YAML yet.
const FENCE_RE = /^(```+)\s*(\S+)([^\n]*)\n((?:[\s\S]*?\n)?)\1\s*$/gm;

/**
 * Walk a markdown body and extract every fenced block whose info
 * string starts with one of the recognized kinds.
 *
 * Why a regex rather than a real markdown parser:
 *   1. The notes plugin already tokenizes via remark; we DO want the
 *      adventures plugin to be standalone enough to test in isolation.
 *   2. Fenced-block extraction is unambiguous (the opening fence
 *      delimiter must be matched at column 0 and the same length).
 *   3. The regex handles nested code-blocks gracefully because Markdown
 *      requires the closing fence to match the opening fence's length.
 *
 * Returns blocks in document order. Duplicate slugs within the same
 * body are suffixed `-2`, `-3`, … so each (noteId, blockKey) pair
 * stays unique.
 */
export function scanFencedBlocks(
  body: string,
  recognizedKinds: ReadonlySet<string>,
): FencedBlock[] {
  const out: FencedBlock[] = [];
  const slugCounts = new Map<string, number>();
  // Reset regex state — RegExp objects are stateful with /g.
  FENCE_RE.lastIndex = 0;
  for (let m = FENCE_RE.exec(body); m !== null; m = FENCE_RE.exec(body)) {
    const kind = m[2]!;
    if (!recognizedKinds.has(kind)) continue;
    const info = (m[3] ?? "").trim();
    const fenceBody = m[4] ?? "";
    // Stable block-id annotation: `# id: <key>` on its own line in
    // the fenced body. When present, the `<key>` is used verbatim as
    // the blockKey — overrides info-string slugification. Lets GMs
    // rename the info-string without rebinding the materialized
    // entity. Annotation is consumed for slug derivation but stays in
    // the body verbatim (the YAML parser ignores YAML-comment lines).
    const idAnnot = fenceBody.match(/^#\s*id:\s*([A-Za-z0-9._:/-]+)\s*$/m);
    let blockKey: string;
    if (idAnnot) {
      blockKey = idAnnot[1]!;
    } else {
      const baseSlug = info ? slugifyInfo(info) : kind;
      const seen = slugCounts.get(baseSlug) ?? 0;
      slugCounts.set(baseSlug, seen + 1);
      blockKey = seen === 0 ? baseSlug : `${baseSlug}-${seen + 1}`;
    }
    out.push({
      kind,
      info,
      body: m[4] ?? "",
      blockKey,
      rangeStart: m.index,
      rangeEnd: m.index + m[0].length,
    });
  }
  return out;
}
