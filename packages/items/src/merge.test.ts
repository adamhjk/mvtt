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
import { Registry, World } from "@vtt/substrate";
import {
  ItemCatalogIndex,
  ItemDerivedFrom,
  ItemIdentity,
  runCatalogMerge,
  type CatalogTemplate,
} from "./shared/index.js";
import { items } from "./manifest.js";

const PLUGIN = "@vtt/test-system";

describe("runCatalogMerge", () => {
  let registry: Registry;
  let world: World;

  beforeEach(() => {
    registry = new Registry();
    registry.load(items);
    registry.validate();
    world = new World();
  });

  function templates(): CatalogTemplate[] {
    return [
      {
        templateId: "test/sword",
        traits: { ItemIdentity: { name: "Sword", description: "" } },
      },
      {
        templateId: "test/bow",
        traits: { ItemIdentity: { name: "Bow", description: "" } },
      },
    ];
  }

  it("first run spawns one entity per template plus a catalog index sentinel", () => {
    runCatalogMerge({ world, registry, pluginName: PLUGIN, templates: templates() });
    const items_ = world.query([ItemIdentity]);
    expect(items_).toHaveLength(2);
    const indexes = world.query([ItemCatalogIndex]);
    expect(indexes).toHaveLength(1);
    const idx = indexes[0]!.values.ItemCatalogIndex as {
      pluginName: string;
      entries: Record<string, string>;
    };
    expect(idx.pluginName).toBe(PLUGIN);
    expect(Object.keys(idx.entries).sort()).toEqual(["test/bow", "test/sword"]);
    for (const item of items_) {
      const derived = world.get(item.id, [ItemDerivedFrom]) as {
        ItemDerivedFrom: { templateId: string; overrides: string[] };
      };
      expect(derived.ItemDerivedFrom.templateId).toMatch(/^test\//);
      expect(derived.ItemDerivedFrom.overrides).toEqual([]);
    }
  });

  it("re-running with the same templates is a no-op (idempotent)", () => {
    runCatalogMerge({ world, registry, pluginName: PLUGIN, templates: templates() });
    const beforeIds = new Set(world.query([ItemIdentity]).map((r) => r.id));
    runCatalogMerge({ world, registry, pluginName: PLUGIN, templates: templates() });
    const afterIds = new Set(world.query([ItemIdentity]).map((r) => r.id));
    expect(afterIds).toEqual(beforeIds);
  });

  it("template change without override flows into the entity", () => {
    runCatalogMerge({ world, registry, pluginName: PLUGIN, templates: templates() });
    const swordId = findEntityByTemplate(world, "test/sword");
    runCatalogMerge({
      world,
      registry,
      pluginName: PLUGIN,
      templates: [
        {
          templateId: "test/sword",
          traits: { ItemIdentity: { name: "Longsword", description: "" } },
        },
        {
          templateId: "test/bow",
          traits: { ItemIdentity: { name: "Bow", description: "" } },
        },
      ],
    });
    const ident = world.get(swordId, [ItemIdentity]) as { ItemIdentity: { name: string } };
    expect(ident.ItemIdentity.name).toBe("Longsword");
  });

  it("override on a field is preserved across re-seed", () => {
    runCatalogMerge({ world, registry, pluginName: PLUGIN, templates: templates() });
    const swordId = findEntityByTemplate(world, "test/sword");
    // Manually set an override (simulates EditItemField having run).
    world.set(swordId, ItemIdentity, {
      name: "Mythril Sword",
      description: "GM-customized",
      img: "",
    });
    const derived = world.get(swordId, [ItemDerivedFrom]) as {
      ItemDerivedFrom: { templateId: string; pluginName: string; overrides: string[] };
    };
    world.set(swordId, ItemDerivedFrom, {
      ...derived.ItemDerivedFrom,
      overrides: ["ItemIdentity.name", "ItemIdentity.description"],
    });

    // Catalog ships an updated name; should NOT clobber override.
    runCatalogMerge({
      world,
      registry,
      pluginName: PLUGIN,
      templates: [
        {
          templateId: "test/sword",
          traits: { ItemIdentity: { name: "Longsword", description: "from-template" } },
        },
        {
          templateId: "test/bow",
          traits: { ItemIdentity: { name: "Bow", description: "" } },
        },
      ],
    });
    const ident = world.get(swordId, [ItemIdentity]) as { ItemIdentity: { name: string; description: string } };
    expect(ident.ItemIdentity.name).toBe("Mythril Sword");
    expect(ident.ItemIdentity.description).toBe("GM-customized");
  });

  it("template removed upstream marks entity deprecated but does not delete", () => {
    runCatalogMerge({ world, registry, pluginName: PLUGIN, templates: templates() });
    const bowId = findEntityByTemplate(world, "test/bow");
    runCatalogMerge({
      world,
      registry,
      pluginName: PLUGIN,
      templates: [
        {
          templateId: "test/sword",
          traits: { ItemIdentity: { name: "Sword", description: "" } },
        },
      ],
    });
    expect(world.has(bowId)).toBe(true);
    const derived = world.get(bowId, [ItemDerivedFrom]) as {
      ItemDerivedFrom: { deprecated?: boolean };
    };
    expect(derived.ItemDerivedFrom.deprecated).toBe(true);
  });

  it("a re-introduced template clears the deprecated flag", () => {
    runCatalogMerge({ world, registry, pluginName: PLUGIN, templates: templates() });
    const bowId = findEntityByTemplate(world, "test/bow");
    // Deprecate.
    runCatalogMerge({
      world,
      registry,
      pluginName: PLUGIN,
      templates: [
        {
          templateId: "test/sword",
          traits: { ItemIdentity: { name: "Sword", description: "" } },
        },
      ],
    });
    // Restore.
    runCatalogMerge({ world, registry, pluginName: PLUGIN, templates: templates() });
    const derived = world.get(bowId, [ItemDerivedFrom]) as {
      ItemDerivedFrom: { deprecated?: boolean };
    };
    expect(derived.ItemDerivedFrom.deprecated).toBe(false);
  });

  it("rejects unknown trait short-names in the template bag", () => {
    expect(() =>
      runCatalogMerge({
        world,
        registry,
        pluginName: PLUGIN,
        templates: [
          {
            templateId: "test/junk",
            traits: { NotARealTrait: { foo: 1 } },
          },
        ],
      }),
    ).toThrow(/unknown trait/);
  });

  it("two plugins can have separate catalog indexes in the same world", () => {
    runCatalogMerge({ world, registry, pluginName: PLUGIN, templates: templates() });
    runCatalogMerge({
      world,
      registry,
      pluginName: "@vtt/other-system",
      templates: [
        {
          templateId: "other/orb",
          traits: { ItemIdentity: { name: "Orb", description: "" } },
        },
      ],
    });
    const indexes = world.query([ItemCatalogIndex]).map(
      (r) => (r.values.ItemCatalogIndex as { pluginName: string }).pluginName,
    );
    expect(new Set(indexes)).toEqual(new Set([PLUGIN, "@vtt/other-system"]));
    expect(world.query([ItemIdentity])).toHaveLength(3);
  });
});

function findEntityByTemplate(world: World, templateId: string): string {
  for (const row of world.query([ItemDerivedFrom])) {
    const v = row.values.ItemDerivedFrom as { templateId: string };
    if (v.templateId === templateId) return row.id;
  }
  throw new Error(`no entity with templateId ${templateId}`);
}
