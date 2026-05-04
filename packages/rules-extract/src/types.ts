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
 * One heading-bounded section of the rulebook. The chunker tries to
 * keep these aligned with the document's outline (PDF bookmarks);
 * when no outline is present it falls back to font-size heuristics.
 */
export interface Chunk {
  /** Stable id, content-addressed via hash of (corpusId, pdfPage, headingPath, body). */
  chunkId: string;
  /** First PDF page this chunk's text appears on. */
  pdfPage: number;
  /** Last PDF page (when the chunk spans page breaks). null = single page. */
  pdfPageEnd: number | null;
  /**
   * Printed page as it appears in the physical book. `null` when the
   * chunker could not determine it (front matter, color plates, etc.).
   * Strings carry Roman numerals (`vii`) and letter-prefixes (`A-12`).
   */
  printedPage: string | number | null;
  printedPageEnd: string | number | null;
  /** Path of headings from outermost to innermost containing this chunk. */
  headingPath: string[];
  /** Cleaned body text. Dehyphenated and paragraph-collapsed. */
  body: string;
  /** Approximate token count (for size budgeting). */
  tokens: number;
  /** Image filenames (relative to images/ dir) that share pages with this chunk. */
  imageRefs: string[];
}

/**
 * Per-corpus manifest written next to chunks.jsonl. Captures the
 * tuning that produced this corpus so we know when re-extraction is
 * warranted (chunker version bumps, profile changes).
 */
export interface CorpusManifest {
  /** Title from the PDF metadata, falling back to the original filename. */
  title: string | null;
  pageCount: number;
  /** SHA256 of the source PDF bytes; matches the assetId-derived hash. */
  sourceSha: string;
  /** Free-form tags for skill-side aliasing. */
  tags: string[];
  /** Bumped when the chunker output format changes. */
  chunkerVersion: number;
  indexedAt: number;
  /**
   * `pdfPage → printedPage` map for the pages where the chunker
   * derived a printed number. Pages absent from this map have
   * `printedPage: null` everywhere they appear.
   */
  pageMap: Record<string, string | number>;
  /** Game-system plugin name in effect at extraction time (for diagnostics). */
  gameSystemPlugin: string | null;
}

/** Raw text item from pdfjs-dist's getTextContent. */
export interface TextItem {
  str: string;
  /** [scaleX, skewY, skewX, scaleY, translateX, translateY]. */
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
  fontName: string;
  /** End-of-line marker: pdfjs sets `hasEOL: true` for items at end of a text line. */
  hasEOL?: boolean;
}

/** A page's text content, ready for chunking. */
export interface PageText {
  pdfPage: number;
  /** Page width in PDF points (1/72 inch). */
  width: number;
  height: number;
  items: TextItem[];
}

/** PDF outline node in the form pdfjs-dist returns it. */
export interface OutlineNode {
  title: string;
  dest: unknown;
  items?: OutlineNode[];
}

/** Resolved outline entry: title → 1-based PDF page index. */
export interface OutlineEntry {
  pdfPage: number;
  /** Hierarchical path from root, e.g. ["Chapter 5", "Combat", "Flanking"]. */
  headingPath: string[];
}

export const CHUNKER_VERSION = 2;
