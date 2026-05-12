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

import { describe, it, expect, beforeEach } from "vitest";
import {
  CommandPipeline,
  definePlugin,
  EntityId,
  EventBus,
  Registry,
  World,
} from "@vtt/substrate";
import { adventures } from "@vtt/adventures";
import {
  BlockKindsSlot,
  buildBlockKindIndex,
  LootParcel,
} from "@vtt/adventures/shared";
import { runBlockParse, blockEntityId } from "@vtt/adventures/server";
import { permissions as permissionsPlugin } from "@vtt/permissions";
import { items } from "@vtt/items";
import { Character } from "@vtt/characters/shared";
import { Page, BelongsToNote, PageBodySet, MarkdownPostRenderSlot, EditorCompletionSourcesSlot, NotesReferenceSlot } from "@vtt/notes/shared";
import {
  TbCarries,
  TbItemSlotOptions,
  TbItemSpecialRules,
  TbSkillBonuses,
  TbWeapon,
} from "./shared/index.js";
import { itemBlockKind, lootBlockKind } from "./shared/blocks/index.js";
import {
  AwardLoot,
  LootAwarded,
  LootAwardSystem,
  LootPlacedInScene,
  LootPlacementSystem,
  PlaceLootInScene,
} from "./shared/loot-commands.js";
import {
  ItemDerivedFrom,
  ItemEconomics,
  ItemIdentity,
} from "@vtt/items/shared";
import { ItemPosition } from "./shared/items/item-traits.js";

const notesStub = definePlugin({
  name: "@vtt/notes",
  version: "0.1.0",
  traits: [Page, BelongsToNote],
  events: [PageBodySet],
  slots: [MarkdownPostRenderSlot, EditorCompletionSourcesSlot, NotesReferenceSlot],
});

const charactersStub = definePlugin({
  name: "@vtt/characters",
  version: "0.1.0",
  traits: [Character],
});

const tbLootTestPlugin = definePlugin({
  name: "@vtt/system-torchbearer-loot-test",
  version: "0",
  dependsOn: [
    "@vtt/permissions@^0",
    "@vtt/items@^0",
    "@vtt/adventures@^0",
  ],
  traits: [
    TbItemSlotOptions,
    TbWeapon,
    TbItemSpecialRules,
    TbSkillBonuses,
    TbCarries,
    ItemPosition,
  ],
  events: [LootAwarded, LootPlacedInScene],
  commands: [AwardLoot, PlaceLootInScene],
  systems: [LootAwardSystem, LootPlacementSystem],
  fills: {
    [BlockKindsSlot.name]: [itemBlockKind as never, lootBlockKind as never],
  },
});

type AuthSession = {
  userId: string;
  email: string;
  name: string;
  role: "gm" | "player";
};
const gmSession: AuthSession = {
  userId: "gm",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

function setup() {
  const registry = new Registry();
  registry.load(permissionsPlugin);
  registry.load(charactersStub);
  registry.load(notesStub);
  registry.load(items);
  registry.load(adventures);
  registry.load(tbLootTestPlugin);
  registry.validate();
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  return { registry, world, bus, pipeline };
}

describe("TB loot block kind", () => {
  let registry: Registry;
  let world: World;
  let pageId: EntityId;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
    const noteId = world.spawn([]);
    pageId = world.spawn([
      Page({ title: "p", body: "", bodyRev: 0 }),
      BelongsToNote({ noteId }),
    ]);
  });

  function parse(body: string) {
    const idx = buildBlockKindIndex(registry);
    return runBlockParse(world, pageId, body, idx);
  }

  it("a loot block projects to LootParcel with items + cash + notes", () => {
    parse(
      [
        "```loot Bywater Spoils",
        "items:",
        "  - item:Serpent Ring",
        "  - 3× item:Traveling Ration",
        "cash:",
        "  copper: 14",
        "  silver: 47",
        "notes: |",
        "  Found in Skarra's pack.",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "bywater-spoils");
    const got = world.get(eid, [LootParcel]) as
      | {
          LootParcel: {
            name: string;
            items: Array<{ kind: string; body: string; quantity: number }>;
            cash: { copper: number; silver: number; gold: number };
            notes: string;
          };
        }
      | undefined;
    expect(got).toBeDefined();
    expect(got!.LootParcel.name).toBe("Bywater Spoils");
    expect(got!.LootParcel.items).toEqual([
      { kind: "item", body: "Serpent Ring", quantity: 1 },
      { kind: "item", body: "Traveling Ration", quantity: 3 },
    ]);
    expect(got!.LootParcel.cash).toEqual({ copper: 14, silver: 47, gold: 0 });
    expect(got!.LootParcel.notes).toContain("Skarra");
  });
});

describe("AwardLoot", () => {
  let registry: Registry;
  let world: World;
  let pipeline: CommandPipeline;
  let pageId: EntityId;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
    pipeline = s.pipeline;
    const noteId = world.spawn([]);
    pageId = world.spawn([
      Page({ title: "p", body: "", bodyRev: 0 }),
      BelongsToNote({ noteId }),
    ]);
  });

  function parse(body: string) {
    const idx = buildBlockKindIndex(registry);
    return runBlockParse(world, pageId, body, idx);
  }

  async function dispatch(cmd: ReturnType<typeof AwardLoot>) {
    return pipeline.dispatch({
      id: `cmd-${Math.random()}`,
      issuedBy: gmSession.userId,
      issuedAt: Date.now(),
      session: gmSession as never,
      cmd,
    });
  }

  it("awards items into the holder's TbCarries (loose: slots)", async () => {
    parse(
      [
        "```item Sword",
        "type: weapon",
        "slot: handR",
        "```",
        "",
        "```loot Test Loot",
        "items:",
        "  - 2× item:Sword",
        "```",
      ].join("\n"),
    );
    const holderId = world.spawn([Character({ name: "Player Alice" })]);
    const parcelId = blockEntityId(pageId, "test-loot");
    const res = await dispatch(AwardLoot({ parcelId, holderId }));
    expect(res.result.ok).toBe(true);
    const carries = world.get(holderId, [TbCarries]) as
      | {
          TbCarries: {
            entries: Array<{ slot: string; itemId: EntityId; quantity: number }>;
          };
        }
      | undefined;
    expect(carries).toBeDefined();
    expect(carries!.TbCarries.entries).toHaveLength(1);
    expect(carries!.TbCarries.entries[0]!.slot).toBe("loose:0");
    expect(carries!.TbCarries.entries[0]!.quantity).toBe(2);
    expect(carries!.TbCarries.entries[0]!.itemId).toBe(blockEntityId(pageId, "sword"));
  });

  it("appends to existing TbCarries instead of replacing", async () => {
    parse(["```item Knife", "type: weapon", "slot: handR", "```"].join("\n"));
    const knifeId = blockEntityId(pageId, "knife");
    const holderId = world.spawn([
      Character({ name: "Bob" }),
      TbCarries({
        entries: [
          {
            slot: "loose:0",
            slotIndex: 0,
            channel: "default" as const,
            slotsConsumed: 1,
            itemId: knifeId,
            quantity: 1,
          },
        ],
      }),
    ]);
    parse(
      [
        "```item Knife",
        "type: weapon",
        "slot: handR",
        "```",
        "",
        "```loot Reward",
        "items:",
        "  - item:Knife",
        "```",
      ].join("\n"),
    );
    const parcelId = blockEntityId(pageId, "reward");
    const res = await dispatch(AwardLoot({ parcelId, holderId }));
    expect(res.result.ok).toBe(true);
    const carries = world.get(holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<{ slot: string }> } }
      | undefined;
    expect(carries!.TbCarries.entries).toHaveLength(2);
    expect(carries!.TbCarries.entries.map((e) => e.slot)).toEqual([
      "loose:0",
      "loose:1",
    ]);
  });

  it("missing items are reported in the LootAwarded event without crashing", async () => {
    parse(
      [
        "```loot Mystery",
        "items:",
        "  - item:Nonexistent",
        "```",
      ].join("\n"),
    );
    const holderId = world.spawn([Character({ name: "Carol" })]);
    const parcelId = blockEntityId(pageId, "mystery");
    const res = await dispatch(AwardLoot({ parcelId, holderId }));
    expect(res.result.ok).toBe(true);
    const event = res.events.find((e) => e.type === LootAwarded.name)!;
    const payload = event.payload as {
      items: ReadonlyArray<unknown>;
      missing: Array<{ kind: string; body: string }>;
    };
    expect(payload.items).toHaveLength(0);
    expect(payload.missing).toEqual([{ kind: "item", body: "Nonexistent" }]);
  });

  it("rejects when not GM", async () => {
    parse(["```loot Empty", "```"].join("\n"));
    const holderId = world.spawn([Character({ name: "X" })]);
    const parcelId = blockEntityId(pageId, "empty");
    const res = await pipeline.dispatch({
      id: "cmd-x",
      issuedBy: "p",
      issuedAt: Date.now(),
      session: { ...gmSession, role: "player" } as never,
      cmd: AwardLoot({ parcelId, holderId }),
    });
    expect(res.result.ok).toBe(false);
  });

  it("rejects when parcelId doesn't carry LootParcel", async () => {
    const holderId = world.spawn([Character({ name: "X" })]);
    const fakeParcelId = world.spawn([Character({ name: "imposter" })]);
    const res = await dispatch(AwardLoot({ parcelId: fakeParcelId, holderId }));
    expect(res.result.ok).toBe(false);
  });
});

describe("loot widget action: 'Place on ground'", () => {
  let registry: Registry;
  let world: World;
  let pageId: EntityId;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
    const noteId = world.spawn([]);
    pageId = world.spawn([
      Page({ title: "p", body: "", bodyRev: 0 }),
      BelongsToNote({ noteId }),
    ]);
  });

  function parse(body: string) {
    const idx = buildBlockKindIndex(registry);
    return runBlockParse(world, pageId, body, idx);
  }

  it("the loot block kind exposes a 'Place on ground' GM-only action", () => {
    expect(lootBlockKind.actions).toBeDefined();
    const place = lootBlockKind.actions!.find((a) => a.id === "place-on-ground");
    expect(place).toBeDefined();
    expect(place!.label).toBe("Place on ground");
    expect(place!.visibility).toBe("gm");
  });

  it("invoking the action dispatches PlaceLootInScene with the active scene + (0, 0)", async () => {
    // Spawn a "scene" placeholder entity carrying the @vtt/scene/Scene
    // trait name (the loot action's firstSceneId helper queries by
    // name only — a stand-in trait is enough for the test).
    const sceneId = world.spawn([{ name: "@vtt/scene/Scene" as never, value: {} }]);
    parse(
      [
        "```item Knife",
        "type: weapon",
        "slot: handR",
        "```",
        "",
        "```loot Treasure",
        "items:",
        "  - item:Knife",
        "```",
      ].join("\n"),
    );
    const parcelId = blockEntityId(pageId, "treasure");
    const dispatched: unknown[] = [];
    const place = lootBlockKind.actions!.find((a) => a.id === "place-on-ground")!;
    await place.run({
      entityId: parcelId,
      world,
      dispatch: (cmd) => {
        dispatched.push(cmd);
        return undefined;
      },
    });
    expect(dispatched).toHaveLength(1);
    const cmd = dispatched[0] as { type: string; payload: { parcelId: EntityId; sceneId: EntityId; x: number; y: number } };
    expect(cmd.type).toBe(PlaceLootInScene.name);
    expect(cmd.payload.parcelId).toBe(parcelId);
    expect(cmd.payload.sceneId).toBe(sceneId);
    expect(cmd.payload.x).toBe(0);
    expect(cmd.payload.y).toBe(0);
  });

  it("is a no-op when no Scene exists in the world", async () => {
    parse(["```loot Empty", "```"].join("\n"));
    const parcelId = blockEntityId(pageId, "empty");
    const dispatched: unknown[] = [];
    const place = lootBlockKind.actions!.find((a) => a.id === "place-on-ground")!;
    await place.run({
      entityId: parcelId,
      world,
      dispatch: (cmd) => {
        dispatched.push(cmd);
        return undefined;
      },
    });
    expect(dispatched).toHaveLength(0);
  });
});

describe("PlaceLootInScene", () => {
  let registry: Registry;
  let world: World;
  let pipeline: CommandPipeline;
  let pageId: EntityId;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
    pipeline = s.pipeline;
    const noteId = world.spawn([]);
    pageId = world.spawn([
      Page({ title: "p", body: "", bodyRev: 0 }),
      BelongsToNote({ noteId }),
    ]);
  });

  function parse(body: string) {
    const idx = buildBlockKindIndex(registry);
    return runBlockParse(world, pageId, body, idx);
  }

  async function dispatch(cmd: ReturnType<typeof PlaceLootInScene>) {
    return pipeline.dispatch({
      id: `cmd-${Math.random()}`,
      issuedBy: gmSession.userId,
      issuedAt: Date.now(),
      session: gmSession as never,
      cmd,
    });
  }

  it("forks each item into a fresh entity at the scene position", async () => {
    parse(
      [
        "```item Gold Idol",
        "type: gear",
        "slot: pocket",
        "```",
        "",
        "```loot Treasure Pile",
        "items:",
        "  - 2× item:Gold Idol",
        "```",
      ].join("\n"),
    );
    const sceneId = world.spawn([]);
    const parcelId = blockEntityId(pageId, "treasure-pile");
    const sourceItemId = blockEntityId(pageId, "gold-idol");
    const beforeCount = world.query([ItemPosition]).length;
    const res = await dispatch(
      PlaceLootInScene({ parcelId, sceneId, x: 100, y: 200 }),
    );
    expect(res.result.ok).toBe(true);
    // The 2× translates to 1 placement entry per quantity unit? No —
    // v1 collapses each parcel item into one placement (quantity is
    // recorded but not fanned out). Adjust expectations accordingly.
    // For "Gold Idol qty 2" one fresh entity at (100, 200) is enough
    // to surface the loot pile; v2 can spawn N or join into a stack.
    const placed = world.query([ItemPosition]);
    expect(placed.length).toBe(beforeCount + 1);
    const pos = placed[placed.length - 1]!.values.ItemPosition as {
      sceneId: EntityId;
      x: number;
      y: number;
    };
    expect(pos).toEqual({ sceneId, x: 100, y: 200 });
    // The fresh entity carries the same ItemIdentity as the source.
    const ident = world.get(placed[placed.length - 1]!.id, [ItemIdentity]) as
      | { ItemIdentity: { name: string } }
      | undefined;
    expect(ident!.ItemIdentity.name).toBe("Gold Idol");
    // Source item is NOT modified (no Position on the catalog entity).
    expect(world.get(sourceItemId, [ItemPosition])).toBeUndefined();
  });

  it("ItemDerivedFrom on the placement entity points back to the source", async () => {
    parse(
      [
        "```item Knife",
        "type: weapon",
        "slot: handR",
        "```",
        "",
        "```loot K",
        "items:",
        "  - item:Knife",
        "```",
      ].join("\n"),
    );
    const sceneId = world.spawn([]);
    const parcelId = blockEntityId(pageId, "k");
    const sourceItemId = blockEntityId(pageId, "knife");
    const res = await dispatch(
      PlaceLootInScene({ parcelId, sceneId, x: 0, y: 0 }),
    );
    expect(res.result.ok).toBe(true);
    const placed = world.query([ItemPosition])[0]!;
    const derived = world.get(placed.id, [ItemDerivedFrom]) as
      | { ItemDerivedFrom: { templateId: string; pluginName: string } }
      | undefined;
    // The placement's lineage points back to the catalog template the
    // source itself was derived from (`block:Knife`) — preserves the
    // upstream-merge story end-to-end. If the source lacked
    // ItemDerivedFrom, the placement's templateId would fall back to
    // the source entity id.
    expect(derived!.ItemDerivedFrom.templateId).toBe("block:Knife");
    expect(derived!.ItemDerivedFrom.pluginName).toBe("@vtt/adventures");
    void sourceItemId;
  });

  it("missing items don't crash and are reported in the event", async () => {
    parse(
      [
        "```loot Mystery",
        "items:",
        "  - item:Nothing",
        "```",
      ].join("\n"),
    );
    const sceneId = world.spawn([]);
    const parcelId = blockEntityId(pageId, "mystery");
    const res = await dispatch(
      PlaceLootInScene({ parcelId, sceneId, x: 0, y: 0 }),
    );
    expect(res.result.ok).toBe(true);
    const event = res.events.find((e) => e.type === LootPlacedInScene.name)!;
    const payload = event.payload as {
      placements: ReadonlyArray<unknown>;
      missing: Array<{ kind: string; body: string }>;
    };
    expect(payload.placements).toHaveLength(0);
    expect(payload.missing).toEqual([{ kind: "item", body: "Nothing" }]);
  });

  it("rejects when not GM", async () => {
    parse(["```loot E", "```"].join("\n"));
    const sceneId = world.spawn([]);
    const parcelId = blockEntityId(pageId, "e");
    const res = await pipeline.dispatch({
      id: "cmd",
      issuedBy: "p",
      issuedAt: Date.now(),
      session: { ...gmSession, role: "player" } as never,
      cmd: PlaceLootInScene({ parcelId, sceneId, x: 0, y: 0 }),
    });
    expect(res.result.ok).toBe(false);
  });
});

void ItemEconomics;
