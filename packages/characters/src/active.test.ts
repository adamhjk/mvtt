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
import { Registry, World } from "@vtt/substrate";
import { characters } from "./manifest.js";
import { Active, Character, isActive, readActive } from "./shared/index.js";

function setup() {
  const registry = new Registry();
  registry.load(characters);
  const world = new World();
  return { registry, world };
}

describe("Active trait", () => {
  it("schema parses with default active: true", () => {
    const parsed = Active.schema.parse({});
    expect(parsed.active).toBe(true);
  });

  it("schema accepts active: false", () => {
    const parsed = Active.schema.parse({ active: false });
    expect(parsed.active).toBe(false);
  });

  it("isActive returns true when the trait is missing — BC default for legacy entities", () => {
    const { world } = setup();
    const id = world.spawn([Character({ name: "Legacy PC" })]);
    expect(isActive(world, id)).toBe(true);
  });

  it("isActive returns true when active: true is explicitly set", () => {
    const { world } = setup();
    const id = world.spawn([Character({ name: "Boris" }), Active({ active: true })]);
    expect(isActive(world, id)).toBe(true);
  });

  it("isActive returns false when active: false", () => {
    const { world } = setup();
    const id = world.spawn([Character({ name: "Library Goblin" }), Active({ active: false })]);
    expect(isActive(world, id)).toBe(false);
  });

  it("readActive returns null when the trait is missing — lets UIs render the default state distinctly", () => {
    const { world } = setup();
    const id = world.spawn([Character({ name: "PC" })]);
    expect(readActive(world, id)).toBeNull();
  });

  it("readActive returns the stored value when set", () => {
    const { world } = setup();
    const id = world.spawn([Character({ name: "PC" }), Active({ active: false })]);
    expect(readActive(world, id)).toBe(false);
  });
});
