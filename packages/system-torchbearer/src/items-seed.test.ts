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
import { definePlugin, Registry, World } from "@vtt/substrate";
import { items } from "@vtt/items";
import {
  ItemCatalogIndex,
  ItemDerivedFrom,
  ItemIdentity,
} from "@vtt/items/shared";
import {
  TbArmor,
  TbCarries,
  TbContainer,
  TbItemSlotOptions,
  TbItemSpecialRules,
  TbSkillBonuses,
  TbSupply,
  TbWeapon,
  ItemPosition,
  SpellCatalogIndex,
  SpellDerivedFrom,
  SpellIdentity,
  TbScroll,
  TbSpellBook,
  TbSpellCasting,
  TbSpellLearning,
  InvocationCatalogIndex,
  InvocationDerivedFrom,
  InvocationIdentity,
  TbInvocationPerforming,
  TbInvocationRelicLink,
  EquipItem,
  MoveItem,
  SetEntryState,
  DropItem,
  PickUpItem,
  UnequipItem,
  ItemEquipped,
  ItemMoved,
  EntryStateChanged,
  ItemDropped,
  ItemPickedUp,
  ItemUnequipped,
} from "./shared/index.js";
import {
  TbEntryStateSystem,
  TbItemDropSystem,
  TbItemEquipSystem,
  TbItemMoveSystem,
  TbItemPickUpSystem,
  TbItemUnequipSystem,
} from "./server/index.js";
import { runCatalogMerge } from "@vtt/items/shared";
import { CanonicalBookCatalog } from "@vtt/books/shared";
import {
  tbSeed,
  TB_ITEM_TEMPLATES,
  TB_CANONICAL_BOOKS,
  templateToTraitBag,
} from "./data/seed.js";
import { TB_CONFLICT_RESOURCE_TEMPLATES } from "./data/tb-conflict-resources.generated.js";
import { TB_ARCANE_ITEM_TEMPLATES } from "./data/tb-arcane-items.generated.js";
import { TB_INVOCATION_TEMPLATES } from "./data/tb-invocations.generated.js";
import { TbConflictResource } from "./shared/monster-traits.js";
import type { TbItemTemplate } from "./data/catalog-types.js";

// Relics are seeded as catalog items (one per invocation that has a
// non-empty `relicName`). Match the seed's filter so the count
// remains stable as new invocations land.
const RELIC_TEMPLATE_COUNT = TB_INVOCATION_TEMPLATES.filter(
  (t) => t.performing.relicName.trim().length > 0,
).length;

const TOTAL_SEED_TEMPLATE_COUNT =
  TB_ITEM_TEMPLATES.length +
  TB_CONFLICT_RESOURCE_TEMPLATES.length +
  TB_ARCANE_ITEM_TEMPLATES.length +
  RELIC_TEMPLATE_COUNT;

// A bare-bones plugin that registers the TB items schema (so the
// merge engine can parse the catalog values) without dragging in
// the rest of the TB manifest's fills.
const tbItemsTestPlugin = definePlugin({
  name: "@vtt/system-torchbearer-seed-test",
  version: "0",
  dependsOn: ["@vtt/items@^0"],
  traits: [
    TbItemSlotOptions,
    TbWeapon,
    TbArmor,
    TbSupply,
    TbContainer,
    TbSkillBonuses,
    TbItemSpecialRules,
    TbCarries,
    TbConflictResource,
    ItemPosition,
    // Arcane catalog targets:
    SpellIdentity,
    TbSpellCasting,
    TbSpellLearning,
    SpellDerivedFrom,
    SpellCatalogIndex,
    TbSpellBook,
    TbScroll,
    // Invocation catalog targets — relic items seed alongside, with
    // a TbInvocationRelicLink back to the matching invocation.
    InvocationIdentity,
    TbInvocationPerforming,
    InvocationDerivedFrom,
    InvocationCatalogIndex,
    TbInvocationRelicLink,
  ],
  events: [
    ItemEquipped,
    ItemMoved,
    EntryStateChanged,
    ItemDropped,
    ItemPickedUp,
    ItemUnequipped,
  ],
  commands: [
    EquipItem,
    MoveItem,
    SetEntryState,
    DropItem,
    PickUpItem,
    UnequipItem,
  ],
  systems: [
    TbItemEquipSystem,
    TbItemMoveSystem,
    TbEntryStateSystem,
    TbItemDropSystem,
    TbItemPickUpSystem,
    TbItemUnequipSystem,
  ],
  gameSystem: true,
});

describe("TB items catalog → seed", () => {
  function buildRegistry(): Registry {
    const r = new Registry();
    r.load(items);
    r.load(tbItemsTestPlugin);
    r.validate();
    return r;
  }

  it("the generated catalog has hundreds of templates and every category", () => {
    expect(TB_ITEM_TEMPLATES.length).toBeGreaterThan(200);
    const cats = new Set(TB_ITEM_TEMPLATES.map((t) => t.category));
    expect(cats.has("armor")).toBe(true);
    expect(cats.has("weapons")).toBe(true);
    expect(cats.has("containers")).toBe(true);
    expect(cats.has("equipment")).toBe(true);
    expect(cats.has("light-sources")).toBe(true);
    expect(cats.has("magic-items")).toBe(true);
  });

  it("every template has a non-empty name and stable id", () => {
    const ids = new Set<string>();
    for (const t of TB_ITEM_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.id).toMatch(/^tb\//);
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });

  it("every template's traits parse against the registered schemas", () => {
    const registry = buildRegistry();
    for (const t of TB_ITEM_TEMPLATES) {
      const bag = templateToTraitBag(t);
      for (const [shortName, value] of Object.entries(bag)) {
        let def: import("@vtt/substrate").TraitMeta | null = null;
        for (const candidate of registry.traits.values()) {
          if (candidate.name.split("/").pop() === shortName) {
            def = candidate;
            break;
          }
        }
        expect(def, `trait ${shortName} (template ${t.id})`).not.toBeNull();
        expect(() => def!.schema.parse(value)).not.toThrow();
      }
    }
  });

  it("seed runs idempotently and converges on the same entity count", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    const firstCount = world.query([ItemDerivedFrom]).length;
    expect(firstCount).toBe(TOTAL_SEED_TEMPLATE_COUNT);
    tbSeed({ world, registry });
    const secondCount = world.query([ItemDerivedFrom]).length;
    expect(secondCount).toBe(firstCount);
  });

  it("seed tags every catalog entity with the right pluginName + templateId", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    const indexEntities = world.query([ItemCatalogIndex]);
    expect(indexEntities).toHaveLength(1);
    const idx = indexEntities[0]!.values.ItemCatalogIndex as {
      pluginName: string;
      entries: Record<string, string>;
    };
    expect(idx.pluginName).toBe("@vtt/system-torchbearer");
    expect(Object.keys(idx.entries)).toHaveLength(TOTAL_SEED_TEMPLATE_COUNT);
    // Every template id maps to a real entity with the matching ItemDerivedFrom.
    for (const t of TB_ITEM_TEMPLATES.slice(0, 5)) {
      const eid = idx.entries[t.id];
      expect(eid).toBeDefined();
      const got = world.get(eid as never, [ItemDerivedFrom]) as {
        ItemDerivedFrom: { templateId: string; pluginName: string };
      };
      expect(got.ItemDerivedFrom.templateId).toBe(t.id);
      expect(got.ItemDerivedFrom.pluginName).toBe("@vtt/system-torchbearer");
    }
  });

  it("seed registers the canonical TB2 book ids in a CanonicalBookCatalog sentinel", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    const sentinels = world.query([CanonicalBookCatalog]);
    expect(sentinels).toHaveLength(1);
    const v = sentinels[0]!.values.CanonicalBookCatalog as {
      pluginName: string;
      entries: ReadonlyArray<{ id: string; name: string }>;
    };
    expect(v.pluginName).toBe("@vtt/system-torchbearer");
    expect(v.entries.map((e) => e.id)).toEqual([
      "tb/book/scholars-guide",
      "tb/book/loremasters-manual",
      "tb/book/dungeoneers-handbook",
    ]);
    expect(v.entries.map((e) => e.name)).toEqual(
      TB_CANONICAL_BOOKS.map((b) => b.name),
    );
  });

  it("re-running the seed leaves the canonical book sentinel unchanged (idempotent)", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    tbSeed({ world, registry });
    const sentinels = world.query([CanonicalBookCatalog]);
    expect(sentinels).toHaveLength(1);
  });

  it("upstream change to a template's name flows into the entity (no override)", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });

    // Pick the first template, find its entity.
    const target = TB_ITEM_TEMPLATES[0]!;
    const idx = world.query([ItemCatalogIndex])[0]!.values.ItemCatalogIndex as {
      entries: Record<string, string>;
    };
    const eid = idx.entries[target.id]!;

    // Simulate a "next-deploy" template tweak by running the merge
    // engine with an altered template list.
    const modified = TB_ITEM_TEMPLATES.map((t): TbItemTemplate =>
      t.id === target.id ? { ...t, name: t.name + " (Reforged)" } : t,
    );
    runCatalogMerge({
      world,
      registry,
      pluginName: "@vtt/system-torchbearer",
      templates: modified.map((t) => ({
        templateId: t.id,
        traits: templateToTraitBag(t),
      })),
    });

    const ident = world.get(eid as never, [ItemIdentity]) as {
      ItemIdentity: { name: string };
    };
    expect(ident.ItemIdentity.name).toBe(target.name + " (Reforged)");
  });
});
