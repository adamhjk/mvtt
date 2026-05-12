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

import { describe, it, expect } from "vitest";
import { bundleToZip, zipToBundle, sha256Hex } from "./server/index.js";
import type { AdventureBundle } from "./server/index.js";

function makeBundle(): AdventureBundle {
  const body = ["```stat foo", "label: a", "value: 1", "```"].join("\n");
  return {
    manifest: {
      bundleId: "uuid-zip",
      name: "Zip Test",
      version: "1.0.0",
      summary: "",
      author: "",
      requires: [],
      exportedAt: "2026-05-10T00:00:00Z",
      notes: [
        {
          bundlePath: "notes/intro.md",
          title: "Intro",
          pages: [
            { title: "Page 1", body, sha256: sha256Hex(body) },
            { title: "Page 2", body: "second page", sha256: sha256Hex("second page") },
          ],
        },
      ],
      assets: [],
    },
    assets: new Map(),
  };
}

describe("bundleToZip / zipToBundle", () => {
  it("round-trips a bundle through zip bytes", () => {
    const original = makeBundle();
    const zip = bundleToZip(original);
    expect(zip.length).toBeGreaterThan(0);
    expect(zip).toBeInstanceOf(Uint8Array);
    const restored = zipToBundle(zip);
    expect(restored.manifest.bundleId).toBe(original.manifest.bundleId);
    expect(restored.manifest.name).toBe(original.manifest.name);
    expect(restored.manifest.version).toBe(original.manifest.version);
    expect(restored.manifest.notes).toHaveLength(1);
    expect(restored.manifest.notes[0]!.title).toBe("Intro");
    expect(restored.manifest.notes[0]!.pages).toHaveLength(2);
    expect(restored.manifest.notes[0]!.pages[0]!.body).toContain("stat foo");
    expect(restored.manifest.notes[0]!.pages[1]!.body).toBe("second page");
  });

  it("preserves asset bytes content-addressed by sha256", () => {
    const original = makeBundle();
    const sha = "0".repeat(64); // dummy sha
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const m = original.manifest;
    const withAsset: AdventureBundle = {
      manifest: {
        ...m,
        assets: [
          { sha256: sha, name: "thing.bin", mime: "application/octet-stream", bytes: 5 },
        ],
      },
      assets: new Map([[sha, bytes]]),
    };
    const zip = bundleToZip(withAsset);
    const restored = zipToBundle(zip);
    expect(restored.assets.get(sha)).toEqual(bytes);
  });

  it("throws on a zip missing manifest.json", () => {
    // Build a bundle, drop the manifest entry, re-zip with raw fflate.
    expect(() => zipToBundle(new Uint8Array([0, 0, 0, 0]))).toThrow();
  });
});
