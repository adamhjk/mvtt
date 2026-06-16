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
import { World } from "@vtt/substrate";
import { Character } from "@vtt/characters/shared";
import { npcLinkKind } from "./shared/npc-link-kind.js";
import { TbNpc } from "./shared/npc-traits.js";

const noModifiers = { modifiers: { meta: false, shift: false, alt: false } };

function spawnNpc(world: World, name: string, role = "Folk"): string {
  return world.spawn([Character({ name }), TbNpc({ role, description: "", pageRef: null })]);
}

function spawnPc(world: World, name: string): string {
  return world.spawn([Character({ name })]);
}

describe("npcLinkKind.parse", () => {
  it("resolves a name to an NPC entity (case-insensitive)", () => {
    const world = new World();
    const npcId = spawnNpc(world, "Skarra");
    const ref = npcLinkKind.parse("skarra", null, world);
    expect(ref).toEqual({ npcId });
  });

  it("resolves an entity id directly", () => {
    const world = new World();
    const npcId = spawnNpc(world, "Skarra");
    expect(npcLinkKind.parse(npcId, null, world)).toEqual({ npcId });
  });

  it("does not resolve to a PC (Character without TbNpc)", () => {
    const world = new World();
    const pcId = spawnPc(world, "Greta");
    expect(npcLinkKind.parse("greta", null, world)).toBeNull();
    expect(npcLinkKind.parse(pcId, null, world)).toBeNull();
  });

  it("returns null when no entity matches", () => {
    const world = new World();
    spawnNpc(world, "Skarra");
    expect(npcLinkKind.parse("nobody", null, world)).toBeNull();
  });
});

describe("npcLinkKind.display", () => {
  it("reads the live Character name", () => {
    const world = new World();
    const npcId = spawnNpc(world, "Skarra");
    expect(npcLinkKind.display({ npcId }, world)).toBe("Skarra");
  });
});

describe("npcLinkKind.activate", () => {
  it("navigates to the NPCs page targeting this entity", () => {
    const world = new World();
    const npcId = spawnNpc(world, "Skarra");
    const out = npcLinkKind.activate({ npcId }, noModifiers);
    expect(out).toEqual({
      type: "navigate",
      pageKind: "@vtt/system-torchbearer/npcs",
      entityId: npcId,
    });
  });
});

describe("npcLinkKind.autocomplete", () => {
  it("lists NPCs by name with their role as badge", () => {
    const world = new World();
    spawnNpc(world, "Skarra", "Smuggler");
    spawnNpc(world, "Marrow", "Tanner");
    spawnPc(world, "Greta");
    const out = npcLinkKind.autocomplete("", world);
    const names = out.map((s) => s.display).sort();
    // PCs are excluded.
    expect(names).toEqual(["Marrow", "Skarra"]);
    const skarra = out.find((s) => s.display === "Skarra");
    expect(skarra?.badge).toBe("Smuggler");
  });

  it("filters by query substring", () => {
    const world = new World();
    spawnNpc(world, "Skarra Wormtongue");
    spawnNpc(world, "Marrow");
    const out = npcLinkKind.autocomplete("worm", world);
    expect(out.length).toBe(1);
    expect(out[0]?.display).toBe("Skarra Wormtongue");
  });

  // Body must be the *name*, not the entity id — entity ids drift on
  // bundle import (every imported entity gets a fresh server-allocated
  // id in the target world), so id-based wikilinks dangle after
  // import. The CodeMirror editor inserts `[[npc:<body>]]` literally,
  // and the parser resolves `<body>` by case-insensitive name match.
  it("emits name-based body so wikilinks survive bundle import", () => {
    const world = new World();
    spawnNpc(world, "Max the Monster");
    const [out] = npcLinkKind.autocomplete("max", world);
    expect(out?.body).toBe("Max the Monster");
    expect(out?.body).not.toMatch(/^e\d+$/);
  });
});
