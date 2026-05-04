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

import { getResolvedPDFJS } from "unpdf";
import type {
  OutlineEntry,
  OutlineNode,
  PageText,
  TextItem,
} from "./types.js";

/**
 * Load a PDF with pdfjs-dist (via unpdf for Node-friendly setup) and
 * return:
 *   - per-page text items with full layout info
 *   - resolved outline (PDF bookmarks)
 *   - title from the PDF's metadata
 */
export async function loadPdf(bytes: Uint8Array): Promise<{
  pageCount: number;
  title: string | null;
  pages: PageText[];
  outline: OutlineEntry[];
}> {
  const pdfjs = await getResolvedPDFJS();
  // pdfjs.getDocument needs an ArrayBuffer-ish source. unpdf's
  // resolved module exposes the same APIs as pdfjs-dist, so this
  // call is identical to a browser-side `pdfjs.getDocument(url)` —
  // no DOM globals are touched in the Node path.
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const pageCount = doc.numPages;

  const pages: PageText[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent({ includeMarkedContent: false });
    const items: TextItem[] = [];
    for (const raw of tc.items) {
      const candidate = raw as Partial<{
        str: string;
        transform: number[];
        width: number;
        height: number;
        fontName: string;
        hasEOL: boolean;
      }>;
      if (typeof candidate.str !== "string") continue;
      items.push({
        str: candidate.str,
        transform: (candidate.transform ?? [1, 0, 0, 1, 0, 0]) as TextItem["transform"],
        width: candidate.width ?? 0,
        height: candidate.height ?? 0,
        fontName: candidate.fontName ?? "",
        hasEOL: candidate.hasEOL,
      });
    }
    pages.push({
      pdfPage: i,
      width: viewport.width,
      height: viewport.height,
      items,
    });
  }

  // Outline is optional; many PDFs have one, some don't.
  const outline: OutlineEntry[] = [];
  try {
    const tree = (await doc.getOutline()) as OutlineNode[] | null;
    if (tree) {
      await walkOutline(tree, [], doc as unknown as PdfDocLike, outline);
      // Deduplicate by pdfPage; keep the deepest headingPath for each
      // page (shallow ones tend to be intermediate ToC entries).
      const dedup = new Map<number, OutlineEntry>();
      for (const e of outline) {
        const existing = dedup.get(e.pdfPage);
        if (!existing || existing.headingPath.length < e.headingPath.length) {
          dedup.set(e.pdfPage, e);
        }
      }
      outline.length = 0;
      outline.push(
        ...Array.from(dedup.values()).sort((a, b) => a.pdfPage - b.pdfPage),
      );
    }
  } catch {
    // Some PDFs fail outline parsing; non-fatal.
  }

  // Title from the PDF metadata, with filename fallback handled by
  // the caller.
  let title: string | null = null;
  try {
    const meta = (await doc.getMetadata()) as {
      info?: { Title?: string };
    };
    if (meta.info?.Title && meta.info.Title.trim().length > 0) {
      title = meta.info.Title.trim();
    }
  } catch {
    // ignore
  }

  await doc.cleanup();
  await doc.destroy();

  return { pageCount, title, pages, outline };
}

/**
 * Walk the outline tree, resolving each node's destination to a
 * 1-based PDF page index. Builds entries with the full headingPath
 * from root to leaf.
 *
 * `dest` can be:
 *   - a string (named destination, resolve via getDestination)
 *   - an array (explicit destination — first element is a RefProxy)
 *   - null (skip)
 */
interface PdfDocLike {
  getPageIndex: (ref: unknown) => Promise<number>;
  getDestination?: (name: string) => Promise<unknown[] | null>;
}

async function walkOutline(
  nodes: OutlineNode[],
  parentPath: string[],
  doc: PdfDocLike,
  out: OutlineEntry[],
): Promise<void> {
  for (const node of nodes) {
    const path = [...parentPath, node.title.trim()];
    const ref = await resolveDestRef(node.dest, doc);
    if (ref !== null) {
      try {
        // pdfjs returns 0-based page indexes; we use 1-based.
        const idx = await doc.getPageIndex(ref);
        out.push({ pdfPage: idx + 1, headingPath: path });
      } catch {
        // unresolved destination — skip this node, but keep walking.
      }
    }
    if (node.items && node.items.length > 0) {
      await walkOutline(node.items, path, doc, out);
    }
  }
}

async function resolveDestRef(
  dest: unknown,
  doc: PdfDocLike,
): Promise<unknown | null> {
  if (!dest) return null;
  if (typeof dest === "string") {
    if (!doc.getDestination) return null;
    try {
      const arr = await doc.getDestination(dest);
      return arr && arr.length > 0 ? arr[0] : null;
    } catch {
      return null;
    }
  }
  if (Array.isArray(dest)) {
    return dest.length > 0 ? dest[0] : null;
  }
  return null;
}
