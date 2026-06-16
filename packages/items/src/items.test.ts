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
import { CommandPipeline, EventBus, Registry, World } from "@vtt/substrate";
import {
  CreateItem,
  CustomizeItem,
  DestroyItem,
  EditItemField,
  ItemBundle,
  ItemDerivedFrom,
  ItemEconomics,
  ItemIdentity,
  JoinItemBundles,
  LockItemField,
  RemoveItemTrait,
  RevertItemField,
  SetItemTrait,
  SplitItemBundle,
  runCatalogMerge,
} from "./shared/index.js";
import { items } from "./manifest.js";

describe("@vtt/items", () => {
  let registry: Registry;
  let world: World;
  let bus: EventBus;
  let pipeline: CommandPipeline;

  beforeEach(() => {
    registry = new Registry();
    registry.load(items);
    registry.validate();
    world = new World();
    bus = new EventBus();
    pipeline = new CommandPipeline(registry, world, bus);
  });

  describe("schema validation", () => {
    it("ItemIdentity rejects empty name", () => {
      expect(() => ItemIdentity({ name: "" } as never)).toThrow();
    });
    it("ItemIdentity accepts a minimal identity", () => {
      const v = ItemIdentity({ name: "Sword" });
      expect(v.value.name).toBe("Sword");
      expect(v.value.description).toBe("");
      expect(v.value.img).toBe("");
    });
    it("ItemDerivedFrom defaults overrides to empty", () => {
      const v = ItemDerivedFrom({ templateId: "tb/sword", pluginName: "@vtt/system-torchbearer" });
      expect(v.value.overrides).toEqual([]);
    });
    it("ItemEconomics treasure value rejects negative dice", () => {
      expect(() => ItemEconomics({ value: { dice: -1, negotiated: false } } as never)).toThrow();
    });
  });

  describe("CreateItem", () => {
    it("spawns an entity with the supplied traits, parsed against schemas", async () => {
      const res = await pipeline.dispatch({
        id: "c1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: {
            ItemIdentity: { name: "Custom Sword", description: "ad-hoc" },
          },
        }),
      });
      expect(res.result.ok).toBe(true);
      const rows = world.query([ItemIdentity]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.values.ItemIdentity).toMatchObject({
        name: "Custom Sword",
        description: "ad-hoc",
      });
    });

    it("rejects unknown trait short-names at validate-time", async () => {
      const res = await pipeline.dispatch({
        id: "c2",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: { NotARealTrait: { foo: 1 } },
        }),
      });
      expect(res.result.ok).toBe(false);
    });
  });

  describe("CustomizeItem (fork-on-write)", () => {
    it("clones every shareable trait onto a fresh entity id", async () => {
      const create = await pipeline.dispatch({
        id: "c1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: {
            ItemIdentity: { name: "Sword", description: "blade" },
            ItemEconomics: { cost: 3 },
          },
        }),
      });
      expect(create.result.ok).toBe(true);
      const sourceId = world.query([ItemIdentity])[0]!.id;

      const fork = await pipeline.dispatch({
        id: "c2",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CustomizeItem({ sourceItemId: sourceId }),
      });
      expect(fork.result.ok).toBe(true);

      const ids = world.query([ItemIdentity]).map((r) => r.id);
      expect(ids).toHaveLength(2);
      const newId = ids.find((id) => id !== sourceId)!;
      const sourceIdent = world.get(sourceId, [ItemIdentity]) as { ItemIdentity: { name: string } };
      const forkIdent = world.get(newId, [ItemIdentity]) as { ItemIdentity: { name: string } };
      expect(forkIdent.ItemIdentity).toEqual(sourceIdent.ItemIdentity);
      // Edits to the fork do not affect the source.
      world.set(newId, ItemIdentity, { name: "Ulrik's Sword", description: "blade", img: "" });
      const sourceAfter = world.get(sourceId, [ItemIdentity]) as { ItemIdentity: { name: string } };
      expect(sourceAfter.ItemIdentity.name).toBe("Sword");
    });

    it("rejects forking an unknown source", async () => {
      const res = await pipeline.dispatch({
        id: "c1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CustomizeItem({ sourceItemId: "ghost" }),
      });
      expect(res.result.ok).toBe(false);
    });
  });

  describe("EditItemField", () => {
    it("writes the field through to the trait and adds the path to overrides", async () => {
      // Seed via the merge engine so the entity gets ItemDerivedFrom.
      runCatalogMerge({
        world,
        registry,
        pluginName: "@vtt/test-system",
        templates: [
          {
            templateId: "test/sword",
            traits: { ItemIdentity: { name: "Sword" } },
          },
        ],
      });
      const sourceId = world.query([ItemIdentity])[0]!.id;

      const res = await pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EditItemField({
          itemId: sourceId,
          path: "ItemIdentity.name",
          value: "Mythril Sword",
        }),
      });
      expect(res.result.ok).toBe(true);
      const ident = world.get(sourceId, [ItemIdentity]) as { ItemIdentity: { name: string } };
      expect(ident.ItemIdentity.name).toBe("Mythril Sword");
      const derived = world.get(sourceId, [ItemDerivedFrom]) as {
        ItemDerivedFrom: { overrides: string[] };
      };
      expect(derived.ItemDerivedFrom.overrides).toContain("ItemIdentity.name");
    });

    it("rejects editing an unknown item", async () => {
      const res = await pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EditItemField({
          itemId: "ghost",
          path: "ItemIdentity.name",
          value: "X",
        }),
      });
      expect(res.result.ok).toBe(false);
    });
  });

  describe("RevertItemField + LockItemField", () => {
    it("revert drops the path from overrides", async () => {
      runCatalogMerge({
        world,
        registry,
        pluginName: "@vtt/test-system",
        templates: [
          {
            templateId: "test/sword",
            traits: { ItemIdentity: { name: "Sword" } },
          },
        ],
      });
      const sourceId = world.query([ItemIdentity])[0]!.id;
      await pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EditItemField({
          itemId: sourceId,
          path: "ItemIdentity.name",
          value: "Custom",
        }),
      });
      const res = await pipeline.dispatch({
        id: "r1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: RevertItemField({
          itemId: sourceId,
          path: "ItemIdentity.name",
        }),
      });
      expect(res.result.ok).toBe(true);
      const derived = world.get(sourceId, [ItemDerivedFrom]) as {
        ItemDerivedFrom: { overrides: string[] };
      };
      expect(derived.ItemDerivedFrom.overrides).not.toContain("ItemIdentity.name");
    });

    it("lock adds an override path without changing the trait value", async () => {
      runCatalogMerge({
        world,
        registry,
        pluginName: "@vtt/test-system",
        templates: [
          {
            templateId: "test/sword",
            traits: { ItemIdentity: { name: "Sword" } },
          },
        ],
      });
      const sourceId = world.query([ItemIdentity])[0]!.id;
      const res = await pipeline.dispatch({
        id: "l1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: LockItemField({
          itemId: sourceId,
          path: "ItemIdentity.name",
        }),
      });
      expect(res.result.ok).toBe(true);
      const derived = world.get(sourceId, [ItemDerivedFrom]) as {
        ItemDerivedFrom: { overrides: string[] };
      };
      expect(derived.ItemDerivedFrom.overrides).toContain("ItemIdentity.name");
      const ident = world.get(sourceId, [ItemIdentity]) as { ItemIdentity: { name: string } };
      expect(ident.ItemIdentity.name).toBe("Sword");
    });

    it("lock rejects items that have no ItemDerivedFrom", async () => {
      await pipeline.dispatch({
        id: "c1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: { ItemIdentity: { name: "Ad hoc" } },
        }),
      });
      const sourceId = world.query([ItemIdentity])[0]!.id;
      const res = await pipeline.dispatch({
        id: "l1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: LockItemField({
          itemId: sourceId,
          path: "ItemIdentity.name",
        }),
      });
      expect(res.result.ok).toBe(false);
    });
  });

  describe("SetItemTrait + RemoveItemTrait", () => {
    it("adds a trait to an item that didn't have it", async () => {
      await pipeline.dispatch({
        id: "c1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: { ItemIdentity: { name: "Hat" } },
        }),
      });
      const itemId = world.query([ItemIdentity])[0]!.id;
      const res = await pipeline.dispatch({
        id: "s1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: SetItemTrait({
          itemId,
          traitShortName: "ItemEconomics",
          value: { cost: 3 },
        }),
      });
      expect(res.result.ok).toBe(true);
      const econ = world.get(itemId, [ItemEconomics]) as
        | { ItemEconomics: { cost?: number } }
        | undefined;
      expect(econ?.ItemEconomics.cost).toBe(3);
    });

    it("rejects an unknown trait short-name", async () => {
      await pipeline.dispatch({
        id: "c1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: { ItemIdentity: { name: "Hat" } },
        }),
      });
      const itemId = world.query([ItemIdentity])[0]!.id;
      const res = await pipeline.dispatch({
        id: "s1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: SetItemTrait({
          itemId,
          traitShortName: "NotARealTrait",
          value: {},
        }),
      });
      expect(res.result.ok).toBe(false);
    });

    it("rejects a value that fails the trait's schema", async () => {
      await pipeline.dispatch({
        id: "c1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: { ItemIdentity: { name: "Hat" } },
        }),
      });
      const itemId = world.query([ItemIdentity])[0]!.id;
      const res = await pipeline.dispatch({
        id: "s1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: SetItemTrait({
          itemId,
          traitShortName: "ItemEconomics",
          value: { cost: -1 },
        }),
      });
      expect(res.result.ok).toBe(false);
    });

    it("RemoveItemTrait strips the trait off the item", async () => {
      await pipeline.dispatch({
        id: "c1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: {
            ItemIdentity: { name: "Hat" },
            ItemEconomics: { cost: 3 },
          },
        }),
      });
      const itemId = world.query([ItemIdentity])[0]!.id;
      expect(world.get(itemId, [ItemEconomics])).toBeDefined();
      await pipeline.dispatch({
        id: "r1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: RemoveItemTrait({
          itemId,
          traitShortName: "ItemEconomics",
        }),
      });
      expect(world.get(itemId, [ItemEconomics])).toBeUndefined();
      // ItemIdentity is still there.
      expect(world.get(itemId, [ItemIdentity])).toBeDefined();
    });

    it("RemoveItemTrait drops the trait's prefix from ItemDerivedFrom.overrides", async () => {
      runCatalogMerge({
        world,
        registry,
        pluginName: "@vtt/test-system",
        templates: [
          {
            templateId: "test/sword",
            traits: {
              ItemIdentity: { name: "Sword" },
              ItemEconomics: { cost: 3 },
            },
          },
        ],
      });
      const itemId = world.query([ItemIdentity])[0]!.id;
      // Edit a field so the override path lands on the entity.
      await pipeline.dispatch({
        id: "e1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: EditItemField({
          itemId,
          path: "ItemEconomics.cost",
          value: 5,
        }),
      });
      const before = world.get(itemId, [ItemDerivedFrom]) as {
        ItemDerivedFrom: { overrides: string[] };
      };
      expect(before.ItemDerivedFrom.overrides).toContain("ItemEconomics.cost");
      await pipeline.dispatch({
        id: "r1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: RemoveItemTrait({
          itemId,
          traitShortName: "ItemEconomics",
        }),
      });
      const after = world.get(itemId, [ItemDerivedFrom]) as {
        ItemDerivedFrom: { overrides: string[] };
      };
      expect(after.ItemDerivedFrom.overrides).not.toContain("ItemEconomics.cost");
    });
  });

  describe("SplitItemBundle", () => {
    async function spawnTorchStack(count = 4): Promise<string> {
      await pipeline.dispatch({
        id: "c1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: {
            ItemIdentity: { name: "Torch" },
            ItemBundle: { count, capacity: 4 },
          },
        }),
      });
      return world.query([ItemIdentity])[0]!.id;
    }

    it("peels N units off into a new entity, decrementing the source", async () => {
      const torchId = await spawnTorchStack(4);
      const res = await pipeline.dispatch({
        id: "split1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: SplitItemBundle({ itemId: torchId, count: 1 }),
      });
      expect(res.result.ok).toBe(true);
      const src = world.get(torchId, [ItemBundle]) as {
        ItemBundle: { count: number };
      };
      expect(src.ItemBundle.count).toBe(3);
      const all = world.query([ItemBundle]).map((r) => r.id);
      expect(all.length).toBe(2);
      const newId = all.find((id) => id !== torchId)!;
      const newBundle = world.get(newId, [ItemBundle]) as {
        ItemBundle: { count: number; capacity: number };
      };
      expect(newBundle.ItemBundle.count).toBe(1);
      expect(newBundle.ItemBundle.capacity).toBe(4);
      const newIdent = world.get(newId, [ItemIdentity]) as {
        ItemIdentity: { name: string };
      };
      expect(newIdent.ItemIdentity.name).toBe("Torch");
    });

    it("rejects splits that would empty the source", async () => {
      const torchId = await spawnTorchStack(2);
      const res = await pipeline.dispatch({
        id: "split-bad",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: SplitItemBundle({ itemId: torchId, count: 2 }),
      });
      expect(res.result.ok).toBe(false);
    });

    it("rejects splits on items without ItemBundle", async () => {
      await pipeline.dispatch({
        id: "create",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: { ItemIdentity: { name: "Sword" } },
        }),
      });
      const swordId = world.query([ItemIdentity])[0]!.id;
      const res = await pipeline.dispatch({
        id: "split-bad",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: SplitItemBundle({ itemId: swordId, count: 1 }),
      });
      expect(res.result.ok).toBe(false);
    });
  });

  describe("JoinItemBundles", () => {
    async function spawnPair(opts: {
      a: { name: string; count: number; capacity: number };
      b: { name: string; count: number; capacity: number };
    }): Promise<{ aId: string; bId: string }> {
      await pipeline.dispatch({
        id: "ca",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: {
            ItemIdentity: { name: opts.a.name },
            ItemBundle: { count: opts.a.count, capacity: opts.a.capacity },
          },
        }),
      });
      await pipeline.dispatch({
        id: "cb",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: {
            ItemIdentity: { name: opts.b.name },
            ItemBundle: { count: opts.b.count, capacity: opts.b.capacity },
          },
        }),
      });
      const all = world.query([ItemIdentity]);
      const aId = all.find(
        (r) =>
          (r.values.ItemIdentity as { name: string }).name === opts.a.name &&
          (world.get(r.id, [ItemBundle]) as { ItemBundle: { count: number } }).ItemBundle.count ===
            opts.a.count,
      )!.id;
      const bId = all.find((r) => r.id !== aId)!.id;
      return { aId, bId };
    }

    it("merges fully when src fits in dest's headroom; src destroyed", async () => {
      const { aId, bId } = await spawnPair({
        a: { name: "Torch", count: 1, capacity: 4 },
        b: { name: "Torch", count: 2, capacity: 4 },
      });
      const res = await pipeline.dispatch({
        id: "join",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: JoinItemBundles({ srcId: aId, destId: bId }),
      });
      expect(res.result.ok).toBe(true);
      expect(world.has(aId)).toBe(false);
      const dest = world.get(bId, [ItemBundle]) as {
        ItemBundle: { count: number };
      };
      expect(dest.ItemBundle.count).toBe(3);
    });

    it("caps transfer at dest.capacity, leaves src remainder", async () => {
      const { aId, bId } = await spawnPair({
        a: { name: "Torch", count: 3, capacity: 4 },
        b: { name: "Torch", count: 3, capacity: 4 },
      });
      const res = await pipeline.dispatch({
        id: "join",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: JoinItemBundles({ srcId: aId, destId: bId }),
      });
      expect(res.result.ok).toBe(true);
      const dest = world.get(bId, [ItemBundle]) as {
        ItemBundle: { count: number };
      };
      const src = world.get(aId, [ItemBundle]) as {
        ItemBundle: { count: number };
      };
      expect(dest.ItemBundle.count).toBe(4);
      expect(src.ItemBundle.count).toBe(2);
      expect(world.has(aId)).toBe(true);
    });

    it("rejects joining items with different identity names", async () => {
      const { aId, bId } = await spawnPair({
        a: { name: "Torch", count: 1, capacity: 4 },
        b: { name: "Candle", count: 2, capacity: 4 },
      });
      const res = await pipeline.dispatch({
        id: "join",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: JoinItemBundles({ srcId: aId, destId: bId }),
      });
      expect(res.result.ok).toBe(false);
    });

    it("rejects joining when dest is already full", async () => {
      const { aId, bId } = await spawnPair({
        a: { name: "Torch", count: 1, capacity: 4 },
        b: { name: "Torch", count: 4, capacity: 4 },
      });
      const res = await pipeline.dispatch({
        id: "join",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: JoinItemBundles({ srcId: aId, destId: bId }),
      });
      expect(res.result.ok).toBe(false);
    });

    it("merges items with matching ItemDerivedFrom.templateId", async () => {
      // Forge two items that look like they came from the same catalog
      // template — the join should honour the templateId match even
      // though one has been customized (different cost).
      await pipeline.dispatch({
        id: "ca",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: {
            ItemIdentity: { name: "Torch" },
            ItemBundle: { count: 2, capacity: 4 },
            ItemDerivedFrom: {
              templateId: "tb/light/torch",
              pluginName: "@vtt/system-torchbearer",
            },
          },
        }),
      });
      await pipeline.dispatch({
        id: "cb",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: {
            ItemIdentity: { name: "Bright Torch" },
            ItemBundle: { count: 1, capacity: 4 },
            ItemDerivedFrom: {
              templateId: "tb/light/torch",
              pluginName: "@vtt/system-torchbearer",
            },
          },
        }),
      });
      const rows = world.query([ItemBundle]);
      const aId = rows[0]!.id;
      const bId = rows[1]!.id;
      const res = await pipeline.dispatch({
        id: "join",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: JoinItemBundles({ srcId: aId, destId: bId }),
      });
      expect(res.result.ok).toBe(true);
    });
  });

  describe("DestroyItem", () => {
    it("despawns the item entity", async () => {
      await pipeline.dispatch({
        id: "c1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: CreateItem({
          traits: { ItemIdentity: { name: "Disposable" } },
        }),
      });
      const sourceId = world.query([ItemIdentity])[0]!.id;
      const res = await pipeline.dispatch({
        id: "d1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: DestroyItem({ itemId: sourceId }),
      });
      expect(res.result.ok).toBe(true);
      expect(world.has(sourceId)).toBe(false);
    });

    it("rejects destroying an unknown item", async () => {
      const res = await pipeline.dispatch({
        id: "d1",
        issuedBy: "alice",
        issuedAt: 0,
        cmd: DestroyItem({ itemId: "ghost" }),
      });
      expect(res.result.ok).toBe(false);
    });
  });

  describe("plugin-namespaced ubiquitous-language names", () => {
    it("uses @vtt/items/ namespace for every export", () => {
      expect(ItemIdentity.name).toBe("@vtt/items/ItemIdentity");
      expect(CreateItem.name).toBe("@vtt/items/CreateItem");
      expect(CustomizeItem.name).toBe("@vtt/items/CustomizeItem");
      expect(EditItemField.name).toBe("@vtt/items/EditItemField");
    });
  });
});
