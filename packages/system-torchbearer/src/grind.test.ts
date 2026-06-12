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
  type EntityId,
} from "@vtt/substrate";
import { items } from "@vtt/items";
import { ItemIdentity } from "@vtt/items/shared";
import { Character } from "@vtt/characters/shared";
import { TbMonster } from "./shared/monster-traits.js";
import { TbNpc } from "./shared/npc-traits.js";
import {
  Conditions,
  DismissLightWentOut,
  GRIND_SENTINEL_ID,
  Grind,
  GrindExtremeSet,
  GrindToll,
  GrindTollOpened,
  GrindTollRowApplied,
  GrindTurnSet,
  LightSourceWentOut,
  LightWentOutNotice,
  MarkGrindToll,
  NoticeDismissed,
  SetGrindExtreme,
  SetGrindTurn,
  TbCarries,
  TbSupply,
  nextGrindCondition,
  tollCadence,
} from "./shared/index.js";
import {
  GrindExtremeToggleSystem,
  GrindTickSystem,
  GrindTollOpenedSystem,
  GrindTollRowAppliedSystem,
  LightWentOutSystem,
  NoticeDismissSystem,
  TbEntryStateSystem,
} from "./server/index.js";
import { EntryStateChanged } from "./shared/items/item-events.js";

const tbGrindTestPlugin = definePlugin({
  name: "@vtt/test-tb-grind",
  version: "0",
  traits: [
    TbCarries,
    TbSupply,
    Grind,
    LightWentOutNotice,
    GrindToll,
    Conditions,
    Character,
    TbMonster,
    TbNpc,
  ],
  events: [
    GrindTurnSet,
    GrindExtremeSet,
    LightSourceWentOut,
    NoticeDismissed,
    GrindTollOpened,
    GrindTollRowApplied,
    EntryStateChanged,
  ],
  commands: [
    SetGrindTurn,
    SetGrindExtreme,
    DismissLightWentOut,
    MarkGrindToll,
  ],
  systems: [
    GrindTickSystem,
    GrindExtremeToggleSystem,
    LightWentOutSystem,
    NoticeDismissSystem,
    GrindTollOpenedSystem,
    GrindTollRowAppliedSystem,
    TbEntryStateSystem,
  ],
  gameSystem: true,
});

interface Setup {
  registry: Registry;
  world: World;
  pipeline: CommandPipeline;
  characterId: EntityId;
  asGm: boolean;
}

function makeSetup(asGm: boolean): Setup {
  const registry = new Registry();
  registry.load(items);
  registry.load(tbGrindTestPlugin);
  registry.validate();
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  // Seed: spawn the grind sentinel with turn=0.
  world.spawnAt(GRIND_SENTINEL_ID, [Grind({ turn: 0 })]);
  const characterId = world.spawn([
    Character({ name: "Bryn" }),
    TbCarries({ entries: [] }),
  ]);
  return { registry, world, pipeline, characterId, asGm };
}

function dispatchAsRole(
  s: Setup,
  envelope: { id: string; cmd: ReturnType<typeof SetGrindTurn> },
): ReturnType<CommandPipeline["dispatch"]> {
  return s.pipeline.dispatch({
    id: envelope.id,
    issuedBy: "u1",
    issuedAt: 0,
    cmd: envelope.cmd,
    session: {
      userId: "u1",
      email: "u1@test.dev",
      role: s.asGm ? "gm" : "player",
      name: s.asGm ? "GM" : "Player",
    },
  });
}

describe("@vtt/system-torchbearer Grind", () => {
  let setup: Setup;

  describe("SetGrindTurn — GM only", () => {
    beforeEach(() => {
      setup = makeSetup(true);
    });

    it("advances the grind clock from 0 to 1", async () => {
      const res = await dispatchAsRole(setup, {
        id: "g1",
        cmd: SetGrindTurn({ to: 1 }),
      });
      expect(res.result.ok).toBe(true);
      const got = setup.world.get(GRIND_SENTINEL_ID, [Grind]) as {
        Grind: { turn: number };
      };
      expect(got.Grind.turn).toBe(1);
    });

    it("rewinds the grind clock", async () => {
      await dispatchAsRole(setup, {
        id: "g1",
        cmd: SetGrindTurn({ to: 5 }),
      });
      const res = await dispatchAsRole(setup, {
        id: "g2",
        cmd: SetGrindTurn({ to: 3 }),
      });
      expect(res.result.ok).toBe(true);
      const got = setup.world.get(GRIND_SENTINEL_ID, [Grind]) as {
        Grind: { turn: number };
      };
      expect(got.Grind.turn).toBe(3);
    });

    it("rejects non-GM sessions", async () => {
      const playerSetup = makeSetup(false);
      const res = await dispatchAsRole(playerSetup, {
        id: "g1",
        cmd: SetGrindTurn({ to: 1 }),
      });
      expect(res.result.ok).toBe(false);
    });
  });

  describe("Light burnout on forward grind", () => {
    beforeEach(() => {
      setup = makeSetup(true);
    });

    function spawnLitTorch(args: { turnsRemaining: number }): EntityId {
      const torchId = setup.world.spawn([
        ItemIdentity({ name: "Torch" }),
        TbSupply({
          supplyType: "light",
          turnsRemaining: 2,
          lit: false,
          nameSingular: "Torch",
        }),
      ]);
      const got = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<unknown> };
      };
      const entries = [
        ...got.TbCarries.entries,
        {
          slot: "handR",
          slotIndex: 0,
          channel: "carried",
          slotsConsumed: 1,
          itemId: torchId,
          quantity: 1,
          state: { lit: true, turnsRemaining: args.turnsRemaining },
        },
      ];
      setup.world.set(setup.characterId, TbCarries, { entries });
      return torchId;
    }

    it("decrements turnsRemaining on a forward tick", async () => {
      const torchId = spawnLitTorch({ turnsRemaining: 2 });
      void torchId;
      await dispatchAsRole(setup, {
        id: "g1",
        cmd: SetGrindTurn({ to: 1 }),
      });
      const got = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: {
          entries: Array<{ state?: { lit?: boolean; turnsRemaining?: number } }>;
        };
      };
      expect(got.TbCarries.entries[0]!.state!.turnsRemaining).toBe(1);
      expect(got.TbCarries.entries[0]!.state!.lit).toBe(true);
    });

    it("emits a burnout notice + dousess at zero", async () => {
      spawnLitTorch({ turnsRemaining: 1 });
      const res = await dispatchAsRole(setup, {
        id: "g1",
        cmd: SetGrindTurn({ to: 1 }),
      });
      expect(res.result.ok).toBe(true);
      // Entry doused.
      const carries = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: {
          entries: Array<{ state?: { lit?: boolean; turnsRemaining?: number } }>;
        };
      };
      expect(carries.TbCarries.entries[0]!.state!.lit).toBe(false);
      expect(carries.TbCarries.entries[0]!.state!.turnsRemaining).toBe(0);
      // Burnout notice spawned.
      const notices = setup.world.query([LightWentOutNotice]);
      expect(notices.length).toBe(1);
      const n = notices[0]!.values.LightWentOutNotice as {
        holderName: string;
        itemName: string;
        turn: number;
      };
      expect(n.holderName).toBe("Bryn");
      expect(n.itemName).toBe("Torch");
      expect(n.turn).toBe(1);
    });

    it("does NOT decrement on a rewind", async () => {
      // Seed turn at 5, then rewind to 3.
      await dispatchAsRole(setup, {
        id: "g0",
        cmd: SetGrindTurn({ to: 5 }),
      });
      spawnLitTorch({ turnsRemaining: 2 });
      await dispatchAsRole(setup, {
        id: "g1",
        cmd: SetGrindTurn({ to: 3 }),
      });
      const got = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<{ state?: { turnsRemaining?: number } }> };
      };
      expect(got.TbCarries.entries[0]!.state!.turnsRemaining).toBe(2);
    });

    it("burnout marks the entry as spent", async () => {
      spawnLitTorch({ turnsRemaining: 1 });
      await dispatchAsRole(setup, {
        id: "g1",
        cmd: SetGrindTurn({ to: 1 }),
      });
      const got = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: {
          entries: Array<{
            state?: { lit?: boolean; turnsRemaining?: number; spent?: boolean };
          }>;
        };
      };
      expect(got.TbCarries.entries[0]!.state!.spent).toBe(true);
    });

    it("ignores unlit and non-light supplies", async () => {
      // Unlit torch.
      const unlitTorch = setup.world.spawn([
        ItemIdentity({ name: "Torch" }),
        TbSupply({
          supplyType: "light",
          turnsRemaining: 2,
          lit: false,
          nameSingular: "Torch",
        }),
      ]);
      // Lit ration (non-light supply, shouldn't decrement).
      const ration = setup.world.spawn([
        ItemIdentity({ name: "Rations, Fresh" }),
        TbSupply({
          supplyType: "food",
          turnsRemaining: 2,
          lit: false,
          nameSingular: "Ration",
        }),
      ]);
      setup.world.set(setup.characterId, TbCarries, {
        entries: [
          {
            slot: "torso",
            slotIndex: 0,
            channel: "default",
            slotsConsumed: 1,
            itemId: unlitTorch,
            quantity: 1,
            state: { lit: false, turnsRemaining: 2 },
          },
          {
            slot: "torso",
            slotIndex: 1,
            channel: "default",
            slotsConsumed: 1,
            itemId: ration,
            quantity: 1,
            state: { lit: true, turnsRemaining: 2 },
          },
        ],
      });
      await dispatchAsRole(setup, {
        id: "g1",
        cmd: SetGrindTurn({ to: 1 }),
      });
      const got = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: {
          entries: Array<{ state?: { lit?: boolean; turnsRemaining?: number } }>;
        };
      };
      // Unlit torch: untouched.
      expect(got.TbCarries.entries[0]!.state!.turnsRemaining).toBe(2);
      // Lit ration: untouched (non-light supply).
      expect(got.TbCarries.entries[1]!.state!.turnsRemaining).toBe(2);
      // No burnout notice.
      expect(setup.world.query([LightWentOutNotice]).length).toBe(0);
    });
  });

  describe("nextGrindCondition", () => {
    it("walks the DH p.41 ladder all the way to dead", () => {
      // Empty / fresh → hungry & thirsty.
      expect(nextGrindCondition({})).toBe("hungryThirsty");
      // Each rung up the ladder.
      expect(nextGrindCondition({ hungryThirsty: true })).toBe("exhausted");
      expect(
        nextGrindCondition({ hungryThirsty: true, exhausted: true }),
      ).toBe("angry");
      expect(
        nextGrindCondition({
          hungryThirsty: true,
          exhausted: true,
          angry: true,
        }),
      ).toBe("sick");
      expect(
        nextGrindCondition({
          hungryThirsty: true,
          exhausted: true,
          angry: true,
          sick: true,
        }),
      ).toBe("injured");
      expect(
        nextGrindCondition({
          hungryThirsty: true,
          exhausted: true,
          angry: true,
          sick: true,
          injured: true,
        }),
      ).toBe("afraid");
      // Six conditions marked → next tick brings death.
      expect(
        nextGrindCondition({
          hungryThirsty: true,
          exhausted: true,
          angry: true,
          sick: true,
          injured: true,
          afraid: true,
        }),
      ).toBe("dead");
      // Already dead → no further effect.
      expect(
        nextGrindCondition({
          hungryThirsty: true,
          exhausted: true,
          angry: true,
          sick: true,
          injured: true,
          afraid: true,
          dead: true,
        }),
      ).toBe(null);
    });
  });

  describe("Grind toll on multiple-of-4 turn", () => {
    beforeEach(() => {
      setup = makeSetup(true);
    });

    it("opens a single toll card listing every character", async () => {
      // Spawn a second character.
      const eowyn = setup.world.spawn([
        Character({ name: "Eowyn" }),
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
      ]);
      // Bryn already has Conditions via the harness setup? Check.
      setup.world.set(setup.characterId, Conditions, {
        fresh: false,
        hungryThirsty: true,
        angry: false,
        afraid: false,
        exhausted: false,
        injured: false,
        sick: false,
        dead: false,
      });
      // Tick to turn 4.
      await dispatchAsRole(setup, {
        id: "g4",
        cmd: SetGrindTurn({ to: 4 }),
      });
      const tolls = setup.world.query([GrindToll]);
      expect(tolls.length).toBe(1);
      const t = tolls[0]!.values.GrindToll as {
        turn: number;
        rows: Array<{
          characterId: string;
          characterName: string;
          condition: string;
          applied: boolean;
        }>;
      };
      expect(t.turn).toBe(4);
      expect(t.rows.length).toBe(2);
      const byChar = new Map(t.rows.map((r) => [r.characterId, r]));
      expect(byChar.get(setup.characterId)!.condition).toBe("exhausted");
      expect(byChar.get(eowyn)!.condition).toBe("hungryThirsty");
      expect(t.rows.every((r) => !r.applied)).toBe(true);
    });

    it("excludes monsters from the toll — only player characters take the grind", async () => {
      const fresh = {
        fresh: true,
        hungryThirsty: false,
        angry: false,
        afraid: false,
        exhausted: false,
        injured: false,
        sick: false,
        dead: false,
      };
      // A monster that would otherwise pick up a condition.
      const goblin = setup.world.spawn([
        Character({ name: "Goblin" }),
        TbMonster({}),
        Conditions(fresh),
      ]);
      setup.world.set(setup.characterId, Conditions, fresh);
      await dispatchAsRole(setup, { id: "g4m", cmd: SetGrindTurn({ to: 4 }) });
      const tolls = setup.world.query([GrindToll]);
      expect(tolls.length).toBe(1);
      const t = tolls[0]!.values.GrindToll as {
        rows: Array<{ characterId: string }>;
      };
      const ids = t.rows.map((r) => r.characterId);
      expect(ids).toContain(setup.characterId); // PC takes the grind
      expect(ids).not.toContain(goblin); // the monster does not
    });

    it("includes a player character with no Conditions trait yet (treated as fresh)", async () => {
      // A freshly-created PC who's never been edited has no Conditions
      // trait attached. The grind must still afflict them.
      const gg = setup.world.spawn([Character({ name: "gg" })]);
      await dispatchAsRole(setup, { id: "g4gg", cmd: SetGrindTurn({ to: 4 }) });
      const tolls = setup.world.query([GrindToll]);
      expect(tolls.length).toBe(1);
      const t = tolls[0]!.values.GrindToll as {
        rows: Array<{ characterId: string; condition: string }>;
      };
      const ggRow = t.rows.find((r) => r.characterId === gg);
      expect(ggRow).toBeDefined();
      expect(ggRow!.condition).toBe("hungryThirsty");
    });

    it("does NOT open a toll on a non-multiple-of-4 tick", async () => {
      setup.world.set(setup.characterId, Conditions, {
        fresh: true,
        hungryThirsty: false,
        angry: false,
        afraid: false,
        exhausted: false,
        injured: false,
        sick: false,
        dead: false,
      });
      await dispatchAsRole(setup, {
        id: "g3",
        cmd: SetGrindTurn({ to: 3 }),
      });
      expect(setup.world.query([GrindToll]).length).toBe(0);
    });

    it("does NOT open a toll if every character is already dead", async () => {
      setup.world.set(setup.characterId, Conditions, {
        fresh: false,
        hungryThirsty: true,
        angry: true,
        afraid: true,
        exhausted: true,
        injured: true,
        sick: true,
        dead: true,
      });
      await dispatchAsRole(setup, {
        id: "g4",
        cmd: SetGrindTurn({ to: 4 }),
      });
      expect(setup.world.query([GrindToll]).length).toBe(0);
    });

    it("a character with all six conditions takes 'dead' on the next tick", async () => {
      setup.world.set(setup.characterId, Conditions, {
        fresh: false,
        hungryThirsty: true,
        exhausted: true,
        angry: true,
        sick: true,
        injured: true,
        afraid: true,
        dead: false,
      });
      await dispatchAsRole(setup, {
        id: "g4",
        cmd: SetGrindTurn({ to: 4 }),
      });
      const tolls = setup.world.query([GrindToll]);
      expect(tolls.length).toBe(1);
      const t = tolls[0]!.values.GrindToll as {
        rows: Array<{ condition: string }>;
      };
      expect(t.rows.length).toBe(1);
      expect(t.rows[0]!.condition).toBe("dead");
      // Apply it.
      const tollId = tolls[0]!.id;
      await dispatchAsRole(setup, {
        id: "m1",
        cmd: MarkGrindToll({ tollId, rowIndex: 0 }) as never,
      });
      const c = setup.world.get(setup.characterId, [Conditions]) as {
        Conditions: { dead: boolean };
      };
      expect(c.Conditions.dead).toBe(true);
    });

    it("MarkGrindToll applies the condition and flips the row to applied", async () => {
      setup.world.set(setup.characterId, Conditions, {
        fresh: true,
        hungryThirsty: false,
        angry: false,
        afraid: false,
        exhausted: false,
        injured: false,
        sick: false,
        dead: false,
      });
      await dispatchAsRole(setup, {
        id: "g4",
        cmd: SetGrindTurn({ to: 4 }),
      });
      const tollId = setup.world.query([GrindToll])[0]!.id;
      const res = await dispatchAsRole(setup, {
        id: "m1",
        cmd: MarkGrindToll({ tollId, rowIndex: 0 }) as never,
      });
      expect(res.result.ok).toBe(true);
      // Toll is despawned because that was the only row.
      expect(setup.world.has(tollId)).toBe(false);
      // Character is now hungry+thirsty (and no longer fresh).
      const c = setup.world.get(setup.characterId, [Conditions]) as {
        Conditions: { hungryThirsty: boolean; fresh: boolean };
      };
      expect(c.Conditions.hungryThirsty).toBe(true);
      expect(c.Conditions.fresh).toBe(false);
    });

    it("with multiple rows, the card stays until every row is applied", async () => {
      const eowyn = setup.world.spawn([
        Character({ name: "Eowyn" }),
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
      ]);
      setup.world.set(setup.characterId, Conditions, {
        fresh: true,
        hungryThirsty: false,
        angry: false,
        afraid: false,
        exhausted: false,
        injured: false,
        sick: false,
        dead: false,
      });
      await dispatchAsRole(setup, {
        id: "g4",
        cmd: SetGrindTurn({ to: 4 }),
      });
      const tollId = setup.world.query([GrindToll])[0]!.id;
      // Apply row 0.
      await dispatchAsRole(setup, {
        id: "m1",
        cmd: MarkGrindToll({ tollId, rowIndex: 0 }) as never,
      });
      expect(setup.world.has(tollId)).toBe(true);
      const after1 = setup.world.get(tollId, [GrindToll]) as {
        GrindToll: { rows: Array<{ applied: boolean }> };
      };
      const appliedCount1 = after1.GrindToll.rows.filter(
        (r) => r.applied,
      ).length;
      expect(appliedCount1).toBe(1);
      // Apply row 1.
      await dispatchAsRole(setup, {
        id: "m2",
        cmd: MarkGrindToll({ tollId, rowIndex: 1 }) as never,
      });
      // Now the toll should be gone.
      expect(setup.world.has(tollId)).toBe(false);
      // Both characters got conditions.
      const cBryn = setup.world.get(setup.characterId, [Conditions]) as {
        Conditions: { hungryThirsty: boolean };
      };
      const cEowyn = setup.world.get(eowyn, [Conditions]) as {
        Conditions: { hungryThirsty: boolean };
      };
      expect(cBryn.Conditions.hungryThirsty).toBe(true);
      expect(cEowyn.Conditions.hungryThirsty).toBe(true);
    });

    it("rejects re-applying an already-applied row", async () => {
      setup.world.set(setup.characterId, Conditions, {
        fresh: true,
        hungryThirsty: false,
        angry: false,
        afraid: false,
        exhausted: false,
        injured: false,
        sick: false,
        dead: false,
      });
      // Add a second character so the toll doesn't auto-despawn.
      setup.world.spawn([
        Character({ name: "Eowyn" }),
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
      ]);
      await dispatchAsRole(setup, {
        id: "g4",
        cmd: SetGrindTurn({ to: 4 }),
      });
      const tollId = setup.world.query([GrindToll])[0]!.id;
      await dispatchAsRole(setup, {
        id: "m1",
        cmd: MarkGrindToll({ tollId, rowIndex: 0 }) as never,
      });
      const res = await dispatchAsRole(setup, {
        id: "m1b",
        cmd: MarkGrindToll({ tollId, rowIndex: 0 }) as never,
      });
      expect(res.result.ok).toBe(false);
    });
  });

  describe("Extreme grind toggle", () => {
    beforeEach(() => {
      setup = makeSetup(true);
    });

    it("tollCadence helper picks 4 normally and 3 in extreme mode", () => {
      expect(tollCadence(false)).toBe(4);
      expect(tollCadence(true)).toBe(3);
    });

    it("SetGrindExtreme writes the flag (GM-only)", async () => {
      const res = await dispatchAsRole(setup, {
        id: "x1",
        cmd: SetGrindExtreme({ extreme: true }) as never,
      });
      expect(res.result.ok).toBe(true);
      const got = setup.world.get(GRIND_SENTINEL_ID, [Grind]) as {
        Grind: { extreme: boolean; turn: number };
      };
      expect(got.Grind.extreme).toBe(true);
    });

    it("rejects non-GM toggles", async () => {
      const player = makeSetup(false);
      const res = await dispatchAsRole(player, {
        id: "x1",
        cmd: SetGrindExtreme({ extreme: true }) as never,
      });
      expect(res.result.ok).toBe(false);
    });

    it("preserves the turn when toggling extreme", async () => {
      await dispatchAsRole(setup, {
        id: "g1",
        cmd: SetGrindTurn({ to: 5 }),
      });
      await dispatchAsRole(setup, {
        id: "x1",
        cmd: SetGrindExtreme({ extreme: true }) as never,
      });
      const got = setup.world.get(GRIND_SENTINEL_ID, [Grind]) as {
        Grind: { turn: number; extreme: boolean };
      };
      expect(got.Grind.turn).toBe(5);
      expect(got.Grind.extreme).toBe(true);
    });

    it("fires a toll on turn 3 when extreme is on (not on turn 4)", async () => {
      setup.world.set(setup.characterId, Conditions, {
        fresh: true,
        hungryThirsty: false,
        angry: false,
        afraid: false,
        exhausted: false,
        injured: false,
        sick: false,
        dead: false,
      });
      await dispatchAsRole(setup, {
        id: "x1",
        cmd: SetGrindExtreme({ extreme: true }) as never,
      });
      // Turn 3 → toll fires (3 % 3 === 0).
      await dispatchAsRole(setup, {
        id: "g3",
        cmd: SetGrindTurn({ to: 3 }),
      });
      expect(setup.world.query([GrindToll]).length).toBe(1);
      // Apply + clear so the next test can observe turn 4.
      const tollId = setup.world.query([GrindToll])[0]!.id;
      await dispatchAsRole(setup, {
        id: "m1",
        cmd: MarkGrindToll({ tollId, rowIndex: 0 }) as never,
      });
      // Reset Conditions so the next toll actually has work to do.
      setup.world.set(setup.characterId, Conditions, {
        fresh: true,
        hungryThirsty: false,
        angry: false,
        afraid: false,
        exhausted: false,
        injured: false,
        sick: false,
        dead: false,
      });
      // Turn 4 in extreme is NOT a multiple of 3 → no toll.
      await dispatchAsRole(setup, {
        id: "g4",
        cmd: SetGrindTurn({ to: 4 }),
      });
      expect(setup.world.query([GrindToll]).length).toBe(0);
    });
  });

  describe("DismissLightWentOut", () => {
    beforeEach(() => {
      setup = makeSetup(true);
    });

    it("removes the burnt entry from the holder, despawns notice + item", async () => {
      // Stage a burnout via the grind tick.
      const torchId = setup.world.spawn([
        ItemIdentity({ name: "Torch" }),
        TbSupply({
          supplyType: "light",
          turnsRemaining: 2,
          lit: false,
          nameSingular: "Torch",
        }),
      ]);
      setup.world.set(setup.characterId, TbCarries, {
        entries: [
          {
            slot: "handR",
            slotIndex: 0,
            channel: "carried",
            slotsConsumed: 1,
            itemId: torchId,
            quantity: 1,
            state: { lit: true, turnsRemaining: 1 },
          },
        ],
      });
      await dispatchAsRole(setup, {
        id: "g1",
        cmd: SetGrindTurn({ to: 1 }),
      });
      const noticeId = setup.world.query([LightWentOutNotice])[0]!.id;
      // Dismiss.
      const res = await dispatchAsRole(setup, {
        id: "d1",
        cmd: DismissLightWentOut({ noticeId }) as never,
      });
      expect(res.result.ok).toBe(true);
      // Notice gone.
      expect(setup.world.query([LightWentOutNotice]).length).toBe(0);
      // Torch entity gone (non-catalog).
      expect(setup.world.has(torchId)).toBe(false);
      // Holder's entry removed.
      const got = setup.world.get(setup.characterId, [TbCarries]) as {
        TbCarries: { entries: Array<unknown> };
      };
      expect(got.TbCarries.entries.length).toBe(0);
    });
  });
});
