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

import { createEffect, createMemo, type JSX } from "solid-js";
import { type Registry, type World } from "@vtt/substrate";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type {
  Root,
  Heading as MdHeading,
  Parent,
  PhrasingContent,
  Text as MdText,
  Code as MdCode,
  List as MdList,
  ListItem as MdListItem,
  Paragraph as MdParagraph,
  Blockquote as MdBlockquote,
  RootContent as MdRootContent,
  BlockContent as MdBlockContent,
  Emphasis as MdEmphasis,
} from "mdast";
import type { Root as HastRoot, Element as HastElement } from "hast";
import { Asset } from "@vtt/assets/shared";
import { parseLinks, type WikiLinkRef } from "../shared/wiki-link.js";
import { headingIdFor, mdastTextContent, slugify } from "../shared/headings.js";
import { buildLinkKindIndex } from "../shared/index.js";
import {
  parseSetDesign,
  splitSegments,
  type SetDesignNode,
} from "../shared/set-design.js";

/**
 * Markdown → static HTML for read-mode pages. We compile the body to
 * an HTML string via a unified pipeline (mdast → hast → string) and
 * set it via `innerHTML` on a single container div. No reactive
 * mid-tree DOM diffing — every body change replaces the subtree
 * atomically in one mutation, which makes scroll targets and click
 * coordinates deterministic.
 *
 * Wiki-links and embeds are produced inline by the pipeline:
 *
 *  - `remarkHeadingIds` stamps each heading with its stable `hd:…` id.
 *  - `remarkWikiLinks` splits text on `[[…]]` / `![[…]]` tokens and
 *    rewrites them as standard `link` mdast nodes whose URL has a
 *    `wikilink:` scheme + a JSON-encoded `WikiLinkRef`.
 *  - `rehypeWikiLinks` walks the resulting hast tree and transforms
 *    those anchors:
 *      - Asset embeds (kind=asset, embed=true) become `<img>` /
 *        `<video>` / `<audio>` / link, looked up against the live
 *        world.
 *      - Everything else becomes a chip-styled `<button>` carrying
 *        the JSON-encoded ref as `data-wiki-ref`.
 *  - External `<a>` tags get `target="_blank"` + safe `rel`.
 *
 * Click handling is event-delegated on the container — walk up from
 * `e.target` to find `[data-wiki-ref]`, decode, hand off to
 * `props.onLink`. This is the extension seam: callers can route
 * clicks to peek/navigate/command/custom activations from a single
 * place.
 */

const WIKI_LINK_URL_PREFIX = "wikilink:";

interface RenderCtx {
  readonly world: World;
  readonly registry: Registry;
  readonly worldId: string;
}

export function MarkdownView(props: {
  body: string;
  world: World;
  registry: Registry;
  worldId: string;
  onLink?: (ref: WikiLinkRef, e: MouseEvent) => void;
  /**
   * Heading id (`hd:…`) to scroll into view after the next compile
   * commits. `onScrolled` is invoked once the scroll dispatched, so
   * the caller can clear the pending state.
   */
  scrollToAnchor?: string | null;
  onScrolled?: () => void;
}): JSX.Element {
  let containerEl: HTMLDivElement | undefined;
  // De-dup scrolls within a single MarkdownView lifetime: avoid
  // re-scrolling for the same anchor when the body recompiles for
  // unrelated reasons (collaborative edits). When this MarkdownView
  // is unmounted and a new one is created (PageContent remount
  // cascade), the new instance's `lastScrolledAnchor` starts fresh —
  // so the same anchor will scroll on its new scroller, which is
  // exactly what we want.
  let lastScrolledAnchor: string | null = null;

  const html = createMemo(() =>
    compile(props.body, {
      world: props.world,
      registry: props.registry,
      worldId: props.worldId,
    }),
  );

  createEffect(() => {
    // Read `html()` to subscribe to the compiled output: this effect
    // must run AFTER the innerHTML JSX binding has updated the DOM.
    void html();
    const anchor = props.scrollToAnchor;
    if (!anchor) {
      lastScrolledAnchor = null;
      return;
    }
    if (anchor === lastScrolledAnchor) return;
    if (!containerEl) return;
    const sel = `[id="${anchor.replace(/"/g, '\\"')}"]`;
    const el = containerEl.querySelector(sel) as HTMLElement | null;
    if (!el) return;
    // Pre-refactor mechanism that the user confirmed worked: walk up
    // to the inner overflow-y-auto pane explicitly, compute scrollTop
    // ourselves, set it directly. scrollIntoView's spec-defined
    // walk-up behaviour can grab a different scroll ancestor than
    // intended, which is what broke when we tried it.
    const scroller = findScrollParent(el);
    if (scroller) {
      const headingTop = el.getBoundingClientRect().top;
      const scrollerTop = scroller.getBoundingClientRect().top;
      const target = Math.max(
        0,
        scroller.scrollTop + (headingTop - scrollerTop) - 8,
      );
      scroller.scrollTo({ top: target, behavior: "smooth" });
    } else {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    lastScrolledAnchor = anchor;
    props.onScrolled?.();
  });

  const onContainerClick = (e: MouseEvent) => {
    let target = e.target as HTMLElement | null;
    while (target && target !== containerEl) {
      const refStr = target.getAttribute?.("data-wiki-ref");
      if (refStr) {
        let ref: WikiLinkRef | null = null;
        try {
          ref = JSON.parse(refStr) as WikiLinkRef;
        } catch {
          ref = null;
        }
        if (ref) props.onLink?.(ref, e);
        return;
      }
      target = target.parentElement;
    }
  };

  return (
    <div
      ref={containerEl}
      onClick={onContainerClick}
      // `prose` (Tailwind typography plugin) handles lists, headings,
      // paragraph spacing, bold/italic/strikethrough, tables, code,
      // blockquote out of the box. `max-w-none` undoes typography's
      // 65ch cap. We *don't* use `prose-invert` — that's a hard flip
      // to dark colors regardless of theme. Instead the `style`
      // prop wires the typography plugin's CSS variables to our
      // design tokens (which already use `light-dark()`), so the
      // rendered note tracks the active theme automatically.
      class="prose max-w-none"
      style={{
        "--tw-prose-body": "var(--color-fg)",
        "--tw-prose-headings": "var(--color-fg)",
        "--tw-prose-lead": "var(--color-fg-muted)",
        "--tw-prose-links": "var(--color-accent)",
        "--tw-prose-bold": "var(--color-fg)",
        "--tw-prose-counters": "var(--color-fg-subtle)",
        "--tw-prose-bullets": "var(--color-fg-subtle)",
        "--tw-prose-hr": "var(--color-border)",
        "--tw-prose-quotes": "var(--color-fg)",
        "--tw-prose-quote-borders": "var(--color-border)",
        "--tw-prose-captions": "var(--color-fg-muted)",
        "--tw-prose-code": "var(--color-fg)",
        "--tw-prose-pre-code": "var(--color-fg)",
        "--tw-prose-pre-bg": "var(--color-surface-sunken)",
        "--tw-prose-th-borders": "var(--color-border)",
        "--tw-prose-td-borders": "var(--color-border-muted)",
      }}
      // eslint-disable-next-line solid/no-innerhtml -- compiled by our trusted unified pipeline; user-supplied raw HTML is dropped via remark-rehype's allowDangerousHtml: false.
      innerHTML={html()}
    />
  );
}

// ---------- Compile pipeline ----------

function compile(body: string, ctx: RenderCtx): string {
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkHeadingIds)
    // remarkSetDesign must run BEFORE remarkWikiLinks so the line text
    // it emits (as standard mdast `text` nodes inside paragraphs) is
    // visited by the wiki-link rewriter just like any other prose.
    .use(remarkSetDesign)
    .use(remarkWikiLinks)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeWikiLinks, ctx)
    .use(rehypeExternalLinks)
    .use(rehypeStringify)
    .processSync(body);
  return String(file);
}

// ---------- remark plugin: heading id assignment ----------

/**
 * Stamps each heading's `data.hProperties.id` using the same algorithm
 * as `extractHeadings` in shared/. remark-rehype copies `hProperties`
 * onto the resulting hast element, which becomes the `id` attribute on
 * the rendered `<h*>` — the wiki-link `> Heading` scroll target.
 */
function remarkHeadingIds() {
  return (tree: Root) => {
    const occurrence = new Map<string, number>();
    visit(tree, "heading", (node: MdHeading) => {
      const text = mdastTextContent(node.children).trim();
      if (text.length === 0) return;
      const bucket = slugify(text);
      const n = (occurrence.get(bucket) ?? 0) + 1;
      occurrence.set(bucket, n);
      const id = headingIdFor(text, n);
      node.data ??= {};
      const data = node.data as { hProperties?: Record<string, unknown> };
      data.hProperties ??= {};
      data.hProperties.id = id;
    });
  };
}

// ---------- remark plugin: set-design fenced blocks ----------

/**
 * Visits every ```setdesign fenced code block and replaces it with a
 * structured mdast tree (blockquote-as-div wrapper → optional header →
 * nested list/listItem tree). Line text is sub-parsed as markdown
 * phrasing so `**bold**`, `*italic*`, `` `code` ``, and `[[wikilinks]]`
 * inside set-design lines flow through the rest of the pipeline
 * normally — `remarkWikiLinks` (registered after us) finds the text
 * nodes we produced and rewrites `[[…]]` literals into mdast links.
 *
 * Source arrows (`->`, `|->`, `→`, `|→`) at the start of a line are
 * decorative — indentation alone determines parent/child. Internal
 * `->`/`→` separators split a line into chained segments rendered
 * with a styled arrow glyph between them.
 */
function remarkSetDesign() {
  return (tree: Root) => {
    visit(tree, "code", (node: MdCode, index, parent) => {
      if (parent == null || index == null) return;
      const lang = (node.lang ?? "").toLowerCase();
      if (lang !== "setdesign") return;
      const block = parseSetDesign(node.value);
      const replacement = renderSetDesignBlock(block);
      (parent as Parent).children.splice(
        index,
        1,
        replacement as unknown as MdRootContent,
      );
      // Skip the children of the replacement (`visit` semantics: return
      // [SKIP, nextIndex] to advance the cursor past the new node).
      return ["skip", index + 1] as const;
    });
  };
}

type HastData = {
  readonly hName?: string;
  readonly hProperties?: Record<string, unknown>;
};

function withHast<T extends { data?: unknown }>(node: T, data: HastData): T {
  (node as { data?: HastData }).data = { ...((node as { data?: HastData }).data ?? {}), ...data };
  return node;
}

function renderSetDesignBlock(block: {
  header: string | null;
  root: ReadonlyArray<SetDesignNode>;
}): MdBlockquote {
  const children: MdBlockContent[] = [];
  if (block.header && block.header.length > 0) {
    children.push(
      withHast<MdParagraph>(
        {
          type: "paragraph",
          children: parseInlinePhrasing(block.header),
        },
        { hProperties: { className: ["set-design-header"] } },
      ),
    );
  }
  if (block.root.length > 0) {
    children.push(buildSetDesignList(block.root));
  }
  return withHast<MdBlockquote>(
    {
      type: "blockquote",
      children,
    },
    { hName: "div", hProperties: { className: ["set-design"] } },
  );
}

function buildSetDesignList(
  nodes: ReadonlyArray<SetDesignNode>,
): MdList {
  return withHast<MdList>(
    {
      type: "list",
      ordered: false,
      spread: false,
      children: nodes.map(buildSetDesignItem),
    },
    { hProperties: { className: ["set-design-tree"] } },
  );
}

function buildSetDesignItem(node: SetDesignNode): MdListItem {
  const lineChildren = buildLinePhrasing(node.text);
  const line = withHast<MdParagraph>(
    {
      type: "paragraph",
      children: lineChildren,
    },
    { hProperties: { className: ["set-design-line"] } },
  );
  const body: MdBlockContent[] = [line];
  if (node.children.length > 0) {
    body.push(buildSetDesignList(node.children));
  }
  const cls = node.blankBefore
    ? ["set-design-node", "is-blank-before"]
    : ["set-design-node"];
  return withHast<MdListItem>(
    {
      type: "listItem",
      spread: false,
      children: body,
    },
    { hProperties: { className: cls } },
  );
}

function buildLinePhrasing(text: string): PhrasingContent[] {
  const segments = splitSegments(text);
  if (segments.length === 0) return [];
  const out: PhrasingContent[] = [];
  segments.forEach((seg, i) => {
    if (i > 0) out.push(arrowSpan());
    for (const phr of parseInlinePhrasing(seg)) out.push(phr);
  });
  return out;
}

function arrowSpan(): MdEmphasis {
  return withHast<MdEmphasis>(
    {
      type: "emphasis",
      children: [{ type: "text", value: "→" } as MdText],
    },
    { hName: "span", hProperties: { className: ["set-design-arrow"] } },
  );
}

/**
 * Shared sub-pipeline that parses an inline source fragment into mdast
 * phrasing content. Instantiated once — `unified()` chains are
 * stateless w.r.t. inputs, so re-using a single processor is safe and
 * avoids per-line allocation overhead.
 */
const inlineParser = unified().use(remarkParse).use(remarkGfm);

function parseInlinePhrasing(text: string): PhrasingContent[] {
  if (text.length === 0) return [];
  const root = inlineParser.parse(text) as Root;
  for (const child of root.children) {
    if (child.type === "paragraph") {
      return child.children as PhrasingContent[];
    }
  }
  return [{ type: "text", value: text }];
}

// ---------- remark plugin: wiki-link splitting ----------

interface WikiLinkAsMdLink {
  type: "link";
  url: string;
  title: null;
  children: Array<MdText>;
}

/**
 * Walks every text node, splits on `[[…]]` / `![[…]]` tokens, and
 * replaces each token with a standard mdast `link` whose URL is
 * `wikilink:` + JSON-encoded ref. The downstream `rehypeWikiLinks`
 * pass picks up the scheme and rewrites these into chips/embeds.
 */
function remarkWikiLinks() {
  return (tree: Root) => {
    visit(tree, "text", (node: MdText, index, parent) => {
      if (parent == null || index == null) return;
      const text = node.value;
      const links = parseLinks(text);
      if (links.length === 0) return;

      const replacement: Array<MdText | WikiLinkAsMdLink> = [];
      let cursor = 0;
      for (const link of links) {
        if (link.range[0] > cursor) {
          replacement.push({
            type: "text",
            value: text.slice(cursor, link.range[0]),
          });
        }
        const fallback = link.alias ?? link.body;
        const url =
          WIKI_LINK_URL_PREFIX + encodeURIComponent(JSON.stringify(link));
        replacement.push({
          type: "link",
          url,
          title: null,
          children: [{ type: "text", value: fallback }],
        });
        cursor = link.range[1];
      }
      if (cursor < text.length) {
        replacement.push({ type: "text", value: text.slice(cursor) });
      }

      const p = parent as Parent;
      p.children.splice(
        index,
        1,
        ...(replacement as unknown as PhrasingContent[]),
      );
      return ["skip", index + replacement.length];
    });
  };
}

// ---------- rehype plugin: wiki-link → chip / asset embed ----------

const CHIP_CLASSES =
  "inline-flex items-center gap-1 rounded-sm border border-border bg-surface-elevated px-1.5 py-0.5 text-[0.85em] text-accent hover:border-accent transition cursor-pointer";

const MISSING_ASSET_CLASSES =
  "inline-block rounded-sm border border-border-muted bg-surface px-2 py-1 text-xs text-fg-subtle";

const IMG_CLASSES =
  "max-w-full rounded-(--radius-control) border border-border-muted";

function rehypeWikiLinks(ctx: RenderCtx) {
  return (tree: HastRoot) => {
    const idx = buildLinkKindIndex(ctx.registry);
    visit(tree, "element", (node: HastElement) => {
      if (node.tagName !== "a") return;
      const href = node.properties?.href;
      if (typeof href !== "string" || !href.startsWith(WIKI_LINK_URL_PREFIX)) {
        return;
      }
      const encoded = href.slice(WIKI_LINK_URL_PREFIX.length);
      let ref: WikiLinkRef | null = null;
      try {
        ref = JSON.parse(decodeURIComponent(encoded)) as WikiLinkRef;
      } catch {
        ref = null;
      }
      if (!ref) return;

      // Asset embeds → swap to <img>/<video>/<audio>/<a> in place.
      if (ref.embed && ref.kind === "asset") {
        rewriteAssetEmbed(node, ref, ctx);
        return;
      }

      // Resolve display + status against the live world.
      const kind = idx.byName.get(ref.kind);
      let resolved: unknown = null;
      let display = ref.alias ?? ref.body;
      if (kind) {
        try {
          resolved = kind.parse(ref.body, ref.anchor, ctx.world, ctx.registry);
        } catch {
          resolved = null;
        }
        if (resolved !== null && !ref.alias) {
          try {
            display = kind.display(resolved, ctx.world);
          } catch {
            display = ref.body;
          }
        }
      }
      const status: "yes" | "no" = resolved === null ? "no" : "yes";

      // Mutate the existing <a> node into a <button> chip.
      node.tagName = "button";
      node.properties = {
        type: "button",
        "data-wiki-ref": JSON.stringify(ref),
        "data-link-kind": ref.kind,
        "data-link-body": ref.body,
        "data-link-resolved": status,
        title: `${ref.kind}:${ref.body}`,
        className: [CHIP_CLASSES],
      };
      const children: HastElement["children"] = [];
      if (status === "no") {
        children.push({
          type: "element",
          tagName: "span",
          properties: { className: ["text-fg-subtle"], "aria-hidden": "true" },
          children: [{ type: "text", value: "⊘" }],
        });
      }
      children.push({
        type: "element",
        tagName: "span",
        properties: {},
        children: [{ type: "text", value: display }],
      });
      node.children = children;
    });
  };
}

function rewriteAssetEmbed(
  node: HastElement,
  ref: WikiLinkRef,
  ctx: RenderCtx,
): void {
  const id = ref.body;
  const has = ctx.world.has(id as never);
  const traits = has
    ? (ctx.world.get(id as never, [Asset]) as
        | { Asset: { mime: string; filename: string | null } }
        | undefined)
    : undefined;
  if (!traits) {
    node.tagName = "span";
    node.properties = {
      className: [MISSING_ASSET_CLASSES],
      title: `asset:${ref.body}`,
    };
    node.children = [{ type: "text", value: "[missing asset]" }];
    return;
  }
  const url = `/plugin-data/${ctx.worldId}/assets/${ref.body}`;
  const mime = traits.Asset.mime;
  const alt = ref.alias ?? traits.Asset.filename ?? "asset";
  if (mime.startsWith("image/")) {
    node.tagName = "img";
    node.properties = {
      src: url,
      alt,
      className: [IMG_CLASSES],
      loading: "lazy",
    };
    node.children = [];
    return;
  }
  if (mime.startsWith("video/")) {
    node.tagName = "video";
    node.properties = {
      src: url,
      controls: true,
      className: ["max-w-full rounded-(--radius-control)"],
    };
    node.children = [];
    return;
  }
  if (mime.startsWith("audio/")) {
    node.tagName = "audio";
    node.properties = { src: url, controls: true, className: ["w-full"] };
    node.children = [];
    return;
  }
  // Fallback: anchor with href. Open in a new tab.
  node.tagName = "a";
  node.properties = {
    href: url,
    target: "_blank",
    rel: "noreferrer noopener",
    className: ["text-accent underline"],
  };
  node.children = [{ type: "text", value: alt }];
}

// ---------- rehype plugin: external links → target=_blank + safe rel ----------

/**
 * Standard markdown links (e.g. `[label](https://…)`) survive as
 * `<a href="…">` after `rehypeWikiLinks` (only the `wikilink:` URLs
 * were rewritten). We add `target="_blank"` + `rel="noreferrer
 * noopener"` so users don't lose the workbench tab when clicking out,
 * and to avoid `window.opener` leaks. Same-origin links go through
 * the same treatment for now — keeps the renderer trustless about
 * what the URL points at.
 */
function rehypeExternalLinks() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: HastElement) => {
      if (node.tagName !== "a") return;
      const href = node.properties?.href;
      if (typeof href !== "string") return;
      // Skip our wikilink: URLs (already rewritten to <button>) and
      // anchors that the wiki-link rewrite somehow left in place.
      if (href.startsWith(WIKI_LINK_URL_PREFIX)) return;
      node.properties = {
        ...node.properties,
        target: "_blank",
        rel: "noreferrer noopener",
        className: [
          ...((node.properties?.className as string[] | undefined) ?? []),
          "text-accent underline-offset-2 hover:underline",
        ],
      };
    });
  };
}

// ---------- scroll-parent walk ----------

/**
 * Walk up from `el` to the nearest ancestor with vertical overflow
 * scrolling. Returns null if none — the caller falls back to plain
 * `scrollIntoView`. We deliberately ignore `body` / `documentElement`
 * here: notes always live inside an inner scroll pane in the
 * workbench, and snapping the whole document is wrong.
 */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el.parentElement;
  while (cur && cur !== document.body) {
    const style = getComputedStyle(cur);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      cur.scrollHeight > cur.clientHeight
    ) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}
