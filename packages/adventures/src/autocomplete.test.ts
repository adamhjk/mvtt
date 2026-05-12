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
import { World, z } from "@vtt/substrate";
import {
  computeBlockCompletions,
  schemaAtPath,
} from "./client/block-autocomplete.js";
import { defineBlockKind, wikiLink, dice } from "./shared/index.js";

const NpcSchema = z.object({
  name: z.string().describe("Display name"),
  level: z.number().int().min(1).max(10).optional(),
  type: z.enum(["humanoid", "undead", "beast", "dragon"]),
  carries: z.array(wikiLink("item")),
  attack: dice().optional(),
});

const npcKind = defineBlockKind({
  name: "npc",
  description: "A non-player character",
  schema: NpcSchema,
  project: () => ({ traits: [] }),
});

const monsterKind = defineBlockKind({
  name: "monster",
  description: "A monster template",
  schema: z.object({
    might: z.number().int().min(1).max(10),
  }),
  project: () => ({ traits: [] }),
});

const allKinds = [npcKind, monsterKind];

describe("schemaAtPath", () => {
  it("walks through object keys", () => {
    const node = schemaAtPath(NpcSchema, ["type"]);
    expect(node).toBeDefined();
    expect(node).toBeInstanceOf(z.ZodEnum);
  });

  it("walks through array elements", () => {
    const node = schemaAtPath(NpcSchema, ["carries", "0"]);
    expect(node).toBeDefined();
    expect(node).toBeInstanceOf(z.ZodString);
  });

  it("returns null for paths that fall off the schema", () => {
    expect(schemaAtPath(NpcSchema, ["nonexistent"])).toBeNull();
    expect(schemaAtPath(NpcSchema, ["name", "extra"])).toBeNull();
  });
});

describe("computeBlockCompletions — info slot", () => {
  it("lists every registered kind with its description", () => {
    const out = computeBlockCompletions({
      slot: "info",
      path: [],
      query: "",
      allKinds,
      ctx: { world: new World() },
    });
    expect(out.map((c) => c.value).sort()).toEqual(["monster", "npc"]);
    const npc = out.find((c) => c.value === "npc");
    expect(npc?.detail).toBe("A non-player character");
  });

  it("filters by query substring", () => {
    const out = computeBlockCompletions({
      slot: "info",
      path: [],
      query: "mon",
      allKinds,
      ctx: { world: new World() },
    });
    expect(out.map((c) => c.value)).toEqual(["monster"]);
  });
});

describe("computeBlockCompletions — key slot", () => {
  it("lists every key in the current object schema", () => {
    const out = computeBlockCompletions({
      slot: "key",
      path: [],
      query: "",
      kind: npcKind,
      allKinds,
      ctx: { world: new World() },
    });
    const keys = out.map((c) => c.value).sort();
    expect(keys).toEqual(["attack", "carries", "level", "name", "type"]);
  });

  it("marks optional fields with '(optional)'", () => {
    const out = computeBlockCompletions({
      slot: "key",
      path: [],
      query: "",
      kind: npcKind,
      allKinds,
      ctx: { world: new World() },
    });
    const level = out.find((c) => c.value === "level");
    expect(level?.detail).toBe("(optional)");
    const name = out.find((c) => c.value === "name");
    expect(name?.detail).toBe("(required)");
  });

  it("filters by query prefix", () => {
    const out = computeBlockCompletions({
      slot: "key",
      path: [],
      query: "ca",
      kind: npcKind,
      allKinds,
      ctx: { world: new World() },
    });
    expect(out.map((c) => c.value)).toEqual(["carries"]);
  });
});

describe("computeBlockCompletions — value slot", () => {
  it("expands enum values for an enum schema node", () => {
    const out = computeBlockCompletions({
      slot: "value",
      path: ["type"],
      query: "",
      kind: npcKind,
      allKinds,
      ctx: { world: new World() },
    });
    expect(out.map((c) => c.value).sort()).toEqual([
      "beast",
      "dragon",
      "humanoid",
      "undead",
    ]);
  });

  it("filters enum values by query prefix", () => {
    const out = computeBlockCompletions({
      slot: "value",
      path: ["type"],
      query: "u",
      kind: npcKind,
      allKinds,
      ctx: { world: new World() },
    });
    expect(out.map((c) => c.value)).toEqual(["undead"]);
  });

  it("delegates to the wikiLinkCompletions resolver for branded slots", () => {
    const out = computeBlockCompletions({
      slot: "value",
      path: ["carries", "0"],
      query: "swo",
      kind: npcKind,
      allKinds,
      ctx: { world: new World() },
      wikiLinkCompletions: (kindName, query) => {
        expect(kindName).toBe("item");
        expect(query).toBe("swo");
        return [
          { value: "sword", label: "Sword" },
          { value: "swordfish", label: "Swordfish" },
        ];
      },
    });
    expect(out.map((c) => c.value)).toEqual(["sword", "swordfish"]);
    expect(out[0]?.source).toBe("wikiLink");
  });

  it("offers static dice suggestions for dice() brands", () => {
    const out = computeBlockCompletions({
      slot: "value",
      path: ["attack"],
      query: "",
      kind: npcKind,
      allKinds,
      ctx: { world: new World() },
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.source).toBe("dice");
  });
});
