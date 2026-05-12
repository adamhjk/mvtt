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

import { zipSync, unzipSync } from "fflate";
import {
  BundleManifestSchema,
  type AdventureBundle,
  type BundleManifest,
} from "./bundle.js";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/**
 * Serialise an `AdventureBundle` to a `.advt` zip byte stream. Layout
 * (per design/adventures.md § "Bundle format"):
 *
 *   manifest.json
 *   notes/<bundlePath>           # one .md per note
 *   assets/<sha256>/<filename>   # bytes from bundle.assets, content-addressed
 *
 * Note: `bundlePath` from the manifest is used verbatim as the file
 * path inside the zip — caller is responsible for choosing collision-
 * free paths (the export builder does this).
 */
export function bundleToZip(bundle: AdventureBundle): Uint8Array {
  const m = bundle.manifest;
  const files: Record<string, Uint8Array> = {};
  files["manifest.json"] = TEXT_ENCODER.encode(JSON.stringify(m, null, 2));
  for (const note of m.notes) {
    // Bodies join with double-newline so reverse parse is unambiguous.
    const body = note.pages
      .map((p) => `# ${p.title}\n\n${p.body}`)
      .join("\n\n");
    files[note.bundlePath] = TEXT_ENCODER.encode(body);
  }
  for (const asset of m.assets) {
    const bytes = bundle.assets.get(asset.sha256);
    if (!bytes) continue;
    files[`assets/${asset.sha256}/${asset.name}`] = bytes;
  }
  return zipSync(files);
}

/**
 * Deserialise a `.advt` zip byte stream back to an `AdventureBundle`.
 * Validates the manifest against `BundleManifestSchema`; throws on
 * unknown shape. Asset bytes are read into the bundle's assets map by
 * sha256.
 */
export function zipToBundle(zipBytes: Uint8Array): AdventureBundle {
  const files = unzipSync(zipBytes);
  const manifestBytes = files["manifest.json"];
  if (!manifestBytes) {
    throw new Error("bundle is missing manifest.json");
  }
  const manifest: BundleManifest = BundleManifestSchema.parse(
    JSON.parse(TEXT_DECODER.decode(manifestBytes)),
  );
  // Re-hydrate page bodies from the per-note .md files, replacing
  // whatever the manifest carries (the manifest's body fields are
  // a build-time convenience; the .md files are the canonical bytes
  // a re-export should round-trip).
  const restoredNotes: BundleManifest["notes"] = manifest.notes.map((note) => {
    const fileBytes = files[note.bundlePath];
    if (!fileBytes) return note;
    const body = TEXT_DECODER.decode(fileBytes);
    // Recover per-page splits by `# ` headings we added at zip time.
    const segs = body.split(/\n\n# /).map((s, i) => (i === 0 ? s.replace(/^# /, "") : s));
    const restored: typeof note.pages = note.pages.map((p, i) => {
      const seg = segs[i];
      if (!seg) return p;
      const newlineIdx = seg.indexOf("\n");
      const title = newlineIdx === -1 ? seg : seg.slice(0, newlineIdx);
      const restBody = newlineIdx === -1 ? "" : seg.slice(newlineIdx + 2);
      return { title: title.trim(), body: restBody, sha256: p.sha256 };
    });
    return { ...note, pages: restored };
  });
  const restoredManifest: BundleManifest = {
    ...manifest,
    notes: restoredNotes,
  };
  // Asset bytes — content-addressed by sha256.
  const assetBytes = new Map<string, Uint8Array>();
  for (const asset of manifest.assets) {
    const path = `assets/${asset.sha256}/${asset.name}`;
    const bytes = files[path];
    if (bytes) assetBytes.set(asset.sha256, bytes);
  }
  return { manifest: restoredManifest, assets: assetBytes };
}
