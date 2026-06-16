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

import { createHash } from "node:crypto";
import type { RulesProfileT } from "@vtt/rules-corpus/shared";
import type { Chunk, OutlineEntry, PageText } from "./types.js";

/**
 * Build chunks from per-page text and (optionally) the PDF outline.
 *
 * Strategy:
 *   1. If the PDF has an outline, treat each outline entry as a
 *      heading boundary. Chunks span from one outline entry to the
 *      next (or to end-of-document for the last entry).
 *   2. If no outline, fall back to font-size-based heading detection
 *      using the profile's headingFontSizes (or auto-detection from
 *      the document's font histogram).
 *
 * Each chunk carries headingPath, the pdfPage range, the body text
 * (dehyphenated, paragraph-collapsed), and a content-addressed id.
 */
export function buildChunks(args: {
  pages: PageText[];
  outline: OutlineEntry[];
  profile: RulesProfileT;
  pageMap: Map<number, string | number>;
  imagesByPage: Map<number, string[]>;
  corpusKey: string;
}): Chunk[] {
  const { pages, outline, profile, pageMap, imagesByPage, corpusKey } = args;

  if (outline.length > 0) {
    return buildChunksFromOutline({
      pages,
      outline,
      profile,
      pageMap,
      imagesByPage,
      corpusKey,
    });
  }
  return buildChunksFromFontSizes({
    pages,
    profile,
    pageMap,
    imagesByPage,
    corpusKey,
  });
}

function buildChunksFromOutline(args: {
  pages: PageText[];
  outline: OutlineEntry[];
  profile: RulesProfileT;
  pageMap: Map<number, string | number>;
  imagesByPage: Map<number, string[]>;
  corpusKey: string;
}): Chunk[] {
  const { pages, outline, profile, pageMap, imagesByPage, corpusKey } = args;
  const chunks: Chunk[] = [];

  const bodySize = computeBodyFontSize(pages, profile);
  const pagesByNum = new Map<number, PageText>();
  let maxPdfPage = 0;
  for (const p of pages) {
    pagesByNum.set(p.pdfPage, p);
    if (p.pdfPage > maxPdfPage) maxPdfPage = p.pdfPage;
  }

  for (let i = 0; i < outline.length; i++) {
    const here = outline[i]!;
    const next = outline[i + 1];
    const startPage = here.pdfPage;
    // Walk through the doc's last page when there's no following
    // outline entry. Using `pages.length` is wrong when pdf page
    // indexes don't start at 1 (rare in real PDFs but breaks tests
    // that pass single pages numbered higher than 1).
    const endPageExclusive = next ? next.pdfPage : maxPdfPage + 1;

    const subSections = collectSubSections({
      pagesByNum,
      startPage,
      endPageExclusive,
      outlineLeaf: here.headingPath[here.headingPath.length - 1] ?? "",
      bodySize,
      profile,
    });

    for (const sub of subSections) {
      const body = collapseWhitespace(sub.body);
      if (body.length === 0) continue;
      const headingPath = sub.subHeading ? [...here.headingPath, sub.subHeading] : here.headingPath;
      pushChunkOrSplit(chunks, {
        headingPath,
        pdfPage: sub.startPage,
        pdfPageEnd: sub.endPage > sub.startPage ? sub.endPage : null,
        body,
        pageMap,
        imagesByPage,
        corpusKey,
        profile,
      });
    }
  }

  return chunks;
}

interface SubSection {
  /** Heading text detected mid-section. Null = the outline-rooted prefix. */
  subHeading: string | null;
  startPage: number;
  endPage: number;
  body: string;
}

/**
 * Walk the pages in `[startPage, endPageExclusive)` line-by-line,
 * splitting into sub-sections at every heading-shaped line we find.
 * The first sub-section inherits the outline's path verbatim
 * (subHeading=null); each subsequent one tags on the detected heading.
 *
 * `outlineLeaf` is the deepest title from the PDF outline — when we
 * encounter a heading-shaped line that matches it, we *eat* it (don't
 * emit a fresh sub-section): it's the section title, already accounted
 * for in `headingPath`. Without this we'd double-count the first
 * heading on the first page of every outline section.
 */
function collectSubSections(args: {
  pagesByNum: Map<number, PageText>;
  startPage: number;
  endPageExclusive: number;
  outlineLeaf: string;
  bodySize: number;
  profile: RulesProfileT;
}): SubSection[] {
  const { pagesByNum, startPage, endPageExclusive, outlineLeaf, bodySize, profile } = args;
  const minHeadingSize = bodySize * profile.subHeading.minSizeRatio;
  const dehyph = profile.dehyphenate;
  const subEnabled = profile.subHeading.enabled;
  const minChars = profile.subHeading.minChars;
  const maxChars = profile.subHeading.maxChars;
  const outlineLeafNorm = normaliseHeading(outlineLeaf);

  const sections: SubSection[] = [];
  let cur: SubSection = {
    subHeading: null,
    startPage,
    endPage: startPage,
    body: "",
  };
  let outlineLeafSeen = outlineLeaf.length === 0;

  const flush = (): void => {
    sections.push(cur);
  };

  for (let p = startPage; p < endPageExclusive; p++) {
    const page = pagesByNum.get(p);
    if (!page) continue;
    let lineBuf = "";
    let lineSize = 0;
    let lineWeight = 0;
    const flushLine = (): void => {
      if (lineWeight === 0) return;
      const avgSize = lineSize / lineWeight;
      const text = (dehyph ? dehyphenate(lineBuf) : lineBuf).trim();
      const isHeading =
        subEnabled &&
        avgSize >= minHeadingSize &&
        text.length >= minChars &&
        text.length <= maxChars &&
        looksLikeHeading(text);
      if (isHeading) {
        // Eat the outline section title on first encounter; it's
        // already in `headingPath` from the bookmark.
        if (!outlineLeafSeen && normaliseHeading(text) === outlineLeafNorm) {
          outlineLeafSeen = true;
          lineBuf = "";
          lineSize = 0;
          lineWeight = 0;
          return;
        }
        // Real sub-heading: flush whatever's accumulated under the
        // previous (sub-)heading, start a fresh sub-section.
        flush();
        cur = { subHeading: text, startPage: p, endPage: p, body: "" };
      } else {
        if (cur.body.length > 0) cur.body += " ";
        cur.body += text;
        cur.endPage = p;
      }
      lineBuf = "";
      lineSize = 0;
      lineWeight = 0;
    };
    for (const it of page.items) {
      const size = Math.abs(it.transform[0]);
      const weight = Math.max(it.str.length, 1);
      lineBuf += it.str;
      lineSize += size * weight;
      lineWeight += weight;
      if (it.hasEOL) flushLine();
    }
    flushLine();
    if (cur.body.length > 0 && !cur.body.endsWith("\n\n")) {
      cur.body += "\n\n";
    }
  }
  flush();

  return sections;
}

/**
 * Compute the dominant body-text font size for a document, used as
 * the baseline against which sub-heading sizes are compared. Falls
 * back to the profile's explicit body size when present, then to a
 * histogram peak, then to a reasonable default.
 */
function computeBodyFontSize(pages: PageText[], profile: RulesProfileT): number {
  if (profile.headingFontSizes.body !== undefined) {
    return profile.headingFontSizes.body;
  }
  const sizeFreq = new Map<number, number>();
  for (const p of pages) {
    for (const it of p.items) {
      const size = Math.round(Math.abs(it.transform[0]) * 10) / 10;
      sizeFreq.set(size, (sizeFreq.get(size) ?? 0) + it.str.length);
    }
  }
  return [...sizeFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

/**
 * Heading shape filter: the size already passed; this rejects lines
 * that are big-but-not-headings (page numbers, watermark stubs,
 * decorative drop-caps). Conservative — better to miss a heading
 * than to misattribute one.
 */
function looksLikeHeading(text: string): boolean {
  // Pure numbers (page numbers in big font on chapter-opener pages).
  if (/^\d+$/.test(text)) return false;
  // DriveThruRPG-style watermark stubs.
  if (/\(Order\s*#\d+\)/.test(text)) return false;
  // Need at least one alpha char so "—" / "·" runs don't qualify.
  const alpha = text.replace(/[^A-Za-zÀ-ɏ]/g, "").length;
  if (alpha < 2) return false;
  return true;
}

/** Case-insensitive, whitespace-collapsed heading equality probe. */
function normaliseHeading(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildChunksFromFontSizes(args: {
  pages: PageText[];
  profile: RulesProfileT;
  pageMap: Map<number, string | number>;
  imagesByPage: Map<number, string[]>;
  corpusKey: string;
}): Chunk[] {
  const { pages, profile, pageMap, imagesByPage, corpusKey } = args;

  // Build a font-size histogram across the doc.
  const sizeFreq = new Map<number, number>();
  for (const p of pages) {
    for (const it of p.items) {
      const size = Math.round(Math.abs(it.transform[0]) * 10) / 10;
      sizeFreq.set(size, (sizeFreq.get(size) ?? 0) + it.str.length);
    }
  }
  const bodySize =
    profile.headingFontSizes.body ??
    [...sizeFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    10;
  const h1 = profile.headingFontSizes.h1 ?? bodySize * 1.6;
  const h2 = profile.headingFontSizes.h2 ?? bodySize * 1.3;
  const h3 = profile.headingFontSizes.h3 ?? bodySize * 1.1;

  const chunks: Chunk[] = [];
  let headingPath: string[] = [];
  let bufBody = "";
  let bufStartPage = pages[0]?.pdfPage ?? 1;
  let bufEndPage: number | null = null;

  const flush = (): void => {
    const body = collapseWhitespace(bufBody);
    if (body.length > 0) {
      pushChunkOrSplit(chunks, {
        headingPath: headingPath.length > 0 ? headingPath : ["(unnamed)"],
        pdfPage: bufStartPage,
        pdfPageEnd: bufEndPage,
        body,
        pageMap,
        imagesByPage,
        corpusKey,
        profile,
      });
    }
    bufBody = "";
    bufEndPage = null;
  };

  for (const page of pages) {
    let lineBuf = "";
    let lineSize = 0;
    let lineCount = 0;
    const flushLine = (): void => {
      if (lineCount === 0) return;
      const avgSize = lineSize / lineCount;
      const text = profile.dehyphenate ? dehyphenate(lineBuf) : lineBuf;
      if (avgSize >= h1) {
        flush();
        headingPath = [text.trim()];
        bufStartPage = page.pdfPage;
      } else if (avgSize >= h2) {
        flush();
        headingPath = [headingPath[0] ?? "", text.trim()].filter((s) => s.length > 0);
        bufStartPage = page.pdfPage;
      } else if (avgSize >= h3) {
        flush();
        headingPath = [headingPath[0] ?? "", headingPath[1] ?? "", text.trim()].filter(
          (s) => s.length > 0,
        );
        bufStartPage = page.pdfPage;
      } else {
        // Body text line. Append to current chunk buffer.
        if (bufBody.length > 0) bufBody += " ";
        bufBody += text;
        if (bufStartPage > page.pdfPage) bufStartPage = page.pdfPage;
        bufEndPage = page.pdfPage;
      }
      lineBuf = "";
      lineSize = 0;
      lineCount = 0;
    };
    for (const it of page.items) {
      const size = Math.abs(it.transform[0]);
      if (it.hasEOL) {
        lineBuf += it.str;
        lineSize += size * Math.max(it.str.length, 1);
        lineCount += Math.max(it.str.length, 1);
        flushLine();
      } else {
        lineBuf += it.str;
        lineSize += size * Math.max(it.str.length, 1);
        lineCount += Math.max(it.str.length, 1);
      }
    }
    flushLine();
    // Inter-page gap counts as paragraph break.
    if (bufBody.length > 0 && !bufBody.endsWith("\n\n")) bufBody += "\n\n";
  }
  flush();

  return chunks;
}

function pushChunkOrSplit(
  out: Chunk[],
  args: {
    headingPath: string[];
    pdfPage: number;
    pdfPageEnd: number | null;
    body: string;
    pageMap: Map<number, string | number>;
    imagesByPage: Map<number, string[]>;
    corpusKey: string;
    profile: RulesProfileT;
  },
): void {
  const { headingPath, pdfPage, pdfPageEnd, body, pageMap, imagesByPage, corpusKey, profile } =
    args;
  const cap = profile.chunkSizeTokens;
  const tokens = approxTokens(body);
  if (tokens <= cap) {
    out.push(
      makeChunk({ headingPath, pdfPage, pdfPageEnd, body, pageMap, imagesByPage, corpusKey }),
    );
    return;
  }
  // Over-cap: split on paragraph boundaries.
  const paras = body.split(/\n{2,}/);
  let buf = "";
  let bufTokens = 0;
  for (const p of paras) {
    const pTokens = approxTokens(p);
    if (bufTokens + pTokens > cap && buf.length > 0) {
      out.push(
        makeChunk({
          headingPath: [...headingPath, "(cont.)"],
          pdfPage,
          pdfPageEnd,
          body: buf.trim(),
          pageMap,
          imagesByPage,
          corpusKey,
        }),
      );
      buf = "";
      bufTokens = 0;
    }
    buf += (buf.length > 0 ? "\n\n" : "") + p;
    bufTokens += pTokens;
  }
  if (buf.trim().length > 0) {
    out.push(
      makeChunk({
        headingPath:
          out.length > 0 && out[out.length - 1]!.headingPath.includes("(cont.)")
            ? [...headingPath, "(cont.)"]
            : headingPath,
        pdfPage,
        pdfPageEnd,
        body: buf.trim(),
        pageMap,
        imagesByPage,
        corpusKey,
      }),
    );
  }
}

function makeChunk(args: {
  headingPath: string[];
  pdfPage: number;
  pdfPageEnd: number | null;
  body: string;
  pageMap: Map<number, string | number>;
  imagesByPage: Map<number, string[]>;
  corpusKey: string;
}): Chunk {
  const { headingPath, pdfPage, pdfPageEnd, body, pageMap, imagesByPage, corpusKey } = args;
  const tokens = approxTokens(body);
  const printedPage = pageMap.get(pdfPage) ?? null;
  const printedPageEnd = pdfPageEnd !== null ? (pageMap.get(pdfPageEnd) ?? null) : null;
  const imageRefs: string[] = [];
  const startP = pdfPage;
  const endP = pdfPageEnd ?? pdfPage;
  for (let p = startP; p <= endP; p++) {
    const refs = imagesByPage.get(p);
    if (refs) imageRefs.push(...refs);
  }
  const idHasher = createHash("sha256");
  idHasher.update(corpusKey);
  idHasher.update("\0");
  idHasher.update(String(pdfPage));
  idHasher.update("\0");
  idHasher.update(headingPath.join("›"));
  idHasher.update("\0");
  idHasher.update(body);
  const chunkId = idHasher.digest("hex").slice(0, 16);
  return {
    chunkId,
    pdfPage,
    pdfPageEnd,
    printedPage,
    printedPageEnd,
    headingPath,
    body,
    tokens,
    imageRefs,
  };
}

/** Stitch hyphenated linebreaks back together: `re-\nform` → `reform`. */
function dehyphenate(s: string): string {
  return s.replace(/(\w)-\n(\w)/g, "$1$2");
}

/** Normalise whitespace: trim, collapse runs, preserve paragraph breaks. */
function collapseWhitespace(s: string): string {
  return (
    s
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      // Strip DriveThruRPG-style per-purchase watermarks. Most TTRPG PDFs
      // we'll process come from DTRPG and carry "<Buyer Name> (Order #N)"
      // on every page; this drops the order ref and the immediately
      // preceding capitalised name run.
      .replace(/\b[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)*\s*\(Order\s*#\d+\)/gu, "")
      .replace(/\(Order\s*#\d+\)/g, "")
      .trim()
  );
}

/** Cheap token estimate: chars/4 for English-like text. */
function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}
