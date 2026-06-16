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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { DEFAULT_RULES_PROFILE, RulesProfile, type RulesProfileT } from "@vtt/rules-corpus/shared";
import { buildChunks } from "./chunker.js";
import { extractImages } from "./images.js";
import { buildPageMap } from "./page-numbers.js";
import { loadPdf } from "./text.js";
import { CHUNKER_VERSION, type Chunk, type CorpusManifest } from "./types.js";

/**
 * Run the full extraction pipeline against a single PDF.
 *
 *   1. Load the PDF (text + outline + metadata).
 *   2. Build pdfPage → printedPage map (header/footer scan or outline).
 *   3. Extract images via pdfimages.
 *   4. Build chunks (outline-driven if available, font-size fallback).
 *   5. Write chunks.jsonl, pages/<n>.txt, manifest.json.
 *
 * On success, returns the manifest. Throws on hard failures (PDF
 * unreadable, output dir not writable). Image extraction failure is
 * non-fatal.
 */
export async function extractCorpus(args: {
  pdfPath: string;
  outDir: string;
  profile?: RulesProfileT;
  tags?: string[];
  title?: string;
  gameSystemPlugin?: string | null;
}): Promise<CorpusManifest> {
  const profile = args.profile ?? DEFAULT_RULES_PROFILE;
  const tags = args.tags ?? [];

  // Logs go to stderr — stdout is reserved for the final manifest JSON
  // line that the runner parses. The runner forwards stderr lines into
  // the server log so progress is visible without tailing files.
  const log = (msg: string): void => {
    process.stderr.write(`${msg}\n`);
  };

  // Read once, hash, parse.
  log(`reading pdf: ${args.pdfPath}`);
  const bytes = readFileSync(args.pdfPath);
  const sourceSha = createHash("sha256").update(bytes).digest("hex");
  const corpusKey = sourceSha;
  log(`pdf bytes=${bytes.length} sha=${sourceSha.slice(0, 12)}…`);

  log("loading pdf (text + outline + metadata)…");
  const { pageCount, title: pdfTitle, pages, outline } = await loadPdf(new Uint8Array(bytes));
  log(
    `pdf loaded: pages=${pageCount} outlineEntries=${outline?.length ?? 0} title=${JSON.stringify(pdfTitle)}`,
  );

  const title = args.title ?? pdfTitle ?? basename(args.pdfPath);

  log("building printed-page map…");
  const pageMap = buildPageMap(pages, profile);
  log(`printed-page map covers ${pageMap.size}/${pageCount} pdf pages`);

  log("extracting images via pdfimages (non-fatal)…");
  const imagesByPage = await extractImages({
    pdfPath: args.pdfPath,
    outDir: args.outDir,
    profile,
  });
  log(`images: ${imagesByPage.size} pages with image artefacts`);

  log("chunking text…");
  const chunks = buildChunks({
    pages,
    outline,
    profile,
    pageMap,
    imagesByPage,
    corpusKey,
  });
  log(`chunks built: ${chunks.length}`);

  // Write output files.
  log(`writing outputs to ${args.outDir}`);
  mkdirSync(args.outDir, { recursive: true });
  writeChunks(resolve(args.outDir, "chunks.jsonl"), chunks);
  writePageTexts(resolve(args.outDir, "pages"), pages);

  const manifest: CorpusManifest = {
    title,
    pageCount,
    sourceSha,
    tags,
    chunkerVersion: CHUNKER_VERSION,
    indexedAt: Date.now(),
    pageMap: Object.fromEntries([...pageMap.entries()].map(([k, v]) => [String(k), v])),
    gameSystemPlugin: args.gameSystemPlugin ?? null,
  };
  writeFileSync(resolve(args.outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  log(
    `extraction complete: ${chunks.length} chunks, ${pageCount} pages, indexedAt=${manifest.indexedAt}`,
  );

  return manifest;
}

function writeChunks(path: string, chunks: Chunk[]): void {
  // jsonl: one JSON object per line.
  const lines = chunks.map((c) => JSON.stringify(c)).join("\n");
  writeFileSync(path, lines + (lines.length > 0 ? "\n" : ""), "utf8");
}

function writePageTexts(
  pagesDir: string,
  pages: ReadonlyArray<{
    pdfPage: number;
    items: ReadonlyArray<{ str: string; hasEOL?: boolean }>;
  }>,
): void {
  mkdirSync(pagesDir, { recursive: true });
  for (const page of pages) {
    let body = "";
    for (const it of page.items) {
      body += it.str;
      if (it.hasEOL) body += "\n";
    }
    writeFileSync(resolve(pagesDir, `${page.pdfPage}.txt`), body, "utf8");
  }
}

/** Re-export the profile schema for callers that want to validate a custom profile. */
export { RulesProfile };
