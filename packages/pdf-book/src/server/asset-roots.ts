// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * URL → filesystem map for the static asset directories pdfjs-dist
 * ships alongside its JS code. Returned from a function (rather than
 * a top-level constant) because resolution touches the filesystem,
 * which we don't want at module-evaluation time.
 *
 * Mounted into the substrate's `assetRoots` by the server entry point
 * so the running app can serve them at the predictable
 * `/pdfjs/{cmaps,standard_fonts,wasm,iccs}/` URLs the reader points
 * pdfjs at via `cMapUrl`/`standardFontDataUrl`/`wasmUrl`/`iccUrl`.
 *
 * Why each one matters:
 *
 *   - **cmaps/** — Chinese / Japanese / Korean character maps. Without
 *     them, any non-Latin text renders as boxes or wrong glyphs.
 *   - **standard_fonts/** — the 14 standard PDF fonts (Times,
 *     Helvetica, Courier, Symbol, ZapfDingbats variants). PDFs aren't
 *     required to embed these, so without the data files pdf.js falls
 *     back to canvas's default font and metrics drift.
 *   - **wasm/** — JBIG2, OpenJPEG (JPEG2000), QCMS color management,
 *     QuickJS scripting. Many scanned-document PDFs use JBIG2/JPEG2000
 *     for compression and look broken without these.
 *   - **iccs/** — embedded ICC color profile for color management.
 *
 * Resolution path: createRequire from this file's URL means
 * `pdfjs-dist/package.json` resolves through pdf-book's own
 * node_modules. The server can therefore import this without taking
 * a direct dependency on pdfjs-dist.
 */
export function pdfBookAssetRoots(): Record<string, string> {
  const req = createRequire(import.meta.url);
  const pdfjsRoot = dirname(req.resolve("pdfjs-dist/package.json"));
  return {
    "/pdfjs/cmaps/": resolve(pdfjsRoot, "cmaps"),
    "/pdfjs/standard_fonts/": resolve(pdfjsRoot, "standard_fonts"),
    "/pdfjs/wasm/": resolve(pdfjsRoot, "wasm"),
    "/pdfjs/iccs/": resolve(pdfjsRoot, "iccs"),
  };
}
