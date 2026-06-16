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

import { z } from "@vtt/substrate";

/**
 * Per-game-system tuning knobs for the heading-aware chunker. Game
 * systems differ enough in layout that one set of heuristics doesn't
 * generalise — Torchbearer's two-column with corner page numbers,
 * d20-style three-column books, and rules-light single-column zines
 * each need different defaults.
 *
 * Profiles live alongside the game-system plugin that consumes them
 * (e.g. `packages/system-torchbearer/src/rules-profile.ts`); the
 * server resolves the active world's `gameSystemPlugin` to find the
 * profile and serialises it to JSON for the extraction CLI subprocess.
 */
export const RulesProfile = z.object({
  /** Number of text columns on a typical body page. */
  columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  /**
   * Font-size thresholds for heading detection (in PDF points).
   * Optional — when absent the chunker auto-detects from the page's
   * font-size histogram.
   */
  headingFontSizes: z
    .object({
      h1: z.number().optional(),
      h2: z.number().optional(),
      h3: z.number().optional(),
      body: z.number().optional(),
    })
    .default({}),
  /** How to derive printed page numbers (the numbers on the physical book). */
  pageNumber: z
    .object({
      strategy: z.enum(["outline", "headerScan", "footerScan", "explicit"]).default("footerScan"),
      band: z.enum(["top", "bottom", "either"]).default("bottom"),
      /** PDF pages before the printed numbering starts (covers, ToC, …). */
      frontMatterPdfPages: z.number().int().nonnegative().default(0),
      /**
       * Explicit `pdfPage → printedPage` overrides for ranges where
       * automatic detection fails (color plates, appendix prefixes,
       * etc.). Keys are 1-based PDF page indexes as strings.
       */
      explicitMap: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    })
    .default({
      strategy: "footerScan",
      band: "bottom",
      frontMatterPdfPages: 0,
    }),
  /**
   * Sub-heading detection inside outline sections. RPG PDFs routinely
   * group several named items (skills, spells, monsters) under one
   * outline entry, so without this every sub-item gets attributed to
   * the outline's deepest entry — search results show the page's first
   * outline heading instead of the actual sub-section that contains
   * the match. Detected sub-headings get appended to `headingPath`.
   */
  subHeading: z
    .object({
      enabled: z.boolean().default(true),
      /**
       * A line is treated as a sub-heading when its average font size
       * is at least `bodySize × minSizeRatio`. Conservative default:
       * a hair above body so light bold-italic running heads don't
       * trigger but proper sub-headings do.
       */
      minSizeRatio: z.number().default(1.15),
      /**
       * Lines longer than this (after trim) are treated as body
       * regardless of size. Most sub-headings fit in <80 chars; this
       * stops a callout or bolded paragraph lead-in from getting
       * mistaken for a heading.
       */
      maxChars: z.number().int().positive().default(80),
      /**
       * Lines shorter than this are treated as body (a stray big
       * letter at line start, drop-cap, page number).
       */
      minChars: z.number().int().positive().default(2),
    })
    .default({
      enabled: true,
      minSizeRatio: 1.15,
      maxChars: 80,
      minChars: 2,
    }),
  /** Stitch hyphenated linebreaks back together (`re-form` → `reform`). */
  dehyphenate: z.boolean().default(true),
  /** Hard cap on chunk size; over-cap chunks split on paragraph boundaries. */
  chunkSizeTokens: z.number().int().positive().default(2000),
  /** Minimum pixel dimensions for an image to be retained (drops icons). */
  imageMinPixels: z
    .object({ width: z.number().int(), height: z.number().int() })
    .default({ width: 64, height: 64 }),
});

export type RulesProfileT = z.infer<typeof RulesProfile>;

/**
 * Default profile — used when the active game system doesn't ship a
 * profile of its own. Conservative settings that should produce
 * usable chunks for most layouts without being optimal for any.
 */
export const DEFAULT_RULES_PROFILE: RulesProfileT = RulesProfile.parse({});
