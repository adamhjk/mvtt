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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { assetUrl, uploadAssetForWorld } from "./client/upload.js";

describe("assetUrl", () => {
  it("builds the canonical fetch URL", () => {
    expect(assetUrl("my-table", "e123")).toBe(
      "/plugin-data/my-table/assets/e123",
    );
  });

  it("percent-encodes the worldId and assetId", () => {
    // Both arguments go through encodeURIComponent so a stray slash in
    // the world id can't escape the path scope.
    expect(assetUrl("a/b", "e123")).toBe("/plugin-data/a%2Fb/assets/e123");
  });

  it("returns null when either argument is missing", () => {
    expect(assetUrl(null, "e1")).toBeNull();
    expect(assetUrl("w1", null)).toBeNull();
    expect(assetUrl("", "e1")).toBeNull();
    expect(assetUrl("w1", "")).toBeNull();
    expect(assetUrl(undefined, undefined)).toBeNull();
  });
});

describe("uploadAssetForWorld", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Reset fetch between tests so leak doesn't bleed.
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs the file to the per-world upload route and returns the assetId", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "portrait.png", {
      type: "image/png",
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            assetId: "e42",
            url: "/plugin-data/my-table/assets/e42",
            deduped: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await uploadAssetForWorld("my-table", file);
    expect(result).toEqual({ assetId: "e42", deduped: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/worlds/my-table/assets/upload");
    expect(call[1]).toBeDefined();
    expect(call[1].method).toBe("POST");
    expect(call[1].body).toBe(file);
    const headers = call[1].headers as Record<string, string>;
    expect(headers["content-type"]).toBe("image/png");
    // File name flows into the x-filename header so the server's
    // sanitiser can preserve a sensible Asset.filename for the
    // asset library.
    expect(headers["x-filename"]).toBe("portrait.png");
  });

  it("surfaces server error text when the upload fails", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "mime image/svg+xml not allowed" }), {
          status: 415,
        }),
    ) as unknown as typeof fetch;
    await expect(
      uploadAssetForWorld(
        "my-table",
        new File([new Uint8Array()], "bad.svg", { type: "image/svg+xml" }),
      ),
    ).rejects.toThrow(/mime image\/svg\+xml not allowed/);
  });

  it("flags deduped uploads so callers can surface 'already uploaded'", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ assetId: "e7", deduped: true }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const result = await uploadAssetForWorld(
      "my-table",
      new File([new Uint8Array([1])], "x.png", { type: "image/png" }),
    );
    expect(result.deduped).toBe(true);
    expect(result.assetId).toBe("e7");
  });

  it("respects an explicit filename override", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ assetId: "e1" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const blob = new Blob([new Uint8Array([1])], { type: "image/png" });
    await uploadAssetForWorld("my-table", blob, { filename: "override.png" });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = call[1].headers as Record<string, string>;
    expect(headers["x-filename"]).toBe("override.png");
  });
});
