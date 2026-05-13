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
import { permissions } from "@vtt/permissions";
import { Permissions } from "@vtt/permissions/shared";
import { Character, Team } from "@vtt/characters/shared";
import { ItemCatalogIndex } from "@vtt/items/shared";
import {
  MonsterCatalogIndex,
  MonsterTemplate,
  NpcCatalogIndex,
  NpcTemplate,
  TbCarries,
  TbMonster,
  TbMonsterDerivedFrom,
  TbMonsterSpecialRules,
  TbMonsterWeapons,
  TbNpc,
  TbNpcDerivedFrom,
  // Items + spells + invocations the seed wires through:
  TbItemSlotOptions,
  TbWeapon,
  TbArmor,
  TbSupply,
  TbContainer,
  TbLiquidVessel,
  TbSkillBonuses,
  TbItemSpecialRules,
  ItemPosition,
  TbConflictResource,
  SpellCatalogIndex,
  SpellDerivedFrom,
  SpellIdentity,
  TbSpellCasting,
  TbSpellLearning,
  TbSpellBook,
  TbScroll,
  InvocationCatalogIndex,
  InvocationDerivedFrom,
  InvocationIdentity,
  TbInvocationPerforming,
  TbInvocationRelicLink,
  // Universal TB character traits:
  Conditions,
  Heroic,
  Identity,
  Pools,
  RawAbilities,
  Skills,
  TownAbilities,
  WhatYouFightFor,
  Wises,
  CharacterTraits,
} from "./shared/index.js";
import { tbSeed } from "./data/seed.js";
import { TB_MONSTER_TEMPLATES } from "./data/tb-monsters.generated.js";
import { TB_NPC_TEMPLATES } from "./data/tb-npcs.generated.js";

const PLUGIN = "@vtt/system-torchbearer";

/**
 * Stripped-down test plugin: registers every trait the seed touches
 * without dragging in the workbench / chat / notes / scene fills the
 * full systemTorchbearer manifest carries. Mirrors the items-seed test's
 * approach so the seed can be exercised in isolation.
 */
const tbSeedTestPlugin = definePlugin({
  name: "@vtt/system-torchbearer-seed-test",
  version: "0",
  dependsOn: ["@vtt/items@^0", "@vtt/permissions@^0"],
  traits: [
    // Universal character + inventory:
    Character,
    Team,
    Permissions,
    // TB common:
    Identity,
    RawAbilities,
    TownAbilities,
    Conditions,
    Heroic,
    Pools,
    WhatYouFightFor,
    Skills,
    Wises,
    CharacterTraits,
    // TB items (subtype + carries):
    TbItemSlotOptions,
    TbWeapon,
    TbArmor,
    TbSupply,
    TbContainer,
    TbLiquidVessel,
    TbSkillBonuses,
    TbItemSpecialRules,
    TbCarries,
    ItemPosition,
    TbConflictResource,
    // Spells:
    SpellIdentity,
    TbSpellCasting,
    TbSpellLearning,
    SpellDerivedFrom,
    SpellCatalogIndex,
    TbSpellBook,
    TbScroll,
    // Invocations:
    InvocationIdentity,
    TbInvocationPerforming,
    InvocationDerivedFrom,
    InvocationCatalogIndex,
    TbInvocationRelicLink,
    // Monsters:
    TbMonster,
    TbMonsterWeapons,
    TbMonsterSpecialRules,
    TbMonsterDerivedFrom,
    MonsterTemplate,
    MonsterCatalogIndex,
    // NPCs:
    TbNpc,
    TbNpcDerivedFrom,
    NpcTemplate,
    NpcCatalogIndex,
  ],
  gameSystem: true,
});

function buildRegistry(): Registry {
  const r = new Registry();
  r.load(permissions);
  r.load(items);
  r.load(tbSeedTestPlugin);
  r.validate();
  return r;
}

describe("TB monster catalog → seed", () => {
  it("seeds one entity per monster template", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    const templateRows = world.query([MonsterTemplate]);
    expect(templateRows.length).toBe(TB_MONSTER_TEMPLATES.length);
  });

  it("each seeded monster carries Character + TbMonster + TbMonsterWeapons + TbMonsterSpecialRules + TbMonsterDerivedFrom + MonsterTemplate", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    const templateRows = world.query([MonsterTemplate]);
    expect(templateRows.length).toBeGreaterThan(0);
    const sample = templateRows[0]!;
    const traits = world.get(sample.id as never, [
      Character,
      TbMonster,
      TbMonsterWeapons,
      TbMonsterSpecialRules,
      TbMonsterDerivedFrom,
      MonsterTemplate,
    ]);
    expect(traits).toBeDefined();
    expect((traits as { Character: { name: string } }).Character.name).toBeTruthy();
    expect(
      (traits as { TbMonsterDerivedFrom: { templateId: string } })
        .TbMonsterDerivedFrom.templateId,
    ).toMatch(/^tb\/monster\//);
  });

  it("MonsterCatalogIndex sentinel maps every templateId to a real entity", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    const sentinels = world.query([MonsterCatalogIndex]);
    expect(sentinels).toHaveLength(1);
    const idx = sentinels[0]!.values.MonsterCatalogIndex as {
      pluginName: string;
      entries: Record<string, string>;
    };
    expect(idx.pluginName).toBe(PLUGIN);
    for (const tmpl of TB_MONSTER_TEMPLATES) {
      const eid = idx.entries[tmpl.id];
      expect(eid).toBeDefined();
      expect(world.has(eid as never)).toBe(true);
    }
  });

  it("seed is idempotent — re-running keeps the same template entity ids", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    const firstIdx = (
      world.query([MonsterCatalogIndex])[0]!.values.MonsterCatalogIndex as {
        entries: Record<string, string>;
      }
    ).entries;
    const firstSnapshot = { ...firstIdx };
    tbSeed({ world, registry });
    const secondIdx = (
      world.query([MonsterCatalogIndex])[0]!.values.MonsterCatalogIndex as {
        entries: Record<string, string>;
      }
    ).entries;
    expect(secondIdx).toEqual(firstSnapshot);
    const templateRowsAfter = world.query([MonsterTemplate]);
    expect(templateRowsAfter.length).toBe(TB_MONSTER_TEMPLATES.length);
  });

  it("monster templates with armorItemTemplateId resolve to the seeded item entity via TbCarries", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    const itemIdx = world.query([ItemCatalogIndex])[0]!.values
      .ItemCatalogIndex as { entries: Record<string, string> };
    const monsterIdx = world.query([MonsterCatalogIndex])[0]!.values
      .MonsterCatalogIndex as { entries: Record<string, string> };
    const armoredTemplate = TB_MONSTER_TEMPLATES.find(
      (t) =>
        t.armorItemTemplateId !== null && itemIdx.entries[t.armorItemTemplateId],
    );
    if (!armoredTemplate) return; // dataset has no armored monsters? skip.
    const monsterId = monsterIdx.entries[armoredTemplate.id]!;
    const carries = world.get(monsterId as never, [TbCarries]) as
      | { TbCarries: { entries: Array<{ itemId: string; slot: string }> } }
      | undefined;
    expect(carries).toBeDefined();
    const expectedItemId = itemIdx.entries[armoredTemplate.armorItemTemplateId!];
    const armorEntry = carries!.TbCarries.entries.find(
      (e) => e.itemId === expectedItemId,
    );
    expect(armorEntry).toBeDefined();
    expect(armorEntry!.slot).toBe("torso");
  });
});

describe("TB NPC catalog → seed", () => {
  it("seeds one entity per NPC template", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    const templateRows = world.query([NpcTemplate]);
    expect(templateRows.length).toBe(TB_NPC_TEMPLATES.length);
  });

  it("each seeded NPC carries Character + TbNpc + TbNpcDerivedFrom + NpcTemplate", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    const templateRows = world.query([NpcTemplate]);
    expect(templateRows.length).toBeGreaterThan(0);
    const sample = templateRows[0]!;
    const traits = world.get(sample.id as never, [
      Character,
      TbNpc,
      TbNpcDerivedFrom,
      NpcTemplate,
    ]);
    expect(traits).toBeDefined();
    expect(
      (traits as { TbNpcDerivedFrom: { templateId: string } })
        .TbNpcDerivedFrom.templateId,
    ).toMatch(/^tb\/npc\//);
  });

  it("NpcCatalogIndex sentinel maps every templateId to a real entity", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    const sentinels = world.query([NpcCatalogIndex]);
    expect(sentinels).toHaveLength(1);
    const idx = sentinels[0]!.values.NpcCatalogIndex as {
      pluginName: string;
      entries: Record<string, string>;
    };
    expect(idx.pluginName).toBe(PLUGIN);
    for (const tmpl of TB_NPC_TEMPLATES) {
      const eid = idx.entries[tmpl.id];
      expect(eid).toBeDefined();
      expect(world.has(eid as never)).toBe(true);
    }
  });

  it("seed is idempotent — re-running keeps the same template entity ids", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    const firstIdx = (
      world.query([NpcCatalogIndex])[0]!.values.NpcCatalogIndex as {
        entries: Record<string, string>;
      }
    ).entries;
    const firstSnapshot = { ...firstIdx };
    tbSeed({ world, registry });
    const secondIdx = (
      world.query([NpcCatalogIndex])[0]!.values.NpcCatalogIndex as {
        entries: Record<string, string>;
      }
    ).entries;
    expect(secondIdx).toEqual(firstSnapshot);
  });
});

describe("TB seed cross-cutting", () => {
  it("templates and instances are distinguishable by trait composition", () => {
    const registry = buildRegistry();
    const world = new World();
    tbSeed({ world, registry });
    // Templates: Character + MonsterTemplate (from seed)
    const templates = world.query([Character, MonsterTemplate]);
    expect(templates.length).toBe(TB_MONSTER_TEMPLATES.length);
    // No characters carry MonsterTemplate AND are not seeded templates —
    // there's nothing else in the world yet, so this is a sanity check
    // that templates are exactly the seeded ones.
    for (const row of templates) {
      const got = world.get(row.id as never, [TbMonsterDerivedFrom]);
      expect(got).toBeDefined();
    }
  });
});
