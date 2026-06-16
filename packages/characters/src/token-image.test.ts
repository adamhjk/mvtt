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
import { CharacterToken } from "./shared/traits.js";
import { resolveCharacterTokenUrl } from "./shared/token-image.js";

describe("CharacterToken trait", () => {
  it("schema parses both legacy imageUrl and new assetId shapes", () => {
    // Legacy data — no assetId at all.
    const legacy = CharacterToken.schema.parse({
      imageUrl: "/plugin-data/w1/@vtt/characters/characters/c1/token.png",
    });
    expect(legacy.assetId).toBeNull();
    expect(legacy.imageUrl).toContain("token.png");

    // New writes — assetId, no imageUrl.
    const fresh = CharacterToken.schema.parse({ assetId: "e42" });
    expect(fresh.assetId).toBe("e42");
    expect(fresh.imageUrl).toBeNull();

    // Empty object — defaults both null (the trait can exist with no
    // portrait so far).
    const empty = CharacterToken.schema.parse({});
    expect(empty.assetId).toBeNull();
    expect(empty.imageUrl).toBeNull();
  });
});

describe("resolveCharacterTokenUrl", () => {
  it("prefers assetId when both are set", () => {
    expect(
      resolveCharacterTokenUrl(
        {
          assetId: "e42",
          imageUrl: "/plugin-data/w1/@vtt/characters/characters/c1/token.png",
        },
        "w1",
      ),
    ).toBe("/plugin-data/w1/assets/e42");
  });

  it("falls back to legacy imageUrl when assetId is null — preserves BC for entities written before the refactor", () => {
    expect(
      resolveCharacterTokenUrl(
        {
          assetId: null,
          imageUrl: "/plugin-data/w1/@vtt/characters/characters/c1/token.png",
        },
        "w1",
      ),
    ).toBe("/plugin-data/w1/@vtt/characters/characters/c1/token.png");
  });

  it("returns null when both fields are null/absent", () => {
    expect(resolveCharacterTokenUrl({ assetId: null, imageUrl: null }, "w1")).toBeNull();
    expect(resolveCharacterTokenUrl(null, "w1")).toBeNull();
    expect(resolveCharacterTokenUrl(undefined, "w1")).toBeNull();
  });

  it("requires a worldId for the asset path — legacy imageUrl still resolves without one", () => {
    // Without worldId, the asset path can't be built; we should fall
    // through to the legacy imageUrl when present.
    expect(
      resolveCharacterTokenUrl(
        {
          assetId: "e42",
          imageUrl: "/legacy/path.png",
        },
        null,
      ),
    ).toBe("/legacy/path.png");
    // No worldId AND no legacy path → null.
    expect(resolveCharacterTokenUrl({ assetId: "e42", imageUrl: null }, null)).toBeNull();
  });

  it("tolerates legacy values that have no assetId field at all (world.get returns them un-reparsed)", () => {
    const legacyValue = {
      imageUrl: "/legacy/token.png",
    } as unknown as {
      assetId: string | null;
      imageUrl: string | null;
    };
    expect(resolveCharacterTokenUrl(legacyValue, "w1")).toBe("/legacy/token.png");
  });
});
