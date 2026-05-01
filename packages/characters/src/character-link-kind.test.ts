// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import { World, type EntityId } from "@vtt/substrate";
import { Character } from "./shared/traits.js";
import { characterLinkKind } from "./shared/character-link-kind.js";

const noModifiers = {
  modifiers: { meta: false, shift: false, alt: false },
} as const;

describe("characterLinkKind.parse", () => {
  it("resolves a name match (case-insensitive)", () => {
    const world = new World();
    const id = world.allocateId();
    world.spawnAt(id, [Character({ name: "Krell" })]);

    const ref = characterLinkKind.parse("krell", null, world);
    expect(ref).toEqual({ characterId: id });
  });

  it("resolves an entity-id body when the entity carries Character", () => {
    const world = new World();
    const id = world.allocateId();
    world.spawnAt(id, [Character({ name: "Tarn" })]);

    const ref = characterLinkKind.parse(id, null, world);
    expect(ref).toEqual({ characterId: id });
  });

  it("returns null for an unknown name", () => {
    const world = new World();
    expect(characterLinkKind.parse("ghost", null, world)).toBeNull();
  });

  it("returns null for an entity id that exists but isn't a Character", () => {
    const world = new World();
    const id = world.allocateId();
    world.spawnAt(id, []);
    expect(characterLinkKind.parse(id, null, world)).toBeNull();
  });
});

describe("characterLinkKind.activate", () => {
  it("returns navigate to the Characters page on plain click", () => {
    const ref = { characterId: "e42" as EntityId };
    const out = characterLinkKind.activate(ref, noModifiers);
    expect(out).toEqual({
      type: "navigate",
      pageKind: "@vtt/characters/characters",
      entityId: "e42",
    });
  });

  it("returns navigate on cmd-click too — modifier handling lives in the dispatcher", () => {
    const ref = { characterId: "e7" as EntityId };
    const out = characterLinkKind.activate(ref, {
      modifiers: { meta: true, shift: false, alt: false },
    });
    expect(out).toEqual({
      type: "navigate",
      pageKind: "@vtt/characters/characters",
      entityId: "e7",
    });
  });
});

describe("characterLinkKind.display", () => {
  it("reads Character.name reactively", () => {
    const world = new World();
    const id = world.allocateId();
    world.spawnAt(id, [Character({ name: "Krell" })]);
    expect(characterLinkKind.display({ characterId: id }, world)).toBe("Krell");
  });

  it("falls back to a placeholder when the entity is gone", () => {
    const world = new World();
    expect(
      characterLinkKind.display({ characterId: "e404" as EntityId }, world),
    ).toBe("(missing character)");
  });
});
