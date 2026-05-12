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
import { Character } from "@vtt/characters/shared";
import { ItemIdentity } from "@vtt/items/shared";
import { Permissions, everyone } from "@vtt/permissions/shared";
import { Formula, RollResult } from "@vtt/resolution/shared";
import {
  AcquireRelic,
  ApplyImmortalBurden,
  CreateBlankInvocation,
  EditInvocationField,
  InvocationCreated,
  InvocationFieldEdited,
  InvocationIdentity,
  InvocationPerformConsumed,
  InvocationPerformConsumeLogged,
  InvocationPerformInitiated,
  InvocationRemoved,
  LoseRelic,
  RelicAcquired,
  RelicLost,
  Relics,
  RemoveInvocation,
  TbCarries,
  TbInvocationHomebrewProse,
  TbInvocationPerforming,
  TbInvocationRelicLink,
  TbInvocationRelics,
  TbItemSlotOptions,
} from "./shared/index.js";
import { parseRelicSlotOptions } from "./shared/invocations/relic-slot-parse.js";
import { TB_INVOCATION_SYSTEMS } from "./server/index.js";
import { TB_INVOCATION_TEMPLATES } from "./data/seed.js";

const tbInvocationsTestPlugin = definePlugin({
  name: "@vtt/test-tb-invocations",
  version: "0",
  traits: [
    Character,
    Permissions,
    Relics,
    ItemIdentity,
    TbCarries,
    TbItemSlotOptions,
    InvocationIdentity,
    TbInvocationPerforming,
    TbInvocationHomebrewProse,
    TbInvocationRelicLink,
    TbInvocationRelics,
    InvocationPerformConsumed,
    Formula,
    RollResult,
  ],
  events: [
    RelicAcquired,
    RelicLost,
    InvocationCreated,
    InvocationRemoved,
    InvocationFieldEdited,
    InvocationPerformInitiated,
    InvocationPerformConsumeLogged,
  ],
  commands: [
    AcquireRelic,
    LoseRelic,
    ApplyImmortalBurden,
    CreateBlankInvocation,
    RemoveInvocation,
    EditInvocationField,
  ],
  systems: [...TB_INVOCATION_SYSTEMS],
  gameSystem: true,
});

interface Setup {
  registry: Registry;
  world: World;
  pipeline: CommandPipeline;
  characterId: EntityId;
  invocationId: EntityId; // Bone Knitter analogue (circle 1, fixed Ob 3, burden 2/1)
  /**
   * Catalog relic-item entity for the invocation above. The seed
   * normally creates this; the test fixture spawns it inline so the
   * AcquireRelic flow can find it via `TbInvocationRelicLink`.
   */
  relicItemId: EntityId;
  asGm: boolean;
}

function makeSetup(asGm = false): Setup {
  const registry = new Registry();
  registry.load(tbInvocationsTestPlugin);
  registry.validate();
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);

  const characterId = world.spawn([
    Character({ name: "Ulrik" }),
    Permissions({ read: everyone(), write: everyone() }),
    Relics({ entries: [], urdr: 1, burden: 0 }),
    TbInvocationRelics({ invocationIds: [] }),
    TbCarries({ entries: [] }),
  ]);

  const invocationId = world.spawn([
    InvocationIdentity({
      name: "Bone Knitter",
      circle: 1,
      traditions: ["theurge"],
      pageRef: { canonicalId: "tb/book/dungeoneers-handbook", page: 209 },
    }),
    TbInvocationPerforming({
      ritualKind: "fixed",
      fixedOb: 3,
      versusAgainst: null,
      invocationTime: { noRelic: 1, withRelic: 0 },
      duration: "One turn",
      immortalBurden: { noRelic: 2, withRelic: 1 },
      relicName: "A set of bone knitting needles",
      relicSlot: "worn/head or pack 1",
      sacramental: "",
    }),
  ]);

  // Catalog relic-item entity for the invocation, seeded in
  // `tbSeed` from `TB_INVOCATION_TEMPLATES` in production. We
  // spawn it inline here so the test fixture matches a post-seed
  // world.
  const relicItemId = world.spawn([
    ItemIdentity({
      name: "A set of bone knitting needles",
      description: "Sacred relic fueling Bone Knitter.",
      img: "",
    }),
    TbItemSlotOptions({ options: { head: 1, pack: 1 } }),
    TbInvocationRelicLink({ invocationId }),
  ]);

  return { registry, world, pipeline, characterId, invocationId, relicItemId, asGm };
}

let nextEnvelope = 1;
async function dispatch(s: Setup, cmd: CommandInstance, asGm = s.asGm) {
  return await s.pipeline.dispatch({
    id: `env-${nextEnvelope++}`,
    issuedBy: "u1",
    issuedAt: 0,
    cmd,
    session: {
      userId: "u1",
      email: "u1@test.dev",
      role: asGm ? "gm" : "player",
      name: asGm ? "GM" : "Player",
    },
  });
}

describe("@vtt/system-torchbearer invocations", () => {
  let setup: Setup;
  beforeEach(() => {
    setup = makeSetup();
  });

  describe("AcquireRelic", () => {
    it("appends the invocation id to TbInvocationRelics", async () => {
      const r = await dispatch(
        setup,
        AcquireRelic({
          characterId: setup.characterId,
          invocationId: setup.invocationId,
        }),
      );
      expect(r.result.ok).toBe(true);
      const got = setup.world.get(setup.characterId, [TbInvocationRelics]) as
        | { TbInvocationRelics: { invocationIds: EntityId[] } }
        | undefined;
      expect(got?.TbInvocationRelics.invocationIds).toEqual([setup.invocationId]);
    });

    it("adds a TbCarries entry pointing at the catalog relic item", async () => {
      await dispatch(
        setup,
        AcquireRelic({
          characterId: setup.characterId,
          invocationId: setup.invocationId,
        }),
      );
      const carries = setup.world.get(setup.characterId, [TbCarries]) as
        | {
            TbCarries: {
              entries: ReadonlyArray<{ itemId: string; slot: string }>;
            };
          }
        | undefined;
      expect(carries?.TbCarries.entries.length).toBe(1);
      const entry = carries!.TbCarries.entries[0]!;
      // Staged in the Loose panel via the `loose:<itemId>` slot —
      // the player can re-equip from there to a real body slot.
      expect(entry.slot).toMatch(/^loose:/);
      // The carried item is exactly the catalog relic entity.
      expect(entry.itemId).toBe(setup.relicItemId);
      // Sanity: the catalog item carries the invocation back-link
      // and slot options derived from the rulebook annotation.
      const link = setup.world.get(setup.relicItemId, [
        TbInvocationRelicLink,
      ]) as
        | { TbInvocationRelicLink: { invocationId: string } }
        | undefined;
      expect(link?.TbInvocationRelicLink.invocationId).toBe(setup.invocationId);
      const slotOpts = setup.world.get(setup.relicItemId, [
        TbItemSlotOptions,
      ]) as
        | { TbItemSlotOptions: { options: Record<string, number> } }
        | undefined;
      expect(slotOpts?.TbItemSlotOptions.options).toEqual({
        head: 1,
        pack: 1,
      });
    });

    it("rejects an unknown invocation id", async () => {
      const r = await dispatch(
        setup,
        AcquireRelic({
          characterId: setup.characterId,
          invocationId: "ghost" as EntityId,
        }),
      );
      expect(r.result.ok).toBe(false);
    });

    it("rejects a duplicate acquire — relic already held", async () => {
      const ok = await dispatch(
        setup,
        AcquireRelic({
          characterId: setup.characterId,
          invocationId: setup.invocationId,
        }),
      );
      expect(ok.result.ok).toBe(true);
      const dup = await dispatch(
        setup,
        AcquireRelic({
          characterId: setup.characterId,
          invocationId: setup.invocationId,
        }),
      );
      expect(dup.result.ok).toBe(false);
      // Inventory still has only one linked item.
      const carries = setup.world.get(setup.characterId, [TbCarries]) as
        | {
            TbCarries: {
              entries: ReadonlyArray<{ itemId: string }>;
            };
          }
        | undefined;
      expect(carries?.TbCarries.entries.length).toBe(1);
    });
  });

  describe("LoseRelic", () => {
    it("removes the flag and the carry entry but keeps the catalog item alive", async () => {
      await dispatch(
        setup,
        AcquireRelic({
          characterId: setup.characterId,
          invocationId: setup.invocationId,
        }),
      );
      const r = await dispatch(
        setup,
        LoseRelic({
          characterId: setup.characterId,
          invocationId: setup.invocationId,
        }),
      );
      expect(r.result.ok).toBe(true);
      const flagAfter = setup.world.get(setup.characterId, [
        TbInvocationRelics,
      ]) as
        | { TbInvocationRelics: { invocationIds: EntityId[] } }
        | undefined;
      expect(flagAfter?.TbInvocationRelics.invocationIds).toEqual([]);
      const carriesAfter = setup.world.get(setup.characterId, [TbCarries]) as
        | { TbCarries: { entries: ReadonlyArray<{ itemId: string }> } }
        | undefined;
      expect(carriesAfter?.TbCarries.entries).toEqual([]);
      // Catalog entity stays alive — relic items are shared by
      // reference, mirroring the spell catalog.
      expect(setup.world.has(setup.relicItemId)).toBe(true);
    });

    it("is a no-op when the relic was never held", async () => {
      const r = await dispatch(
        setup,
        LoseRelic({
          characterId: setup.characterId,
          invocationId: setup.invocationId,
        }),
      );
      expect(r.result.ok).toBe(true);
    });
  });

  describe("ApplyImmortalBurden", () => {
    /**
     * Synthesise a Roll entity with a Formula trait carrying
     * `meta.spec.invocationPerform`. The post-roll commit reads from
     * that meta payload — same pattern as `ApplyImmortalBurden`'s
     * sibling SpellCast commits.
     */
    function makeRoll(
      world: World,
      characterId: EntityId,
      invocationId: EntityId,
      burdenAdded: number,
    ): EntityId {
      return world.spawn([
        Formula({
          notation: "4d6",
          meta: {
            spec: {
              invocationPerform: {
                characterId,
                invocationId,
                invocationName: "Bone Knitter",
                invocationCircle: 1,
                withRelic: false,
                burdenAdded,
              },
            },
          },
        }),
        RollResult({ dice: [], total: 0, output: "", rolledAt: 0 }),
      ]);
    }

    it("increments Relics.burden and stamps the marker", async () => {
      const rollId = makeRoll(
        setup.world,
        setup.characterId,
        setup.invocationId,
        2,
      );
      const r = await dispatch(setup, ApplyImmortalBurden({ rollId }));
      expect(r.result.ok).toBe(true);
      const relics = setup.world.get(setup.characterId, [Relics]) as
        | { Relics: { burden: number } }
        | undefined;
      expect(relics?.Relics.burden).toBe(2);
      const marker = setup.world.get(rollId, [InvocationPerformConsumed]) as
        | { InvocationPerformConsumed: { burdenAdded: number } }
        | undefined;
      expect(marker?.InvocationPerformConsumed.burdenAdded).toBe(2);
    });

    it("rejects a second click — marker is one-shot", async () => {
      const rollId = makeRoll(
        setup.world,
        setup.characterId,
        setup.invocationId,
        2,
      );
      await dispatch(setup, ApplyImmortalBurden({ rollId }));
      const r = await dispatch(setup, ApplyImmortalBurden({ rollId }));
      expect(r.result.ok).toBe(false);
    });

    it("rejects when the roll isn't an invocation perform", async () => {
      const rollId = setup.world.spawn([
        Formula({ notation: "4d6", meta: { spec: {} } }),
      ]);
      const r = await dispatch(setup, ApplyImmortalBurden({ rollId }));
      expect(r.result.ok).toBe(false);
    });
  });

  describe("Catalog management", () => {
    it("CreateBlankInvocation is GM-only and spawns defaults", async () => {
      const playerR = await dispatch(
        setup,
        CreateBlankInvocation({ name: "Custom Rite" }),
      );
      expect(playerR.result.ok).toBe(false);
      const r = await dispatch(
        setup,
        CreateBlankInvocation({ name: "Custom Rite" }),
        true,
      );
      expect(r.result.ok).toBe(true);
      const created = (
        r.events as ReadonlyArray<{ type: string; payload: { invocationId: EntityId } }>
      ).find((e) => e.type === InvocationCreated.name);
      expect(created).toBeDefined();
      const ident = setup.world.get(created!.payload.invocationId, [
        InvocationIdentity,
      ]) as { InvocationIdentity: { name: string; circle: number } } | undefined;
      expect(ident?.InvocationIdentity.name).toBe("Custom Rite");
      expect(ident?.InvocationIdentity.circle).toBe(1);
    });

    it("EditInvocationField applies a deep-set", async () => {
      const r = await dispatch(
        setup,
        EditInvocationField({
          invocationId: setup.invocationId,
          trait: "TbInvocationPerforming",
          path: ["fixedOb"],
          value: 4,
        }),
        true,
      );
      expect(r.result.ok).toBe(true);
      const got = setup.world.get(setup.invocationId, [
        TbInvocationPerforming,
      ]) as { TbInvocationPerforming: { fixedOb: number } } | undefined;
      expect(got?.TbInvocationPerforming.fixedOb).toBe(4);
    });

    it("RemoveInvocation despawns the entity", async () => {
      const r = await dispatch(
        setup,
        RemoveInvocation({ invocationId: setup.invocationId }),
        true,
      );
      expect(r.result.ok).toBe(true);
      expect(setup.world.has(setup.invocationId)).toBe(false);
    });
  });
});

/* -------------------------------------------------------------------------
 * Catalog-data sanity tests — guard against typos and drift in the
 * generated invocation data.
 * ----------------------------------------------------------------------- */

describe("parseRelicSlotOptions", () => {
  it("parses a simple worn slot", () => {
    expect(parseRelicSlotOptions("worn/neck")).toEqual({ neck: 1 });
  });
  it("parses a slot with explicit count", () => {
    expect(parseRelicSlotOptions("worn/torso 2")).toEqual({ torso: 2 });
  });
  it("parses 'X or Y' alternatives", () => {
    expect(parseRelicSlotOptions("worn/head or pack 1")).toEqual({
      head: 1,
      pack: 1,
    });
  });
  it("parses a comma+'or' compound (pocket form)", () => {
    expect(
      parseRelicSlotOptions("pocket, worn/neck or worn/hands 1"),
    ).toEqual({ pocket: 1, neck: 1, hands: 1 });
  });
  it("collapses 'wielded' onto 'carried'", () => {
    expect(
      parseRelicSlotOptions("carried 1, belt 1; wielded 1"),
    ).toEqual({ carried: 1, belt: 1 });
  });
  it("maps 'raiment' onto torso", () => {
    expect(parseRelicSlotOptions("raiment")).toEqual({ torso: 1 });
  });
  it("strips unknown parentheticals (tattoo) leaving just the slot", () => {
    expect(parseRelicSlotOptions("worn (tattoo)")).toEqual({});
  });
  it("treats 'inventory as weapon' as carried", () => {
    expect(parseRelicSlotOptions("inventory as weapon")).toEqual({
      carried: 1,
    });
  });
  it("parses 'hand/carried 1' as carried", () => {
    expect(parseRelicSlotOptions("hand/carried 1")).toEqual({ carried: 1 });
  });
  it("returns empty for empty input", () => {
    expect(parseRelicSlotOptions("")).toEqual({});
  });
});

describe("TB_INVOCATION_TEMPLATES catalog", () => {
  it("contains both theurge and shaman traditions", () => {
    const traditions = new Set<string>();
    for (const t of TB_INVOCATION_TEMPLATES) {
      for (const tr of t.traditions) traditions.add(tr);
    }
    expect(traditions.has("theurge")).toBe(true);
    expect(traditions.has("shaman")).toBe(true);
  });

  it("every entry has unique id", () => {
    const ids = new Set<string>();
    for (const t of TB_INVOCATION_TEMPLATES) ids.add(t.id);
    expect(ids.size).toBe(TB_INVOCATION_TEMPLATES.length);
  });

  it("includes the canonical Bone Knitter (theurge p.209)", () => {
    const bk = TB_INVOCATION_TEMPLATES.find(
      (t) => t.id === "tb/invocation/theurge/bone-knitter",
    );
    expect(bk).toBeDefined();
    expect(bk!.circle).toBe(1);
    expect(bk!.performing.ritualKind).toBe("fixed");
    expect(bk!.performing.fixedOb).toBe(3);
  });

  it("includes the canonical Frenzy of the Lord of Beasts (shaman p.45)", () => {
    const f = TB_INVOCATION_TEMPLATES.find(
      (t) => t.id === "tb/invocation/shaman/frenzy-of-the-lord-of-beasts",
    );
    expect(f).toBeDefined();
    expect(f!.performing.ritualKind).toBe("versus");
    expect(f!.performing.immortalBurden.noRelic).toBe(3);
    expect(f!.performing.immortalBurden.withRelic).toBe(2);
  });
});
