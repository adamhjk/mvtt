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
} from "@vtt/substrate";
import {
  CreateItem,
  CustomizeItem,
  DestroyItem,
  EditItemField,
  ItemDerivedFrom,
  ItemEconomics,
  ItemIdentity,
  LockItemField,
  RevertItemField,
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
      expect(() =>
        ItemEconomics({ value: { dice: -1, negotiated: false } } as never),
      ).toThrow();
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
