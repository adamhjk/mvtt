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

import { beforeEach, describe, expect, it } from "vitest";
import {
  CommandPipeline,
  EventBus,
  Registry,
  World,
  definePlugin,
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import { items } from "@vtt/items";
import { ItemIdentity } from "@vtt/items/shared";
import { Character } from "@vtt/characters/shared";
import {
  AssignLightCoverage,
  ClearLightCoverage,
  GRIND_SENTINEL_ID,
  Grind,
  GrindTurnSet,
  LightCoverage,
  LightCoverageChanged,
  LightSourceWentOut,
  SetGrindTurn,
  TbCarries,
  TbSupply,
  lightCoverage,
  lightSourceKey,
} from "./shared/index.js";
import {
  GrindTickSystem,
  LightCoverageAutoClearOnBurnoutSystem,
  LightCoverageAutoClearOnDouseSystem,
  LightCoverageSystem,
  LightWentOutSystem,
  TbEntryStateSystem,
} from "./server/index.js";
import { EntryStateChanged } from "./shared/items/item-events.js";
import { SetEntryState } from "./shared/items/item-commands.js";

const testPlugin = definePlugin({
  name: "@vtt/test-light-coverage",
  version: "0",
  traits: [TbCarries, TbSupply, Grind, LightCoverage, Character],
  events: [
    LightCoverageChanged,
    GrindTurnSet,
    LightSourceWentOut,
    EntryStateChanged,
  ],
  commands: [AssignLightCoverage, ClearLightCoverage, SetGrindTurn, SetEntryState],
  systems: [
    LightCoverageSystem,
    LightCoverageAutoClearOnDouseSystem,
    LightCoverageAutoClearOnBurnoutSystem,
    GrindTickSystem,
    LightWentOutSystem,
    TbEntryStateSystem,
  ],
  gameSystem: true,
});

interface Setup {
  registry: Registry;
  world: World;
  pipeline: CommandPipeline;
  holderId: EntityId;
  torchId: EntityId;
  lanternId: EntityId;
  char2Id: EntityId;
  char3Id: EntityId;
}

function makeSetup(): Setup {
  const registry = new Registry();
  registry.load(items);
  registry.load(testPlugin);
  registry.validate();
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);

  // Sentinel.
  world.spawnAt(GRIND_SENTINEL_ID, [
    Grind({ turn: 0 }),
    LightCoverage({ assignments: {} }),
  ]);

  // Holder character with a lit torch and a lit lantern.
  const torchId = world.spawn([
    ItemIdentity({ name: "Torch" }),
    TbSupply({
      supplyType: "light",
      turnsRemaining: 2,
      lit: false,
      nameSingular: "Torch",
    }),
  ]);
  const lanternId = world.spawn([
    ItemIdentity({ name: "Lantern" }),
    TbSupply({
      supplyType: "light",
      turnsRemaining: 3,
      lit: false,
      nameSingular: "Lantern",
    }),
  ]);
  const holderId = world.spawn([
    Character({ name: "Bryn" }),
    TbCarries({
      entries: [
        {
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: torchId,
          quantity: 1,
          state: { lit: true, turnsRemaining: 2 },
        },
        {
          slot: "handL",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: lanternId,
          quantity: 1,
          state: { lit: true, turnsRemaining: 3 },
        },
      ],
    }),
  ]);

  const char2Id = world.spawn([Character({ name: "Eowyn" })]);
  const char3Id = world.spawn([Character({ name: "Ragnar" })]);

  return {
    registry,
    world,
    pipeline,
    holderId: holderId as EntityId,
    torchId: torchId as EntityId,
    lanternId: lanternId as EntityId,
    char2Id: char2Id as EntityId,
    char3Id: char3Id as EntityId,
  };
}

function dispatchGm(
  s: Setup,
  envelope: { id: string; cmd: CommandInstance },
): ReturnType<CommandPipeline["dispatch"]> {
  return s.pipeline.dispatch({
    id: envelope.id,
    issuedBy: "u1",
    issuedAt: 0,
    cmd: envelope.cmd,
    session: {
      userId: "u1",
      email: "gm@test.dev",
      role: "gm",
      name: "GM",
    },
  });
}

function dispatchPlayer(
  s: Setup,
  envelope: { id: string; cmd: CommandInstance },
): ReturnType<CommandPipeline["dispatch"]> {
  return s.pipeline.dispatch({
    id: envelope.id,
    issuedBy: "u2",
    issuedAt: 0,
    cmd: envelope.cmd,
    session: {
      userId: "u2",
      email: "player@test.dev",
      role: "player",
      name: "Player",
    },
  });
}

// ---------------------------------------------------------------------------
// lightCoverage() helper
// ---------------------------------------------------------------------------

describe("lightCoverage()", () => {
  it("returns 1 for a candle", () => {
    expect(lightCoverage("tb/light-sources/candles-e1f2a3")).toBe(1);
  });

  it("returns 2 for a torch", () => {
    expect(lightCoverage("tb/light-sources/torches-e1f2a3")).toBe(2);
  });

  it("returns 2 for a candle lantern", () => {
    expect(lightCoverage("tb/light-sources/candle-lantern-e1f2a3")).toBe(2);
  });

  it("returns 3 for a lantern", () => {
    expect(lightCoverage("tb/light-sources/lantern-e1f2a3")).toBe(3);
  });

  it("returns 3 for a long torch", () => {
    expect(lightCoverage("tb/light-sources/long-torch-e1f2a3")).toBe(3);
  });

  it("returns 2 for a covered lantern", () => {
    expect(lightCoverage("tb/light-sources/covered-lantern-e1f2a3")).toBe(2);
  });

  it("falls back to name heuristic — lantern", () => {
    expect(lightCoverage("custom-item-123", "Magical Lantern")).toBe(3);
  });

  it("falls back to name heuristic — torch", () => {
    expect(lightCoverage("custom-item-456", "Everburning Torch")).toBe(2);
  });

  it("defaults to 1 for unknown items", () => {
    expect(lightCoverage("custom-item-789")).toBe(1);
  });

  it("defaults to 1 for unknown items with non-matching name", () => {
    expect(lightCoverage("custom-item-000", "Glowing Orb")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// lightSourceKey()
// ---------------------------------------------------------------------------

describe("lightSourceKey()", () => {
  it("produces the expected composite key", () => {
    expect(lightSourceKey("e5", 2)).toBe("e5:2");
  });
});

// ---------------------------------------------------------------------------
// AssignLightCoverage command
// ---------------------------------------------------------------------------

describe("AssignLightCoverage", () => {
  let setup: Setup;

  beforeEach(() => {
    setup = makeSetup();
  });

  it("assigns coverage and writes LightCoverage trait", async () => {
    const res = await dispatchGm(setup, {
      id: "a1",
      cmd: AssignLightCoverage({
        holderId: setup.holderId,
        entryIndex: 0,
        coveredCharacterIds: [setup.holderId, setup.char2Id],
      }),
    });
    expect(res.result.ok).toBe(true);

    const cov = setup.world.get(GRIND_SENTINEL_ID, [LightCoverage]) as {
      LightCoverage: {
        assignments: Record<
          string,
          { coveredCharacterIds: string[]; maxCoverage: number }
        >;
      };
    };
    const key = lightSourceKey(setup.holderId, 0);
    expect(cov.LightCoverage.assignments[key]).toBeDefined();
    expect(cov.LightCoverage.assignments[key]!.coveredCharacterIds).toEqual([
      setup.holderId,
      setup.char2Id,
    ]);
  });

  it("rejects non-GM sessions", async () => {
    const res = await dispatchPlayer(setup, {
      id: "a1",
      cmd: AssignLightCoverage({
        holderId: setup.holderId,
        entryIndex: 0,
        coveredCharacterIds: [setup.holderId],
      }),
    });
    expect(res.result.ok).toBe(false);
  });

  it("rejects if the entry is not lit", async () => {
    // Douse the torch first.
    setup.world.set(setup.holderId, TbCarries, {
      entries: [
        {
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: setup.torchId,
          quantity: 1,
          state: { lit: false, turnsRemaining: 2 },
        },
        {
          slot: "handL",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: setup.lanternId,
          quantity: 1,
          state: { lit: true, turnsRemaining: 3 },
        },
      ],
    });
    const res = await dispatchGm(setup, {
      id: "a1",
      cmd: AssignLightCoverage({
        holderId: setup.holderId,
        entryIndex: 0,
        coveredCharacterIds: [setup.holderId],
      }),
    });
    expect(res.result.ok).toBe(false);
  });

  it("rejects if coveredCharacterIds exceeds maxCoverage", async () => {
    // Torch covers 2 (name heuristic since it's not a catalog id).
    const res = await dispatchGm(setup, {
      id: "a1",
      cmd: AssignLightCoverage({
        holderId: setup.holderId,
        entryIndex: 0,
        coveredCharacterIds: [setup.holderId, setup.char2Id, setup.char3Id],
      }),
    });
    expect(res.result.ok).toBe(false);
  });

  it("allows up to maxCoverage characters for a lantern", async () => {
    // Lantern covers 3 (name heuristic).
    const res = await dispatchGm(setup, {
      id: "a1",
      cmd: AssignLightCoverage({
        holderId: setup.holderId,
        entryIndex: 1,
        coveredCharacterIds: [setup.holderId, setup.char2Id, setup.char3Id],
      }),
    });
    expect(res.result.ok).toBe(true);
  });

  it("rejects if holder has no TbCarries", async () => {
    const res = await dispatchGm(setup, {
      id: "a1",
      cmd: AssignLightCoverage({
        holderId: setup.char2Id,
        entryIndex: 0,
        coveredCharacterIds: [setup.char2Id],
      }),
    });
    expect(res.result.ok).toBe(false);
  });

  it("rejects if entry index is out of bounds", async () => {
    const res = await dispatchGm(setup, {
      id: "a1",
      cmd: AssignLightCoverage({
        holderId: setup.holderId,
        entryIndex: 99,
        coveredCharacterIds: [setup.holderId],
      }),
    });
    expect(res.result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ClearLightCoverage command
// ---------------------------------------------------------------------------

describe("ClearLightCoverage", () => {
  let setup: Setup;

  beforeEach(() => {
    setup = makeSetup();
  });

  it("clears a previously assigned coverage", async () => {
    // First assign.
    await dispatchGm(setup, {
      id: "a1",
      cmd: AssignLightCoverage({
        holderId: setup.holderId,
        entryIndex: 0,
        coveredCharacterIds: [setup.holderId, setup.char2Id],
      }),
    });
    // Then clear.
    const res = await dispatchGm(setup, {
      id: "c1",
      cmd: ClearLightCoverage({
        holderId: setup.holderId,
        entryIndex: 0,
      }),
    });
    expect(res.result.ok).toBe(true);

    const cov = setup.world.get(GRIND_SENTINEL_ID, [LightCoverage]) as {
      LightCoverage: { assignments: Record<string, unknown> };
    };
    const key = lightSourceKey(setup.holderId, 0);
    expect(cov.LightCoverage.assignments[key]).toBeUndefined();
  });

  it("rejects non-GM sessions", async () => {
    const res = await dispatchPlayer(setup, {
      id: "c1",
      cmd: ClearLightCoverage({
        holderId: setup.holderId,
        entryIndex: 0,
      }),
    });
    expect(res.result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Auto-clear on douse (EntryStateChanged with lit=false)
// ---------------------------------------------------------------------------

describe("Auto-clear coverage on douse", () => {
  let setup: Setup;

  beforeEach(() => {
    setup = makeSetup();
  });

  it("removes coverage when a lit source is doused via SetEntryState", async () => {
    // Assign coverage first.
    await dispatchGm(setup, {
      id: "a1",
      cmd: AssignLightCoverage({
        holderId: setup.holderId,
        entryIndex: 0,
        coveredCharacterIds: [setup.holderId],
      }),
    });
    const key = lightSourceKey(setup.holderId, 0);
    let cov = setup.world.get(GRIND_SENTINEL_ID, [LightCoverage]) as {
      LightCoverage: { assignments: Record<string, unknown> };
    };
    expect(cov.LightCoverage.assignments[key]).toBeDefined();

    // Douse the torch.
    await dispatchGm(setup, {
      id: "d1",
      cmd: SetEntryState({
        holderId: setup.holderId,
        entryIndex: 0,
        state: { lit: false },
      }),
    });

    cov = setup.world.get(GRIND_SENTINEL_ID, [LightCoverage]) as {
      LightCoverage: { assignments: Record<string, unknown> };
    };
    expect(cov.LightCoverage.assignments[key]).toBeUndefined();
  });

  it("does NOT clear coverage on unrelated EntryStateChanged", async () => {
    // Assign coverage.
    await dispatchGm(setup, {
      id: "a1",
      cmd: AssignLightCoverage({
        holderId: setup.holderId,
        entryIndex: 0,
        coveredCharacterIds: [setup.holderId],
      }),
    });

    // Change damage state, not lit.
    await dispatchGm(setup, {
      id: "d1",
      cmd: SetEntryState({
        holderId: setup.holderId,
        entryIndex: 0,
        state: { damaged: true },
      }),
    });

    const cov = setup.world.get(GRIND_SENTINEL_ID, [LightCoverage]) as {
      LightCoverage: { assignments: Record<string, unknown> };
    };
    const key = lightSourceKey(setup.holderId, 0);
    expect(cov.LightCoverage.assignments[key]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Auto-clear on burnout (LightSourceWentOut via grind)
// ---------------------------------------------------------------------------

describe("Auto-clear coverage on burnout", () => {
  let setup: Setup;

  beforeEach(() => {
    setup = makeSetup();
    // Give the torch only 1 turn remaining so it burns out on next tick.
    const got = setup.world.get(setup.holderId, [TbCarries]) as {
      TbCarries: { entries: Array<Record<string, unknown>> };
    };
    const entries = got.TbCarries.entries.slice();
    entries[0] = {
      ...entries[0]!,
      state: { lit: true, turnsRemaining: 1 },
    };
    setup.world.set(setup.holderId, TbCarries, { entries });
  });

  it("clears coverage when a light source burns out via grind tick", async () => {
    // Assign coverage.
    await dispatchGm(setup, {
      id: "a1",
      cmd: AssignLightCoverage({
        holderId: setup.holderId,
        entryIndex: 0,
        coveredCharacterIds: [setup.holderId],
      }),
    });
    const key = lightSourceKey(setup.holderId, 0);
    let cov = setup.world.get(GRIND_SENTINEL_ID, [LightCoverage]) as {
      LightCoverage: { assignments: Record<string, unknown> };
    };
    expect(cov.LightCoverage.assignments[key]).toBeDefined();

    // Advance grind — torch burns out.
    await dispatchGm(setup, {
      id: "g1",
      cmd: SetGrindTurn({ to: 1 }),
    });

    cov = setup.world.get(GRIND_SENTINEL_ID, [LightCoverage]) as {
      LightCoverage: { assignments: Record<string, unknown> };
    };
    expect(cov.LightCoverage.assignments[key]).toBeUndefined();
  });
});
