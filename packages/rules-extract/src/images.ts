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

import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { RulesProfileT } from "@vtt/rules-corpus/shared";

/**
 * Extract every embedded image from a PDF using poppler's
 * `pdfimages -all -p <pdf> <prefix>`. Output filenames are
 * `<prefix>-<pdfPage>-<index>.<ext>`. Returns a `pdfPage → filenames`
 * map for the chunker to associate images with chunks.
 *
 * Tiny inline icons (under `imageMinPixels`) are post-filtered.
 *
 * If `pdfimages` isn't installed, returns an empty map and logs a
 * warning to stderr — non-fatal; chunks just have no imageRefs.
 */
export async function extractImages(args: {
  pdfPath: string;
  outDir: string;
  profile: RulesProfileT;
}): Promise<Map<number, string[]>> {
  const { pdfPath, outDir, profile } = args;
  const imagesDir = resolve(outDir, "images");
  mkdirSync(imagesDir, { recursive: true });

  const prefix = resolve(imagesDir, "p");
  const ok = await runPdfImages(pdfPath, prefix);
  if (!ok) return new Map();

  // Walk the output dir, collect filenames, optionally filter by size.
  // pdfimages writes p-<page>-<index>.<ext>; we re-parse the name.
  const map = new Map<number, string[]>();
  const filenameRe = /^p-(\d{3,})-(\d{3,})\.(ppm|pgm|pbm|jpg|jpeg|png|jb2)$/;
  const minW = profile.imageMinPixels.width;
  const minH = profile.imageMinPixels.height;
  for (const entry of readdirSync(imagesDir)) {
    const m = filenameRe.exec(entry);
    if (!m) continue;
    const pdfPage = Number(m[1]);
    if (!Number.isFinite(pdfPage)) continue;
    const full = resolve(imagesDir, entry);
    const stats = statSync(full);
    // Cheap min-size filter via byte size — small PNGs/PPMs from
    // tiny icons stay under ~2 KB. The proper width/height filter
    // would require loading each image; not worth the cost for v0.
    if (stats.size < (minW * minH) / 8) {
      try {
        unlinkSync(full);
      } catch {
        // ignore
      }
      continue;
    }
    const list = map.get(pdfPage) ?? [];
    list.push(entry);
    map.set(pdfPage, list);
  }
  return map;
}

function runPdfImages(pdfPath: string, prefix: string): Promise<boolean> {
  return new Promise((res) => {
    const proc = spawn("pdfimages", ["-all", "-p", pdfPath, prefix], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => {
      console.error(
        `[rules-extract] pdfimages not found or failed to start: ${err.message}. ` +
          `Install poppler-utils to enable image extraction.`,
      );
      res(false);
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        console.error(`[rules-extract] pdfimages exited with code ${code}: ${stderr.trim()}`);
        res(false);
        return;
      }
      res(true);
    });
  });
}
