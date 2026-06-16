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
import { z } from "zod";
import {
  defineCommand,
  defineDerivation,
  defineEvent,
  definePlugin,
  defineSystem,
  defineTrait,
  EventBus,
  ok,
  runSystemsToFixpoint,
  type EventInstance,
} from "./index.js";
import { CommandPipeline } from "./command-pipeline.js";
import { Registry } from "./registry.js";
import { World } from "./world.js";
import type { EntityId, TraitName } from "./schema.js";

const Abilities = defineTrait({
  name: "@test/derivation/Abilities",
  schema: z.object({
    str: z.number().int(),
    dex: z.number().int(),
  }),
});

const Proficiency = defineTrait({
  name: "@test/derivation/Proficiency",
  schema: z.object({ bonus: z.number().int().default(2) }).default({ bonus: 2 }),
});

const SaveBonuses = defineTrait({
  name: "@test/derivation/SaveBonuses",
  schema: z.object({
    str: z.number().int(),
    dex: z.number().int(),
  }),
});

const SkillBonuses = defineTrait({
  name: "@test/derivation/SkillBonuses",
  schema: z.object({
    athletics: z.number().int(),
  }),
});

const PassivePerception = defineTrait({
  name: "@test/derivation/PassivePerception",
  schema: z.number().int(),
});

const SaveBonusesChanged = defineEvent({
  name: "@test/derivation/SaveBonusesChanged",
  schema: z.object({
    entityId: z.string(),
    values: z.object({ str: z.number(), dex: z.number() }),
  }),
});

const SkillBonusesChanged = defineEvent({
  name: "@test/derivation/SkillBonusesChanged",
  schema: z.object({
    entityId: z.string(),
    values: z.object({ athletics: z.number() }),
  }),
});

const PassivePerceptionChanged = defineEvent({
  name: "@test/derivation/PassivePerceptionChanged",
  schema: z.object({
    entityId: z.string(),
    value: z.number(),
  }),
});

const mod = (s: number): number => Math.floor((s - 10) / 2);

const SaveBonusesDerivation = defineDerivation({
  name: "@test/derivation/save-bonuses",
  inputs: [Abilities, Proficiency] as const,
  output: SaveBonuses,
  compute: ([abilities, proficiency]) => ({
    str: mod(abilities.str) + proficiency.bonus,
    dex: mod(abilities.dex) + proficiency.bonus,
  }),
  toEvent: (entityId, values) => SaveBonusesChanged({ entityId, values }),
});

const SkillBonusesDerivation = defineDerivation({
  name: "@test/derivation/skill-bonuses",
  inputs: [Abilities, Proficiency] as const,
  output: SkillBonuses,
  compute: ([abilities, proficiency]) => ({
    athletics: mod(abilities.str) + proficiency.bonus,
  }),
  toEvent: (entityId, values) => SkillBonusesChanged({ entityId, values }),
});

const PassivePerceptionDerivation = defineDerivation({
  name: "@test/derivation/passive-perception",
  inputs: [SkillBonuses] as const,
  output: PassivePerception,
  compute: ([skills]) => 10 + skills.athletics,
  toEvent: (entityId, value) => PassivePerceptionChanged({ entityId, value }),
});

describe("defineDerivation type shape", () => {
  it("brands the derivation with __kind", () => {
    expect(SaveBonusesDerivation.__kind).toBe("derivation");
    expect(SaveBonusesDerivation.where).toBe("server");
  });
});

describe("topological sort", () => {
  function buildRegistry(plugins: ReturnType<typeof definePlugin>[]): Registry {
    const r = new Registry();
    for (const p of plugins) r.load(p);
    r.validate();
    return r;
  }

  it("orders derivations so dependencies run before dependents", () => {
    const r = buildRegistry([
      definePlugin({
        name: "@test/d-shared",
        version: "0.0.0",
        traits: [Abilities, Proficiency, SaveBonuses, SkillBonuses, PassivePerception],
        events: [SaveBonusesChanged, SkillBonusesChanged, PassivePerceptionChanged],
        // Register PassivePerception (depends on SkillBonuses) BEFORE
        // SkillBonuses, to prove sort doesn't rely on registration order.
        derivations: [PassivePerceptionDerivation, SaveBonusesDerivation, SkillBonusesDerivation],
      }),
    ]);
    const order = r.derivations.map((d) => d.name);
    // PassivePerception must come after SkillBonuses (its input).
    expect(order.indexOf("@test/derivation/passive-perception")).toBeGreaterThan(
      order.indexOf("@test/derivation/skill-bonuses"),
    );
    // The two abilities-fed derivations have no inter-dependency; only
    // their order relative to PassivePerception matters.
  });

  it("rejects a cycle at validate time with a descriptive message", () => {
    const A = defineTrait({ name: "@test/cycle/A", schema: z.number() });
    const B = defineTrait({ name: "@test/cycle/B", schema: z.number() });
    const Achanged = defineEvent({
      name: "@test/cycle/Achanged",
      schema: z.object({ entityId: z.string(), value: z.number() }),
    });
    const Bchanged = defineEvent({
      name: "@test/cycle/Bchanged",
      schema: z.object({ entityId: z.string(), value: z.number() }),
    });
    const dA = defineDerivation({
      name: "@test/cycle/derive-A",
      inputs: [B] as const,
      output: A,
      compute: ([b]) => b + 1,
      toEvent: (id, v) => Achanged({ entityId: id, value: v }),
    });
    const dB = defineDerivation({
      name: "@test/cycle/derive-B",
      inputs: [A] as const,
      output: B,
      compute: ([a]) => a + 1,
      toEvent: (id, v) => Bchanged({ entityId: id, value: v }),
    });
    const r = new Registry();
    r.load(
      definePlugin({
        name: "@test/cycle",
        version: "0.0.0",
        traits: [A, B],
        events: [Achanged, Bchanged],
        derivations: [dA, dB],
      }),
    );
    expect(() => r.validate()).toThrow(/cycle detected/);
  });

  it("rejects two derivations producing the same output trait", () => {
    const dupe = defineDerivation({
      name: "@test/derivation/save-bonuses-dupe",
      inputs: [Abilities, Proficiency] as const,
      output: SaveBonuses,
      compute: () => ({ str: 0, dex: 0 }),
      toEvent: (entityId, values) => SaveBonusesChanged({ entityId, values }),
    });
    const r = new Registry();
    r.load(
      definePlugin({
        name: "@test/d-dupe",
        version: "0.0.0",
        traits: [Abilities, Proficiency, SaveBonuses],
        events: [SaveBonusesChanged],
        derivations: [SaveBonusesDerivation, dupe],
      }),
    );
    expect(() => r.validate()).toThrow(/only one derivation may write/);
  });

  it("rejects a derivation whose input trait is undeclared by any plugin", () => {
    const Undeclared = defineTrait({ name: "@test/missing/Undeclared", schema: z.number() });
    const Out = defineTrait({ name: "@test/missing/Out", schema: z.number() });
    const Outchanged = defineEvent({
      name: "@test/missing/Outchanged",
      schema: z.object({ entityId: z.string(), value: z.number() }),
    });
    const d = defineDerivation({
      name: "@test/missing/d",
      inputs: [Undeclared] as const,
      output: Out,
      compute: ([u]) => u,
      toEvent: (id, v) => Outchanged({ entityId: id, value: v }),
    });
    const r = new Registry();
    r.load(
      definePlugin({
        name: "@test/missing",
        version: "0.0.0",
        traits: [Out], // Undeclared deliberately omitted
        events: [Outchanged],
        derivations: [d],
      }),
    );
    expect(() => r.validate()).toThrow(/which is not declared by any loaded plugin/);
  });
});

describe("derivation runtime", () => {
  function makeWorld(): { world: World; registry: Registry; pipeline: CommandPipeline } {
    const r = new Registry();
    r.load(
      definePlugin({
        name: "@test/d-shared",
        version: "0.0.0",
        traits: [Abilities, Proficiency, SaveBonuses, SkillBonuses, PassivePerception],
        events: [SaveBonusesChanged, SkillBonusesChanged, PassivePerceptionChanged],
        derivations: [SaveBonusesDerivation, SkillBonusesDerivation, PassivePerceptionDerivation],
      }),
    );
    r.validate();
    const world = new World();
    const bus = new EventBus();
    const pipeline = new CommandPipeline(r, world, bus);
    return { world, registry: r, pipeline };
  }

  const SetAbility = defineCommand({
    name: "@test/derivation/SetAbility",
    schema: z.object({
      entityId: z.string(),
      ability: z.enum(["str", "dex"]),
      value: z.number().int(),
    }),
    validate: () => ok(),
    apply: () => [],
  });

  const AbilityChanged = defineEvent({
    name: "@test/derivation/AbilityChanged",
    schema: z.object({ entityId: z.string() }),
  });

  it("derivations fire on initial spawn (writes are detected)", () => {
    const { world, pipeline, registry } = makeWorld();
    // Hook a system to do the trait write so the pipeline tracks dirty.
    const SpawnAbilities = defineCommand({
      name: "@test/derivation/SpawnAbilities",
      schema: z.object({
        str: z.number(),
        dex: z.number(),
      }),
      validate: () => ok(),
      apply: ({ cmd, world }) => {
        const id = world.spawn([
          Abilities({ str: cmd.str, dex: cmd.dex }),
          Proficiency({ bonus: 2 }),
        ]);
        return [SpawnedAbilities({ entityId: id })];
      },
    });
    const SpawnedAbilities = defineEvent({
      name: "@test/derivation/SpawnedAbilities",
      schema: z.object({ entityId: z.string() }),
    });
    registry.events.set(SpawnedAbilities.name, SpawnedAbilities);
    registry.commands.set(SpawnAbilities.name, SpawnAbilities);

    const result = pipeline.dispatch({
      id: "c1",
      issuedBy: "u1",
      issuedAt: 0,
      cmd: SpawnAbilities({ str: 16, dex: 14 }),
    });
    return result.then((r) => {
      expect(r.result.ok).toBe(true);
      const entityId = world.query([Abilities])[0]!.id;
      const got = world.get(entityId, [SaveBonuses]) as
        | { SaveBonuses: { str: number; dex: number } }
        | undefined;
      expect(got).toBeDefined();
      // mod(16) = +3, prof = 2 → save +5. mod(14) = +2 → +4.
      expect(got!.SaveBonuses).toEqual({ str: 5, dex: 4 });
      // Cascading derivation: Skill → PassivePerception
      const pp = world.get(entityId, [PassivePerception]) as
        | { PassivePerception: number }
        | undefined;
      // SkillBonus.athletics = +3 + 2 = 5; PP = 10 + 5 = 15
      expect(pp!.PassivePerception).toBe(15);
      // Both *Changed events appeared in the broadcast.
      const evNames = r.events.map((e) => e.type);
      expect(evNames).toContain("@test/derivation/SaveBonusesChanged");
      expect(evNames).toContain("@test/derivation/SkillBonusesChanged");
      expect(evNames).toContain("@test/derivation/PassivePerceptionChanged");
    });
  });

  it("re-running a command that writes the same value emits no derivative *Changed event (skip-on-unchanged)", async () => {
    const { world, pipeline, registry } = makeWorld();
    // Seed an entity directly.
    const id = world.spawn([Abilities({ str: 16, dex: 14 }), Proficiency({ bonus: 2 })]);
    // Force initial derivation by issuing a no-op set via command.
    const Touch = defineCommand({
      name: "@test/derivation/Touch",
      schema: z.object({ entityId: z.string() }),
      validate: () => ok(),
      apply: ({ cmd, world }) => {
        // Re-write the same Abilities value — should not change SaveBonuses output.
        const cur = world.get(cmd.entityId, [Abilities]) as {
          Abilities: { str: number; dex: number };
        };
        world.set(cmd.entityId, Abilities, cur.Abilities);
        return [];
      },
    });
    registry.commands.set(Touch.name, Touch);

    // First call — populates SaveBonuses for the first time.
    const r1 = await pipeline.dispatch({
      id: "c1",
      issuedBy: "u1",
      issuedAt: 0,
      cmd: Touch({ entityId: id }),
    });
    expect(r1.events.some((e) => e.type === "@test/derivation/SaveBonusesChanged")).toBe(true);

    // Second call — Abilities written to the same value, SaveBonuses already
    // matches, no derivative event should appear.
    const r2 = await pipeline.dispatch({
      id: "c2",
      issuedBy: "u1",
      issuedAt: 0,
      cmd: Touch({ entityId: id }),
    });
    expect(r2.events.some((e) => e.type === "@test/derivation/SaveBonusesChanged")).toBe(false);
  });

  it("uses Zod default for a missing input trait", async () => {
    const { world, pipeline, registry } = makeWorld();
    const Spawn = defineCommand({
      name: "@test/derivation/SpawnNoProf",
      schema: z.object({}),
      validate: () => ok(),
      apply: ({ world }) => {
        // Spawn with Abilities only — Proficiency missing, Zod default kicks in.
        world.spawn([Abilities({ str: 16, dex: 14 })]);
        return [];
      },
    });
    registry.commands.set(Spawn.name, Spawn);

    await pipeline.dispatch({
      id: "c1",
      issuedBy: "u1",
      issuedAt: 0,
      cmd: Spawn({}),
    });
    const id = world.query([Abilities])[0]!.id;
    const got = world.get(id, [SaveBonuses]) as
      | { SaveBonuses: { str: number; dex: number } }
      | undefined;
    expect(got).toBeDefined();
    // Default proficiency = 2.
    expect(got!.SaveBonuses).toEqual({ str: 5, dex: 4 });
  });

  it("skips entities that lack a required input with no default", async () => {
    const Required = defineTrait({
      name: "@test/no-default/Required",
      schema: z.number().int(),
    });
    const Out = defineTrait({
      name: "@test/no-default/Out",
      schema: z.number().int(),
    });
    const OutChanged = defineEvent({
      name: "@test/no-default/OutChanged",
      schema: z.object({ entityId: z.string(), value: z.number() }),
    });
    const SeedTrigger = defineTrait({
      name: "@test/no-default/SeedTrigger",
      schema: z.number().int(),
    });
    const d = defineDerivation({
      name: "@test/no-default/d",
      inputs: [Required] as const,
      output: Out,
      compute: ([v]) => v * 2,
      toEvent: (id, v) => OutChanged({ entityId: id, value: v }),
    });
    const Seed = defineCommand({
      name: "@test/no-default/Seed",
      schema: z.object({}),
      validate: () => ok(),
      apply: ({ world }) => {
        world.spawn([SeedTrigger(1)]);
        return [];
      },
    });
    const r = new Registry();
    r.load(
      definePlugin({
        name: "@test/no-default",
        version: "0.0.0",
        traits: [Required, Out, SeedTrigger],
        events: [OutChanged],
        commands: [Seed],
        derivations: [d],
      }),
    );
    r.validate();
    const world = new World();
    const bus = new EventBus();
    const pipeline = new CommandPipeline(r, world, bus);
    const result = await pipeline.dispatch({
      id: "c1",
      issuedBy: "u1",
      issuedAt: 0,
      cmd: Seed({}),
    });
    expect(result.result.ok).toBe(true);
    const id = world.query([SeedTrigger])[0]!.id;
    // Required is absent and has no default — derivation skipped.
    expect(world.get(id, [Out])).toBeUndefined();
  });

  it("derivations cascade through cross-derivation dependencies", async () => {
    // Already exercised by the spawn test; verify the EXPLICIT cascade
    // by changing only one input and observing PassivePerception update.
    const { world, pipeline, registry } = makeWorld();
    const id = world.spawn([Abilities({ str: 10, dex: 10 }), Proficiency({ bonus: 2 })]);
    // Flush initial derivation pass
    const Touch = defineCommand({
      name: "@test/derivation/CascadeTouch",
      schema: z.object({ entityId: z.string() }),
      validate: () => ok(),
      apply: ({ cmd, world }) => {
        const cur = world.get(cmd.entityId, [Abilities]) as {
          Abilities: { str: number; dex: number };
        };
        world.set(cmd.entityId, Abilities, cur.Abilities);
        return [];
      },
    });
    registry.commands.set(Touch.name, Touch);
    await pipeline.dispatch({
      id: "c0",
      issuedBy: "u1",
      issuedAt: 0,
      cmd: Touch({ entityId: id }),
    });
    let pp = world.get(id, [PassivePerception]) as { PassivePerception: number };
    expect(pp.PassivePerception).toBe(12); // mod(10)+2=2; PP=12

    // Now bump STR to 18 and verify both SkillBonuses and PassivePerception cascade.
    const Bump = defineCommand({
      name: "@test/derivation/CascadeBump",
      schema: z.object({ entityId: z.string() }),
      validate: () => ok(),
      apply: ({ cmd, world }) => {
        world.set(cmd.entityId, Abilities, { str: 18, dex: 10 });
        return [];
      },
    });
    registry.commands.set(Bump.name, Bump);
    const r = await pipeline.dispatch({
      id: "c1",
      issuedBy: "u1",
      issuedAt: 0,
      cmd: Bump({ entityId: id }),
    });
    pp = world.get(id, [PassivePerception]) as { PassivePerception: number };
    // mod(18)=4 + prof 2 = 6; PP = 16
    expect(pp.PassivePerception).toBe(16);
    expect(r.events.some((e) => e.type === "@test/derivation/PassivePerceptionChanged")).toBe(true);
  });
});

/**
 * Client-side derivation flow: when a wire event arrives at the client,
 * the universal-mirror system writes the input trait, the client's local
 * derivation pass picks up the dirty trait, and the derived trait is
 * recomputed locally. Without this, server-broadcast `*Changed` events
 * have no client-side receiver and views reading the derived trait stay
 * stale (e.g. HP/health-tracker not updating after Stats.might changes).
 */
describe("derivation runs on the client side", () => {
  const PoolSize = defineTrait({
    name: "@test/client-deriv/PoolSize",
    schema: z.number().int(),
  });
  const Doubled = defineTrait({
    name: "@test/client-deriv/Doubled",
    schema: z.number().int(),
  });
  const PoolSizeSet = defineEvent({
    name: "@test/client-deriv/PoolSizeSet",
    schema: z.object({ entityId: z.string(), value: z.number().int() }),
  });
  const DoubledChanged = defineEvent({
    name: "@test/client-deriv/DoubledChanged",
    schema: z.object({ entityId: z.string(), value: z.number().int() }),
  });
  const PoolSizeMirror = defineSystem({
    name: "PoolSizeMirror",
    on: PoolSizeSet,
    reads: [],
    writes: [PoolSize],
    run: ({ event, world }) => {
      if (!world.has(event.entityId)) return [];
      world.set(event.entityId, PoolSize, event.value);
      return [];
    },
  });
  const DoubledBoth = defineDerivation({
    name: "@test/client-deriv/doubled-both",
    inputs: [PoolSize] as const,
    output: Doubled,
    compute: ([n]) => n * 2,
    toEvent: (id, v) => DoubledChanged({ entityId: id, value: v }),
    where: "both",
  });
  const DoubledServerOnly = defineDerivation({
    name: "@test/client-deriv/doubled-server-only",
    inputs: [PoolSize] as const,
    output: Doubled,
    compute: ([n]) => n * 2,
    toEvent: (id, v) => DoubledChanged({ entityId: id, value: v }),
    where: "server",
  });

  function makeRegistry(d: typeof DoubledBoth | typeof DoubledServerOnly): Registry {
    const r = new Registry();
    r.load(
      definePlugin({
        name: "@test/client-deriv",
        version: "0.0.0",
        traits: [PoolSize, Doubled],
        events: [PoolSizeSet, DoubledChanged],
        systems: [PoolSizeMirror],
        derivations: [d],
      }),
    );
    r.validate();
    return r;
  }

  function makeDirtyMap(world: World): {
    dirty: Map<EntityId, Set<TraitName>>;
    unsub: () => void;
  } {
    const dirty = new Map<EntityId, Set<TraitName>>();
    const unsub = world.subscribe((id, name) => {
      let s = dirty.get(id);
      if (!s) {
        s = new Set();
        dirty.set(id, s);
      }
      s.add(name);
    });
    return { dirty, unsub };
  }

  it("runs `where: 'both'` derivations on the client when an input trait is written by a mirror system", () => {
    const registry = makeRegistry(DoubledBoth);
    const world = new World();
    const id = world.spawn([PoolSize(3)]);
    // Initial Doubled trait is absent — only the derivation pass writes it.
    expect(world.get(id, [Doubled])).toBeUndefined();

    const { dirty, unsub } = makeDirtyMap(world);
    let emitted: EventInstance[];
    try {
      emitted = runSystemsToFixpoint(
        registry,
        world,
        [PoolSizeSet({ entityId: id, value: 7 })],
        dirty,
        "client",
      );
    } finally {
      unsub();
    }

    // Mirror wrote PoolSize=7, then derivation cascaded Doubled=14.
    expect((world.get(id, [PoolSize]) as { PoolSize: number }).PoolSize).toBe(7);
    expect((world.get(id, [Doubled]) as { Doubled: number }).Doubled).toBe(14);
    // The derivation's *Changed event is part of the returned set so views
    // and other client systems can react to it locally.
    expect(emitted.some((e) => e.type === DoubledChanged.name)).toBe(true);
  });

  it("does NOT run `where: 'server'` derivations on the client", () => {
    const registry = makeRegistry(DoubledServerOnly);
    const world = new World();
    const id = world.spawn([PoolSize(3)]);

    const { dirty, unsub } = makeDirtyMap(world);
    try {
      runSystemsToFixpoint(
        registry,
        world,
        [PoolSizeSet({ entityId: id, value: 7 })],
        dirty,
        "client",
      );
    } finally {
      unsub();
    }

    // Mirror still ran (it's a system, not a derivation), but the
    // server-only derivation was filtered out so Doubled stays absent.
    expect((world.get(id, [PoolSize]) as { PoolSize: number }).PoolSize).toBe(7);
    expect(world.get(id, [Doubled])).toBeUndefined();
  });

  it("DOES run `where: 'server'` derivations on the server side", () => {
    const registry = makeRegistry(DoubledServerOnly);
    const world = new World();
    const id = world.spawn([PoolSize(3)]);

    const { dirty, unsub } = makeDirtyMap(world);
    try {
      runSystemsToFixpoint(
        registry,
        world,
        [PoolSizeSet({ entityId: id, value: 7 })],
        dirty,
        "server",
      );
    } finally {
      unsub();
    }

    expect((world.get(id, [Doubled]) as { Doubled: number }).Doubled).toBe(14);
  });
});

/* -------------------------------------------------------------------------
 * runSystemsToFixpoint — error containment
 * ----------------------------------------------------------------------- */

const PingEvent = defineEvent({
  name: "@test/runner/Ping",
  schema: z.object({ note: z.string() }),
});

const PongEvent = defineEvent({
  name: "@test/runner/Pong",
  schema: z.object({ note: z.string() }),
});

describe("runSystemsToFixpoint error containment", () => {
  it("logs and continues when a system throws — the dispatch tick is not aborted", () => {
    // Two systems on the same event: the first throws, the second
    // succeeds. The runner should swallow the first error, run the
    // second, and not propagate the throw to the caller.
    const ThrowingSystem = defineSystem({
      name: "Throwing",
      on: PingEvent,
      reads: [],
      writes: [],
      run: () => {
        throw new Error("boom");
      },
    });
    const SurvivingSystem = defineSystem({
      name: "Surviving",
      on: PingEvent,
      reads: [],
      writes: [],
      run: ({ event }) => [PongEvent({ note: `echo:${event.note}` })],
    });

    const registry = new Registry();
    registry.load(
      definePlugin({
        name: "@test/runner-throws",
        version: "0.0.0",
        events: [PingEvent, PongEvent],
        systems: [ThrowingSystem, SurvivingSystem],
      }),
    );
    registry.validate();
    const world = new World();

    // Suppress the structured error log under test so the suite stays
    // tidy, but assert it was called so we know the runner logged.
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = ((...args: unknown[]) => errors.push(args)) as typeof console.error;
    let emitted: EventInstance[] = [];
    try {
      // Throws here would fail the test — the point is that the
      // runner traps them. No try/catch around this call on purpose.
      emitted = runSystemsToFixpoint(
        registry,
        world,
        [PingEvent({ note: "hello" })],
        undefined,
        "server",
      );
    } finally {
      console.error = original;
    }

    expect(emitted.some((e) => e.type === PingEvent.name)).toBe(true);
    expect(emitted.some((e) => e.type === PongEvent.name)).toBe(true);
    const pong = emitted.find((e) => e.type === PongEvent.name);
    expect((pong!.payload as { note: string }).note).toBe("echo:hello");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const logged = errors.flat().join(" ");
    expect(logged).toContain('"Throwing"');
    expect(logged).toContain("boom");
  });
});
