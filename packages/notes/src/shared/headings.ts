/**
 * Heading extraction from markdown body. Used by `PageBodyParseSystem`
 * to materialise the `Headings` trait, AND by the read-mode renderer
 * to stamp matching ids on each rendered `<h*>` element. Both paths
 * MUST produce identical ids for the same body — which is why this
 * function is the single source of truth.
 *
 * Heading ids are content-hashed: `hd:` + a short FNV-1a over
 * `slug(text):occurrence`. Stable across rephrases of UNRELATED
 * headings; a heading whose own text changes does change id (which
 * is fine — incoming links to the old text would naturally need to
 * update too).
 *
 * Implementation walks a real mdast tree (via `unified` +
 * `remark-parse` + `remark-gfm`) so behaviour matches what the
 * renderer actually displays — `# **Bold**` produces text content
 * "Bold" rather than the literal `**Bold**`, headings inside
 * blockquotes are skipped if remark skips them, etc.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, PhrasingContent } from "mdast";

export interface HeadingItem {
  /** Stable id prefixed with "hd:". */
  readonly id: string;
  /** Rendered heading text after stripping markdown markers. */
  readonly text: string;
  /** 1–6, matching `#` count. */
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
}

const processor = unified().use(remarkParse).use(remarkGfm);

export function extractHeadings(text: string): HeadingItem[] {
  let root: Root;
  try {
    root = processor.parse(text) as Root;
  } catch {
    return [];
  }
  const out: HeadingItem[] = [];
  const occurrence = new Map<string, number>();
  // Only top-level headings count — matches CommonMark's expectation
  // and avoids picking up `#`-shaped content inside fenced code or
  // similar that the parser already classified as non-heading.
  for (const node of root.children) {
    if (node.type !== "heading") continue;
    const headingText = mdastTextContent(node.children).trim();
    if (headingText.length === 0) continue;
    const slug = slugify(headingText);
    const n = (occurrence.get(slug) ?? 0) + 1;
    occurrence.set(slug, n);
    const id = `hd:${shortHash(slug + ":" + n)}`;
    out.push({
      id,
      text: headingText,
      level: node.depth as 1 | 2 | 3 | 4 | 5 | 6,
    });
  }
  return out;
}

/**
 * Pull plain-text content out of a heading's mdast children. Exported
 * so the renderer's remark plugin can compute ids without re-parsing.
 */
export function mdastTextContent(
  children: ReadonlyArray<PhrasingContent>,
): string {
  let s = "";
  for (const c of children) {
    if (c.type === "text" || c.type === "inlineCode" || c.type === "html") {
      s += (c as { value: string }).value;
    } else if (
      "children" in c &&
      Array.isArray((c as { children: unknown[] }).children)
    ) {
      s += mdastTextContent(
        (c as { children: ReadonlyArray<PhrasingContent> }).children,
      );
    }
  }
  return s;
}

/**
 * Compute the stable id for a heading given its plain text and
 * 1-based occurrence index within the document. Same algorithm both
 * `extractHeadings` (trait-side) and the renderer-side remark plugin
 * use — so wiki-link `> Heading` anchors resolve to the same `hd:…`
 * id that the rendered `<h*>` element carries.
 */
export function headingIdFor(text: string, occurrence: number): string {
  return `hd:${shortHash(slugify(text) + ":" + occurrence)}`;
}

/**
 * Lowercase + strip non-alphanumerics + kebab-case. Used both for the
 * stored `Headings.items[].id` (via `headingIdFor`) and as the
 * occurrence-bucket key — same key as `extractHeadings` uses, so the
 * renderer-side remark plugin can pick the same occurrence count for
 * each heading and produce identical ids.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * 32-bit FNV-1a → base36 — short, deterministic, dependency-free, and
 * non-cryptographic (we don't need security here, just a stable
 * fingerprint).
 */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Drop sign.
  return (h >>> 0).toString(36);
}
