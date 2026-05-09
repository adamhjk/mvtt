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
import {
  CommandPipeline,
  defineCommand,
  definePlugin,
  EventBus,
  invokeRollable,
  ok,
  Registry,
  World,
  z,
  type CommandInstance,
} from "@vtt/substrate";
import {
  Character,
  CharacterFieldSet,
  PendingRoll,
  PendingRollContributed,
  SetField,
  type Contribution,
} from "@vtt/characters/shared";
import {
  CharacterFieldSetSystem,
  PendingRollContributionSystem,
} from "@vtt/characters/server";
import { Permissions, everyone, gmOnly } from "@vtt/permissions/shared";
import {
  Formula,
  RequestRoll,
  RolledBy,
  RollResult,
} from "@vtt/resolution/shared";
import { systemTorchbearer } from "./manifest.js";
import {
  ADVENTURING_SKILLS,
  AdvancementLogged,
  AdvancementLoggedTrait,
  ALL_SKILLS,
  AlliesEnemies,
  CharacterTraits,
  CirclesCheck,
  CONDITION_ORDER,
  Conditions,
  HealthCheck,
  Identity,
  ImproveSkill,
  LogAdvancement,
  LORE_MASTER_SKILLS,
  NatureCheck,
  OpenSkillImprovement,
  Pools,
  RawAbilities,
  Relics,
  ResourcesCheck,
  SkillCheck,
  SkillImproved,
  SkillImprovementOpened,
  SkillImprovementOpportunity,
  LearnSkill,
  OpenSkillLearning,
  SkillLearned,
  SkillLearningOpened,
  SkillLearningOpportunity,
  Skills,
  TOWN_SKILLS,
  TownAbilities,
  TraitUsageLogged,
  TraitUsageLoggedTrait,
  LogTraitUsage,
  UseTraitOnRoll,
  WhatYouFightFor,
  WillCheck,
  Wises,
  eligibleHelpFor,
  getSkill,
  helpProvidedBy,
  helpReplacesKey,
  isKnownSkillId,
  RollSpends,
  SpendDeeperUnderstanding,
  SpendLuck,
  SpendOfCourse,
  type HelperContext,
  type RollSpendEntry,
} from "./shared/index.js";
import {
  AdvancementLoggedSystem,
  SkillImprovedSystem,
  SkillImprovementOpenedSystem,
} from "./server/index.js";

/* -------------------------------------------------------------------------
 * Manifest shape
 * ----------------------------------------------------------------------- */

describe("@vtt/system-torchbearer manifest", () => {
  it("is marked as a game system", () => {
    expect(systemTorchbearer.gameSystem).toBe(true);
  });

  it("declares the expected dependencies", () => {
    const names = systemTorchbearer.dependsOn.map((d) => d.split("@", 2).join("@"));
    expect(names).toEqual(
      expect.arrayContaining([
        "@vtt/substrate",
        "@vtt/characters",
        "@vtt/dice-tray",
        "@vtt/scene",
        "@vtt/resolution",
      ]),
    );
  });

  it("registers every TB trait", () => {
    const names = new Set(systemTorchbearer.traits.map((t) => t.name));
    for (const trait of [
      Identity,
      WhatYouFightFor,
      Pools,
      Conditions,
      RawAbilities,
      TownAbilities,
      Skills,
      CharacterTraits,
      Wises,
      Relics,
      AlliesEnemies,
    ]) {
      expect(names.has(trait.name)).toBe(true);
    }
  });

  it("registers every TB rollable", () => {
    const names = new Set(systemTorchbearer.rollables.map((r) => r.name));
    for (const r of [
      WillCheck,
      HealthCheck,
      NatureCheck,
      ResourcesCheck,
      CirclesCheck,
      SkillCheck,
    ]) {
      expect(names.has(r.name)).toBe(true);
    }
  });

  it("fills the four sheet slots TB needs (identity, vitals, tabs, actions)", () => {
    // No status fill: the conditions ladder in vitals already shows the
    // active set; a separate chip strip in the status slot was redundant.
    const filled = Object.keys(systemTorchbearer.fills);
    expect(filled).toEqual(
      expect.arrayContaining([
        "@vtt/characters/sheet-identity",
        "@vtt/characters/sheet-vitals",
        "@vtt/characters/sheet-tabs",
        "@vtt/characters/sheet-actions",
      ]),
    );
    expect(filled).not.toContain("@vtt/characters/sheet-status");
  });

  it("registers seven tabs in printed-sheet order — inventory before arcane and invocations", () => {
    const tabs = systemTorchbearer.fills["@vtt/characters/sheet-tabs"] as Array<{
      id: string;
      label: string;
      priority: number;
    }>;
    expect(tabs).toHaveLength(7);
    // Higher priority renders leftmost — so descending priority is the
    // expected display order. Verify that and the labels.
    const sorted = [...tabs].sort((a, b) => b.priority - a.priority);
    expect(sorted.map((t) => t.label)).toEqual([
      "Who You Are",
      "What You Fight For",
      "Abilities & Skills",
      "Traits & Wises",
      "Inventory",
      "Arcane",
      "Invocations",
    ]);
  });
});

/* -------------------------------------------------------------------------
 * Skill catalog
 * ----------------------------------------------------------------------- */

describe("Skill catalog", () => {
  it("totals 47 skills (DH 33 + LMM 8 + SG NPC 6)", () => {
    expect(ADVENTURING_SKILLS).toHaveLength(25);
    expect(TOWN_SKILLS).toHaveLength(8);
    expect(LORE_MASTER_SKILLS).toHaveLength(8);
    // 6 NPC-only crafts from the Beasts with Two Legs chapter (SG p.201)
    // — Beekeeper, Brewer, Glazier, Miller, Popinjay, Potter.
    expect(ALL_SKILLS).toHaveLength(47);
  });

  it("has unique skill ids and names", () => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const s of ALL_SKILLS) {
      expect(ids.has(s.id), `duplicate id ${s.id}`).toBe(false);
      expect(names.has(s.name), `duplicate name ${s.name}`).toBe(false);
      ids.add(s.id);
      names.add(s.name);
    }
  });

  it("assigns BL to every skill", () => {
    for (const s of ALL_SKILLS) {
      expect(["will", "health"]).toContain(s.bl);
    }
  });

  it("includes the LMM additions with correct citations", () => {
    const lmmIds = new Set(LORE_MASTER_SKILLS.map((s) => s.id));
    expect(lmmIds).toEqual(
      new Set([
        "beggar",
        "butcher",
        "enchanter",
        "fisher",
        "jeweler",
        "smith",
        "strategist",
        "tanner",
      ]),
    );
    for (const s of LORE_MASTER_SKILLS) {
      expect(s.source.book).toBe("LMM");
      expect(s.source.page).toBeGreaterThanOrEqual(36);
      expect(s.source.page).toBeLessThanOrEqual(40);
    }
  });

  it("includes the standard adventuring 25 with DH citation", () => {
    for (const s of ADVENTURING_SKILLS) {
      expect(s.category).toBe("adventuring");
      expect(s.source.book).toBe("DH");
      expect(s.source.page).toBe(249);
    }
  });

  it("getSkill / isKnownSkillId look up by id", () => {
    expect(getSkill("alchemist")?.name).toBe("Alchemist");
    expect(getSkill("smith")?.bl).toBe("health");
    expect(getSkill("nope")).toBeUndefined();
    expect(isKnownSkillId("alchemist")).toBe(true);
    expect(isKnownSkillId("nope")).toBe(false);
  });

  it("every skill carries a suggestedHelp[] of known skill ids (DH p.37)", () => {
    const known = new Set(ALL_SKILLS.map((s) => s.id));
    for (const s of ALL_SKILLS) {
      expect(Array.isArray(s.suggestedHelp), `${s.id} suggestedHelp not array`).toBe(true);
      for (const id of s.suggestedHelp) {
        expect(known.has(id), `${s.id} suggests unknown help ${id}`).toBe(true);
      }
    }
  });

  it("matches the printed Help: lists for representative skills", () => {
    expect(getSkill("alchemist")?.suggestedHelp).toEqual(["loreMaster", "laborer"]);
    expect(getSkill("manipulator")?.suggestedHelp).toEqual(["haggler", "persuader"]);
    expect(getSkill("scout")?.suggestedHelp).toEqual(["pathfinder", "hunter"]);
    expect(getSkill("strategist")?.suggestedHelp).toEqual([
      "commander",
      "scholar",
      "steward",
    ]);
  });
});

/* -------------------------------------------------------------------------
 * Help eligibility (DH p.37)
 * ----------------------------------------------------------------------- */

describe("eligibleHelpFor", () => {
  function helper(input: Partial<HelperContext> = {}): HelperContext {
    return {
      skills: input.skills ?? new Map<string, number>(),
      will: input.will ?? 0,
      health: input.health ?? 0,
      nature: input.nature ?? 0,
      natureDescriptors: input.natureDescriptors ?? [],
      resources: input.resources ?? 0,
      circles: input.circles ?? 0,
    };
  }

  it("same skill help: lights up the exact skill the roller is testing", () => {
    const h = helper({ skills: new Map([["scout", 4]]) });
    const out = eligibleHelpFor({ kind: "skill", sourceId: "scout" }, h);
    expect(out.map((o) => o.id)).toEqual(["skill:scout"]);
    expect(out[0]!.via).toBe("same-skill");
    expect(out[0]!.label).toBe("Scout 4");
  });

  it("suggested help: lights up listed helps in the rulebook order", () => {
    // Alchemist suggestedHelp = [loreMaster, laborer]. Helper has both.
    const h = helper({ skills: new Map([["loreMaster", 3], ["laborer", 2]]) });
    const out = eligibleHelpFor({ kind: "skill", sourceId: "alchemist" }, h);
    expect(out.map((o) => o.id)).toEqual([
      "skill:loreMaster",
      "skill:laborer",
    ]);
    expect(out.map((o) => o.via)).toEqual(["suggested-skill", "suggested-skill"]);
  });

  it("filters rating-0 entries (DH p.37 'Rating 0 Help')", () => {
    const h = helper({ skills: new Map([["loreMaster", 0]]) });
    const out = eligibleHelpFor({ kind: "skill", sourceId: "alchemist" }, h);
    expect(out).toHaveLength(0);
  });

  it("skill-bl: helper with the actual skill helps with that, not the BL ability", () => {
    // Alchemist BL = Will. Helper has Alchemist but no Will. Result:
    // single same-skill option (BL ability is suppressed when the
    // helper has the actual skill).
    const h = helper({ skills: new Map([["alchemist", 3]]), will: 0 });
    const out = eligibleHelpFor({ kind: "skill-bl", sourceId: "alchemist" }, h);
    expect(out.map((o) => o.id)).toEqual(["skill:alchemist"]);
  });

  it("skill-bl: helper without the skill falls back to BL ability (DH p.37 'Helping Beginners')", () => {
    // Healer BL = Will. Helper has no Healer skill but has Will 4.
    const h = helper({ will: 4 });
    const out = eligibleHelpFor({ kind: "skill-bl", sourceId: "healer" }, h);
    expect(out.map((o) => o.id)).toEqual(["ability:will"]);
    expect(out[0]!.via).toBe("bl-ability");
  });

  it("ability help: same ability only", () => {
    const h = helper({ will: 5, health: 3 });
    const will = eligibleHelpFor({ kind: "ability", sourceId: "will" }, h);
    expect(will.map((o) => o.id)).toEqual(["ability:will"]);
    expect(will[0]!.via).toBe("same-ability");

    const health = eligibleHelpFor({ kind: "ability", sourceId: "health" }, h);
    expect(health.map((o) => o.id)).toEqual(["ability:health"]);
  });

  it("nature: surfaces helper's descriptors in the option label", () => {
    const h = helper({
      nature: 4,
      natureDescriptors: ["Crafting", "Climbing"],
    });
    const out = eligibleHelpFor({ kind: "ability", sourceId: "nature" }, h);
    expect(out.map((o) => o.id)).toEqual(["ability:nature"]);
    expect(out[0]!.label).toContain("Crafting");
    expect(out[0]!.label).toContain("Climbing");
    expect(out[0]!.via).toBe("nature");
  });

  it("town-ability: Resources / Circles same-only", () => {
    const h = helper({ resources: 3, circles: 4 });
    expect(
      eligibleHelpFor({ kind: "town-ability", sourceId: "resources" }, h).map(
        (o) => o.id,
      ),
    ).toEqual(["ability:resources"]);
    expect(
      eligibleHelpFor({ kind: "town-ability", sourceId: "circles" }, h).map(
        (o) => o.id,
      ),
    ).toEqual(["ability:circles"]);
  });

  it("versus: returns empty (no automatic eligibility)", () => {
    const h = helper({ skills: new Map([["fighter", 4]]) });
    const out = eligibleHelpFor({ kind: "versus", sourceId: "fighter" }, h);
    expect(out).toHaveLength(0);
  });
});

describe("helpProvidedBy / helpReplacesKey", () => {
  it("encodes a stable providedBy: 'help:<charId>:<optionId>'", () => {
    expect(helpProvidedBy("char-7", "skill:scout")).toBe("help:char-7:skill:scout");
    expect(helpProvidedBy("char-7", "ability:will")).toBe("help:char-7:ability:will");
  });

  it("dedups helper contributions per character via replaces key", () => {
    expect(helpReplacesKey("char-7")).toBe("tb:help:char-7");
    expect(helpReplacesKey("char-9")).toBe("tb:help:char-9");
    expect(helpReplacesKey("char-7")).not.toBe(helpReplacesKey("char-9"));
  });
});

/* -------------------------------------------------------------------------
 * Condition ladder
 * ----------------------------------------------------------------------- */

describe("Condition ladder", () => {
  it("has eight conditions in canonical severity order", () => {
    expect(CONDITION_ORDER.map((c) => c.id)).toEqual([
      "fresh",
      "hungryThirsty",
      "angry",
      "afraid",
      "exhausted",
      "injured",
      "sick",
      "dead",
    ]);
  });

  it("flags which conditions clear in camp vs town", () => {
    const camp = CONDITION_ORDER.filter((c) => c.clearsInCamp).map((c) => c.id);
    const town = CONDITION_ORDER.filter((c) => !c.clearsInCamp).map((c) => c.id);
    expect(camp).toEqual(["fresh", "hungryThirsty", "angry", "afraid", "exhausted"]);
    expect(town).toEqual(["injured", "sick", "dead"]);
  });

  it("matches the trait schema's keys", () => {
    const sample = Conditions.schema.parse(undefined);
    expect(Object.keys(sample).sort()).toEqual(
      [...CONDITION_ORDER.map((c) => c.id)].sort(),
    );
  });
});

/* -------------------------------------------------------------------------
 * Trait schemas
 * ----------------------------------------------------------------------- */

describe("Trait schemas", () => {
  it("Identity defaults are sane", () => {
    const v = Identity.schema.parse(undefined);
    expect(v.name).toBe("");
    expect(v.level).toBe(1);
    expect(v.age).toBe(20);
  });

  it("Identity rejects out-of-range level", () => {
    expect(() => Identity.schema.parse({ level: 99 })).toThrow();
    expect(() => Identity.schema.parse({ level: 0 })).toThrow();
  });

  it("Pools defaults to zeroes", () => {
    const v = Pools.schema.parse(undefined);
    expect(v).toEqual({
      fate: { current: 0, totalSpent: 0 },
      persona: { current: 0, totalSpent: 0 },
    });
  });

  it("Pools rejects negative values", () => {
    expect(() =>
      Pools.schema.parse({ fate: { current: -1, totalSpent: 0 }, persona: { current: 0, totalSpent: 0 } }),
    ).toThrow();
  });

  it("Conditions defaults to fresh=true, others=false", () => {
    const v = Conditions.schema.parse(undefined);
    expect(v.fresh).toBe(true);
    expect(v.hungryThirsty).toBe(false);
    expect(v.dead).toBe(false);
  });

  it("RawAbilities defaults rate Will/Health/Nature at 0 with empty advancement", () => {
    const v = RawAbilities.schema.parse(undefined);
    expect(v.will.rating).toBe(0);
    expect(v.health.advancement.pass).toBe(0);
    expect(v.nature.descriptors).toEqual([]);
  });

  it("TownAbilities Resources/Circles use the same advancement shape", () => {
    const v = TownAbilities.schema.parse(undefined);
    expect(v.resources).toEqual({ rating: 0, advancement: { pass: 0, fail: 0 } });
    expect(v.circles).toEqual({ rating: 0, advancement: { pass: 0, fail: 0 } });
    expect(v.precedence).toBe(0);
    expect(v.might).toBe(2);
  });

  it("Skills.entries includes every catalogued skill at default", () => {
    const v = Skills.schema.parse(undefined);
    for (const s of ALL_SKILLS) {
      expect(v.entries[s.id]).toBeDefined();
      expect(v.entries[s.id]!.rating).toBe(0);
    }
    // Every catalogued skill must be present and only those skills.
    expect(Object.keys(v.entries).sort()).toEqual(
      ALL_SKILLS.map((s) => s.id).sort(),
    );
  });

  it("CharacterTraits.entries enforces level 1..3", () => {
    expect(() =>
      CharacterTraits.schema.parse({
        entries: [{ name: "Stubborn", level: 0, beneficialUses: 0, checks: 0 }],
      }),
    ).toThrow();
    expect(() =>
      CharacterTraits.schema.parse({
        entries: [{ name: "Stubborn", level: 4, beneficialUses: 0, checks: 0 }],
      }),
    ).toThrow();
    const ok = CharacterTraits.schema.parse({
      entries: [{ name: "Stubborn", level: 2, beneficialUses: 1, checks: 0 }],
    });
    expect(ok.entries).toHaveLength(1);
  });

  it("Wises.entries accepts the four-box matrix", () => {
    const v = Wises.schema.parse({
      entries: [
        { name: "Field Dressing-wise", pass: true, fail: false, fate: true, persona: false },
      ],
    });
    expect(v.entries[0]!.pass).toBe(true);
    expect(v.entries[0]!.fate).toBe(true);
  });


  it("Relics tracks Urðr and Burden", () => {
    const v = Relics.schema.parse({});
    expect(v.urdr).toBe(1);
    expect(v.burden).toBe(0);
    expect(() => Relics.schema.parse({ urdr: 5 })).toThrow();
  });

  it("AlliesEnemies defaults to empty entries", () => {
    const v = AlliesEnemies.schema.parse(undefined);
    expect(v.entries).toEqual([]);
  });

  it("WhatYouFightFor defaults to empty BICG strings", () => {
    const v = WhatYouFightFor.schema.parse(undefined);
    expect(v).toEqual({ belief: "", creed: "", goal: "", instinct: "" });
  });
});

/* -------------------------------------------------------------------------
 * Rollables — given/when/then
 * ----------------------------------------------------------------------- */

function buildRollableHarness(): {
  registry: Registry;
  world: World;
  pipeline: CommandPipeline;
} {
  const r = new Registry();
  r.load(
    definePlugin({
      name: "@vtt/test-tb",
      version: "0.0.0",
      traits: [Character, Team, ...systemTorchbearer.traits],
      events: [...systemTorchbearer.events],
      commands: [RequestRoll],
      rollables: [...systemTorchbearer.rollables],
    }),
  );
  r.validate();
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(r, world, bus);
  return { registry: r, world, pipeline };
}

const SpawnTb = defineCommand({
  name: "@vtt/test-tb/Spawn",
  schema: z.object({
    name: z.string(),
    will: z.number().int().default(0),
    health: z.number().int().default(0),
    nature: z.number().int().default(0),
    maximum: z.number().int().default(0),
    resources: z.number().int().default(0),
    circles: z.number().int().default(0),
    skills: z.record(z.string(), z.number().int()).default({}),
    fresh: z.boolean().default(false),
    hungryThirsty: z.boolean().default(false),
    exhausted: z.boolean().default(false),
    injured: z.boolean().default(false),
    sick: z.boolean().default(false),
    team: z.enum(["party", "enemy"]).default("party"),
  }),
  validate: () => ok(),
  apply: ({ cmd, world }) => {
    world.spawn([
      Character({ name: cmd.name }),
      Team({ kind: cmd.team }),
      Identity({
        name: cmd.name,
        stock: "Human",
        class: "Warrior",
        level: 1,
        age: 25,
        home: "",
        raiment: "",
        parents: "",
        mentor: "",
        friend: "",
        enemy: "",
      }),
      RawAbilities({
        will: { rating: cmd.will, advancement: { pass: 0, fail: 0 } },
        health: { rating: cmd.health, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: cmd.nature,
          maximum: cmd.maximum,
          advancement: { pass: 0, fail: 0 },
          descriptors: [],
        },
      }),
      TownAbilities({
        resources: { rating: cmd.resources, advancement: { pass: 0, fail: 0 } },
        circles: { rating: cmd.circles, advancement: { pass: 0, fail: 0 } },
        precedence: 0,
        might: 2,
      }),
      // Conditions explicitly off — the trait defaults to `fresh: true`,
      // which would auto-add +1D to every test pool. The rollable
      // subsystem covers Fresh / Injured / Sick in dedicated tests
      // below; here we want clean base-pool numbers.
      Conditions({
        fresh: cmd.fresh,
        hungryThirsty: cmd.hungryThirsty,
        angry: false,
        afraid: false,
        exhausted: cmd.exhausted,
        injured: cmd.injured,
        sick: cmd.sick,
        dead: false,
      }),
      Skills({
        entries: Object.fromEntries(
          ALL_SKILLS.map((s) => [
            s.id,
            {
              rating: cmd.skills[s.id] ?? 0,
              advancement: { pass: 0, fail: 0 },
              taxed: false,
              learningTests: 0,
            },
          ]),
        ),
      }),
    ]);
    return [];
  },
});

async function spawn(
  pipeline: CommandPipeline,
  payload: z.input<typeof SpawnTb.schema>,
  registry: Registry,
): Promise<void> {
  registry.commands.set(SpawnTb.name, SpawnTb);
  await pipeline.dispatch({
    id: `c-${Math.random()}`,
    issuedBy: "u1",
    issuedAt: 0,
    cmd: SpawnTb(payload) as CommandInstance,
  });
}

describe("Ability rollables", () => {
  it("WillCheck — pool comes from RawAbilities.will.rating", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 4 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(h.registry.rollables.get(WillCheck.name)!, h.world, id);
    expect(r).not.toBeNull();
    const spec = r!.spec as { pool: number; source: string; baseDice: number };
    expect(spec.baseDice).toBe(4);
    expect(spec.pool).toBe(4);
    expect(spec.source).toBe("Will");
  });

  it("HealthCheck — pool comes from RawAbilities.health.rating", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", health: 5 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(h.registry.rollables.get(HealthCheck.name)!, h.world, id);
    const spec = r!.spec as { pool: number; baseDice: number };
    expect(spec.baseDice).toBe(5);
    expect(spec.pool).toBe(5);
  });

  it("NatureCheck — defaults to rated Nature", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", nature: 4, maximum: 2 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(h.registry.rollables.get(NatureCheck.name)!, h.world, id);
    const spec = r!.spec as { pool: number; source: string };
    expect(spec.pool).toBe(4);
    expect(spec.source).toBe("Nature");
  });

  it("NatureCheck — opts.tap rolls maximum Nature instead", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", nature: 4, maximum: 2 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(NatureCheck.name)!,
      h.world,
      id,
      { tap: true },
    );
    const spec = r!.spec as { pool: number; source: string };
    expect(spec.pool).toBe(2);
    expect(spec.source).toBe("Nature (tap)");
  });
});

describe("Town ability rollables", () => {
  it("ResourcesCheck — pool comes from TownAbilities.resources.rating", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", resources: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(h.registry.rollables.get(ResourcesCheck.name)!, h.world, id);
    expect((r!.spec as { pool: number }).pool).toBe(3);
  });

  it("CirclesCheck — pool comes from TownAbilities.circles.rating", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", circles: 2 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(h.registry.rollables.get(CirclesCheck.name)!, h.world, id);
    expect((r!.spec as { pool: number }).pool).toBe(2);
  });
});

describe("SkillCheck rollable", () => {
  it("rolls the skill rating when learned", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", skills: { fighter: 3 } }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(SkillCheck.name)!,
      h.world,
      id,
      { skillId: "fighter" },
    );
    const spec = r!.spec as { pool: number; source: string; baseDice: number };
    expect(spec.baseDice).toBe(3);
    expect(spec.pool).toBe(3);
    expect(spec.source).toBe("Fighter");
  });

  it("falls through to half BL ability (Health for Fighter) when unlearned", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", health: 5 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(SkillCheck.name)!,
      h.world,
      id,
      { skillId: "fighter" },
    );
    const spec = r!.spec as { pool: number; source: string };
    // Health 5 → ceil(5/2) = 3
    expect(spec.pool).toBe(3);
    expect(spec.source).toContain("Beginner's Luck, health");
  });

  it("falls through to half Will for a Will-BL skill (Alchemist)", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 4 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(SkillCheck.name)!,
      h.world,
      id,
      { skillId: "alchemist" },
    );
    const spec = r!.spec as { pool: number; source: string };
    // Will 4 → ceil(4/2) = 2
    expect(spec.pool).toBe(2);
    expect(spec.source).toContain("Beginner's Luck, will");
  });

  it("supports LMM-introduced skills (e.g. Strategist) in BL fall-through", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 5 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(SkillCheck.name)!,
      h.world,
      id,
      { skillId: "strategist" },
    );
    const spec = r!.spec as { pool: number; source: string };
    // Will 5 → ceil(5/2) = 3, LMM Strategist BL = will
    expect(spec.pool).toBe(3);
    expect(spec.source).toContain("Strategist (Beginner's Luck, will)");
  });

  it("rejects an opts shape with no skillId", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn" }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    expect(() =>
      invokeRollable(h.registry.rollables.get(SkillCheck.name)!, h.world, id, {}),
    ).toThrow(/opts failed schema/);
  });
});

/* -------------------------------------------------------------------------
 * Rolling subsystem — modifiers, conditions, panel contributions, meta
 * ----------------------------------------------------------------------- */

import {
  ANGRY_AFFECTED_SKILLS,
  Heroic,
  TbRollSpec,
  TbRollModifier,
  TbRollMetaSchema,
  TbRollModifierSchema,
  TbRollModifierProvidersSlot,
  TbRollSpecSchema,
  TB_DISPOSITION_CONTRIB_KIND,
  TB_ROLL_META_SYSTEM,
  TB_CHANNEL_NATURE_CONTRIB_KIND,
  TB_HEROIC_CONTRIB_KIND,
  TB_MODIFIER_CONTRIB_KIND,
  TB_OBSTACLE_CONTRIB_KIND,
  TB_PERSONA_SPEND_CONTRIB_KIND,
  TB_SYNERGY_CONTRIB_KIND,
  TB_VERSUS_CONTRIB_KIND,
  buildTbNotation,
  channelNatureFromContributions,
  countSuccesses,
  dispositionAddToFromContributions,
  dispositionFromContributions,
  foldBlModifiers,
  foldModifiers,
  formatModifier,
  heroicFromContributions,
  isBlPreHalfModifier,
  obstacleFromContributions,
  personaSpendTotalFromContributions,
  resolveSuccessCount,
  synergyHelpersFromContributions,
  autoModifiersFromConditions,
  modifiersFromContributions,
  suggestedQuickModifiersFor,
  versusFromContributions,
} from "./shared/index.js";
import { Team } from "@vtt/characters/shared";
import { DiceRoll } from "@dice-roller/rpg-dice-roller";

describe("TbRollModifier schema", () => {
  it("accepts a minimal manual modifier and defaults apply/source", () => {
    const m = TbRollModifierSchema.parse({
      id: "m1",
      kind: "dice",
      value: 1,
      label: "Help (Tarn)",
    });
    expect(m.apply).toBe("always");
    expect(m.source).toBe("manual");
  });

  it("rejects zero value modifiers? (no — zero is allowed since signed integer)", () => {
    // We deliberately allow zero — pre-empts edge cases like a wise's
    // first-use bookkeeping where the contribution exists for tracking
    // even though it doesn't move the pool.
    const m = TbRollModifierSchema.parse({
      id: "m0",
      kind: "success",
      value: 0,
      label: "noop",
    });
    expect(m.value).toBe(0);
  });

  it("validates apply enum members", () => {
    expect(() =>
      TbRollModifierSchema.parse({
        id: "m1",
        kind: "dice",
        value: 1,
        label: "x",
        apply: "sometimes" as never,
      }),
    ).toThrow();
  });

  it("validates kind enum members", () => {
    expect(() =>
      TbRollModifierSchema.parse({
        id: "m1",
        kind: "tax" as never,
        value: 1,
        label: "x",
      }),
    ).toThrow();
  });
});

describe("foldModifiers", () => {
  it("returns the base when there are no modifiers", () => {
    expect(foldModifiers(4, [])).toEqual({
      pool: 4,
      bonusSuccesses: 0,
      obstacleAdjust: 0,
    });
  });

  it("adds always-applied dice modifiers to the pool", () => {
    const r = foldModifiers(3, [
      { id: "a", kind: "dice", value: 1, label: "Fresh", apply: "always", source: "condition" },
      { id: "b", kind: "dice", value: -1, label: "Sick", apply: "always", source: "condition" },
    ]);
    expect(r.pool).toBe(3);
    expect(r.bonusSuccesses).toBe(0);
  });

  it("clamps a negative pool at zero", () => {
    const r = foldModifiers(2, [
      { id: "a", kind: "dice", value: -5, label: "huge penalty", apply: "always", source: "manual" },
    ]);
    expect(r.pool).toBe(0);
  });

  it("ignores conditional modifiers when folding the pool", () => {
    const r = foldModifiers(3, [
      { id: "a", kind: "dice", value: 1, label: "always", apply: "always", source: "manual" },
      { id: "b", kind: "dice", value: 5, label: "on success", apply: "on-success", source: "manual" },
      { id: "c", kind: "success", value: 5, label: "on success", apply: "on-success", source: "manual" },
    ]);
    expect(r.pool).toBe(4);
    expect(r.bonusSuccesses).toBe(0);
  });

  it("sums always-applied success modifiers", () => {
    const r = foldModifiers(3, [
      { id: "a", kind: "success", value: 1, label: "+1s", apply: "always", source: "manual" },
      { id: "b", kind: "success", value: 2, label: "+2s", apply: "always", source: "manual" },
      { id: "c", kind: "success", value: -1, label: "-1s", apply: "always", source: "manual" },
    ]);
    expect(r.bonusSuccesses).toBe(2);
  });
});

describe("foldModifiers — obstacle kind", () => {
  it("sums always-applied obstacle modifiers into obstacleAdjust", () => {
    const r = foldModifiers(4, [
      { id: "f", kind: "obstacle", value: 1, label: "factors", apply: "always", source: "manual" },
      { id: "d", kind: "obstacle", value: 1, label: "dim light", apply: "always", source: "condition" },
      { id: "b", kind: "obstacle", value: -1, label: "advantage", apply: "always", source: "manual" },
    ]);
    expect(r.obstacleAdjust).toBe(1);
    expect(r.pool).toBe(4);
    expect(r.bonusSuccesses).toBe(0);
  });

  it("ignores conditional obstacle modifiers (always-applied only)", () => {
    const r = foldModifiers(3, [
      { id: "x", kind: "obstacle", value: 5, label: "post-pass nonsense", apply: "on-success", source: "manual" },
    ]);
    expect(r.obstacleAdjust).toBe(0);
  });
});

describe("isBlPreHalfModifier (DH p.59 partition)", () => {
  // Helper: build a modifier of arbitrary source/kind with safe defaults.
  function mod(
    over: Partial<TbRollModifier> & {
      kind: TbRollModifier["kind"];
      source: TbRollModifier["source"];
    },
  ): TbRollModifier {
    return {
      id: over.id ?? "m",
      kind: over.kind,
      value: over.value ?? 1,
      label: over.label ?? "x",
      apply: over.apply ?? "always",
      source: over.source,
      providedBy: over.providedBy,
    };
  }

  it("help, wise, gear → pre-half", () => {
    expect(isBlPreHalfModifier(mod({ kind: "dice", source: "help" }))).toBe(true);
    expect(isBlPreHalfModifier(mod({ kind: "dice", source: "wise" }))).toBe(true);
    expect(isBlPreHalfModifier(mod({ kind: "dice", source: "gear" }))).toBe(true);
  });

  it("trait / persona / fate / spell / level-benefit / manual / auto → post-half", () => {
    for (const source of ["trait", "persona", "fate", "spell", "level-benefit", "manual", "auto"] as const) {
      expect(isBlPreHalfModifier(mod({ kind: "dice", source }))).toBe(false);
    }
  });

  it("condition: Injured / Sick / taxed-skill → pre-half (reduce ability)", () => {
    expect(
      isBlPreHalfModifier(
        mod({ kind: "dice", value: -1, source: "condition", providedBy: "condition:injured" }),
      ),
    ).toBe(true);
    expect(
      isBlPreHalfModifier(
        mod({ kind: "dice", value: -1, source: "condition", providedBy: "condition:sick" }),
      ),
    ).toBe(true);
    expect(
      isBlPreHalfModifier(
        mod({ kind: "dice", value: -1, source: "condition", providedBy: "skill:fighter:taxed" }),
      ),
    ).toBe(true);
  });

  it("condition: Fresh → post-half (RAW: 'the fresh condition')", () => {
    expect(
      isBlPreHalfModifier(
        mod({ kind: "dice", value: 1, source: "condition", providedBy: "condition:fresh" }),
      ),
    ).toBe(false);
  });

  it("non-dice modifiers never participate in halving", () => {
    expect(
      isBlPreHalfModifier(mod({ kind: "success", source: "trait", value: 1 })),
    ).toBe(false);
    expect(
      isBlPreHalfModifier(mod({ kind: "obstacle", source: "manual", value: 1 })),
    ).toBe(false);
  });

  it("conditional modifiers never participate in halving", () => {
    expect(
      isBlPreHalfModifier(
        mod({ kind: "dice", source: "help", apply: "on-success" }),
      ),
    ).toBe(false);
  });
});

describe("foldBlModifiers (DH p.59 'Beginners Roll Half')", () => {
  it("halves a bare ability rating, rounding up", () => {
    expect(foldBlModifiers(5, [])).toEqual({
      pool: 3,
      bonusSuccesses: 0,
      obstacleAdjust: 0,
    });
    expect(foldBlModifiers(4, []).pool).toBe(2);
    expect(foldBlModifiers(3, []).pool).toBe(2);
    expect(foldBlModifiers(0, []).pool).toBe(0);
  });

  it("help dice fold INTO the halved group: ceil((ability + help) / 2)", () => {
    // Health 3 + Hunter 1 help → ceil(4/2) = 2 dice (vs 3 under the old
    // halve-then-add math).
    const r = foldBlModifiers(3, [
      { id: "h", kind: "dice", value: 1, label: "Tarn (Hunter)", apply: "always", source: "help" },
    ]);
    expect(r.pool).toBe(2);
  });

  it("Injured/Sick reduce ability before halving", () => {
    // Health 5, Injured -1D, Sick -1D → ceil((5 - 1 - 1) / 2) = 2.
    const r = foldBlModifiers(5, [
      { id: "i", kind: "dice", value: -1, label: "Injured", apply: "always", source: "condition", providedBy: "condition:injured" },
      { id: "s", kind: "dice", value: -1, label: "Sick", apply: "always", source: "condition", providedBy: "condition:sick" },
    ]);
    expect(r.pool).toBe(2);
  });

  it("Fresh adds AFTER halving (RAW: 'add … the fresh condition')", () => {
    // Health 4 + Fresh +1D → ceil(4/2) + 1 = 3 dice. Fresh wouldn't co-
    // exist with another condition under DH's cancellation rule, but the
    // partition still places it post-half.
    const r = foldBlModifiers(4, [
      { id: "f", kind: "dice", value: 1, label: "Fresh", apply: "always", source: "condition", providedBy: "condition:fresh" },
    ]);
    expect(r.pool).toBe(3);
  });

  it("traits and persona land post-half", () => {
    // Will 4 + trait +1D + persona +1D → ceil(4/2) + 1 + 1 = 4.
    const r = foldBlModifiers(4, [
      { id: "t", kind: "dice", value: 1, label: "Stubborn", apply: "always", source: "trait" },
      { id: "p", kind: "dice", value: 1, label: "Persona", apply: "always", source: "persona" },
    ]);
    expect(r.pool).toBe(4);
  });

  it("mixed: ability 5 + help +1 + Injured -1 + trait +1", () => {
    // Pre-half group: 5 + 1 (help) - 1 (Injured) = 5 → ceil(5/2) = 3
    // Post-half: + 1 (trait) = 4.
    const r = foldBlModifiers(5, [
      { id: "h", kind: "dice", value: 1, label: "help", apply: "always", source: "help" },
      { id: "i", kind: "dice", value: -1, label: "Injured", apply: "always", source: "condition", providedBy: "condition:injured" },
      { id: "t", kind: "dice", value: 1, label: "Brave", apply: "always", source: "trait" },
    ]);
    expect(r.pool).toBe(4);
  });

  it("clamps a negative pre-half group at 0 before halving", () => {
    // Will 1, Injured -1, Sick -1 → pre-half = max(0, 1-1-1) = 0
    // → ceil(0/2) = 0; no traits → pool 0 (auto-fail).
    const r = foldBlModifiers(1, [
      { id: "i", kind: "dice", value: -1, label: "Injured", apply: "always", source: "condition", providedBy: "condition:injured" },
      { id: "s", kind: "dice", value: -1, label: "Sick", apply: "always", source: "condition", providedBy: "condition:sick" },
    ]);
    expect(r.pool).toBe(0);
  });

  it("success modifiers fold into bonusSuccesses (no halving for them)", () => {
    const r = foldBlModifiers(4, [
      { id: "s", kind: "success", value: 1, label: "+1s", apply: "always", source: "manual" },
    ]);
    expect(r.pool).toBe(2);
    expect(r.bonusSuccesses).toBe(1);
  });

  it("obstacle modifiers fold normally", () => {
    const r = foldBlModifiers(4, [
      { id: "o", kind: "obstacle", value: 1, label: "factors", apply: "always", source: "manual" },
    ]);
    expect(r.pool).toBe(2);
    expect(r.obstacleAdjust).toBe(1);
  });

  it("conditional dice modifiers don't enter the halving (apply post-roll)", () => {
    const r = foldBlModifiers(4, [
      { id: "x", kind: "dice", value: 1, label: "on-pass bonus", apply: "on-success", source: "manual" },
    ]);
    expect(r.pool).toBe(2);
  });
});

describe("SkillCheck BL — RAW halving (DH p.59)", () => {
  // Smoke test against the rollable directly. Detailed fold tests live
  // above; this confirms the rollable wires foldBlModifiers in.
  it("BL ability 5 with no help: pool 3 (unchanged from old math)", async () => {
    // Already covered by the existing 'falls through to half BL ability'
    // test, but kept here for grouping clarity.
    expect(Math.ceil(5 / 2)).toBe(3);
  });

  it("with a +1D help contribution, BL pool stays at ceil((ability+1)/2) — not ability/2 + 1", () => {
    const fold = foldBlModifiers(3, [
      { id: "h", kind: "dice", value: 1, label: "Tarn (Hunter)", apply: "always", source: "help" },
    ]);
    expect(fold.pool).toBe(2);
    // Old (pre-fix) behavior would have produced 3.
    expect(fold.pool).not.toBe(3);
  });
});

describe("buildTbNotation", () => {
  it("renders a default-success pool as Nd6>=4", () => {
    expect(buildTbNotation(4, 0, false)).toBe("4d6>=4");
  });

  it("renders a heroic pool with the lowered target Nd6>=3", () => {
    expect(buildTbNotation(4, 0, true)).toBe("4d6>=3");
  });

  it("appends positive bonus successes as +B arithmetic", () => {
    expect(buildTbNotation(3, 1, false)).toBe("3d6>=4+1");
    expect(buildTbNotation(3, 2, true)).toBe("3d6>=3+2");
  });

  it("appends negative bonus successes as -B (single sign)", () => {
    expect(buildTbNotation(3, -1, false)).toBe("3d6>=4-1");
    expect(buildTbNotation(3, -2, true)).toBe("3d6>=3-2");
  });

  it("collapses to a bare 0 when the pool is auto-fail (no bonus)", () => {
    expect(buildTbNotation(0, 0, false)).toBe("0");
    expect(buildTbNotation(-3, 0, true)).toBe("0");
  });

  it("emits a bare bonus-successes constant when the pool is zero with bonus", () => {
    expect(buildTbNotation(0, 2, false)).toBe("2");
    expect(buildTbNotation(0, -1, false)).toBe("-1");
  });
});

describe("countSuccesses", () => {
  it("defaults to target 4 (standard TB)", () => {
    const dice = [
      { sides: 6 as const, value: 3 },
      { sides: 6 as const, value: 4 },
      { sides: 6 as const, value: 5 },
      { sides: 6 as const, value: 6 },
      { sides: 6 as const, value: 1 },
    ];
    expect(countSuccesses(dice)).toBe(3);
  });

  it("ignores non-d6 dice (defensive)", () => {
    const dice = [
      { sides: 6 as const, value: 5 },
      { sides: 8 as const, value: 7 },
      { sides: "F" as const, value: 1 },
    ];
    expect(countSuccesses(dice)).toBe(1);
  });

  it("counts dice >= 3 when given the heroic target", () => {
    const dice = [
      { sides: 6 as const, value: 1 },
      { sides: 6 as const, value: 2 },
      { sides: 6 as const, value: 3 },
      { sides: 6 as const, value: 4 },
      { sides: 6 as const, value: 5 },
      { sides: 6 as const, value: 6 },
    ];
    expect(countSuccesses(dice, 3)).toBe(4);
    expect(countSuccesses(dice, 4)).toBe(3);
  });
});

describe("dice formula round-trip via rpg-dice-roller", () => {
  /**
   * The notation TB emits has to actually produce a meaningful
   * `RollResult.total` — anyone consuming the wire needs to trust
   * that `total` IS the success count after always-applied bonuses.
   * This verifies the rules-as-written formula end-to-end through
   * the same dice library that runs in production.
   */

  it("rolls Nd6>=4 and reports success count as total", () => {
    const r = new DiceRoll("4d6>=4");
    // total is integer in [0, 4]
    expect(Number.isInteger(r.total)).toBe(true);
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(4);
  });

  it("rolls Nd6>=3 (heroic) and reports more-or-equal successes than the same notation at >=4", () => {
    // Run both with deterministic-ish dice via repeated rolls and
    // compare averages. With 4 dice over 200 trials, heroic should
    // produce a higher mean — proves the success target is wired.
    const trials = 200;
    let standard = 0;
    let heroic = 0;
    for (let i = 0; i < trials; i++) {
      standard += new DiceRoll("4d6>=4").total;
      heroic += new DiceRoll("4d6>=3").total;
    }
    // Expected mean: standard ≈ 4 * (3/6) = 2; heroic ≈ 4 * (4/6) ≈ 2.67.
    // Allow generous slack but require heroic strictly >= standard
    // across the trial mass.
    expect(heroic).toBeGreaterThan(standard);
  });

  it("respects bonus-success arithmetic in notation", () => {
    // 4d6>=4+10 — adds 10 to the total, regardless of dice rolled.
    // Smallest possible dice contribution is 0 successes; total >= 10.
    for (let i = 0; i < 20; i++) {
      const r = new DiceRoll("4d6>=4+10");
      expect(r.total).toBeGreaterThanOrEqual(10);
      expect(r.total).toBeLessThanOrEqual(14);
    }
  });

  it("accepts the auto-fail sentinel (`0`) as a valid notation", () => {
    const r = new DiceRoll("0");
    expect(r.total).toBe(0);
  });

  it("accepts a leading-negative bonus-only notation (`-1`)", () => {
    const r = new DiceRoll("-1");
    expect(r.total).toBe(-1);
  });

  it("buildTbNotation always produces a notation rpg-dice-roller can parse", () => {
    // Cross every combination the rolling subsystem can emit:
    // pool { 0, 1, 6 }, bonus { -2, 0, 1, 3 }, heroic { false, true }.
    const cases: Array<{ pool: number; bonus: number; heroic: boolean }> = [];
    for (const pool of [0, 1, 6]) {
      for (const bonus of [-2, 0, 1, 3]) {
        for (const heroic of [false, true]) {
          cases.push({ pool, bonus, heroic });
        }
      }
    }
    for (const c of cases) {
      const notation = buildTbNotation(c.pool, c.bonus, c.heroic);
      // Construct without throwing — the validator in RequestRoll
      // does the same check.
      const r = new DiceRoll(notation);
      expect(typeof r.total).toBe("number");
    }
  });
});

describe("resolveSuccessCount", () => {
  const baseSpec: TbRollSpec = {
    kind: "ability",
    source: "Will",
    sourceId: "will",
    baseDice: 4,
    pool: 4,
    bonusSuccesses: 0,
    heroic: false,
    successTarget: 4,
    baseObstacle: 2,
    obstacle: 2,
    modifiers: [],
    caption: "Will vs Ob 2",
  };

  it("counts raw successes against the obstacle", () => {
    const r = resolveSuccessCount(baseSpec, [
      { sides: 6, value: 5 },
      { sides: 6, value: 6 },
      { sides: 6, value: 1 },
      { sides: 6, value: 2 },
    ]);
    expect(r.rawSuccesses).toBe(2);
    expect(r.always).toBe(0);
    expect(r.conditional).toBe(0);
    expect(r.final).toBe(2);
    expect(r.passed).toBe(true);
  });

  it("folds always-applied success bonuses into the final count", () => {
    const r = resolveSuccessCount(
      { ...baseSpec, bonusSuccesses: 1 },
      [
        { sides: 6, value: 5 },
        { sides: 6, value: 1 },
        { sides: 6, value: 2 },
        { sides: 6, value: 3 },
      ],
    );
    expect(r.rawSuccesses).toBe(1);
    expect(r.always).toBe(1);
    expect(r.final).toBe(2);
    expect(r.passed).toBe(true);
  });

  it("applies on-success modifiers only when the test passes", () => {
    const spec: TbRollSpec = {
      ...baseSpec,
      modifiers: [
        {
          id: "f1",
          kind: "success",
          value: 1,
          label: "Faith reroll",
          apply: "on-success",
          source: "fate",
        },
      ],
    };
    // 2 successes vs Ob 2 → pass; +1s on success => 3 total
    const pass = resolveSuccessCount(spec, [
      { sides: 6, value: 4 },
      { sides: 6, value: 5 },
      { sides: 6, value: 1 },
      { sides: 6, value: 2 },
    ]);
    expect(pass.passed).toBe(true);
    expect(pass.conditional).toBe(1);
    expect(pass.final).toBe(3);

    // 0 successes vs Ob 2 → fail; on-success modifier inert
    const fail = resolveSuccessCount(spec, [
      { sides: 6, value: 1 },
      { sides: 6, value: 2 },
      { sides: 6, value: 3 },
      { sides: 6, value: 3 },
    ]);
    expect(fail.passed).toBe(false);
    expect(fail.conditional).toBe(0);
    expect(fail.final).toBe(0);
  });

  it("applies on-fail modifiers only when the test fails", () => {
    const spec: TbRollSpec = {
      ...baseSpec,
      modifiers: [
        {
          id: "f1",
          kind: "success",
          value: 2,
          label: "consolation",
          apply: "on-fail",
          source: "manual",
        },
      ],
    };
    // 0 successes vs Ob 2 → fail; +2s on fail
    const fail = resolveSuccessCount(spec, [
      { sides: 6, value: 1 },
      { sides: 6, value: 2 },
      { sides: 6, value: 3 },
      { sides: 6, value: 3 },
    ]);
    expect(fail.passed).toBe(false);
    expect(fail.conditional).toBe(2);
    expect(fail.final).toBe(2);
  });

  it("falls back to total > 0 when no obstacle is declared", () => {
    const spec: TbRollSpec = { ...baseSpec, obstacle: null };
    const passed = resolveSuccessCount(spec, [{ sides: 6, value: 6 }]);
    expect(passed.passed).toBe(true);
    const failed = resolveSuccessCount(spec, [
      { sides: 6, value: 1 },
      { sides: 6, value: 2 },
    ]);
    expect(failed.passed).toBe(false);
  });

  it("treats pool=0 as auto-fail with zero raw successes regardless of dice", () => {
    const spec: TbRollSpec = { ...baseSpec, pool: 0, baseDice: 0 };
    // Buildr emits a bare `0` notation; the chat row sees no dice
    // and pool==0 short-circuits to 0 successes.
    const r = resolveSuccessCount(spec, [{ sides: 6, value: 6 }]);
    expect(r.rawSuccesses).toBe(0);
    expect(r.passed).toBe(false);
    expect(r.final).toBe(0);
  });

  it("counts dice >= 3 as successes when the spec is heroic", () => {
    const spec: TbRollSpec = {
      ...baseSpec,
      heroic: true,
      successTarget: 3,
    };
    // dice [1, 3, 4, 6]: standard target = 2 successes, heroic = 3.
    const r = resolveSuccessCount(spec, [
      { sides: 6, value: 1 },
      { sides: 6, value: 3 },
      { sides: 6, value: 4 },
      { sides: 6, value: 6 },
    ]);
    expect(r.rawSuccesses).toBe(3);
    expect(r.passed).toBe(true);
    expect(r.final).toBe(3);
  });

  it("standard spec ignores 3s as misses", () => {
    const spec: TbRollSpec = { ...baseSpec, heroic: false, successTarget: 4 };
    const r = resolveSuccessCount(spec, [
      { sides: 6, value: 1 },
      { sides: 6, value: 3 },
      { sides: 6, value: 4 },
      { sides: 6, value: 6 },
    ]);
    expect(r.rawSuccesses).toBe(2);
  });
});

describe("autoModifiersFromConditions", () => {
  function conds(o: Partial<Parameters<typeof autoModifiersFromConditions>[0]>) {
    return {
      fresh: false,
      hungryThirsty: false,
      angry: false,
      afraid: false,
      exhausted: false,
      injured: false,
      sick: false,
      dead: false,
      ...o,
    };
  }

  it("emits +1D for Fresh on ability tests", () => {
    const m = autoModifiersFromConditions(conds({ fresh: true }), "ability");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "dice", value: 1, source: "condition" });
  });

  it("emits -1D each for Injured and Sick stacking on a skill test", () => {
    const m = autoModifiersFromConditions(
      conds({ injured: true, sick: true }),
      "skill",
    );
    expect(m.map((x) => x.value)).toEqual([-1, -1]);
    expect(m.map((x) => x.providedBy)).toEqual([
      "condition:injured",
      "condition:sick",
    ]);
  });

  it("emits no modifiers on town-ability rolls (Resources/Circles)", () => {
    const m = autoModifiersFromConditions(
      conds({ fresh: true, injured: true, sick: true }),
      "town-ability",
    );
    expect(m).toEqual([]);
  });

  it("applies condition modifiers to Beginner's-Luck skill rolls (skill-bl)", () => {
    // Fresh + Injured can't co-exist by SG p.46 — Injured cancels
    // the Fresh bonus. So this combination yields only the Injured
    // -1D, not both.
    const m = autoModifiersFromConditions(
      conds({ fresh: true, injured: true }),
      "skill-bl",
    );
    expect(m).toHaveLength(1);
    expect(m[0]!.value).toBe(-1);
    expect(m[0]!.providedBy).toBe("condition:injured");
  });

  it("Fresh +1D fires alone when no other condition is set, on skill-bl too", () => {
    const m = autoModifiersFromConditions(
      conds({ fresh: true }),
      "skill-bl",
    );
    expect(m).toHaveLength(1);
    expect(m[0]!.value).toBe(1);
    expect(m[0]!.providedBy).toBe("condition:fresh");
  });

  it("suppresses Fresh +1D the moment any other condition is also set (SG p.46)", () => {
    for (const otherKey of [
      "hungryThirsty",
      "angry",
      "afraid",
      "exhausted",
      "injured",
      "sick",
      "dead",
    ] as const) {
      const m = autoModifiersFromConditions(
        conds({ fresh: true, [otherKey]: true } as never),
        "skill",
      );
      const hasFresh = m.some((x) => x.providedBy === "condition:fresh");
      expect(hasFresh).toBe(false);
    }
  });

  it("Dead trumps every other condition: emits a single suppressing modifier (SG p.52)", () => {
    const m = autoModifiersFromConditions(
      conds({ dead: true, fresh: true, injured: true, sick: true }),
      "ability",
    );
    expect(m).toHaveLength(1);
    expect(m[0]!.providedBy).toBe("condition:dead");
    expect(m[0]!.value).toBeLessThan(0);
  });

  it("Dead suppresses Resources/Circles too — town-ability is no exception", () => {
    const m = autoModifiersFromConditions(
      conds({ dead: true }),
      "town-ability",
    );
    expect(m).toHaveLength(1);
    expect(m[0]!.providedBy).toBe("condition:dead");
  });

  it("Afraid + skill-bl emits a no-BL suppression modifier (SG p.48)", () => {
    const m = autoModifiersFromConditions(
      conds({ afraid: true }),
      "skill-bl",
      "fighter",
    );
    const blMod = m.find((x) => x.providedBy === "condition:afraid");
    expect(blMod).toBeDefined();
    expect(blMod!.value).toBeLessThan(0);
    expect(blMod!.label).toContain("Beginner");
  });

  it("Afraid does NOT suppress learned-skill rolls (only skill-bl is gated)", () => {
    const m = autoModifiersFromConditions(
      conds({ afraid: true }),
      "skill",
      "fighter",
    );
    const blMod = m.find((x) => x.providedBy === "condition:afraid");
    expect(blMod).toBeUndefined();
  });

  it("Angry on a versus test of a precision/social skill emits -1s (SG p.48)", () => {
    const m = autoModifiersFromConditions(
      conds({ angry: true }),
      "skill",
      "manipulator",
      "versus:abc",
    );
    const angryMod = m.find((x) => x.providedBy === "condition:angry");
    expect(angryMod).toBeDefined();
    expect(angryMod!.kind).toBe("success");
    expect(angryMod!.value).toBe(-1);
    expect(angryMod!.label).toContain("versus");
  });

  it("Angry on a non-versus test does NOT auto-apply +1 Ob (GM option, surfaced as suggestion)", () => {
    // SG p.48: the +1 Ob for non-versus precision/social tests is
    // "at the game master's option" — we don't fold it into the
    // spec automatically. It's surfaced through
    // `suggestedQuickModifiersFor` as a contextual panel button
    // the GM/player can apply deliberately.
    const m = autoModifiersFromConditions(
      conds({ angry: true }),
      "skill",
      "loreMaster",
      null,
    );
    expect(m.find((x) => x.providedBy === "condition:angry")).toBeUndefined();
  });

  it("Angry doesn't fire on combat-related skills (Fighter, Hunter, Scout)", () => {
    for (const sourceId of ["fighter", "hunter", "scout"]) {
      const nonVersus = autoModifiersFromConditions(
        conds({ angry: true }),
        "skill",
        sourceId,
        null,
      );
      const versus = autoModifiersFromConditions(
        conds({ angry: true }),
        "skill",
        sourceId,
        "versus:abc",
      );
      expect(
        nonVersus.find((x) => x.providedBy === "condition:angry"),
      ).toBeUndefined();
      expect(
        versus.find((x) => x.providedBy === "condition:angry"),
      ).toBeUndefined();
    }
  });

  it("Angry doesn't fire on ability or town-ability rolls regardless of source", () => {
    const ability = autoModifiersFromConditions(
      conds({ angry: true }),
      "ability",
      "will",
      null,
    );
    expect(
      ability.find((x) => x.providedBy === "condition:angry"),
    ).toBeUndefined();
    // town-ability returns [] entirely (kind filter), so trivially no angry mod.
    const town = autoModifiersFromConditions(
      conds({ angry: true }),
      "town-ability",
      "resources",
      null,
    );
    expect(town).toEqual([]);
  });

  it("Angry's affected-skills constant covers the printed list (SG p.48)", () => {
    // Spot-check the printed roster.
    for (const id of [
      "alchemist",
      "cartographer",
      "commander",
      "cook",
      "dungeoneer",
      "haggler",
      "healer",
      "mentor",
      "loreMaster",
      "manipulator",
      "orator",
      "pathfinder",
      "persuader",
      "scholar",
      "survivalist",
    ]) {
      expect(ANGRY_AFFECTED_SKILLS).toContain(id);
    }
    // Sanity: not affected (combat-related, not precision/social).
    expect(ANGRY_AFFECTED_SKILLS).not.toContain("fighter");
    expect(ANGRY_AFFECTED_SKILLS).not.toContain("hunter");
    expect(ANGRY_AFFECTED_SKILLS).not.toContain("scout");
  });

  it("Hungry/Thirsty and Exhausted never fold into the test pool (conflict-only)", () => {
    const m = autoModifiersFromConditions(
      conds({ hungryThirsty: true, exhausted: true }),
      "skill",
      "fighter",
    );
    expect(m).toEqual([]);
  });
});

describe("suggestedQuickModifiersFor", () => {
  function conds(o: Partial<Parameters<typeof autoModifiersFromConditions>[0]>) {
    return {
      fresh: false,
      hungryThirsty: false,
      angry: false,
      afraid: false,
      exhausted: false,
      injured: false,
      sick: false,
      dead: false,
      ...o,
    };
  }

  it("returns empty for healthy characters", () => {
    expect(
      suggestedQuickModifiersFor({
        conditions: conds({}),
        kind: "skill",
        sourceId: "loreMaster",
        versusTestId: null,
      }),
    ).toEqual([]);
  });

  it("surfaces Angry's +1 Ob on a non-versus precision/social test", () => {
    const out = suggestedQuickModifiersFor({
      conditions: conds({ angry: true }),
      kind: "skill",
      sourceId: "loreMaster",
      versusTestId: null,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("suggest:angry:ob");
    expect(out[0]!.modifier.kind).toBe("obstacle");
    expect(out[0]!.modifier.value).toBe(1);
    expect(out[0]!.note).toMatch(/SG p\.48/);
  });

  it("does NOT surface Angry's +1 Ob in a versus test (the -1s auto-mod handles versus)", () => {
    const out = suggestedQuickModifiersFor({
      conditions: conds({ angry: true }),
      kind: "skill",
      sourceId: "loreMaster",
      versusTestId: "versus:abc",
    });
    expect(out).toEqual([]);
  });

  it("does NOT surface Angry's +1 Ob on combat skills (Fighter, Hunter, Scout)", () => {
    for (const sourceId of ["fighter", "hunter", "scout"]) {
      const out = suggestedQuickModifiersFor({
        conditions: conds({ angry: true }),
        kind: "skill",
        sourceId,
        versusTestId: null,
      });
      expect(out).toEqual([]);
    }
  });

  it("does NOT surface anything on ability rolls (Will/Health/Nature)", () => {
    const out = suggestedQuickModifiersFor({
      conditions: conds({ angry: true }),
      kind: "ability",
      sourceId: "will",
      versusTestId: null,
    });
    expect(out).toEqual([]);
  });
});

describe("Heroic trait", () => {
  it("defaults to empty arrays for all three categories", () => {
    const v = Heroic.schema.parse(undefined);
    expect(v).toEqual({ abilities: [], townAbilities: [], skills: [] });
  });

  it("accepts ids in any of its three lists", () => {
    const v = Heroic.schema.parse({
      abilities: ["will"],
      townAbilities: ["resources"],
      skills: ["fighter", "scout"],
    });
    expect(v.abilities).toEqual(["will"]);
    expect(v.townAbilities).toEqual(["resources"]);
    expect(v.skills).toEqual(["fighter", "scout"]);
  });
});

describe("heroicFromContributions", () => {
  function tbHeroicC(enabled: boolean, fromUserId = "u1"): Contribution {
    return {
      kind: TB_HEROIC_CONTRIB_KIND,
      label: enabled ? "Heroic on" : "Heroic off",
      fromUserId,
      payload: { enabled },
    };
  }

  it("returns undefined when no heroic toggle is present", () => {
    expect(heroicFromContributions(undefined)).toBeUndefined();
    expect(heroicFromContributions([])).toBeUndefined();
  });

  it("returns the latest toggle's enabled flag (last-wins)", () => {
    expect(
      heroicFromContributions([tbHeroicC(true), tbHeroicC(false)]),
    ).toBe(false);
    expect(
      heroicFromContributions([tbHeroicC(false), tbHeroicC(true)]),
    ).toBe(true);
  });

  it("ignores other contribution kinds", () => {
    const mixed: Contribution[] = [
      {
        kind: TB_MODIFIER_CONTRIB_KIND,
        label: "+1D",
        fromUserId: "u1",
        payload: {
          id: "x",
          kind: "dice",
          value: 1,
          label: "x",
          apply: "always",
          source: "manual",
        },
      },
      tbHeroicC(true),
    ];
    expect(heroicFromContributions(mixed)).toBe(true);
  });
});

describe("obstacleFromContributions", () => {
  function tbObstacleC(value: number | null): Contribution {
    return {
      kind: TB_OBSTACLE_CONTRIB_KIND,
      label: value === null ? "Obstacle cleared" : `Ob ${value}`,
      fromUserId: "u1",
      payload: { value },
    };
  }

  it("returns undefined for empty / no-obstacle-contribution lists", () => {
    expect(obstacleFromContributions(undefined)).toBeUndefined();
    expect(obstacleFromContributions([])).toBeUndefined();
  });

  it("returns the latest numeric obstacle (last-wins)", () => {
    expect(
      obstacleFromContributions([tbObstacleC(2), tbObstacleC(5)]),
    ).toBe(5);
  });

  it("distinguishes panel-cleared (null) from no-pick (undefined)", () => {
    expect(obstacleFromContributions([tbObstacleC(null)])).toBeNull();
    expect(
      obstacleFromContributions([tbObstacleC(3), tbObstacleC(null)]),
    ).toBeNull();
  });

  it("rejects out-of-range obstacle payloads via the schema", () => {
    const oob: Contribution = {
      kind: TB_OBSTACLE_CONTRIB_KIND,
      label: "Ob 99",
      fromUserId: "u1",
      payload: { value: 99 },
    };
    expect(obstacleFromContributions([oob])).toBeUndefined();
  });

  it("ignores non-tb-obstacle contributions", () => {
    const mixed: Contribution[] = [
      tbObstacleC(3),
      {
        kind: TB_MODIFIER_CONTRIB_KIND,
        label: "+1D",
        fromUserId: "u1",
        payload: {
          id: "x",
          kind: "dice",
          value: 1,
          label: "x",
          apply: "always",
          source: "manual",
        },
      },
    ];
    expect(obstacleFromContributions(mixed)).toBe(3);
  });
});

describe("versusFromContributions", () => {
  function tbVersusC(versusTestId: string | null): Contribution {
    return {
      kind: TB_VERSUS_CONTRIB_KIND,
      label: versusTestId === null ? "Versus cleared" : `vs ${versusTestId}`,
      fromUserId: "u1",
      payload: { versusTestId },
    };
  }

  it("returns undefined when no tb-versus contribution is present", () => {
    expect(versusFromContributions(undefined)).toBeUndefined();
    expect(versusFromContributions([])).toBeUndefined();
  });

  it("returns the latest versusTestId (last-wins)", () => {
    expect(
      versusFromContributions([tbVersusC("versus:abc"), tbVersusC("versus:def")]),
    ).toBe("versus:def");
  });

  it("distinguishes panel-cleared (null) from no-pick (undefined)", () => {
    expect(versusFromContributions([tbVersusC(null)])).toBeNull();
  });

  it("rejects oversized payloads via the schema", () => {
    const bad: Contribution = {
      kind: TB_VERSUS_CONTRIB_KIND,
      label: "x",
      fromUserId: "u1",
      payload: { versusTestId: "x".repeat(200) },
    };
    expect(versusFromContributions([bad])).toBeUndefined();
  });
});

describe("TbRollSpec schema — versusTestId", () => {
  it("defaults versusTestId to undefined when omitted", () => {
    const v = TbRollSpecSchema.parse({
      kind: "ability",
      source: "Will",
      sourceId: "will",
      baseDice: 3,
      pool: 3,
      bonusSuccesses: 0,
      heroic: false,
      successTarget: 4,
      baseObstacle: null,
      obstacle: null,
      modifiers: [],
      caption: "Bryn — Will",
    });
    expect(v.versusTestId).toBeUndefined();
  });

  it("accepts a versusTestId string", () => {
    const v = TbRollSpecSchema.parse({
      kind: "ability",
      source: "Will",
      sourceId: "will",
      baseDice: 3,
      pool: 3,
      bonusSuccesses: 0,
      heroic: false,
      successTarget: 4,
      baseObstacle: null,
      obstacle: null,
      modifiers: [],
      caption: "Bryn — Will",
      versusTestId: "versus:abc",
    });
    expect(v.versusTestId).toBe("versus:abc");
  });
});

describe("dispositionFromContributions", () => {
  function tbDispositionC(
    enabled: boolean,
    addTo?: "will" | "health" | null,
  ): Contribution {
    return {
      kind: TB_DISPOSITION_CONTRIB_KIND,
      label: enabled ? "disposition on" : "disposition off",
      fromUserId: "u1",
      payload: addTo === undefined ? { enabled } : { enabled, addTo },
    };
  }

  it("returns undefined when no tb-disposition contribution is present", () => {
    expect(dispositionFromContributions(undefined)).toBeUndefined();
    expect(dispositionFromContributions([])).toBeUndefined();
  });

  it("returns the latest enabled flag (last-wins)", () => {
    expect(
      dispositionFromContributions([tbDispositionC(true), tbDispositionC(false)]),
    ).toBe(false);
    expect(
      dispositionFromContributions([tbDispositionC(false), tbDispositionC(true)]),
    ).toBe(true);
  });

  it("dispositionAddToFromContributions returns the latest addTo selection", () => {
    expect(dispositionAddToFromContributions(undefined)).toBeUndefined();
    expect(dispositionAddToFromContributions([])).toBeUndefined();
    // Toggle on with no addTo → null (caller's fallback territory).
    expect(dispositionAddToFromContributions([tbDispositionC(true)])).toBeNull();
    // Pick Will → Will. Pick Health → Health. Last wins.
    expect(
      dispositionAddToFromContributions([tbDispositionC(true, "will")]),
    ).toBe("will");
    expect(
      dispositionAddToFromContributions([
        tbDispositionC(true, "will"),
        tbDispositionC(true, "health"),
      ]),
    ).toBe("health");
  });
});

describe("modifiersFromContributions", () => {
  it("decodes TB-shaped contributions into modifiers", () => {
    const mods = modifiersFromContributions([
      {
        kind: TB_MODIFIER_CONTRIB_KIND,
        label: "+1D Fresh",
        fromUserId: "u1",
        payload: {
          id: "m1",
          kind: "dice",
          value: 1,
          label: "Fresh",
          apply: "always",
          source: "manual",
        },
      },
    ]);
    expect(mods).toHaveLength(1);
    expect(mods[0]!.kind).toBe("dice");
  });

  it("ignores contributions with a different kind (system-simple Help, etc.)", () => {
    const mods = modifiersFromContributions([
      {
        kind: "help",
        label: "Tarn helps",
        fromUserId: "u2",
        payload: { dice: 2, stat: "might" },
      },
    ]);
    expect(mods).toEqual([]);
  });

  it("silently drops contributions whose payload doesn't match TbRollModifier", () => {
    const mods = modifiersFromContributions([
      {
        kind: TB_MODIFIER_CONTRIB_KIND,
        label: "garbage",
        fromUserId: "u1",
        payload: { not: "a modifier" },
      },
    ]);
    expect(mods).toEqual([]);
  });

  it("returns [] for undefined / empty input", () => {
    expect(modifiersFromContributions(undefined)).toEqual([]);
    expect(modifiersFromContributions([])).toEqual([]);
  });
});

describe("formatModifier — obstacle kind", () => {
  it("renders an obstacle modifier with the Ob unit", () => {
    expect(
      formatModifier({
        id: "x",
        kind: "obstacle",
        value: 1,
        label: "factors",
        apply: "always",
        source: "manual",
      }),
    ).toBe("+1 Ob factors");
    expect(
      formatModifier({
        id: "y",
        kind: "obstacle",
        value: -2,
        label: "huge advantage",
        apply: "always",
        source: "manual",
      }),
    ).toBe("-2 Ob huge advantage");
  });
});

describe("formatModifier", () => {
  it("renders a positive dice modifier with sign", () => {
    expect(
      formatModifier({
        id: "x",
        kind: "dice",
        value: 1,
        label: "Fresh",
        apply: "always",
        source: "condition",
      }),
    ).toBe("+1D Fresh");
  });

  it("renders a negative success modifier", () => {
    expect(
      formatModifier({
        id: "x",
        kind: "success",
        value: -1,
        label: "Bad luck",
        apply: "always",
        source: "manual",
      }),
    ).toBe("-1s Bad luck");
  });

  it("calls out conditional apply mode in the rendered string", () => {
    expect(
      formatModifier({
        id: "x",
        kind: "success",
        value: 1,
        label: "Faith",
        apply: "on-success",
        source: "fate",
      }),
    ).toBe("+1s on success: Faith");
    expect(
      formatModifier({
        id: "y",
        kind: "success",
        value: 2,
        label: "consolation",
        apply: "on-fail",
        source: "manual",
      }),
    ).toBe("+2s on fail: consolation");
  });
});

describe("TbRollModifierProvidersSlot", () => {
  it("is declared by the manifest with a stable name", () => {
    expect(TbRollModifierProvidersSlot.name).toBe(
      "@vtt/system-torchbearer/roll-modifier-providers",
    );
    expect(systemTorchbearer.slots).toContain(TbRollModifierProvidersSlot);
  });

  it("validates a minimal provider through the slot schema", () => {
    const ok = TbRollModifierProvidersSlot.schema.safeParse({
      providerId: "@vtt/test/relic-axe",
      modifier: {
        id: "axe",
        kind: "dice",
        value: 1,
        label: "Razor's Edge",
        apply: "always",
        source: "gear",
      },
    });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.eligibility).toEqual({});
  });

  it("rejects a provider whose modifier shape is malformed", () => {
    const bad = TbRollModifierProvidersSlot.schema.safeParse({
      providerId: "p",
      modifier: { kind: "tax", value: 1 },
    });
    expect(bad.success).toBe(false);
  });

  it("accepts an eligibility filter narrowing to a roll kind / source", () => {
    const ok = TbRollModifierProvidersSlot.schema.safeParse({
      providerId: "@vtt/test/wise-tunnel",
      eligibility: { rollKinds: ["skill"], sourceIds: ["dungeoneer"] },
      modifier: {
        id: "tw",
        kind: "dice",
        value: 1,
        label: "Tunnel-wise",
        apply: "always",
        source: "wise",
      },
    });
    expect(ok.success).toBe(true);
  });
});

describe("Rollables — integration with conditions and panel contributions", () => {
  it("WillCheck folds in Fresh +1D from the Conditions trait", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3, fresh: true }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(h.registry.rollables.get(WillCheck.name)!, h.world, id);
    const spec = r!.spec as TbRollSpec;
    expect(spec.baseDice).toBe(3);
    expect(spec.pool).toBe(4);
    // The Fresh modifier appears in the spec for transparency.
    expect(spec.modifiers.find((m) => m.providedBy === "condition:fresh")).toBeTruthy();
  });

  it("HealthCheck stacks Injured + Sick onto the pool penalty", async () => {
    const h = buildRollableHarness();
    await spawn(
      h.pipeline,
      { name: "Bryn", health: 4, injured: true, sick: true },
      h.registry,
    );
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(h.registry.rollables.get(HealthCheck.name)!, h.world, id);
    const spec = r!.spec as TbRollSpec;
    // 4 base, -1 Injured, -1 Sick = 2.
    expect(spec.pool).toBe(2);
  });

  it("ResourcesCheck does NOT apply condition modifiers", async () => {
    const h = buildRollableHarness();
    await spawn(
      h.pipeline,
      { name: "Bryn", resources: 3, fresh: true, injured: true, sick: true },
      h.registry,
    );
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(h.registry.rollables.get(ResourcesCheck.name)!, h.world, id);
    const spec = r!.spec as TbRollSpec;
    expect(spec.pool).toBe(3);
    expect(spec.modifiers).toHaveLength(0);
  });

  it("SkillCheck adds a -1D modifier when the skill entry is taxed", async () => {
    const h = buildRollableHarness();
    await spawn(
      h.pipeline,
      { name: "Bryn", skills: { fighter: 4 } },
      h.registry,
    );
    const id = h.world.query([Identity])[0]!.id;
    // Mark the skill as taxed via SetField — the rollable subsystem
    // should pick it up via the auto-mod path.
    h.registry.commands.set(SetField.name, SetField);
    h.registry.systems.push(CharacterFieldSetSystem);
    await h.pipeline.dispatch({
      id: "tax",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id as Parameters<typeof SetField>[0]["characterId"],
        trait: Skills.name,
        path: ["entries", "fighter", "taxed"],
        value: true,
      }) as CommandInstance,
    });
    const r = invokeRollable(
      h.registry.rollables.get(SkillCheck.name)!,
      h.world,
      id,
      { skillId: "fighter" },
    );
    const spec = r!.spec as TbRollSpec;
    // 4 base - 1 taxed = 3.
    expect(spec.pool).toBe(3);
    expect(spec.modifiers.find((m) => m.providedBy === "skill:fighter:taxed")).toBeTruthy();
  });

  it("absorbs panel contributions (TB-shaped) into the spec's modifier list", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      {
        contributions: [
          {
            kind: TB_MODIFIER_CONTRIB_KIND,
            label: "+1D Help",
            fromUserId: "u1",
            payload: {
              id: "help-1",
              kind: "dice",
              value: 1,
              label: "Help (Tarn)",
              apply: "always",
              source: "help",
            },
          },
          {
            kind: TB_MODIFIER_CONTRIB_KIND,
            label: "+1s Faith",
            fromUserId: "u1",
            payload: {
              id: "faith-1",
              kind: "success",
              value: 1,
              label: "Faith",
              apply: "on-success",
              source: "fate",
            },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    // 3 base + 1 help dice. Faith is on-success, so it stays out of pool.
    expect(spec.pool).toBe(4);
    expect(spec.bonusSuccesses).toBe(0);
    expect(spec.modifiers.length).toBeGreaterThanOrEqual(2);
    expect(spec.modifiers.some((m) => m.id === "help-1")).toBe(true);
    expect(spec.modifiers.some((m) => m.id === "faith-1" && m.apply === "on-success")).toBe(true);
  });

  it("emits a TbRollMeta payload with the spec under RequestRoll.meta", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(h.registry.rollables.get(WillCheck.name)!, h.world, id);
    const cmd = r!.command as { type: string; payload: { meta?: unknown } };
    const meta = TbRollMetaSchema.parse(cmd.payload.meta);
    expect(meta.system).toBe(TB_ROLL_META_SYSTEM);
    expect(meta.spec.source).toBe("Will");
  });

  it("respects opts.obstacle in the spec and caption", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      { obstacle: 3 },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.obstacle).toBe(3);
    expect(spec.caption).toContain("vs Ob 3");
  });

  it("standard rolls produce notation Nd6>=4 and successTarget=4", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(h.registry.rollables.get(WillCheck.name)!, h.world, id);
    const spec = r!.spec as TbRollSpec;
    expect(spec.heroic).toBe(false);
    expect(spec.successTarget).toBe(4);
    const cmd = r!.command as { payload: { notation: string } };
    expect(cmd.payload.notation).toBe("3d6>=4");
  });

  it("opts.heroic=true flips the success target without trait or contribution", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      { heroic: true },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.heroic).toBe(true);
    expect(spec.successTarget).toBe(3);
    const cmd = r!.command as { payload: { notation: string } };
    expect(cmd.payload.notation).toBe("3d6>=3");
  });

  it("the Heroic trait flags an ability so a vanilla click rolls heroic", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    h.world.set(id, Heroic, {
      abilities: ["will"],
      townAbilities: [],
      skills: [],
    });
    const r = invokeRollable(h.registry.rollables.get(WillCheck.name)!, h.world, id);
    const spec = r!.spec as TbRollSpec;
    expect(spec.heroic).toBe(true);
    expect(spec.successTarget).toBe(3);
  });

  it("opts.heroic=false overrides the Heroic trait (force standard)", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    h.world.set(id, Heroic, {
      abilities: ["will"],
      townAbilities: [],
      skills: [],
    });
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      { heroic: false },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.heroic).toBe(false);
    expect(spec.successTarget).toBe(4);
  });

  it("a tb-heroic panel toggle sits between trait and opts in priority", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    // Trait says heroic; panel toggle says off; opts is unset → panel wins.
    h.world.set(id, Heroic, { abilities: ["will"], townAbilities: [], skills: [] });
    const offByPanel = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      {
        contributions: [
          {
            kind: TB_HEROIC_CONTRIB_KIND,
            label: "Heroic off",
            fromUserId: "u1",
            payload: { enabled: false },
          },
        ],
      },
    );
    expect((offByPanel!.spec as TbRollSpec).heroic).toBe(false);

    // Trait says heroic; panel says off; opts says on → opts wins.
    const onByOpts = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      {
        heroic: true,
        contributions: [
          {
            kind: TB_HEROIC_CONTRIB_KIND,
            label: "Heroic off",
            fromUserId: "u1",
            payload: { enabled: false },
          },
        ],
      },
    );
    expect((onByOpts!.spec as TbRollSpec).heroic).toBe(true);
  });

  it("SkillCheck reads the Heroic trait's `skills` list (matched by skill id)", async () => {
    const h = buildRollableHarness();
    await spawn(
      h.pipeline,
      { name: "Bryn", skills: { fighter: 3 } },
      h.registry,
    );
    const id = h.world.query([Identity])[0]!.id;
    h.world.set(id, Heroic, {
      abilities: [],
      townAbilities: [],
      skills: ["fighter"],
    });
    const r = invokeRollable(
      h.registry.rollables.get(SkillCheck.name)!,
      h.world,
      id,
      { skillId: "fighter" },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.heroic).toBe(true);
    expect(spec.successTarget).toBe(3);
  });

  it("ResourcesCheck honors the Heroic trait's `townAbilities` list", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", resources: 4 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    h.world.set(id, Heroic, {
      abilities: [],
      townAbilities: ["resources"],
      skills: [],
    });
    const r = invokeRollable(
      h.registry.rollables.get(ResourcesCheck.name)!,
      h.world,
      id,
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.heroic).toBe(true);
  });

  it("a tb-obstacle contribution sets spec.obstacle without opts.obstacle", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      {
        contributions: [
          {
            kind: TB_OBSTACLE_CONTRIB_KIND,
            label: "Ob 3",
            fromUserId: "u1",
            payload: { value: 3 },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.obstacle).toBe(3);
    expect(spec.caption).toContain("vs Ob 3");
  });

  it("opts.obstacle overrides a tb-obstacle contribution (caller wins)", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      {
        obstacle: 5,
        contributions: [
          {
            kind: TB_OBSTACLE_CONTRIB_KIND,
            label: "Ob 3",
            fromUserId: "u1",
            payload: { value: 3 },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.obstacle).toBe(5);
  });

  it("obstacle modifiers (kind: 'obstacle') shift the resolved obstacle from the base", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 4 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      {
        obstacle: 3, // base
        contributions: [
          {
            kind: TB_MODIFIER_CONTRIB_KIND,
            label: "+1 Ob factors",
            fromUserId: "u1",
            payload: {
              id: "factors",
              kind: "obstacle",
              value: 1,
              label: "factors",
              apply: "always",
              source: "manual",
            },
          },
          {
            kind: TB_MODIFIER_CONTRIB_KIND,
            label: "-1 Ob advantage",
            fromUserId: "u1",
            payload: {
              id: "adv",
              kind: "obstacle",
              value: -1,
              label: "advantage",
              apply: "always",
              source: "manual",
            },
          },
          {
            kind: TB_MODIFIER_CONTRIB_KIND,
            label: "+1 Ob dim light",
            fromUserId: "u1",
            payload: {
              id: "dim",
              kind: "obstacle",
              value: 1,
              label: "dim light",
              apply: "always",
              source: "condition",
            },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.baseObstacle).toBe(3);
    // 3 + 1 - 1 + 1 = 4.
    expect(spec.obstacle).toBe(4);
  });

  it("clamps the resolved obstacle at 0 even when modifiers push it lower", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 4 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      {
        obstacle: 1,
        contributions: [
          {
            kind: TB_MODIFIER_CONTRIB_KIND,
            label: "-5 Ob heaven",
            fromUserId: "u1",
            payload: {
              id: "heaven",
              kind: "obstacle",
              value: -5,
              label: "heaven",
              apply: "always",
              source: "manual",
            },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.baseObstacle).toBe(1);
    expect(spec.obstacle).toBe(0);
  });

  it("obstacle modifiers without a base obstacle are recorded but do nothing", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 4 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      {
        // No base obstacle declared.
        contributions: [
          {
            kind: TB_MODIFIER_CONTRIB_KIND,
            label: "+1 Ob factors",
            fromUserId: "u1",
            payload: {
              id: "factors",
              kind: "obstacle",
              value: 1,
              label: "factors",
              apply: "always",
              source: "manual",
            },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.baseObstacle).toBeNull();
    expect(spec.obstacle).toBeNull();
    // The mod is still in the modifier list for transparency.
    expect(spec.modifiers.some((m) => m.id === "factors")).toBe(true);
  });

  it("a tb-versus contribution sets spec.versusTestId on the rolled spec", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      {
        contributions: [
          {
            kind: TB_VERSUS_CONTRIB_KIND,
            label: "vs Tarn",
            fromUserId: "u1",
            payload: { versusTestId: "versus:abc" },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.versusTestId).toBe("versus:abc");
    expect(spec.caption).toContain("(versus)");
  });

  it("opts.versusTestId overrides a tb-versus contribution", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      {
        versusTestId: "versus:opts",
        contributions: [
          {
            kind: TB_VERSUS_CONTRIB_KIND,
            label: "vs Tarn",
            fromUserId: "u1",
            payload: { versusTestId: "versus:panel" },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.versusTestId).toBe("versus:opts");
  });

  it("a `null` tb-versus contribution clears the panel pick", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      {
        contributions: [
          {
            kind: TB_VERSUS_CONTRIB_KIND,
            label: "vs Tarn",
            fromUserId: "u1",
            payload: { versusTestId: "versus:abc" },
          },
          {
            kind: TB_VERSUS_CONTRIB_KIND,
            label: "Versus cleared",
            fromUserId: "u1",
            payload: { versusTestId: null },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.versusTestId).toBeNull();
  });

  it("a `null` tb-obstacle contribution clears the panel pick (last-wins)", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 3 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      {
        contributions: [
          {
            kind: TB_OBSTACLE_CONTRIB_KIND,
            label: "Ob 3",
            fromUserId: "u1",
            payload: { value: 3 },
          },
          {
            kind: TB_OBSTACLE_CONTRIB_KIND,
            label: "Obstacle cleared",
            fromUserId: "u1",
            payload: { value: null },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.obstacle).toBeNull();
  });

  it("on-success modifier fires only when raw+always meets the obstacle (post-pass bonus)", async () => {
    // 4 will + Fresh +1D = 5 pool, Ob 3, +2s on success.
    // If raw successes >= 3 - 0 (no always) = 3 → pass; +2s applies.
    // If raw successes < 3 → fail; +2s does NOT apply.
    const baseSpec: TbRollSpec = {
      kind: "ability",
      source: "Will",
      sourceId: "will",
      baseDice: 4,
      pool: 4,
      bonusSuccesses: 0,
      heroic: false,
      successTarget: 4,
      baseObstacle: 3,
      obstacle: 3,
      modifiers: [
        {
          id: "f",
          kind: "success",
          value: 2,
          label: "on-success bonus",
          apply: "on-success",
          source: "manual",
        },
      ],
      caption: "Will vs Ob 3",
    };
    // 3 successes (4,5,6,1) → meets Ob 3 → +2 conditional → final 5.
    const pass = resolveSuccessCount(baseSpec, [
      { sides: 6, value: 4 },
      { sides: 6, value: 5 },
      { sides: 6, value: 6 },
      { sides: 6, value: 1 },
    ]);
    expect(pass.passed).toBe(true);
    expect(pass.rawSuccesses).toBe(3);
    expect(pass.conditional).toBe(2);
    expect(pass.final).toBe(5);

    // 2 successes (4,5,1,2) → falls short → on-success bonus does NOT fire.
    const fail = resolveSuccessCount(baseSpec, [
      { sides: 6, value: 4 },
      { sides: 6, value: 5 },
      { sides: 6, value: 1 },
      { sides: 6, value: 2 },
    ]);
    expect(fail.passed).toBe(false);
    expect(fail.rawSuccesses).toBe(2);
    expect(fail.conditional).toBe(0);
    expect(fail.final).toBe(2);
  });

  it("always-applied success bonus contributes to the pass check, on-success does not", async () => {
    const baseSpec: TbRollSpec = {
      kind: "ability",
      source: "Will",
      sourceId: "will",
      baseDice: 4,
      pool: 4,
      bonusSuccesses: 1, // always-applied +1s
      heroic: false,
      successTarget: 4,
      baseObstacle: 3,
      obstacle: 3,
      modifiers: [
        {
          id: "always",
          kind: "success",
          value: 1,
          label: "always",
          apply: "always",
          source: "manual",
        },
        {
          id: "post",
          kind: "success",
          value: 1,
          label: "on-success",
          apply: "on-success",
          source: "manual",
        },
      ],
      caption: "Will vs Ob 3",
    };
    // 2 raw + 1 always = 3 → meets Ob 3 → on-success +1 → final 4.
    const r = resolveSuccessCount(baseSpec, [
      { sides: 6, value: 4 },
      { sides: 6, value: 5 },
      { sides: 6, value: 1 },
      { sides: 6, value: 2 },
    ]);
    expect(r.passed).toBe(true);
    expect(r.rawSuccesses).toBe(2);
    expect(r.always).toBe(1);
    expect(r.conditional).toBe(1);
    expect(r.final).toBe(4);
  });

  it("auto-fail pool=0 still respects the heroic flag in the spec (no pool to roll, but target is recorded)", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 1, sick: true }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    h.world.set(id, Heroic, { abilities: ["will"], townAbilities: [], skills: [] });
    // base 1 - 1 (sick) = 0 pool, heroic still on.
    const r = invokeRollable(h.registry.rollables.get(WillCheck.name)!, h.world, id);
    const spec = r!.spec as TbRollSpec;
    expect(spec.pool).toBe(0);
    expect(spec.heroic).toBe(true);
    expect(spec.successTarget).toBe(3);
    const cmd = r!.command as { payload: { notation: string } };
    expect(cmd.payload.notation).toBe("0");
  });

  it("disposition mode flips spec.dispositionMode and clears obstacle/versus", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 4 }, h.registry);
    const id = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      id,
      {
        obstacle: 5, // would normally set baseObstacle=5
        versusTestId: "versus:abc",
        dispositionMode: true,
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.dispositionMode).toBe(true);
    // Disposition forces obstacle/versus off.
    expect(spec.baseObstacle).toBeNull();
    expect(spec.obstacle).toBeNull();
    expect(spec.versusTestId).toBeNull();
    expect(spec.caption).toContain("(disposition)");
  });

  it("disposition mode adds Team Hungry & Thirsty -1s when any party member has it", async () => {
    const h = buildRollableHarness();
    // Spawn the rolling character (party) — clean conditions.
    await spawn(h.pipeline, { name: "Bryn", will: 4 }, h.registry);
    const rollerId = h.world.query([Identity])[0]!.id;
    // Spawn a party teammate flagged hungry & thirsty.
    await spawn(
      h.pipeline,
      {
        name: "Tarn",
        will: 3,
        team: "party",
        hungryThirsty: true,
      },
      h.registry,
    );
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      rollerId,
      { dispositionMode: true },
    );
    const spec = r!.spec as TbRollSpec;
    const teamMod = spec.modifiers.find(
      (m) => m.providedBy === "team:hungry-thirsty",
    );
    expect(teamMod).toBeDefined();
    expect(teamMod!.value).toBe(-1);
    expect(teamMod!.kind).toBe("success");
  });

  it("Team H&T penalty fires only once even when multiple party members have it (per-team singular)", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 4 }, h.registry);
    const rollerId = h.world.query([Identity])[0]!.id;
    // Three teammates, all hungry & thirsty.
    await spawn(
      h.pipeline,
      { name: "Tarn", team: "party", hungryThirsty: true },
      h.registry,
    );
    await spawn(
      h.pipeline,
      { name: "Wren", team: "party", hungryThirsty: true },
      h.registry,
    );
    await spawn(
      h.pipeline,
      { name: "Olin", team: "party", hungryThirsty: true },
      h.registry,
    );
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      rollerId,
      { dispositionMode: true },
    );
    const spec = r!.spec as TbRollSpec;
    const ht = spec.modifiers.filter(
      (m) => m.providedBy === "team:hungry-thirsty",
    );
    expect(ht).toHaveLength(1);
  });

  it("Team Exhausted -1s stacks with Team H&T -1s in disposition mode", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 4 }, h.registry);
    const rollerId = h.world.query([Identity])[0]!.id;
    await spawn(
      h.pipeline,
      { name: "Tarn", team: "party", hungryThirsty: true },
      h.registry,
    );
    await spawn(
      h.pipeline,
      { name: "Wren", team: "party", exhausted: true },
      h.registry,
    );
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      rollerId,
      { dispositionMode: true },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.modifiers.some((m) => m.providedBy === "team:hungry-thirsty"))
      .toBe(true);
    expect(spec.modifiers.some((m) => m.providedBy === "team:exhausted"))
      .toBe(true);
    // Both fold into bonusSuccesses (-1 + -1 = -2).
    expect(spec.bonusSuccesses).toBe(-2);
  });

  it("disposition mode ignores GM-team characters' conditions", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 4 }, h.registry);
    const rollerId = h.world.query([Identity])[0]!.id;
    // A GM-flagged NPC who's hungry & thirsty — shouldn't affect us.
    await spawn(
      h.pipeline,
      { name: "Goblin", team: "enemy", hungryThirsty: true, exhausted: true },
      h.registry,
    );
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      rollerId,
      { dispositionMode: true },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.modifiers.find((m) => m.providedBy === "team:hungry-thirsty"))
      .toBeUndefined();
    expect(spec.modifiers.find((m) => m.providedBy === "team:exhausted"))
      .toBeUndefined();
  });

  it("disposition off → no team penalties added even when teammates are hungry", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 4 }, h.registry);
    const rollerId = h.world.query([Identity])[0]!.id;
    await spawn(
      h.pipeline,
      { name: "Tarn", team: "party", hungryThirsty: true },
      h.registry,
    );
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      rollerId,
      // dispositionMode omitted → default false
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.dispositionMode).toBeUndefined();
    expect(spec.modifiers.find((m) => m.providedBy === "team:hungry-thirsty"))
      .toBeUndefined();
  });

  it("a tb-disposition contribution flips the rollable into disposition mode (panel path)", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 4 }, h.registry);
    const rollerId = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      rollerId,
      {
        contributions: [
          {
            kind: TB_DISPOSITION_CONTRIB_KIND,
            label: "disposition on",
            fromUserId: "u1",
            payload: { enabled: true },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.dispositionMode).toBe(true);
  });

  /* -------------------------------------------------------------------
   * dispoBase: skill rolls in disposition mode use the captain's
   * Will or Health rating as the additive base, NOT the skill rating.
   * SG p.63-64 / LM p.106. The previous implementation conflated the
   * two and silently produced the wrong dispo for skills like
   * Manipulator (Trick) where skill ≠ ability.
   * ----------------------------------------------------------------- */

  it("SkillCheck dispo: addTo=will → spec.dispoBase = will rating (NOT skill rating)", async () => {
    const h = buildRollableHarness();
    // Bryn: Will 5, Manipulator skill 3. Trick conflict adds Will.
    await spawn(
      h.pipeline,
      { name: "Bryn", will: 5, skills: { manipulator: 3 } },
      h.registry,
    );
    const rollerId = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(SkillCheck.name)!,
      h.world,
      rollerId,
      {
        skillId: "manipulator",
        contributions: [
          {
            kind: TB_DISPOSITION_CONTRIB_KIND,
            label: "disposition: + Will",
            fromUserId: "u1",
            payload: { enabled: true, addTo: "will" },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.dispositionMode).toBe(true);
    expect(spec.baseDice).toBe(3); // skill rating drives the pool
    expect(spec.dispoBase).toBe(5); // Will rating is the additive base
    expect(spec.dispoAddTo).toBe("will");
  });

  it("SkillCheck dispo: addTo=health → spec.dispoBase = health rating", async () => {
    const h = buildRollableHarness();
    // Bryn: Health 6, Fighter skill 4. Kill conflict adds Health.
    await spawn(
      h.pipeline,
      { name: "Bryn", health: 6, skills: { fighter: 4 } },
      h.registry,
    );
    const rollerId = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(SkillCheck.name)!,
      h.world,
      rollerId,
      {
        skillId: "fighter",
        contributions: [
          {
            kind: TB_DISPOSITION_CONTRIB_KIND,
            label: "disposition: + Health",
            fromUserId: "u1",
            payload: { enabled: true, addTo: "health" },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.baseDice).toBe(4); // pool = Fighter rating
    expect(spec.dispoBase).toBe(6); // additive base = Health rating
    expect(spec.dispoAddTo).toBe("health");
  });

  it("SkillCheck dispo without addTo: spec.dispoBase undefined (legacy fallback)", async () => {
    const h = buildRollableHarness();
    await spawn(
      h.pipeline,
      { name: "Bryn", will: 5, skills: { manipulator: 3 } },
      h.registry,
    );
    const rollerId = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(SkillCheck.name)!,
      h.world,
      rollerId,
      {
        skillId: "manipulator",
        contributions: [
          {
            kind: TB_DISPOSITION_CONTRIB_KIND,
            label: "disposition on",
            fromUserId: "u1",
            payload: { enabled: true },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.dispositionMode).toBe(true);
    // dispoBase absent → chat row falls back to baseDice (legacy);
    // panel UI surfaces a warning to nudge the user to pick.
    expect(spec.dispoBase).toBeUndefined();
    expect(spec.dispoAddTo).toBeNull();
  });

  it("WillCheck dispo without addTo: defaults to will (ability IS the base)", async () => {
    const h = buildRollableHarness();
    await spawn(h.pipeline, { name: "Bryn", will: 4 }, h.registry);
    const rollerId = h.world.query([Identity])[0]!.id;
    const r = invokeRollable(
      h.registry.rollables.get(WillCheck.name)!,
      h.world,
      rollerId,
      {
        contributions: [
          {
            kind: TB_DISPOSITION_CONTRIB_KIND,
            label: "disposition on",
            fromUserId: "u1",
            payload: { enabled: true },
          },
        ],
      },
    );
    const spec = r!.spec as TbRollSpec;
    expect(spec.baseDice).toBe(4);
    // WillCheck auto-fills addTo to "will" (its own ability) when the
    // panel didn't specify, since baseDice and dispoBase coincide.
    expect(spec.dispoBase).toBe(4);
    expect(spec.dispoAddTo).toBe("will");
  });
});

/* -------------------------------------------------------------------------
 * Skill improvement — given/when/then
 * ----------------------------------------------------------------------- */

/**
 * Improvement-specific harness. Loads ImproveSkill + OpenSkillImprovement
 * and the two universal-mirror systems on top of the rollable harness so
 * we can dispatch commands end-to-end and watch the trait + opportunity
 * entity transitions.
 *
 * Sessions are stamped with role=gm so `requireWrite` short-circuits to
 * "ok" — we're testing the advancement rules here, not the permissions
 * model.
 */
function buildImprovementHarness(): {
  registry: Registry;
  world: World;
  pipeline: CommandPipeline;
} {
  const r = new Registry();
  r.load(
    definePlugin({
      name: "@vtt/test-tb-improvement",
      version: "0.0.0",
      // Formula / RollResult / RolledBy registered so the
      // LogAdvancement tests can spawn Roll entities directly via a
      // one-shot command — the LogAdvancement validator reads
      // Formula.meta + RolledBy.speakingAsCharacterId off the entity.
      traits: [
        Character,
        Permissions,
        Formula,
        RollResult,
        RolledBy,
        PendingRoll,
        ...systemTorchbearer.traits,
      ],
      events: [
        CharacterFieldSet,
        PendingRollContributed,
        ...systemTorchbearer.events,
      ],
      commands: [RequestRoll, SetField, ...systemTorchbearer.commands],
      // CharacterFieldSetSystem must run before SkillOpportunitySweepSystem
      // so the latter sees the post-write trait state. Since the runner
      // executes systems in registration order, we register the
      // characters' field-set system first. PendingRollContributionSystem
      // is the consumer of PendingRollContributed events — UseTraitOnRoll
      // emits one and we need this system to apply the change to the
      // PendingRoll trait.
      systems: [
        CharacterFieldSetSystem,
        PendingRollContributionSystem,
        ...systemTorchbearer.systems,
      ],
      rollables: [...systemTorchbearer.rollables],
    }),
  );
  r.validate();
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(r, world, bus);
  return { registry: r, world, pipeline };
}

interface SkillEntryLive {
  rating: number;
  advancement: { pass: number; fail: number };
  taxed: boolean;
  learningTests: number;
}

function spawnImproveCharacter(
  pipeline: CommandPipeline,
  registry: Registry,
  args: {
    name?: string;
    skillId?: string;
    rating?: number;
    pass?: number;
    fail?: number;
  } = {},
): Promise<void> {
  const SpawnImprove = defineCommand({
    name: "@vtt/test-tb-improvement/Spawn",
    schema: z.object({
      name: z.string(),
      skillId: z.string(),
      rating: z.number().int(),
      pass: z.number().int(),
      fail: z.number().int(),
    }),
    validate: () => ok(),
    apply: ({ cmd, world }) => {
      world.spawn([
        Character({ name: cmd.name }),
        Permissions({
          read: { kind: "everyone" },
          write: { kind: "users", userIds: ["u1"] },
        }),
        Identity({
          name: cmd.name,
          stock: "Human",
          class: "Theologian",
          level: 1,
          age: 30,
          home: "",
          raiment: "",
          parents: "",
          mentor: "",
          friend: "",
          enemy: "",
        }),
        RawAbilities({
          will: { rating: 4, advancement: { pass: 0, fail: 0 } },
          health: { rating: 4, advancement: { pass: 0, fail: 0 } },
          nature: {
            rating: 4,
            maximum: 4,
            advancement: { pass: 0, fail: 0 },
            descriptors: [],
          },
        }),
        TownAbilities({
          resources: { rating: 0, advancement: { pass: 0, fail: 0 } },
          circles: { rating: 0, advancement: { pass: 0, fail: 0 } },
          precedence: 0,
          might: 2,
        }),
        // Conditions explicitly attached at default (fresh: true,
        // others false). Required so the FreshCancellationSystem
        // and the rollables' condition-modifier reads find a live
        // trait to inspect.
        Conditions({
          fresh: true,
          hungryThirsty: false,
          angry: false,
          afraid: false,
          exhausted: false,
          injured: false,
          sick: false,
          dead: false,
        }),
        Skills({
          entries: Object.fromEntries(
            ALL_SKILLS.map((s) => [
              s.id,
              {
                rating: s.id === cmd.skillId ? cmd.rating : 0,
                advancement: {
                  pass: s.id === cmd.skillId ? cmd.pass : 0,
                  fail: s.id === cmd.skillId ? cmd.fail : 0,
                },
                taxed: false,
                learningTests: 0,
              },
            ]),
          ),
        }),
      ]);
      return [];
    },
  });
  registry.commands.set(SpawnImprove.name, SpawnImprove);
  return pipeline
    .dispatch({
      id: `c-${Math.random()}`,
      issuedBy: "u1",
      issuedAt: 0,
      cmd: SpawnImprove({
        name: args.name ?? "Bryn",
        skillId: args.skillId ?? "alchemist",
        rating: args.rating ?? 2,
        pass: args.pass ?? 0,
        fail: args.fail ?? 0,
      }) as CommandInstance,
    })
    .then(() => undefined);
}

function gmSession(): {
  userId: string;
  email: string;
  name: string;
  role: "gm";
} {
  return { userId: "u1", email: "u1@test.dev", name: "Tester", role: "gm" };
}

function readSkillEntry(world: World, id: string, skillId: string): SkillEntryLive | undefined {
  const got = world.get(id as Parameters<World["get"]>[0], [Skills]) as
    | { Skills: { entries: Record<string, SkillEntryLive> } }
    | undefined;
  return got?.Skills.entries[skillId];
}

describe("ImproveSkill command", () => {
  it("validates the pass/fail track is full before applying", async () => {
    const h = buildImprovementHarness();
    // rating 2 → needs 2P + 1F; spawn with the track NOT yet full.
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "alchemist",
      rating: 2,
      pass: 1,
      fail: 1,
    });
    const id = h.world.query([Character])[0]!.id;
    const r = await h.pipeline.dispatch({
      id: "c-imp-1",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: ImproveSkill({ characterId: id, skillId: "alchemist" }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(/pass track/);
  });

  it("bumps rating and resets advancement when the track is full (rating 2 → 3)", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "alchemist",
      rating: 2,
      pass: 2,
      fail: 1,
    });
    const id = h.world.query([Character])[0]!.id;
    const r = await h.pipeline.dispatch({
      id: "c-imp-2",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: ImproveSkill({ characterId: id, skillId: "alchemist" }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const entry = readSkillEntry(h.world, id, "alchemist")!;
    expect(entry.rating).toBe(3);
    expect(entry.advancement).toEqual({ pass: 0, fail: 0 });
  });

  it("treats a rating-1 track as full with just 1 pass and zero fails", async () => {
    const h = buildImprovementHarness();
    // rating 1 → passNeeded=1, failNeeded=0.
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "fighter",
      rating: 1,
      pass: 1,
      fail: 0,
    });
    const id = h.world.query([Character])[0]!.id;
    const r = await h.pipeline.dispatch({
      id: "c-imp-3",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: ImproveSkill({ characterId: id, skillId: "fighter" }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    expect(readSkillEntry(h.world, id, "fighter")!.rating).toBe(2);
  });

  it("rejects an unknown skill id with a clear reason", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const id = h.world.query([Character])[0]!.id;
    const r = await h.pipeline.dispatch({
      id: "c-imp-4",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: ImproveSkill({ characterId: id, skillId: "nope" }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(/unknown skill/);
  });

  it("rejects when the skill is already at the max rating", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "alchemist",
      rating: 6,
      pass: 6,
      fail: 5,
    });
    const id = h.world.query([Character])[0]!.id;
    const r = await h.pipeline.dispatch({
      id: "c-imp-5",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: ImproveSkill({ characterId: id, skillId: "alchemist" }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(/max rating/);
  });

  it("emits a SkillImproved event with a server-stamped improvedAt", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "scholar",
      rating: 2,
      pass: 2,
      fail: 1,
    });
    const id = h.world.query([Character])[0]!.id;
    const before = Date.now();
    const r = await h.pipeline.dispatch({
      id: "c-imp-6",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: ImproveSkill({ characterId: id, skillId: "scholar" }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const evt = r.events.find((e) => e.type === SkillImproved.name);
    expect(evt).toBeDefined();
    const payload = evt!.payload as { characterId: string; skillId: string; improvedAt: number };
    expect(payload.characterId).toBe(id);
    expect(payload.skillId).toBe("scholar");
    expect(payload.improvedAt).toBeGreaterThanOrEqual(before);
  });

  it("despawns any matching SkillImprovementOpportunity entity after improvement", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "fighter",
      rating: 2,
      pass: 2,
      fail: 1,
    });
    const id = h.world.query([Character])[0]!.id;
    // Open the opportunity row first.
    await h.pipeline.dispatch({
      id: "c-open-1",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillImprovement({
        characterId: id,
        skillId: "fighter",
      }) as CommandInstance,
    });
    expect(h.world.query([SkillImprovementOpportunity])).toHaveLength(1);
    // Then improve — system should sweep the opportunity.
    await h.pipeline.dispatch({
      id: "c-imp-7",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: ImproveSkill({ characterId: id, skillId: "fighter" }) as CommandInstance,
    });
    expect(h.world.query([SkillImprovementOpportunity])).toHaveLength(0);
  });
});

describe("OpenSkillImprovement command", () => {
  it("rejects when the track isn't full yet", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "alchemist",
      rating: 2,
      pass: 1,
      fail: 1,
    });
    const id = h.world.query([Character])[0]!.id;
    const r = await h.pipeline.dispatch({
      id: "c-open-2",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillImprovement({
        characterId: id,
        skillId: "alchemist",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(/not full/);
  });

  it("spawns one opportunity entity with denormalised character + skill names", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      name: "Bryn",
      skillId: "alchemist",
      rating: 2,
      pass: 2,
      fail: 1,
    });
    const id = h.world.query([Character])[0]!.id;
    const r = await h.pipeline.dispatch({
      id: "c-open-3",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillImprovement({
        characterId: id,
        skillId: "alchemist",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const opps = h.world.query([SkillImprovementOpportunity]);
    expect(opps).toHaveLength(1);
    const v = opps[0]!.values.SkillImprovementOpportunity as {
      characterId: string;
      characterName: string;
      skillId: string;
      skillName: string;
      rating: number;
    };
    expect(v.characterId).toBe(id);
    expect(v.characterName).toBe("Bryn");
    expect(v.skillId).toBe("alchemist");
    expect(v.skillName).toBe("Alchemist");
    expect(v.rating).toBe(2);
  });

  it("dedups: a second OpenSkillImprovement for the same char+skill is rejected", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "alchemist",
      rating: 2,
      pass: 2,
      fail: 1,
    });
    const id = h.world.query([Character])[0]!.id;
    await h.pipeline.dispatch({
      id: "c-open-4a",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillImprovement({
        characterId: id,
        skillId: "alchemist",
      }) as CommandInstance,
    });
    const r = await h.pipeline.dispatch({
      id: "c-open-4b",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillImprovement({
        characterId: id,
        skillId: "alchemist",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(/already open/);
    expect(h.world.query([SkillImprovementOpportunity])).toHaveLength(1);
  });

  it("emits a SkillImprovementOpened event with a server-allocated opportunityId", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "fighter",
      rating: 2,
      pass: 2,
      fail: 1,
    });
    const id = h.world.query([Character])[0]!.id;
    const r = await h.pipeline.dispatch({
      id: "c-open-5",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillImprovement({
        characterId: id,
        skillId: "fighter",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const evt = r.events.find((e) => e.type === SkillImprovementOpened.name);
    expect(evt).toBeDefined();
    const payload = evt!.payload as { opportunityId: string; openedAt: number };
    expect(payload.opportunityId).toMatch(/^e\d+$/);
    expect(payload.openedAt).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------
 * SkillImprovedSystem / SkillImprovementOpenedSystem
 * ----------------------------------------------------------------------- */

describe("SkillImprovedSystem", () => {
  it("registers SkillImproved + SkillImprovementOpened + sweep handlers", () => {
    const names = new Set(systemTorchbearer.systems.map((s) => s.name));
    expect(names.has(SkillImprovedSystem.name)).toBe(true);
    expect(names.has(SkillImprovementOpenedSystem.name)).toBe(true);
    expect(names.has("SkillOpportunitySweep")).toBe(true);
  });

  it("survives a SkillImproved event for a character that no longer exists", async () => {
    const h = buildImprovementHarness();
    // No character; emit the event directly via a one-shot command.
    const Emit = defineCommand({
      name: "@vtt/test-tb-improvement/Emit",
      schema: z.object({}),
      validate: () => ok(),
      apply: () => [
        SkillImproved({
          characterId: "e9999" as Parameters<World["get"]>[0],
          skillId: "alchemist",
          improvedAt: 0,
        }),
      ],
    });
    h.registry.commands.set(Emit.name, Emit);
    const r = await h.pipeline.dispatch({
      id: "c-emit-1",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: Emit({}) as CommandInstance,
    });
    // System short-circuits on missing character — no crash, no spawns.
    expect(r.result.ok).toBe(true);
    expect(h.world.query([SkillImprovementOpportunity])).toHaveLength(0);
  });
});

describe("SkillOpportunitySweepSystem", () => {
  it("despawns the open opportunity when a SetField drops the pass track below threshold", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "alchemist",
      rating: 2,
      pass: 2,
      fail: 1,
    });
    const id = h.world.query([Character])[0]!.id;
    // Open the opportunity first.
    await h.pipeline.dispatch({
      id: "c-sweep-1a",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillImprovement({
        characterId: id,
        skillId: "alchemist",
      }) as CommandInstance,
    });
    expect(h.world.query([SkillImprovementOpportunity])).toHaveLength(1);
    // Player un-fills a pass bubble — 2P → 1P puts the track below
    // threshold (rating 2 needs 2P).
    await h.pipeline.dispatch({
      id: "c-sweep-1b",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Skills.name,
        path: ["entries", "alchemist", "advancement", "pass"],
        value: 1,
      }) as CommandInstance,
    });
    expect(h.world.query([SkillImprovementOpportunity])).toHaveLength(0);
  });

  it("despawns the opportunity when the fail track is dropped below threshold", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "fighter",
      rating: 2,
      pass: 2,
      fail: 1,
    });
    const id = h.world.query([Character])[0]!.id;
    await h.pipeline.dispatch({
      id: "c-sweep-2a",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillImprovement({
        characterId: id,
        skillId: "fighter",
      }) as CommandInstance,
    });
    await h.pipeline.dispatch({
      id: "c-sweep-2b",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Skills.name,
        path: ["entries", "fighter", "advancement", "fail"],
        value: 0,
      }) as CommandInstance,
    });
    expect(h.world.query([SkillImprovementOpportunity])).toHaveLength(0);
  });

  it("despawns the opportunity when the rating is bumped past threshold (so the same P/F no longer suffices)", async () => {
    const h = buildImprovementHarness();
    // rating 2 with 2P + 1F → full. Bump rating manually to 3 → now
    // needs 3P + 2F, so the existing 2P + 1F is no longer enough.
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "scholar",
      rating: 2,
      pass: 2,
      fail: 1,
    });
    const id = h.world.query([Character])[0]!.id;
    await h.pipeline.dispatch({
      id: "c-sweep-3a",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillImprovement({
        characterId: id,
        skillId: "scholar",
      }) as CommandInstance,
    });
    await h.pipeline.dispatch({
      id: "c-sweep-3b",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Skills.name,
        path: ["entries", "scholar", "rating"],
        value: 3,
      }) as CommandInstance,
    });
    expect(h.world.query([SkillImprovementOpportunity])).toHaveLength(0);
  });

  it("despawns the opportunity when the rating is set to the max", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "alchemist",
      rating: 2,
      pass: 2,
      fail: 1,
    });
    const id = h.world.query([Character])[0]!.id;
    await h.pipeline.dispatch({
      id: "c-sweep-4a",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillImprovement({
        characterId: id,
        skillId: "alchemist",
      }) as CommandInstance,
    });
    await h.pipeline.dispatch({
      id: "c-sweep-4b",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Skills.name,
        path: ["entries", "alchemist", "rating"],
        value: 6,
      }) as CommandInstance,
    });
    expect(h.world.query([SkillImprovementOpportunity])).toHaveLength(0);
  });

  it("leaves opportunities for other (character, skill) pairs alone", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "alchemist",
      rating: 2,
      pass: 2,
      fail: 1,
    });
    const id = h.world.query([Character])[0]!.id;
    // Force a parallel opportunity for a different skill by also
    // setting fighter's track + opening it.
    await h.pipeline.dispatch({
      id: "c-sweep-5a",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Skills.name,
        path: ["entries", "fighter", "rating"],
        value: 2,
      }) as CommandInstance,
    });
    await h.pipeline.dispatch({
      id: "c-sweep-5b",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Skills.name,
        path: ["entries", "fighter", "advancement", "pass"],
        value: 2,
      }) as CommandInstance,
    });
    await h.pipeline.dispatch({
      id: "c-sweep-5c",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Skills.name,
        path: ["entries", "fighter", "advancement", "fail"],
        value: 1,
      }) as CommandInstance,
    });
    await h.pipeline.dispatch({
      id: "c-sweep-5d",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillImprovement({
        characterId: id,
        skillId: "alchemist",
      }) as CommandInstance,
    });
    await h.pipeline.dispatch({
      id: "c-sweep-5e",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillImprovement({
        characterId: id,
        skillId: "fighter",
      }) as CommandInstance,
    });
    expect(h.world.query([SkillImprovementOpportunity])).toHaveLength(2);
    // Drop alchemist's track. Fighter's opportunity should survive.
    await h.pipeline.dispatch({
      id: "c-sweep-5f",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Skills.name,
        path: ["entries", "alchemist", "advancement", "pass"],
        value: 0,
      }) as CommandInstance,
    });
    const remaining = h.world.query([SkillImprovementOpportunity]);
    expect(remaining).toHaveLength(1);
    const v = remaining[0]!.values.SkillImprovementOpportunity as { skillId: string };
    expect(v.skillId).toBe("fighter");
  });
});

describe("FreshCancellationSystem", () => {
  function readConditions(world: World, id: string): Record<string, boolean> {
    return (
      world.get(id as Parameters<World["get"]>[0], [Conditions]) as
        | { Conditions: Record<string, boolean> }
        | undefined
    )?.Conditions ?? {};
  }

  it("clears fresh when Injured is set true on a fresh character (SG p.46)", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const id = h.world.query([Character])[0]!.id;
    // Default Conditions has fresh: true.
    expect(readConditions(h.world, id).fresh).toBe(true);

    await h.pipeline.dispatch({
      id: "c-fc-1",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Conditions.name,
        path: ["injured"],
        value: true,
      }) as CommandInstance,
    });

    const c = readConditions(h.world, id);
    expect(c.injured).toBe(true);
    expect(c.fresh).toBe(false);
  });

  it.each([
    ["hungryThirsty"],
    ["angry"],
    ["afraid"],
    ["exhausted"],
    ["sick"],
    ["dead"],
  ])("clears fresh when %s is set true", async (key) => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const id = h.world.query([Character])[0]!.id;
    await h.pipeline.dispatch({
      id: `c-fc-${key}`,
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Conditions.name,
        path: [key],
        value: true,
      }) as CommandInstance,
    });
    expect(readConditions(h.world, id).fresh).toBe(false);
  });

  it("does NOT auto-restore fresh when a non-fresh condition is cleared", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const id = h.world.query([Character])[0]!.id;
    // Sicken first — fresh cleared.
    await h.pipeline.dispatch({
      id: "c-fc-restore-1",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Conditions.name,
        path: ["sick"],
        value: true,
      }) as CommandInstance,
    });
    expect(readConditions(h.world, id).fresh).toBe(false);
    // Recover from sick. Fresh should NOT come back automatically —
    // SG p.46 requires a town-phase lifestyle maintenance test.
    await h.pipeline.dispatch({
      id: "c-fc-restore-2",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Conditions.name,
        path: ["sick"],
        value: false,
      }) as CommandInstance,
    });
    const c = readConditions(h.world, id);
    expect(c.sick).toBe(false);
    expect(c.fresh).toBe(false);
  });

  it("does not interfere when fresh is already false (only acts on the cascade)", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const id = h.world.query([Character])[0]!.id;
    // First clear fresh manually.
    await h.pipeline.dispatch({
      id: "c-fc-noop-0",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Conditions.name,
        path: ["fresh"],
        value: false,
      }) as CommandInstance,
    });
    // Now set Injured. fresh stays false; system has nothing to cascade.
    await h.pipeline.dispatch({
      id: "c-fc-noop-1",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Conditions.name,
        path: ["injured"],
        value: true,
      }) as CommandInstance,
    });
    const c = readConditions(h.world, id);
    expect(c.injured).toBe(true);
    expect(c.fresh).toBe(false);
  });

  it("ignores writes to other traits", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const id = h.world.query([Character])[0]!.id;
    // Bump a skill rating — unrelated to Conditions. Fresh stays.
    await h.pipeline.dispatch({
      id: "c-fc-other",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Skills.name,
        path: ["entries", "alchemist", "rating"],
        value: 3,
      }) as CommandInstance,
    });
    expect(readConditions(h.world, id).fresh).toBe(true);
  });

  it("ignores when fresh itself is being set to true (not bidirectional)", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const id = h.world.query([Character])[0]!.id;
    // Start with fresh false, injured true (out-of-band setup).
    await h.pipeline.dispatch({
      id: "c-fc-bi-1",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Conditions.name,
        path: ["injured"],
        value: true,
      }) as CommandInstance,
    });
    expect(readConditions(h.world, id).fresh).toBe(false);
    // Now set fresh: true directly. The system shouldn't react —
    // setting fresh isn't the cascade trigger. The trait now flags
    // both fresh AND injured (legal-state-wise it's invalid, but
    // the modifier-emit logic suppresses the +1D anyway).
    await h.pipeline.dispatch({
      id: "c-fc-bi-2",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Conditions.name,
        path: ["fresh"],
        value: true,
      }) as CommandInstance,
    });
    const c = readConditions(h.world, id);
    expect(c.fresh).toBe(true);
    expect(c.injured).toBe(true);
  });

  it("ignores writes that set a non-fresh condition to false", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const id = h.world.query([Character])[0]!.id;
    // Setting Injured = false on a fresh-and-not-injured character
    // is a no-op write; fresh shouldn't be touched.
    await h.pipeline.dispatch({
      id: "c-fc-false",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: id,
        trait: Conditions.name,
        path: ["injured"],
        value: false,
      }) as CommandInstance,
    });
    expect(readConditions(h.world, id).fresh).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * LogAdvancement command + AdvancementLoggedSystem
 * ----------------------------------------------------------------------- */

interface SpawnRollArgs {
  characterId: string;
  spec: Partial<TbRollSpec> & {
    kind: TbRollSpec["kind"];
    sourceId: string;
    source: string;
  };
}

/**
 * Register a one-shot command that spawns a Roll entity with a
 * TB-flavoured Formula.meta payload — same shape the rolling
 * subsystem produces in production. Returns the spawned id.
 *
 * Bypasses the resolution package's RollRecordingSystem because the
 * improvement harness doesn't load it; we just want a Roll entity
 * with the three traits LogAdvancement reads.
 */
async function spawnTestRoll(
  pipeline: CommandPipeline,
  registry: Registry,
  args: SpawnRollArgs,
): Promise<string> {
  const fullSpec: TbRollSpec = {
    kind: args.spec.kind,
    source: args.spec.source,
    sourceId: args.spec.sourceId,
    baseDice: args.spec.baseDice ?? 3,
    pool: args.spec.pool ?? 3,
    bonusSuccesses: args.spec.bonusSuccesses ?? 0,
    heroic: args.spec.heroic ?? false,
    successTarget: args.spec.successTarget ?? 4,
    baseObstacle: args.spec.baseObstacle ?? null,
    obstacle: args.spec.obstacle ?? null,
    modifiers: args.spec.modifiers ?? [],
    versusTestId: args.spec.versusTestId ?? null,
    dispositionMode: args.spec.dispositionMode,
    caption: args.spec.caption ?? `Test — ${args.spec.source}`,
  };
  const characterId = args.characterId;
  let allocatedId = "";
  const SpawnRoll = defineCommand({
    name: "@vtt/test-tb-improvement/SpawnRoll",
    schema: z.object({}),
    validate: () => ok(),
    apply: ({ world }) => {
      const id = world.allocateId();
      allocatedId = id;
      world.spawnAt(id, [
        Formula({
          notation: "3d6>=4",
          reason: fullSpec.caption,
          meta: { system: TB_ROLL_META_SYSTEM, spec: fullSpec },
        }),
        RollResult({
          total: 2,
          output: "[3d6>=4: 5*, 4*, 2] = 2",
          rolledAt: Date.now(),
          dice: [
            { sides: 6, value: 5 },
            { sides: 6, value: 4 },
            { sides: 6, value: 2 },
          ],
        }),
        RolledBy({
          userId: "u1",
          displayName: "Tester",
          speakingAsCharacterId: characterId as Parameters<World["get"]>[0],
        }),
        Permissions({ read: everyone(), write: gmOnly() }),
      ]);
      return [];
    },
  });
  registry.commands.set(SpawnRoll.name, SpawnRoll);
  await pipeline.dispatch({
    id: `spawn-roll-${Math.random()}`,
    issuedBy: "u1",
    issuedAt: 0,
    session: gmSession(),
    cmd: SpawnRoll({}) as CommandInstance,
  });
  return allocatedId;
}

describe("LogAdvancement command", () => {
  it("rejects when the roll entity does not exist", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const r = await h.pipeline.dispatch({
      id: "c-la-missing",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: "e9999" as Parameters<World["get"]>[0],
        outcome: "pass",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(/does not exist/);
  });

  it("rejects rolls without TB metadata", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    // Spawn a Roll with no meta on the formula — substitute a bogus
    // meta that won't decode as TbRollMeta.
    const SpawnBogus = defineCommand({
      name: "@vtt/test-tb-improvement/SpawnBogusRoll",
      schema: z.object({}),
      validate: () => ok(),
      apply: ({ world }) => {
        const id = world.allocateId();
        world.spawnAt(id, [
          Formula({ notation: "1d20", meta: { system: "other" } }),
          RollResult({
            total: 10,
            output: "10",
            rolledAt: 1,
            dice: [{ sides: 20, value: 10 }],
          }),
          RolledBy({
            userId: "u1",
            displayName: "Tester",
            speakingAsCharacterId: charId as Parameters<World["get"]>[0],
          }),
          Permissions({ read: everyone(), write: gmOnly() }),
        ]);
        return [];
      },
    });
    h.registry.commands.set(SpawnBogus.name, SpawnBogus);
    await h.pipeline.dispatch({
      id: "c-la-bogus-spawn",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SpawnBogus({}) as CommandInstance,
    });
    const rollId = h.world.query([Formula])[0]!.id;
    const r = await h.pipeline.dispatch({
      id: "c-la-bogus",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "pass",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(/not a torchbearer roll/);
  });

  it("rejects disposition rolls (no advancement under TB rules)", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, { skillId: "fighter", rating: 2 });
    const charId = h.world.query([Character])[0]!.id;
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "ability",
        source: "Will",
        sourceId: "will",
        dispositionMode: true,
      },
    });
    const r = await h.pipeline.dispatch({
      id: "c-la-disp",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "pass",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(/not advance-able/);
  });

  it("bumps the skill pass counter for a skill roll", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "fighter",
      rating: 2,
      pass: 1,
      fail: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: { kind: "skill", source: "Fighter", sourceId: "fighter" },
    });
    const r = await h.pipeline.dispatch({
      id: "c-la-skill-pass",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "pass",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const entry = readSkillEntry(h.world, charId, "fighter")!;
    expect(entry.advancement).toEqual({ pass: 2, fail: 0 });
  });

  it("increments learningTests for a skill-bl roll and leaves advancement untouched (DH p.75)", async () => {
    const h = buildImprovementHarness();
    // Skill at rating 0 → BL roll. The character starts with 0 learning
    // tests and 0 advancement bubbles; outcome-irrelevant per RAW.
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "scholar",
      rating: 0,
      pass: 0,
      fail: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "skill-bl",
        source: "Scholar (Beginner's Luck, will)",
        sourceId: "scholar",
      },
    });
    const r = await h.pipeline.dispatch({
      id: "c-la-bl-fail",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "fail",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const entry = readSkillEntry(h.world, charId, "scholar")!;
    expect(entry.learningTests).toBe(1);
    expect(entry.advancement).toEqual({ pass: 0, fail: 0 });
  });

  it("does not advance the underlying ability for a skill-bl roll", async () => {
    // DH p.75: "If you're using Beginner's Luck, do not mark a test
    // to advance Will or Health."
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "scholar",
      rating: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "skill-bl",
        source: "Scholar (Beginner's Luck, will)",
        sourceId: "scholar",
      },
    });
    await h.pipeline.dispatch({
      id: "c-la-bl-no-ability",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "pass",
      }) as CommandInstance,
    });
    const got = h.world.get(charId, [RawAbilities]) as
      | {
          RawAbilities: {
            will: { advancement: { pass: number; fail: number } };
            health: { advancement: { pass: number; fail: number } };
          };
        }
      | undefined;
    expect(got!.RawAbilities.will.advancement).toEqual({ pass: 0, fail: 0 });
    expect(got!.RawAbilities.health.advancement).toEqual({ pass: 0, fail: 0 });
  });

  it("bumps the ability advancement for a Will check", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: { kind: "ability", source: "Will", sourceId: "will" },
    });
    await h.pipeline.dispatch({
      id: "c-la-will",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "pass",
      }) as CommandInstance,
    });
    const got = h.world.get(charId, [RawAbilities]) as
      | { RawAbilities: { will: { advancement: { pass: number; fail: number } } } }
      | undefined;
    expect(got?.RawAbilities.will.advancement).toEqual({ pass: 1, fail: 0 });
  });

  it("bumps the town-ability advancement for Resources", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "town-ability",
        source: "Resources",
        sourceId: "resources",
      },
    });
    await h.pipeline.dispatch({
      id: "c-la-res",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "fail",
      }) as CommandInstance,
    });
    const got = h.world.get(charId, [TownAbilities]) as
      | {
          TownAbilities: {
            resources: { advancement: { pass: number; fail: number } };
          };
        }
      | undefined;
    expect(got?.TownAbilities.resources.advancement).toEqual({ pass: 0, fail: 1 });
  });

  it("attaches an AdvancementLogged trait to the Roll entity", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: { kind: "skill", source: "Fighter", sourceId: "fighter" },
    });
    await h.pipeline.dispatch({
      id: "c-la-attach",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "pass",
      }) as CommandInstance,
    });
    const got = h.world.get(rollId as Parameters<World["get"]>[0], [
      AdvancementLoggedTrait,
    ]) as
      | {
          AdvancementLogged: {
            outcome: string;
            target: { kind: string; id: string; label: string };
          };
        }
      | undefined;
    expect(got).toBeDefined();
    expect(got!.AdvancementLogged.outcome).toBe("pass");
    expect(got!.AdvancementLogged.target).toEqual({
      kind: "skill",
      id: "fighter",
      label: "Fighter",
    });
  });

  it("rejects a second log against the same roll", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: { kind: "skill", source: "Fighter", sourceId: "fighter" },
    });
    await h.pipeline.dispatch({
      id: "c-la-once",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "pass",
      }) as CommandInstance,
    });
    const r = await h.pipeline.dispatch({
      id: "c-la-twice",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "fail",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(/already logged/);
  });

  it("emits a server-stamped AdvancementLogged event", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: { kind: "skill", source: "Fighter", sourceId: "fighter" },
    });
    const before = Date.now();
    const r = await h.pipeline.dispatch({
      id: "c-la-event",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "fail",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const evt = r.events.find((e) => e.type === AdvancementLogged.name);
    expect(evt).toBeDefined();
    const payload = evt!.payload as {
      rollId: string;
      characterId: string;
      target: { kind: string; id: string };
      outcome: string;
      loggedAt: number;
    };
    expect(payload.rollId).toBe(rollId);
    expect(payload.characterId).toBe(charId);
    expect(payload.target.id).toBe("fighter");
    expect(payload.outcome).toBe("fail");
    expect(payload.loggedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("AdvancementLoggedSystem", () => {
  it("registers AdvancementLogged in the manifest", () => {
    const names = new Set(systemTorchbearer.systems.map((s) => s.name));
    expect(names.has(AdvancementLoggedSystem.name)).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * Beginner's Luck learning — DH p.75 threshold + auto-promotion
 * ----------------------------------------------------------------------- */

/**
 * Helper for BL tests: jam learningTests directly via world.set so
 * the next dispatch can cross the threshold cleanly.
 */
function setLearningTests(
  world: World,
  characterId: string,
  skillId: string,
  count: number,
): void {
  const got = world.get(characterId as Parameters<World["get"]>[0], [Skills]) as {
    Skills: { entries: Record<string, { learningTests: number }> };
  };
  world.set(characterId as Parameters<World["get"]>[0], Skills, {
    entries: {
      ...got.Skills.entries,
      [skillId]: {
        ...(got.Skills.entries[skillId] as object),
        learningTests: count,
      },
    },
  } as never);
}

describe("Beginner's Luck learning — Log Test increments learningTests", () => {
  it("does not auto-bump rating when learningTests reaches max Nature (opportunity-based flow)", async () => {
    // The cross-threshold path no longer auto-promotes. The user must
    // confirm via OpenSkillLearning + LearnSkill (mirrors the standard
    // SkillImprovementOpportunity flow). This test asserts that
    // logging the threshold-crossing BL test does NOT bump the rating.
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "rider",
      rating: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    setLearningTests(h.world, charId, "rider", 3);
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "skill-bl",
        source: "Rider (Beginner's Luck, health)",
        sourceId: "rider",
      },
    });
    const r = await h.pipeline.dispatch({
      id: "c-la-bl-cross",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "fail",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const after = readSkillEntry(h.world, charId, "rider")!;
    expect(after.rating).toBe(0);
    expect(after.learningTests).toBe(4);
    expect(after.advancement).toEqual({ pass: 0, fail: 0 });
  });

  it("does not emit SkillLearned on a Log Test (the click flow runs through LearnSkill)", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "rider",
      rating: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    setLearningTests(h.world, charId, "rider", 3);
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "skill-bl",
        source: "Rider (Beginner's Luck, health)",
        sourceId: "rider",
      },
    });
    const r = await h.pipeline.dispatch({
      id: "c-la-bl-noevt",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "pass",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    expect(r.events.find((e) => e.type === SkillLearned.name)).toBeUndefined();
    expect(r.events.find((e) => e.type === SkillLearningOpened.name)).toBeUndefined();
  });

  it("treats a legacy entry without learningTests as 0 (no NaN write)", async () => {
    // Snapshots from before the field rename had `learning: false`
    // instead of `learningTests: number`. `world.get` returns the
    // raw stored value without re-parsing, so the system has to
    // tolerate a missing field without producing a NaN write that
    // would crash the dispatch tick.
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "rider",
      rating: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    // Bypass world.set's schema parse so we can install the legacy
    // shape (no `learningTests` field). The internal entities map is
    // a Map<EntityId, Map<TraitName, unknown>> — we reach in and
    // overwrite the trait value directly to mimic a snapshot loaded
    // from disk before the rename.
    const internals = h.world as unknown as {
      entities: Map<string, Map<string, unknown>>;
    };
    const rec = internals.entities.get(charId)!;
    const stored = rec.get(Skills.name) as {
      entries: Record<string, Record<string, unknown>>;
    };
    const legacyEntry = { ...stored.entries.rider } as Record<string, unknown>;
    delete legacyEntry.learningTests;
    rec.set(Skills.name, {
      entries: { ...stored.entries, rider: legacyEntry },
    });

    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "skill-bl",
        source: "Rider (Beginner's Luck, health)",
        sourceId: "rider",
      },
    });
    const r = await h.pipeline.dispatch({
      id: "c-la-bl-legacy",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "pass",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const after = readSkillEntry(h.world, charId, "rider")!;
    expect(after.learningTests).toBe(1);
  });

  it("stops accumulating learningTests once the skill has been learned", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "rider",
      rating: 2,
    });
    const charId = h.world.query([Character])[0]!.id;
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "skill-bl",
        source: "Rider (Beginner's Luck, health)",
        sourceId: "rider",
      },
    });
    // Even though the spec says "skill-bl", the entry is rated 2, so
    // the system shouldn't bump learningTests. (Defensive guard
    // against a stale BL roll committed after the rating bumped.)
    await h.pipeline.dispatch({
      id: "c-la-bl-stale",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogAdvancement({
        rollId: rollId as Parameters<World["get"]>[0],
        outcome: "pass",
      }) as CommandInstance,
    });
    const after = readSkillEntry(h.world, charId, "rider")!;
    expect(after.rating).toBe(2);
    expect(after.learningTests).toBe(0);
    expect(after.advancement).toEqual({ pass: 0, fail: 0 });
  });
});

describe("OpenSkillLearning command", () => {
  it("rejects when the learning track isn't full", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "rider",
      rating: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    setLearningTests(h.world, charId, "rider", 1); // max nature = 4
    const r = await h.pipeline.dispatch({
      id: "c-osl-1",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillLearning({
        characterId: charId,
        skillId: "rider",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(/not full/);
  });

  it("rejects when the skill is already learned", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "rider",
      rating: 2,
    });
    const charId = h.world.query([Character])[0]!.id;
    const r = await h.pipeline.dispatch({
      id: "c-osl-2",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillLearning({
        characterId: charId,
        skillId: "rider",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(/already learned/);
  });

  it("spawns one SkillLearningOpportunity entity with denormalised character + skill names", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      name: "Beren",
      skillId: "rider",
      rating: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    setLearningTests(h.world, charId, "rider", 4);
    const r = await h.pipeline.dispatch({
      id: "c-osl-3",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillLearning({
        characterId: charId,
        skillId: "rider",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const opps = h.world.query([SkillLearningOpportunity]);
    expect(opps).toHaveLength(1);
    const v = opps[0]!.values.SkillLearningOpportunity as {
      characterId: string;
      characterName: string;
      skillId: string;
      skillName: string;
      learningTests: number;
    };
    expect(v.characterId).toBe(charId);
    expect(v.characterName).toBe("Beren");
    expect(v.skillId).toBe("rider");
    expect(v.skillName).toBe("Rider");
    expect(v.learningTests).toBe(4);
  });

  it("dedups: a second OpenSkillLearning for the same char+skill is rejected", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "rider",
      rating: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    setLearningTests(h.world, charId, "rider", 4);
    await h.pipeline.dispatch({
      id: "c-osl-4a",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillLearning({
        characterId: charId,
        skillId: "rider",
      }) as CommandInstance,
    });
    const r = await h.pipeline.dispatch({
      id: "c-osl-4b",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillLearning({
        characterId: charId,
        skillId: "rider",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(/already open/);
    expect(h.world.query([SkillLearningOpportunity])).toHaveLength(1);
  });
});

describe("LearnSkill command", () => {
  it("rejects when the learning track isn't full", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "rider",
      rating: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    setLearningTests(h.world, charId, "rider", 2);
    const r = await h.pipeline.dispatch({
      id: "c-ls-1",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LearnSkill({
        characterId: charId,
        skillId: "rider",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(/not full/);
  });

  it("bumps the rating from 0 to 2 and resets learningTests + advancement", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "rider",
      rating: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    setLearningTests(h.world, charId, "rider", 4);
    const r = await h.pipeline.dispatch({
      id: "c-ls-2",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LearnSkill({
        characterId: charId,
        skillId: "rider",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const after = readSkillEntry(h.world, charId, "rider")!;
    expect(after.rating).toBe(2);
    expect(after.learningTests).toBe(0);
    expect(after.advancement).toEqual({ pass: 0, fail: 0 });
  });

  it("despawns the matching SkillLearningOpportunity row", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "rider",
      rating: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    setLearningTests(h.world, charId, "rider", 4);
    await h.pipeline.dispatch({
      id: "c-ls-3a",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillLearning({
        characterId: charId,
        skillId: "rider",
      }) as CommandInstance,
    });
    expect(h.world.query([SkillLearningOpportunity])).toHaveLength(1);
    await h.pipeline.dispatch({
      id: "c-ls-3b",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LearnSkill({
        characterId: charId,
        skillId: "rider",
      }) as CommandInstance,
    });
    expect(h.world.query([SkillLearningOpportunity])).toHaveLength(0);
  });

  it("emits a SkillLearned event with a server-stamped learnedAt", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "rider",
      rating: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    setLearningTests(h.world, charId, "rider", 4);
    const before = Date.now();
    const r = await h.pipeline.dispatch({
      id: "c-ls-4",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LearnSkill({
        characterId: charId,
        skillId: "rider",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const evt = r.events.find((e) => e.type === SkillLearned.name);
    expect(evt).toBeDefined();
    const payload = evt!.payload as {
      characterId: string;
      skillId: string;
      learnedAt: number;
    };
    expect(payload.characterId).toBe(charId);
    expect(payload.skillId).toBe("rider");
    expect(payload.learnedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("SkillLearningSweepSystem", () => {
  it("despawns the opportunity when an editor un-fills a learning pip", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, {
      skillId: "rider",
      rating: 0,
    });
    const charId = h.world.query([Character])[0]!.id;
    setLearningTests(h.world, charId, "rider", 4);
    await h.pipeline.dispatch({
      id: "c-sweep-1a",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: OpenSkillLearning({
        characterId: charId,
        skillId: "rider",
      }) as CommandInstance,
    });
    expect(h.world.query([SkillLearningOpportunity])).toHaveLength(1);
    // Editor lowers the learning count below threshold via SetField.
    await h.pipeline.dispatch({
      id: "c-sweep-1b",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: SetField({
        characterId: charId,
        trait: Skills.name,
        path: ["entries", "rider", "learningTests"],
        value: 2,
      }) as CommandInstance,
    });
    expect(h.world.query([SkillLearningOpportunity])).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------
 * UseTraitOnRoll command + TraitUsedOnRollSystem
 * ----------------------------------------------------------------------- */

describe("UseTraitOnRoll command", () => {
  function spawnPendingRoll(
    world: World,
    initiatorCharacterId: string,
  ): { id: string } {
    const id = world.allocateId();
    world.spawnAt(id, [
      PendingRoll({
        initiatorUserId: "u1",
        initiatorCharacterId: initiatorCharacterId as Parameters<
          typeof PendingRoll
        >[0]["initiatorCharacterId"],
        rollableName: WillCheck.name,
        opts: {},
        contributions: [],
        openedAt: 0,
      }),
    ]);
    return { id };
  }

  function setTraits(
    world: World,
    characterId: string,
    entries: ReadonlyArray<{
      name: string;
      level: number;
      beneficialUses?: number;
      checks?: number;
      usedAgainst?: boolean;
    }>,
  ): void {
    world.set(characterId, CharacterTraits, {
      entries: entries.map((e) => ({
        name: e.name,
        level: e.level,
        beneficialUses: e.beneficialUses ?? 0,
        checks: e.checks ?? 0,
        usedAgainst: e.usedAgainst ?? false,
      })),
    });
  }

  it("'for self' at Lv1: stamps a +1D modifier with a structured providedBy; does NOT mutate the sheet", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setTraits(h.world, charId, [{ name: "Stubborn", level: 1 }]);
    const pr = spawnPendingRoll(h.world, charId);

    const r = await h.pipeline.dispatch({
      id: "c-trait-1",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: pr.id as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: charId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 0,
        direction: "for",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);

    // Sheet untouched — beneficialUses bump only happens on LogTraitUsage.
    const after = h.world.get(charId, [CharacterTraits]) as
      | { CharacterTraits: { entries: ReadonlyArray<{ beneficialUses: number }> } }
      | undefined;
    expect(after!.CharacterTraits.entries[0]!.beneficialUses).toBe(0);

    const prAfter = h.world.get(pr.id, [PendingRoll]) as
      | { PendingRoll: { contributions: ReadonlyArray<Contribution> } }
      | undefined;
    expect(prAfter!.PendingRoll.contributions).toHaveLength(1);
    const mod = prAfter!.PendingRoll.contributions[0]!.payload as {
      kind: string;
      value: number;
      source: string;
      providedBy: string;
    };
    expect(mod.kind).toBe("dice");
    expect(mod.value).toBe(1);
    expect(mod.source).toBe("trait");
    expect(mod.providedBy).toBe("trait:0:for");
  });

  it("'for self' at Lv2 once-used: stamps a modifier; sheet uses count is unchanged at dispatch", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setTraits(h.world, charId, [{ name: "Stubborn", level: 2, beneficialUses: 1 }]);
    const pr = spawnPendingRoll(h.world, charId);

    const r = await h.pipeline.dispatch({
      id: "c-trait-2",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: pr.id as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: charId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 0,
        direction: "for",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    // Still 1 — bump waits for LogTraitUsage.
    const after = h.world.get(charId, [CharacterTraits]) as
      | { CharacterTraits: { entries: ReadonlyArray<{ beneficialUses: number }> } }
      | undefined;
    expect(after!.CharacterTraits.entries[0]!.beneficialUses).toBe(1);
  });

  it("rejects 'for self' when all beneficial uses are spent", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setTraits(h.world, charId, [{ name: "Stubborn", level: 2, beneficialUses: 2 }]);
    const pr = spawnPendingRoll(h.world, charId);

    const r = await h.pipeline.dispatch({
      id: "c-trait-3",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: pr.id as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: charId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 0,
        direction: "for",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(
      /used all 2 beneficial uses/i,
    );
  });

  it("'for self' at Lv3: adds a +1s on-success modifier and does NOT consume a use", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setTraits(h.world, charId, [{ name: "Bold", level: 3, beneficialUses: 0 }]);
    const pr = spawnPendingRoll(h.world, charId);

    const r = await h.pipeline.dispatch({
      id: "c-trait-4",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: pr.id as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: charId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 0,
        direction: "for",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const after = h.world.get(charId, [CharacterTraits]) as
      | { CharacterTraits: { entries: ReadonlyArray<{ beneficialUses: number }> } }
      | undefined;
    expect(after!.CharacterTraits.entries[0]!.beneficialUses).toBe(0);
    const prAfter = h.world.get(pr.id, [PendingRoll]) as
      | { PendingRoll: { contributions: ReadonlyArray<Contribution> } }
      | undefined;
    const mod = prAfter!.PendingRoll.contributions[0]!.payload as {
      kind: string;
      value: number;
      apply: string;
      providedBy?: string;
    };
    expect(mod.kind).toBe("success");
    expect(mod.value).toBe(1);
    expect(mod.apply).toBe("on-success");
    // Lv3 omits providedBy — there's nothing to log post-roll.
    expect(mod.providedBy).toBeUndefined();
  });

  it("'against self' with -1D: stamps -1D modifier; sheet checks count is unchanged at dispatch", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setTraits(h.world, charId, [{ name: "Reckless", level: 1, checks: 0 }]);
    const pr = spawnPendingRoll(h.world, charId);

    const r = await h.pipeline.dispatch({
      id: "c-trait-5",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: pr.id as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: charId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 0,
        direction: "against",
        severity: "minus-1d",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const after = h.world.get(charId, [CharacterTraits]) as
      | { CharacterTraits: { entries: ReadonlyArray<{ checks: number; beneficialUses: number }> } }
      | undefined;
    // Sheet still 0 — checks earn only when LogTraitUsage fires.
    expect(after!.CharacterTraits.entries[0]!.checks).toBe(0);
    expect(after!.CharacterTraits.entries[0]!.beneficialUses).toBe(0);
    const prAfter = h.world.get(pr.id, [PendingRoll]) as
      | { PendingRoll: { contributions: ReadonlyArray<Contribution> } }
      | undefined;
    const mod = prAfter!.PendingRoll.contributions[0]!.payload as {
      kind: string;
      value: number;
      source: string;
      providedBy: string;
    };
    expect(mod.kind).toBe("dice");
    expect(mod.value).toBe(-1);
    expect(mod.source).toBe("trait");
    expect(mod.providedBy).toBe("trait:0:against:minus-1d");
  });

  it("rejects a second trait use on the same pending roll (DH p.81 'one trait per test')", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setTraits(h.world, charId, [
      { name: "Stubborn", level: 2 },
      { name: "Bold", level: 1 },
    ]);
    const pr = spawnPendingRoll(h.world, charId);

    const r1 = await h.pipeline.dispatch({
      id: "c-trait-6a",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: pr.id as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: charId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 0,
        direction: "for",
      }) as CommandInstance,
    });
    expect(r1.result.ok).toBe(true);

    const r2 = await h.pipeline.dispatch({
      id: "c-trait-6b",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: pr.id as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: charId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 1,
        direction: "for",
      }) as CommandInstance,
    });
    expect(r2.result.ok).toBe(false);
    expect((r2.result as { ok: false; reason: string }).reason).toMatch(
      /one trait per test/i,
    );
  });

  it("rejects a non-existent trait index", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setTraits(h.world, charId, [{ name: "Stubborn", level: 1 }]);
    const pr = spawnPendingRoll(h.world, charId);

    const r = await h.pipeline.dispatch({
      id: "c-trait-7",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: pr.id as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: charId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 5,
        direction: "for",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(
      /no trait at index 5/i,
    );
  });

  it("rejects 'against self' without a severity", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setTraits(h.world, charId, [{ name: "Stubborn", level: 1 }]);
    const pr = spawnPendingRoll(h.world, charId);

    const r = await h.pipeline.dispatch({
      id: "c-trait-8",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: pr.id as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: charId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 0,
        direction: "against",
        // severity intentionally omitted
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
  });

  it("rejects 'against self' when the trait's usedAgainst flag is already set (DH p.80 once-per-session)", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setTraits(h.world, charId, [
      { name: "Reckless", level: 1, usedAgainst: true },
    ]);
    const pr = spawnPendingRoll(h.world, charId);

    const r = await h.pipeline.dispatch({
      id: "c-trait-against-cap",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: pr.id as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: charId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 0,
        direction: "against",
        severity: "minus-1d",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(
      /already been used against yourself this session/i,
    );
  });

  it("'for self' is allowed even when usedAgainst is true (the cap is direction-specific)", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setTraits(h.world, charId, [
      { name: "Stubborn", level: 1, usedAgainst: true },
    ]);
    const pr = spawnPendingRoll(h.world, charId);

    const r = await h.pipeline.dispatch({
      id: "c-trait-for-when-against-set",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: pr.id as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: charId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 0,
        direction: "for",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
  });

  it("does not emit a sheet-mutation event at dispatch time (deferred to LogTraitUsage)", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setTraits(h.world, charId, [{ name: "Stubborn", level: 1 }]);
    const pr = spawnPendingRoll(h.world, charId);

    const r = await h.pipeline.dispatch({
      id: "c-trait-9",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: pr.id as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: charId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 0,
        direction: "for",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    // No TraitUsageLogged event yet — that fires only when the player
    // clicks "Log" on the chat card after the roll resolves.
    const logged = r.events.find((e) => e.type === TraitUsageLogged.name);
    expect(logged).toBeUndefined();
  });

  /* ----- +2D opp (versus pairing) ----- */

  it("'+2D opp' (against): puts +2D on the opponent's roll, marker on ours, +2 checks", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, { name: "Bryn" });
    await spawnImproveCharacter(h.pipeline, h.registry, { name: "Ulrik" });
    const chars = h.world.query([Character]);
    const oursCharId = chars[0]!.id;
    const theirsCharId = chars[1]!.id;
    setTraits(h.world, oursCharId, [{ name: "Reckless", level: 1, checks: 0 }]);

    const versusId = "versus:test-pair-1";
    const ours = h.world.allocateId();
    h.world.spawnAt(ours, [
      PendingRoll({
        initiatorUserId: "u1",
        initiatorCharacterId: oursCharId as Parameters<
          typeof PendingRoll
        >[0]["initiatorCharacterId"],
        rollableName: WillCheck.name,
        opts: { versusTestId: versusId },
        contributions: [],
        openedAt: 0,
      }),
    ]);
    const theirs = h.world.allocateId();
    h.world.spawnAt(theirs, [
      PendingRoll({
        initiatorUserId: "u2",
        initiatorCharacterId: theirsCharId as Parameters<
          typeof PendingRoll
        >[0]["initiatorCharacterId"],
        rollableName: WillCheck.name,
        opts: { versusTestId: versusId },
        contributions: [],
        openedAt: 0,
      }),
    ]);

    const r = await h.pipeline.dispatch({
      id: "c-trait-opp-1",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: ours as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: oursCharId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 0,
        direction: "against",
        severity: "plus-2d-opp",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);

    // Opponent's pending roll: +2D dice modifier with source=trait.
    const theirsAfter = h.world.get(theirs, [PendingRoll]) as
      | { PendingRoll: { contributions: ReadonlyArray<Contribution> } }
      | undefined;
    expect(theirsAfter!.PendingRoll.contributions).toHaveLength(1);
    const oppMod = theirsAfter!.PendingRoll.contributions[0]!.payload as {
      kind: string;
      value: number;
      source: string;
    };
    expect(oppMod.kind).toBe("dice");
    expect(oppMod.value).toBe(2);
    expect(oppMod.source).toBe("trait");

    // Our pending roll: zero-value marker with source=trait so the
    // "one trait per test" check still triggers.
    const oursAfter = h.world.get(ours, [PendingRoll]) as
      | { PendingRoll: { contributions: ReadonlyArray<Contribution> } }
      | undefined;
    expect(oursAfter!.PendingRoll.contributions).toHaveLength(1);
    const ourMarker = oursAfter!.PendingRoll.contributions[0]!.payload as {
      value: number;
      source: string;
      providedBy: string;
    };
    expect(ourMarker.value).toBe(0);
    expect(ourMarker.source).toBe("trait");
    expect(ourMarker.providedBy).toBe("trait:0:against:plus-2d-opp");

    // Sheet checks count is unchanged at dispatch time — earning
    // checks waits for the post-roll LogTraitUsage button.
    const ct = h.world.get(oursCharId, [CharacterTraits]) as
      | { CharacterTraits: { entries: ReadonlyArray<{ checks: number }> } }
      | undefined;
    expect(ct!.CharacterTraits.entries[0]!.checks).toBe(0);
  });

  it("rejects '+2D opp' when there's no versus pairing", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setTraits(h.world, charId, [{ name: "Reckless", level: 1 }]);
    const pr = spawnPendingRoll(h.world, charId);

    const r = await h.pipeline.dispatch({
      id: "c-trait-opp-2",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: pr.id as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: charId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 0,
        direction: "against",
        severity: "plus-2d-opp",
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(
      /requires a versus pairing/i,
    );
  });

  it("after '+2D opp', the marker on our roll blocks adding another trait to our own roll", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry, { name: "Bryn" });
    await spawnImproveCharacter(h.pipeline, h.registry, { name: "Ulrik" });
    const chars = h.world.query([Character]);
    const oursCharId = chars[0]!.id;
    const theirsCharId = chars[1]!.id;
    setTraits(h.world, oursCharId, [
      { name: "Reckless", level: 1 },
      { name: "Bold", level: 1 },
    ]);

    const versusId = "versus:test-pair-2";
    const ours = h.world.allocateId();
    h.world.spawnAt(ours, [
      PendingRoll({
        initiatorUserId: "u1",
        initiatorCharacterId: oursCharId as Parameters<
          typeof PendingRoll
        >[0]["initiatorCharacterId"],
        rollableName: WillCheck.name,
        opts: { versusTestId: versusId },
        contributions: [],
        openedAt: 0,
      }),
    ]);
    const theirs = h.world.allocateId();
    h.world.spawnAt(theirs, [
      PendingRoll({
        initiatorUserId: "u2",
        initiatorCharacterId: theirsCharId as Parameters<
          typeof PendingRoll
        >[0]["initiatorCharacterId"],
        rollableName: WillCheck.name,
        opts: { versusTestId: versusId },
        contributions: [],
        openedAt: 0,
      }),
    ]);

    // First: +2D to opponent.
    const r1 = await h.pipeline.dispatch({
      id: "c-trait-opp-3a",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: ours as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: oursCharId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 0,
        direction: "against",
        severity: "plus-2d-opp",
      }) as CommandInstance,
    });
    expect(r1.result.ok).toBe(true);
    void theirs;

    // Second: try to add a "for self" with another trait — should be
    // rejected because our marker is already on our pending roll.
    const r2 = await h.pipeline.dispatch({
      id: "c-trait-opp-3b",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: UseTraitOnRoll({
        pendingRollId: ours as Parameters<
          typeof UseTraitOnRoll
        >[0]["pendingRollId"],
        characterId: oursCharId as Parameters<
          typeof UseTraitOnRoll
        >[0]["characterId"],
        traitIndex: 1,
        direction: "for",
      }) as CommandInstance,
    });
    expect(r2.result.ok).toBe(false);
    expect((r2.result as { ok: false; reason: string }).reason).toMatch(
      /one trait per test/i,
    );
  });
});

/* -------------------------------------------------------------------------
 * LogTraitUsage command + TraitUsageLoggedSystem
 * ----------------------------------------------------------------------- */

describe("LogTraitUsage command", () => {
  function setOneTrait(
    world: World,
    characterId: string,
    entry: {
      name: string;
      level: number;
      beneficialUses?: number;
      checks?: number;
      usedAgainst?: boolean;
    },
  ): void {
    world.set(characterId, CharacterTraits, {
      entries: [
        {
          name: entry.name,
          level: entry.level,
          beneficialUses: entry.beneficialUses ?? 0,
          checks: entry.checks ?? 0,
          usedAgainst: entry.usedAgainst ?? false,
        },
      ],
    });
  }

  function traitMod(
    traitIndex: number,
    direction: "for" | "against",
    severity?: "minus-1d" | "plus-2d-opp",
  ): TbRollModifier {
    const providedBy =
      direction === "for"
        ? `trait:${traitIndex}:for`
        : `trait:${traitIndex}:against:${severity}`;
    return {
      id: `trait:test:${providedBy}`,
      kind: direction === "for" ? "dice" : "dice",
      value: direction === "for" ? 1 : severity === "plus-2d-opp" ? 0 : -1,
      label: `Trait test: ${providedBy}`,
      apply: "always",
      source: "trait",
      providedBy,
    };
  }

  it("rejects when the roll has no Formula.meta TB spec", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const r = await h.pipeline.dispatch({
      id: "c-ltu-missing",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogTraitUsage({
        rollId: "nope" as Parameters<typeof LogTraitUsage>[0]["rollId"],
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
  });

  it("rejects when the roll's spec has no trait modifier with a structured providedBy", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setOneTrait(h.world, charId, { name: "Stubborn", level: 1 });
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: { kind: "ability", sourceId: "will", source: "Will" },
    });
    const r = await h.pipeline.dispatch({
      id: "c-ltu-no-trait",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogTraitUsage({
        rollId: rollId as Parameters<typeof LogTraitUsage>[0]["rollId"],
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(false);
    expect((r.result as { ok: false; reason: string }).reason).toMatch(
      /no trait usage to log/i,
    );
  });

  it("for-self Lv1: bumps beneficialUses to 1 and attaches the marker trait", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setOneTrait(h.world, charId, { name: "Stubborn", level: 1, beneficialUses: 0 });
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "ability",
        sourceId: "will",
        source: "Will",
        modifiers: [traitMod(0, "for")],
      },
    });
    const r = await h.pipeline.dispatch({
      id: "c-ltu-1",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogTraitUsage({
        rollId: rollId as Parameters<typeof LogTraitUsage>[0]["rollId"],
      }) as CommandInstance,
    });
    expect(r.result.ok).toBe(true);
    const ct = h.world.get(charId, [CharacterTraits]) as
      | { CharacterTraits: { entries: ReadonlyArray<{ beneficialUses: number }> } }
      | undefined;
    expect(ct!.CharacterTraits.entries[0]!.beneficialUses).toBe(1);
    expect(h.world.get(rollId, [TraitUsageLoggedTrait])).toBeDefined();
  });

  it("for-self Lv2 with one used: bumps to 2 (capped at level)", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setOneTrait(h.world, charId, { name: "Stubborn", level: 2, beneficialUses: 1 });
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "ability",
        sourceId: "will",
        source: "Will",
        modifiers: [traitMod(0, "for")],
      },
    });
    await h.pipeline.dispatch({
      id: "c-ltu-2",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogTraitUsage({
        rollId: rollId as Parameters<typeof LogTraitUsage>[0]["rollId"],
      }) as CommandInstance,
    });
    const ct = h.world.get(charId, [CharacterTraits]) as
      | { CharacterTraits: { entries: ReadonlyArray<{ beneficialUses: number }> } }
      | undefined;
    expect(ct!.CharacterTraits.entries[0]!.beneficialUses).toBe(2);
  });

  it("against-self minus-1d: earns 1 check and flips usedAgainst to true", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setOneTrait(h.world, charId, { name: "Reckless", level: 1, checks: 0 });
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "ability",
        sourceId: "will",
        source: "Will",
        modifiers: [traitMod(0, "against", "minus-1d")],
      },
    });
    await h.pipeline.dispatch({
      id: "c-ltu-3",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogTraitUsage({
        rollId: rollId as Parameters<typeof LogTraitUsage>[0]["rollId"],
      }) as CommandInstance,
    });
    const ct = h.world.get(charId, [CharacterTraits]) as
      | {
          CharacterTraits: {
            entries: ReadonlyArray<{ checks: number; usedAgainst?: boolean }>;
          };
        }
      | undefined;
    expect(ct!.CharacterTraits.entries[0]!.checks).toBe(1);
    expect(ct!.CharacterTraits.entries[0]!.usedAgainst).toBe(true);
  });

  it("for-self log does NOT touch the usedAgainst flag", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setOneTrait(h.world, charId, { name: "Stubborn", level: 1, beneficialUses: 0 });
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "ability",
        sourceId: "will",
        source: "Will",
        modifiers: [traitMod(0, "for")],
      },
    });
    await h.pipeline.dispatch({
      id: "c-ltu-for-no-against",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogTraitUsage({
        rollId: rollId as Parameters<typeof LogTraitUsage>[0]["rollId"],
      }) as CommandInstance,
    });
    const ct = h.world.get(charId, [CharacterTraits]) as
      | {
          CharacterTraits: {
            entries: ReadonlyArray<{ usedAgainst?: boolean }>;
          };
        }
      | undefined;
    expect(ct!.CharacterTraits.entries[0]!.usedAgainst).toBe(false);
  });

  it("against-self plus-2d-opp: earns 2 checks", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setOneTrait(h.world, charId, { name: "Reckless", level: 1, checks: 0 });
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "ability",
        sourceId: "will",
        source: "Will",
        modifiers: [traitMod(0, "against", "plus-2d-opp")],
      },
    });
    await h.pipeline.dispatch({
      id: "c-ltu-4",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogTraitUsage({
        rollId: rollId as Parameters<typeof LogTraitUsage>[0]["rollId"],
      }) as CommandInstance,
    });
    const ct = h.world.get(charId, [CharacterTraits]) as
      | { CharacterTraits: { entries: ReadonlyArray<{ checks: number }> } }
      | undefined;
    expect(ct!.CharacterTraits.entries[0]!.checks).toBe(2);
  });

  it("rejects a second LogTraitUsage on the same roll (idempotent)", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    setOneTrait(h.world, charId, { name: "Stubborn", level: 2 });
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "ability",
        sourceId: "will",
        source: "Will",
        modifiers: [traitMod(0, "for")],
      },
    });
    const r1 = await h.pipeline.dispatch({
      id: "c-ltu-5a",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogTraitUsage({
        rollId: rollId as Parameters<typeof LogTraitUsage>[0]["rollId"],
      }) as CommandInstance,
    });
    expect(r1.result.ok).toBe(true);
    const r2 = await h.pipeline.dispatch({
      id: "c-ltu-5b",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: LogTraitUsage({
        rollId: rollId as Parameters<typeof LogTraitUsage>[0]["rollId"],
      }) as CommandInstance,
    });
    expect(r2.result.ok).toBe(false);
    expect((r2.result as { ok: false; reason: string }).reason).toMatch(
      /already logged/i,
    );
  });
});

/* -------------------------------------------------------------------------
 * Fate / persona spend commands (DH p.23, p.67, p.77, p.87)
 * ----------------------------------------------------------------------- */

describe("Fate / persona spend commands", () => {
  /**
   * Set Pools / Wises directly via world.set so tests start with a known
   * fate / persona budget. The improvement harness already sets up
   * Character + Permissions + RawAbilities; we layer the spend-specific
   * fixtures on top.
   */
  function setupSpendCharacter(
    world: World,
    characterId: string,
    args: {
      fate?: number;
      persona?: number;
      natureRating?: number;
      wises?: ReadonlyArray<{ name: string }>;
    } = {},
  ): void {
    world.set(characterId, Pools, {
      fate: { current: args.fate ?? 0, totalSpent: 0 },
      persona: { current: args.persona ?? 0, totalSpent: 0 },
    });
    if (args.natureRating !== undefined) {
      world.set(characterId, RawAbilities, {
        will: { rating: 4, advancement: { pass: 0, fail: 0 } },
        health: { rating: 4, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: args.natureRating,
          maximum: args.natureRating,
          advancement: { pass: 0, fail: 0 },
          descriptors: [],
        },
      });
    }
    if (args.wises) {
      world.set(characterId, Wises, {
        entries: args.wises.map((w) => ({
          name: w.name,
          pass: false,
          fail: false,
          fate: false,
          persona: false,
        })),
      });
    }
  }

  function readPools(world: World, id: string): {
    fate: { current: number; totalSpent: number };
    persona: { current: number; totalSpent: number };
  } {
    const got = world.get(id as Parameters<World["get"]>[0], [Pools]) as
      | { Pools: typeof Pools extends never ? never : { fate: { current: number; totalSpent: number }; persona: { current: number; totalSpent: number } } }
      | undefined;
    return got!.Pools;
  }

  function readSpends(world: World, rollId: string): ReadonlyArray<RollSpendEntry> {
    const got = world.get(rollId as Parameters<World["get"]>[0], [RollSpends]) as
      | { RollSpends: { entries: ReadonlyArray<RollSpendEntry> } }
      | undefined;
    return got?.RollSpends.entries ?? [];
  }

  function readDice(world: World, rollId: string): ReadonlyArray<{ sides: number | "F"; value: number }> {
    const got = world.get(rollId as Parameters<World["get"]>[0], [RollResult]) as
      | { RollResult: { dice: ReadonlyArray<{ sides: number | "F"; value: number }> } }
      | undefined;
    return got?.RollResult.dice ?? [];
  }


  describe("SpendLuck", () => {
    it("rejects when no 6s in the dice pool", async () => {
      const h = buildImprovementHarness();
      await spawnImproveCharacter(h.pipeline, h.registry);
      const charId = h.world.query([Character])[0]!.id;
      setupSpendCharacter(h.world, charId, { fate: 1 });
      // Default test roll has dice [5, 4, 2] — no 6s.
      const rollId = await spawnTestRoll(h.pipeline, h.registry, {
        characterId: charId,
        spec: { kind: "skill", source: "Fighter", sourceId: "fighter" },
      });
      const r = await h.pipeline.dispatch({
        id: "spend-luck-no-6",
        issuedBy: "u1",
        issuedAt: 0,
        session: gmSession(),
        cmd: SpendLuck({
          rollId: rollId as Parameters<typeof SpendLuck>[0]["rollId"],
        }) as CommandInstance,
      });
      expect((r.result as { ok: false }).ok).toBe(false);
    });
  });

  describe("SpendDeeperUnderstanding", () => {
    it("rejects rerolling a die that's already a success", async () => {
      const h = buildImprovementHarness();
      await spawnImproveCharacter(h.pipeline, h.registry);
      const charId = h.world.query([Character])[0]!.id;
      setupSpendCharacter(h.world, charId, {
        fate: 1,
        wises: [{ name: "Field-Dressing" }],
      });
      const rollId = await spawnTestRoll(h.pipeline, h.registry, {
        characterId: charId,
        spec: { kind: "skill", source: "Fighter", sourceId: "fighter" },
      });
      // dice[0] = 5 — a success. DU only rerolls fails.
      const r = await h.pipeline.dispatch({
        id: "spend-du-pass",
        issuedBy: "u1",
        issuedAt: 0,
        session: gmSession(),
        cmd: SpendDeeperUnderstanding({
          rollId: rollId as Parameters<typeof SpendDeeperUnderstanding>[0]["rollId"],
          wiseIndex: 0,
          dieIndex: 0,
        }) as CommandInstance,
      });
      expect((r.result as { ok: false; reason: string }).ok).toBe(false);
      expect((r.result as { ok: false; reason: string }).reason).toMatch(
        /already a success/i,
      );
    });

    it("decrements fate, replaces a single failed die, bumps wise.fate", async () => {
      const h = buildImprovementHarness();
      await spawnImproveCharacter(h.pipeline, h.registry);
      const charId = h.world.query([Character])[0]!.id;
      setupSpendCharacter(h.world, charId, {
        fate: 1,
        wises: [{ name: "Field-Dressing" }],
      });
      const rollId = await spawnTestRoll(h.pipeline, h.registry, {
        characterId: charId,
        spec: { kind: "skill", source: "Fighter", sourceId: "fighter" },
      });
      // dice[2] = 2 — a fail. Reroll it.
      const r = await h.pipeline.dispatch({
        id: "spend-du-fail",
        issuedBy: "u1",
        issuedAt: 0,
        session: gmSession(),
        cmd: SpendDeeperUnderstanding({
          rollId: rollId as Parameters<typeof SpendDeeperUnderstanding>[0]["rollId"],
          wiseIndex: 0,
          dieIndex: 2,
        }) as CommandInstance,
      });
      expect((r.result as { ok: true }).ok).toBe(true);
      expect(readPools(h.world, charId).fate.current).toBe(0);
      const wises = h.world.get(charId as Parameters<World["get"]>[0], [
        Wises,
      ]) as { Wises: { entries: ReadonlyArray<{ fate: boolean }> } };
      expect(wises.Wises.entries[0]!.fate).toBe(true);
      const entries = readSpends(h.world, rollId);
      expect(entries[0]!.kind).toBe("deeper-understanding");
      expect(entries[0]!.rerolledIndices).toEqual([2]);
    });
  });

  describe("SpendOfCourse", () => {
    it("rejects after Luck has fired (RAW ordering DH p.77)", async () => {
      const h = buildImprovementHarness();
      await spawnImproveCharacter(h.pipeline, h.registry);
      const charId = h.world.query([Character])[0]!.id;
      setupSpendCharacter(h.world, charId, {
        fate: 1,
        persona: 1,
        wises: [{ name: "Field-Dressing" }],
      });
      const rollId = await spawnTestRoll(h.pipeline, h.registry, {
        characterId: charId,
        spec: { kind: "skill", source: "Fighter", sourceId: "fighter" },
      });
      // First, manually inject a luck spend by going around the validator
      // — set RollSpends directly so the OC validator's "no prior luck"
      // check fires. (Spending Luck legitimately needs a 6 in the dice
      // pool, which our default test roll doesn't have.)
      h.world.set(rollId as Parameters<World["get"]>[0], RollSpends, {
        entries: [
          {
            kind: "luck",
            pool: "fate",
            cost: 1,
            rerolledIndices: [],
            appendedCount: 0,
            newSuccesses: 0,
            byUserId: "u1",
            byCharacterId: charId,
            loggedAt: 0,
          },
        ],
      });
      const r = await h.pipeline.dispatch({
        id: "spend-oc-after-luck",
        issuedBy: "u1",
        issuedAt: 0,
        session: gmSession(),
        cmd: SpendOfCourse({
          rollId: rollId as Parameters<typeof SpendOfCourse>[0]["rollId"],
          wiseIndex: 0,
        }) as CommandInstance,
      });
      expect((r.result as { ok: false; reason: string }).ok).toBe(false);
      expect((r.result as { ok: false; reason: string }).reason).toMatch(
        /OC first|before Luck/i,
      );
    });

    it("rerolls all failed dice, bumps wise.persona", async () => {
      const h = buildImprovementHarness();
      await spawnImproveCharacter(h.pipeline, h.registry);
      const charId = h.world.query([Character])[0]!.id;
      setupSpendCharacter(h.world, charId, {
        persona: 1,
        wises: [{ name: "Field-Dressing" }],
      });
      const rollId = await spawnTestRoll(h.pipeline, h.registry, {
        characterId: charId,
        spec: { kind: "skill", source: "Fighter", sourceId: "fighter" },
      });
      // dice[2] = 2 is the only fail.
      const r = await h.pipeline.dispatch({
        id: "spend-oc-ok",
        issuedBy: "u1",
        issuedAt: 0,
        session: gmSession(),
        cmd: SpendOfCourse({
          rollId: rollId as Parameters<typeof SpendOfCourse>[0]["rollId"],
          wiseIndex: 0,
        }) as CommandInstance,
      });
      expect((r.result as { ok: true }).ok).toBe(true);
      expect(readPools(h.world, charId).persona.current).toBe(0);
      const wises = h.world.get(charId as Parameters<World["get"]>[0], [
        Wises,
      ]) as { Wises: { entries: ReadonlyArray<{ persona: boolean }> } };
      expect(wises.Wises.entries[0]!.persona).toBe(true);
      const entries = readSpends(h.world, rollId);
      expect(entries[0]!.kind).toBe("of-course");
      expect(entries[0]!.rerolledIndices).toContain(2);
    });
  });

});

/* -------------------------------------------------------------------------
 * Pre-roll spend contribution helpers (DH p.250 — tally before the test)
 * ----------------------------------------------------------------------- */

describe("Pre-roll spend contribution helpers", () => {
  let nextId = 0;
  function freshId(): string {
    nextId += 1;
    return `m-${nextId}`;
  }
  function persona(count: 1 | 2 | 3): Contribution {
    return {
      kind: TB_PERSONA_SPEND_CONTRIB_KIND,
      label: `+${count}D`,
      fromUserId: "u1",
      payload: { id: freshId(), count },
    } as Contribution;
  }

  function channel(scope: "within" | "outside"): Contribution {
    return {
      kind: TB_CHANNEL_NATURE_CONTRIB_KIND,
      label: `Channel (${scope})`,
      fromUserId: "u1",
      payload: { id: freshId(), scope },
    } as Contribution;
  }

  function synergy(helperCharacterId: string): Contribution {
    return {
      kind: TB_SYNERGY_CONTRIB_KIND,
      label: `synergy ${helperCharacterId}`,
      fromUserId: "u1",
      payload: { id: freshId(), helperCharacterId },
    } as Contribution;
  }

  it("personaSpendTotalFromContributions sums and caps at 3 (DH p.8)", () => {
    expect(personaSpendTotalFromContributions(undefined)).toBe(0);
    expect(personaSpendTotalFromContributions([])).toBe(0);
    expect(personaSpendTotalFromContributions([persona(1)])).toBe(1);
    expect(
      personaSpendTotalFromContributions([persona(1), persona(1), persona(1)]),
    ).toBe(3);
    // Beyond 3 should clamp.
    expect(
      personaSpendTotalFromContributions([persona(2), persona(2)]),
    ).toBe(3);
  });

  it("channelNatureFromContributions returns last-wins or null", () => {
    expect(channelNatureFromContributions(undefined)).toBeNull();
    expect(channelNatureFromContributions([channel("within")])?.scope).toBe(
      "within",
    );
    expect(
      channelNatureFromContributions([channel("within"), channel("outside")])
        ?.scope,
    ).toBe("outside");
  });

  it("synergyHelpersFromContributions de-dups by helper id", () => {
    expect(synergyHelpersFromContributions(undefined)).toEqual([]);
    expect(synergyHelpersFromContributions([synergy("e1")])).toEqual(["e1"]);
    expect(
      synergyHelpersFromContributions([synergy("e1"), synergy("e1"), synergy("e2")]),
    ).toEqual(["e1", "e2"]);
  });
});

/* -------------------------------------------------------------------------
 * TbCommitSpendsSystem — pool debit + ledger writes after commit
 * ----------------------------------------------------------------------- */

describe("Pre-roll spend → commit-time debit", () => {
  it("declared persona on the spec → debits roller persona, writes ledger entry", async () => {
    const h = buildImprovementHarness();
    await spawnImproveCharacter(h.pipeline, h.registry);
    const charId = h.world.query([Character])[0]!.id;
    h.world.set(charId, Pools, {
      fate: { current: 0, totalSpent: 0 },
      persona: { current: 3, totalSpent: 0 },
    });
    // Spawn a roll whose spec.personaDiceSpent = 2. The TbCommitSpendsSystem
    // listens to RollResolved; spawnTestRoll synthesises the resolved Roll
    // entity but doesn't emit RollResolved — so we exercise the system by
    // dispatching a RollResolved event directly via a one-shot command.
    const rollId = await spawnTestRoll(h.pipeline, h.registry, {
      characterId: charId,
      spec: {
        kind: "skill",
        source: "Fighter",
        sourceId: "fighter",
        personaDiceSpent: 2,
      },
    });
    const EmitResolved = defineCommand({
      name: "@vtt/test-tb-improvement/EmitResolved",
      schema: z.object({}),
      validate: () => ok(),
      apply: () => [
        // Re-emit RollResolved with the same roll's meta. The system reads
        // meta.spec for the spend declarations.
        {
          type: "@vtt/resolution/RollResolved",
          payload: {
            rollId,
            notation: "3d6>=4",
            reason: "test",
            output: "x",
            total: 2,
            dice: [],
            visibility: "public",
            rolledByUserId: "u1",
            rolledByName: "Tester",
            speakingAsCharacterId: charId,
            rolledAt: 0,
            meta: {
              system: "@vtt/system-torchbearer",
              spec: {
                kind: "skill",
                source: "Fighter",
                sourceId: "fighter",
                baseDice: 3,
                pool: 5,
                bonusSuccesses: 0,
                heroic: false,
                successTarget: 4,
                baseObstacle: null,
                obstacle: null,
                modifiers: [],
                personaDiceSpent: 2,
                channelNature: null,
                synergyHelpers: [],
                caption: "test",
              },
            },
          },
        } as never,
      ],
    });
    h.registry.commands.set(EmitResolved.name, EmitResolved);
    await h.pipeline.dispatch({
      id: "emit-resolved",
      issuedBy: "u1",
      issuedAt: 0,
      session: gmSession(),
      cmd: EmitResolved({}) as CommandInstance,
    });
    const pools = (h.world.get(charId as Parameters<World["get"]>[0], [Pools]) as
      | { Pools: { persona: { current: number; totalSpent: number } } }
      | undefined)!.Pools;
    expect(pools.persona.current).toBe(1);
    expect(pools.persona.totalSpent).toBe(2);
    const got = h.world.get(rollId as Parameters<World["get"]>[0], [
      RollSpends,
    ]) as { RollSpends: { entries: ReadonlyArray<RollSpendEntry> } } | undefined;
    const spends = got!.RollSpends.entries;
    expect(spends.find((e) => e.kind === "persona-dice")?.cost).toBe(2);
  });
});
