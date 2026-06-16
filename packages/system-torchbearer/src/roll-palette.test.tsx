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

import { describe, expect, it } from "vitest";
import type { EntityId } from "@vtt/substrate";
import { Character } from "@vtt/characters/shared";
import { ownedBy, Permissions } from "@vtt/permissions/shared";
import { buildAtelierHarness } from "./client/atelier/test-helpers.js";
import { TbRollPaletteActions, tbRollablesForCharacter } from "./client/roll-palette.js";
import { ALL_SKILLS, RawAbilities, SkillCheck, TownAbilities } from "./shared/index.js";

const ME = "test-me";

/** Build a harness whose character (Bryn) knows Fighter, plus Resources/Circles. */
function bryn(asGm: boolean) {
  const { h } = buildAtelierHarness({
    asGm,
    rollableName: SkillCheck.name,
    opts: { skillId: "fighter" },
    skills: { fighter: 3 },
  });
  // buildAtelierHarness leaves town abilities at 0 — give them ratings so
  // Resources/Circles are rollable (preview pool > 0).
  h.world.set(h.characterId, TownAbilities, {
    resources: { rating: 2, advancement: { pass: 0, fail: 0 } },
    circles: { rating: 3, advancement: { pass: 0, fail: 0 } },
    precedence: 0,
    might: 2,
  });
  return h;
}

describe("tbRollablesForCharacter", () => {
  it("enumerates abilities, town abilities, and every skill (Beginner's Luck)", () => {
    const h = bryn(true);
    const opts = tbRollablesForCharacter(h.client.registry, h.world, h.characterId);
    const labels = opts.map((o) => o.label);
    for (const expected of [
      "Will",
      "Health",
      "Nature",
      "Resources",
      "Circles",
      "Fighter", // learned (rating 3)
      "Scout", // unlearned — rollable via Beginner's Luck
    ]) {
      expect(labels).toContain(expected);
    }
    // Every catalogued skill is offered, not just the learned ones.
    for (const def of ALL_SKILLS) {
      expect(labels).toContain(def.name);
    }
  });

  it("maps each ability/skill to the rollable + opts the sheet uses", () => {
    const h = bryn(true);
    const opts = tbRollablesForCharacter(h.client.registry, h.world, h.characterId);
    const will = opts.find((o) => o.label === "Will");
    expect(will).toMatchObject({
      rollableName: "@vtt/system-torchbearer/will-check",
      opts: {},
    });
    const fighter = opts.find((o) => o.label === "Fighter");
    expect(fighter).toMatchObject({
      rollableName: SkillCheck.name,
      opts: { skillId: "fighter" },
    });
  });
});

describe("TbRollPaletteActions — write-gating", () => {
  function spawnEnemyOwnedByOther(world: import("@vtt/substrate").World): EntityId {
    return world.spawn([
      Character({ name: "Grimjaw" }),
      Permissions(ownedBy("other-player")),
      RawAbilities({
        will: { rating: 3, advancement: { pass: 0, fail: 0 } },
        health: { rating: 3, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: 3,
          maximum: 3,
          advancement: { pass: 0, fail: 0 },
          descriptors: [],
        },
      }),
    ]) as EntityId;
  }

  const initiatorOf = (cmd: { payload: unknown }) =>
    (cmd.payload as { initiatorCharacterId: string }).initiatorCharacterId;

  it("a player only sees rolls for characters they can write to", () => {
    const h = bryn(false);
    const enemyId = spawnEnemyOwnedByOther(h.world);

    const entries = TbRollPaletteActions.list({
      world: h.world,
      registry: h.client.registry,
      userId: ME,
      role: "player",
    });
    expect(entries.length).toBeGreaterThan(0);
    // Every entry targets the player's own character; none target the
    // other player's character.
    for (const e of entries) {
      expect(initiatorOf(e.command)).toBe(h.characterId);
    }
    expect(entries.some((e) => initiatorOf(e.command) === enemyId)).toBe(false);
    // Labels read "Roll <Character> — <Ability>".
    expect(entries.every((e) => e.label.startsWith("Roll "))).toBe(true);
    expect(entries.every((e) => e.tag === "roll")).toBe(true);
  });

  it("a GM sees rolls for every character, including the other player's", () => {
    const h = bryn(false);
    const enemyId = spawnEnemyOwnedByOther(h.world);

    const entries = TbRollPaletteActions.list({
      world: h.world,
      registry: h.client.registry,
      userId: "gm-user",
      role: "gm",
    });
    expect(entries.some((e) => initiatorOf(e.command) === enemyId)).toBe(true);
    expect(entries.some((e) => initiatorOf(e.command) === h.characterId)).toBe(true);
  });
});
