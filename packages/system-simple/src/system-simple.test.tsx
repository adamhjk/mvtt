import "@testing-library/jest-dom/vitest";
// Lives in .tsx → vitest's jsdom project (per vitest.config.ts), so the
// manifest's transitive Solid imports load against jsdom's window. All
// assertions here are pure data; the DOM isn't actually exercised.
import { describe, it, expect } from "vitest";
import {
  CommandPipeline,
  defineCommand,
  definePlugin,
  EventBus,
  invokeRollable,
  ok,
  previewRollable,
  Registry,
  World,
  z,
  type CommandInstance,
} from "@vtt/substrate";
import { Character } from "@vtt/characters/shared";
import { RequestRoll } from "@vtt/resolution/shared";
import { systemSimple } from "./manifest.js";
import {
  MaxHp,
  MaxHpChanged,
  Notes,
  StatCheck,
  Stats,
  Vitals,
} from "./shared/index.js";

describe("@vtt/system-simple manifest", () => {
  it("is marked as a game system", () => {
    expect(systemSimple.gameSystem).toBe(true);
  });

  it("declares the baseline shared mechanics as dependencies", () => {
    const names = systemSimple.dependsOn.map((d) => d.split("@", 2).join("@"));
    expect(names).toEqual(
      expect.arrayContaining([
        "@vtt/dice-tray",
        "@vtt/characters",
        "@vtt/scene",
        "@vtt/books",
        "@vtt/pdf-book",
        "@vtt/resolution",
      ]),
    );
  });

  it("exposes Stats, Vitals, MaxHp, Notes, Concept traits", () => {
    const names = systemSimple.traits.map((t) => t.name);
    expect(names).toContain(Stats.name);
    expect(names).toContain(Vitals.name);
    expect(names).toContain(MaxHp.name);
    expect(names).toContain(Notes.name);
  });

  it("registers the MaxHp derivation and StatCheck rollable", () => {
    const derivationNames = systemSimple.derivations.map((d) => d.name);
    expect(derivationNames).toContain("@vtt/system-simple/max-hp");
    const rollableNames = systemSimple.rollables.map((r) => r.name);
    expect(rollableNames).toContain(StatCheck.name);
  });

  it("fills all five sheet slots", () => {
    const filled = Object.keys(systemSimple.fills);
    expect(filled).toEqual(
      expect.arrayContaining([
        "@vtt/characters/sheet-identity",
        "@vtt/characters/sheet-vitals",
        "@vtt/characters/sheet-status",
        "@vtt/characters/sheet-tabs",
        "@vtt/characters/sheet-actions",
      ]),
    );
  });
});

/**
 * Minimal test harness: register the system's traits/events/derivations/
 * rollables alongside Character (which the rollable's compute reads) and
 * RequestRoll (which the rollable dispatches). Returns a fully-validated
 * Registry plus a fresh World and pipeline.
 */
function buildHarness(): {
  registry: Registry;
  world: World;
  bus: EventBus;
  pipeline: CommandPipeline;
} {
  const r = new Registry();
  r.load(
    definePlugin({
      name: "@vtt/test-harness",
      version: "0.0.0",
      traits: [Character, ...systemSimple.traits],
      events: [...systemSimple.events],
      commands: [RequestRoll],
      derivations: [...systemSimple.derivations],
      rollables: [...systemSimple.rollables],
    }),
  );
  r.validate();
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(r, world, bus);
  return { registry: r, world, bus, pipeline };
}

describe("MaxHp derivation", () => {
  it("recomputes MaxHp from Stats.might × 3 when Stats changes", async () => {
    const { registry, world, bus, pipeline } = buildHarness();
    // Need a command so the pipeline's dirty tracker covers the spawn.
    const SpawnTest = defineCommand({
      name: "@vtt/test-harness/Spawn",
      schema: z.object({}),
      validate: () => ok(),
      apply: ({ world }) => {
        world.spawn([
          Character({ name: "Tarn" }),
          Stats({ might: 4, quickness: 2, mind: 2, charm: 2 }),
        ]);
        return [];
      },
    });
    registry.commands.set(SpawnTest.name, SpawnTest);

    const captured: string[] = [];
    bus.onAny((e) => captured.push(e.type));

    const result = await pipeline.dispatch({
      id: "c1",
      issuedBy: "u1",
      issuedAt: 0,
      cmd: SpawnTest({}) as CommandInstance,
    });
    expect(result.result.ok).toBe(true);

    const id = world.query([Stats])[0]!.id;
    const mh = world.get(id, [MaxHp]) as { MaxHp: number } | undefined;
    expect(mh).toBeDefined();
    expect(mh!.MaxHp).toBe(12); // might 4 × 3
    expect(captured).toContain(MaxHpChanged.name);
  });

  it("re-fires when Stats.might updates", async () => {
    const { registry, world, pipeline } = buildHarness();
    const SpawnDefault = defineCommand({
      name: "@vtt/test-harness/SpawnDefault",
      schema: z.object({}),
      validate: () => ok(),
      apply: ({ world }) => {
        world.spawn([
          Character({ name: "Tarn" }),
          Stats({ might: 1, quickness: 1, mind: 1, charm: 1 }),
        ]);
        return [];
      },
    });
    const BumpMight = defineCommand({
      name: "@vtt/test-harness/BumpMight",
      schema: z.object({ entityId: z.string(), value: z.number() }),
      validate: () => ok(),
      apply: ({ cmd, world }) => {
        const cur = world.get(cmd.entityId, [Stats]) as { Stats: z.infer<typeof Stats.schema> };
        world.set(cmd.entityId, Stats, { ...cur.Stats, might: cmd.value });
        return [];
      },
    });
    registry.commands.set(SpawnDefault.name, SpawnDefault);
    registry.commands.set(BumpMight.name, BumpMight);

    await pipeline.dispatch({
      id: "c1",
      issuedBy: "u1",
      issuedAt: 0,
      cmd: SpawnDefault({}) as CommandInstance,
    });
    const id = world.query([Stats])[0]!.id;
    expect((world.get(id, [MaxHp]) as { MaxHp: number }).MaxHp).toBe(3);

    await pipeline.dispatch({
      id: "c2",
      issuedBy: "u1",
      issuedAt: 0,
      cmd: BumpMight({ entityId: id, value: 5 }) as CommandInstance,
    });
    expect((world.get(id, [MaxHp]) as { MaxHp: number }).MaxHp).toBe(15);
  });
});

describe("StatCheck rollable", () => {
  it("computes a 1d6+N notation from the named stat", () => {
    const { registry, world } = buildHarness();
    const id = world.spawn([
      Character({ name: "Tarn" }),
      Stats({ might: 4, quickness: 2, mind: 3, charm: 1 }),
    ]);
    const rollable = registry.rollables.get(StatCheck.name)!;
    const result = invokeRollable(rollable, world, id, { stat: "might" });
    expect(result).not.toBeNull();
    const spec = result!.spec as { notation: string; label: string };
    expect(spec.notation).toBe("1d6+4");
    expect(spec.label).toContain("Tarn");
    expect(spec.label).toContain("Might");
    expect(result!.command.type).toBe("@vtt/resolution/RequestRoll");
    expect(result!.command.payload).toMatchObject({
      notation: "1d6+4",
      visibility: "public",
      speakingAsCharacterId: id,
    });
  });

  it("preview returns the spec without dispatching", () => {
    const { registry, world } = buildHarness();
    const id = world.spawn([
      Character({ name: "Aelric" }),
      Stats({ might: 1, quickness: 3, mind: 2, charm: 4 }),
    ]);
    const rollable = registry.rollables.get(StatCheck.name)!;
    const spec = previewRollable(rollable, world, id, { stat: "charm" }) as {
      notation: string;
    };
    expect(spec.notation).toBe("1d6+4");
  });

  it("rejects opts that fail the schema", () => {
    const { registry, world } = buildHarness();
    const id = world.spawn([
      Character({ name: "Aelric" }),
      Stats({ might: 1, quickness: 3, mind: 2, charm: 4 }),
    ]);
    const rollable = registry.rollables.get(StatCheck.name)!;
    expect(() =>
      invokeRollable(rollable, world, id, { stat: "invalid" }),
    ).toThrow(/opts failed schema/);
  });
});

describe("Notes trait default", () => {
  it("has an empty-text default that lets SetField materialize the trait on first edit", () => {
    const parsed = Notes.schema.safeParse(undefined);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ text: "" });
    }
  });
});

describe("HpBarUnderlay", () => {
  it("is wired into the scene's TokenUnderlaysSlot", async () => {
    const { TokenUnderlaysSlot } = await import("@vtt/scene/shared");
    const fills = systemSimple.fills?.[TokenUnderlaysSlot.name] as
      | Array<{ id: string; mount: unknown }>
      | undefined;
    expect(fills).toBeDefined();
    expect(fills!).toHaveLength(1);
    expect(fills![0]!.id).toBe("@vtt/system-simple/hp-bar");
    expect(typeof fills![0]!.mount).toBe("function");
  });
});
