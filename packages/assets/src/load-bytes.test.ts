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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadAssetBytesFromDisk } from "./server/routes.js";
import type { EntityId, WorldId } from "@vtt/substrate";

/**
 * Regression test for the silent-null bug: `loadAssetBytesFromDisk`
 * used `require("node:fs")` inside the read branch, which throws
 * (silently caught) under an ESM runtime. The export pipeline calls
 * this synchronously per asset; a null return drops the descriptor.
 * Real-world symptom: `.advt.zip` bundles came out with `assets: []`
 * even when the world had Asset entities and the bytes were on disk.
 */
describe("loadAssetBytesFromDisk", () => {
  let dir: string;
  const worldId = "w-test" as WorldId;
  const assetId = "e1" as EntityId;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "mvtt-asset-load-"));
    mkdirSync(resolve(dir, worldId, "assets"), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the raw bytes when the file exists on disk", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(resolve(dir, worldId, "assets", assetId), bytes);
    const out = loadAssetBytesFromDisk({
      pluginDataDir: dir,
      worldId,
      assetId,
    });
    expect(out).not.toBeNull();
    expect(out!.length).toBe(bytes.length);
    expect(out!).toEqual(bytes);
  });

  it("returns null when the file is missing — caller filters and skips the descriptor", () => {
    const out = loadAssetBytesFromDisk({
      pluginDataDir: dir,
      worldId,
      assetId: "nonexistent" as EntityId,
    });
    expect(out).toBeNull();
  });

  it("handles large binary content without truncation (450 KB image-sized payload)", () => {
    const bytes = new Uint8Array(450 * 1024);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 17) & 0xff;
    writeFileSync(resolve(dir, worldId, "assets", assetId), bytes);
    const out = loadAssetBytesFromDisk({
      pluginDataDir: dir,
      worldId,
      assetId,
    });
    expect(out!.length).toBe(bytes.length);
    // Spot-check a few bytes to confirm the buffer view shape is right
    // (off-by-byteOffset bugs would skew these).
    expect(out![0]).toBe(0);
    expect(out![1]).toBe(17);
    expect(out![100]).toBe((100 * 17) & 0xff);
    expect(out![bytes.length - 1]).toBe(((bytes.length - 1) * 17) & 0xff);
  });
});
