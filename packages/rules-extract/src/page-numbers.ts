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

import type { RulesProfileT } from "@vtt/rules-corpus/shared";
import type { PageText, TextItem } from "./types.js";

/**
 * Build a `pdfPage → printedPage` map. Strategy is profile-driven:
 *
 *   - **explicit**: take the map from the profile's `explicitMap`
 *     verbatim. Useful when automatic detection fails.
 *   - **headerScan / footerScan**: look at the top or bottom band
 *     of each page for a single integer or Roman numeral that's
 *     monotonic with neighbours. The most reliable strategy for
 *     digital PDFs that don't have an outline.
 *   - **outline**: deferred to the chunker, which has access to the
 *     outline; we just return an empty map here.
 *
 * Pages where the strategy can't produce a confident answer are
 * absent from the map (callers treat them as `null`).
 */
export function buildPageMap(
  pages: PageText[],
  profile: RulesProfileT,
): Map<number, string | number> {
  const map = new Map<number, string | number>();
  const cfg = profile.pageNumber;

  if (cfg.strategy === "explicit") {
    if (cfg.explicitMap) {
      for (const [k, v] of Object.entries(cfg.explicitMap)) {
        const pdfPage = Number(k);
        if (Number.isFinite(pdfPage) && pdfPage > 0) map.set(pdfPage, v);
      }
    }
    return map;
  }

  if (cfg.strategy === "outline") {
    // Outline-based mapping is composed in the chunker (which holds
    // both outline and page text). Return empty here.
    return map;
  }

  // Header / footer scan.
  const band = cfg.band;
  const frontMatter = cfg.frontMatterPdfPages;

  // First pass: candidate per page.
  const candidates = new Map<number, { value: string | number; confidence: number }>();
  for (const page of pages) {
    if (page.pdfPage <= frontMatter) continue;
    const c = scanBand(page, band);
    if (c !== null) candidates.set(page.pdfPage, c);
  }

  // Second pass: keep only candidates that are monotonic with their
  // immediate neighbours (delta ≤ 2 to be tolerant of inserted pages).
  // This filters spurious matches against page numbers that happen to
  // appear in body text.
  for (const [pdfPage, cand] of candidates) {
    if (typeof cand.value !== "number") {
      // Roman / letter-prefixed: keep if confidence is high.
      if (cand.confidence >= 1) map.set(pdfPage, cand.value);
      continue;
    }
    const prev = candidates.get(pdfPage - 1);
    const next = candidates.get(pdfPage + 1);
    // Accept iff at least one numeric neighbour candidate is exactly
    // one off in the right direction. A corrupt prev (e.g. body-text
    // false match) doesn't poison this page — we just look at next
    // instead. Page 1 / last page accept on a single matching side.
    const prevDelta = prev && typeof prev.value === "number" ? cand.value - prev.value : null;
    const nextDelta = next && typeof next.value === "number" ? next.value - cand.value : null;
    if (prevDelta === 1 || nextDelta === 1) {
      map.set(pdfPage, cand.value);
    }
  }

  // Third pass: for each gap, see if linear interpolation between
  // the surrounding mapped pages produces a sensible printed number.
  // Only fill when both neighbours map to integers and the offset is
  // consistent, so we don't invent numbers across genuine breaks
  // (color plates, appendices with letter prefixes).
  fillIntegerGaps(map, pages);

  // Apply explicitMap overrides on top, if present.
  if (cfg.explicitMap) {
    for (const [k, v] of Object.entries(cfg.explicitMap)) {
      const pdfPage = Number(k);
      if (Number.isFinite(pdfPage) && pdfPage > 0) map.set(pdfPage, v);
    }
  }

  return map;
}

const ROMAN_RE = /^(?=[mdclxvi])(m{0,3})(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const INTEGER_RE = /^(\d{1,4})$/;

function scanBand(
  page: PageText,
  band: "top" | "bottom" | "either",
): { value: string | number; confidence: number } | null {
  // Define top and bottom bands as the outer 8% of page height.
  const bandSize = page.height * 0.08;
  const inBand = (item: TextItem): boolean => {
    const y = item.transform[5];
    if (band === "top") return y >= page.height - bandSize;
    if (band === "bottom") return y <= bandSize;
    return y <= bandSize || y >= page.height - bandSize;
  };

  // Tokenise band items: just collect strings and look for short
  // standalone tokens that match an integer or Roman numeral.
  // Confidence rises if the token is the only thing in its line.
  const banded = page.items.filter((it) => inBand(it) && it.str.trim().length > 0);
  if (banded.length === 0) return null;

  // Group items by approximate y-coordinate (within 4 points).
  type Line = { y: number; tokens: string[] };
  const lines: Line[] = [];
  for (const it of banded) {
    const y = it.transform[5];
    let line = lines.find((l) => Math.abs(l.y - y) < 4);
    if (!line) {
      line = { y, tokens: [] };
      lines.push(line);
    }
    for (const tok of it.str.split(/\s+/)) {
      if (tok.length > 0) line.tokens.push(tok);
    }
  }

  // Scan each line. Prefer single-token lines (high confidence).
  let best: { value: string | number; confidence: number } | null = null;
  for (const line of lines) {
    if (line.tokens.length === 0) continue;
    for (const raw of line.tokens) {
      const tok = raw.replace(/[^\w-]/g, "");
      if (tok.length === 0) continue;
      const intMatch = INTEGER_RE.exec(tok);
      if (intMatch) {
        const value = Number(intMatch[1]);
        const confidence = line.tokens.length === 1 ? 2 : 1;
        if (!best || confidence > best.confidence) best = { value, confidence };
        continue;
      }
      if (ROMAN_RE.test(tok)) {
        const confidence = line.tokens.length === 1 ? 2 : 0;
        if (confidence > 0 && (!best || confidence > best.confidence)) {
          best = { value: tok.toLowerCase(), confidence };
        }
      }
    }
  }
  return best;
}

/**
 * For consecutive pages where both endpoints map to integers and the
 * gap is small (< 8 pages), fill in the interior by simple
 * `prev + (i - prevIdx)` interpolation when the implied step matches.
 * Conservative — leaves real gaps (chapter breaks, plates) alone.
 */
function fillIntegerGaps(map: Map<number, string | number>, pages: PageText[]): void {
  const pdfPages = pages.map((p) => p.pdfPage).sort((a, b) => a - b);
  for (let i = 0; i < pdfPages.length; i++) {
    const here = pdfPages[i]!;
    if (map.has(here)) continue;
    // Walk back to the nearest mapped integer.
    let prevIdx = i - 1;
    while (prevIdx >= 0) {
      const v = map.get(pdfPages[prevIdx]!);
      if (typeof v === "number") break;
      prevIdx--;
    }
    if (prevIdx < 0) continue;
    let nextIdx = i + 1;
    while (nextIdx < pdfPages.length) {
      const v = map.get(pdfPages[nextIdx]!);
      if (typeof v === "number") break;
      nextIdx++;
    }
    if (nextIdx >= pdfPages.length) continue;
    if (nextIdx - prevIdx > 8) continue; // gap too wide; don't extrapolate
    const prevPdf = pdfPages[prevIdx]!;
    const nextPdf = pdfPages[nextIdx]!;
    const prevVal = map.get(prevPdf) as number;
    const nextVal = map.get(nextPdf) as number;
    const expectedStep = (nextVal - prevVal) / (nextPdf - prevPdf);
    if (Math.abs(expectedStep - 1) > 0.01) continue; // non-1 step = something funky; skip
    map.set(here, prevVal + (here - prevPdf));
  }
}
