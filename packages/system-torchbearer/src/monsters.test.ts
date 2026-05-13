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
  definePlugin,
  EventBus,
  Registry,
  World,
} from "@vtt/substrate";
import { items } from "@vtt/items";
import { Character, Team } from "@vtt/characters/shared";
import { Permissions } from "@vtt/permissions/shared";
import { ItemCatalogIndex, ItemIdentity } from "@vtt/items/shared";
import {
  Conditions,
  CreateBlankMonster,
  CreateMonsterFromCatalog,
  Heroic,
  MonsterCreated,
  MonsterRemoved,
  MonsterTemplate,
  RawAbilities,
  RemoveMonster,
  TbConflictResource,
  TbMonster,
  TbMonsterDerivedFrom,
  TbMonsterSpecialRules,
  TbMonsterWeapons,
  TownAbilities,
  // Arcane traits — needed by the test plugin since the seed now
  // also runs the arcane catalog merge.
  SpellCatalogIndex,
  SpellDerivedFrom,
  SpellIdentity,
  TbScroll,
  TbSpellBook,
  TbSpellCasting,
  TbSpellLearning,
  // Invocation traits — the seed also runs the invocation catalog
  // merge and seeds a relic item per invocation.
  InvocationCatalogIndex,
  InvocationDerivedFrom,
  InvocationIdentity,
  TbInvocationPerforming,
  TbInvocationRelicLink,
} from "./shared/index.js";
import { TbCarries } from "./shared/items/index.js";
import {
  TbArmor,
  TbContainer,
  TbItemSlotOptions,
  TbItemSpecialRules,
  TbLiquidVessel,
  TbSkillBonuses,
  TbSupply,
  TbWeapon,
} from "./shared/items/item-traits.js";
import {
  MonsterRemovalSystem,
  MonsterSpawningSystem,
} from "./server/monster-systems.js";
import { tbSeed } from "./data/seed.js";

/**
 * Minimal plugin that registers only what the monster spawn path needs
 * (Character / Permissions / Team / TB ability + condition traits +
 * monster traits + items traits) — without dragging in the shell-
 * workbench / comms / resolution / notes pages and chat fills the
 * full TB manifest carries.
 */
const monstersTestPlugin = definePlugin({
  name: "@vtt/system-torchbearer-monsters-test",
  version: "0",
  dependsOn: ["@vtt/items@^0"],
  gameSystem: true,
  traits: [
    Character,
    Permissions,
    Team,
    Conditions,
    Heroic,
    RawAbilities,
    TownAbilities,
    TbArmor,
    TbCarries,
    TbConflictResource,
    TbContainer,
    TbLiquidVessel,
    TbItemSlotOptions,
    TbItemSpecialRules,
    TbMonster,
    TbMonsterDerivedFrom,
    TbMonsterSpecialRules,
    TbMonsterWeapons,
    TbSkillBonuses,
    TbSupply,
    TbWeapon,
    // Arcane catalog targets — the seed under test now also seeds
    // spellbooks and scrolls, so the registry needs their traits.
    SpellIdentity,
    TbSpellCasting,
    TbSpellLearning,
    SpellDerivedFrom,
    SpellCatalogIndex,
    TbSpellBook,
    TbScroll,
    // Invocation catalog targets — the seed also seeds invocation
    // entities and a relic item per invocation, both of which need
    // their traits registered.
    InvocationIdentity,
    TbInvocationPerforming,
    InvocationDerivedFrom,
    InvocationCatalogIndex,
    TbInvocationRelicLink,
  ],
  events: [MonsterCreated, MonsterRemoved],
  commands: [CreateBlankMonster, CreateMonsterFromCatalog, RemoveMonster],
  systems: [MonsterSpawningSystem, MonsterRemovalSystem],
});

interface Setup {
  registry: Registry;
  world: World;
  pipeline: CommandPipeline;
}

const GM_USER = "gm-1";
const PLAYER_USER = "p-1";

function makeSetup(): Setup {
  const registry = new Registry();
  registry.load(items);
  registry.load(monstersTestPlugin);
  registry.validate();
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  return { registry, world, pipeline };
}

type AnyCmd = Parameters<CommandPipeline["dispatch"]>[0]["cmd"];

function dispatchAsGm(
  s: Setup,
  cmd: AnyCmd,
  id = "c1",
): ReturnType<CommandPipeline["dispatch"]> {
  return s.pipeline.dispatch({
    id,
    issuedBy: GM_USER,
    issuedAt: 0,
    cmd,
    session: {
      userId: GM_USER,
      email: "gm@test.dev",
      role: "gm",
      name: "GM",
    },
  });
}

function dispatchAsPlayer(
  s: Setup,
  cmd: AnyCmd,
  id = "c1",
): ReturnType<CommandPipeline["dispatch"]> {
  return s.pipeline.dispatch({
    id,
    issuedBy: PLAYER_USER,
    issuedAt: 0,
    cmd,
    session: {
      userId: PLAYER_USER,
      email: "player@test.dev",
      role: "player",
      name: "Player",
    },
  });
}

describe("@vtt/system-torchbearer monsters", () => {
  let setup: Setup;
  beforeEach(() => {
    setup = makeSetup();
  });

  describe("CreateMonsterFromCatalog (Vampire Lord)", () => {
    it("rejects from non-GM session", async () => {
      const res = await dispatchAsPlayer(
        setup,
        CreateMonsterFromCatalog({ templateId: "tb/monster/vampire-lord" }),
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects unknown template ids", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateMonsterFromCatalog({ templateId: "tb/monster/does-not-exist" }),
      );
      expect(res.result.ok).toBe(false);
    });

    it("spawns a Vampire Lord with the canonical SG p.261 stat block", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateMonsterFromCatalog({ templateId: "tb/monster/vampire-lord" }),
      );
      expect(res.result.ok).toBe(true);
      const monsters = setup.world.query([Character, TbMonster]);
      expect(monsters).toHaveLength(1);
      const monsterId = monsters[0]!.id;
      const character = setup.world.get(monsterId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      expect(character?.Character.name).toBe("Vampire Lord");
      const team = setup.world.get(monsterId, [Team]) as
        | { Team: { kind: string } }
        | undefined;
      expect(team?.Team.kind).toBe("enemy");
      const monster = setup.world.get(monsterId, [TbMonster]) as
        | {
            TbMonster: {
              type: string;
              instinct: string;
              armorDescription: string;
              dispositions: { conflictType: string; value: number }[];
              pageRef: { canonicalId: string; page: number } | null;
            };
          }
        | undefined;
      expect(monster?.TbMonster.type).toBe("undead");
      // Catalog spawns ship empty prose — the sheet shows the
      // BookCitation deep-link, not paraphrased rulebook text.
      expect(monster?.TbMonster.instinct).toBe("");
      expect(monster?.TbMonster.armorDescription).toBe("");
      expect(monster?.TbMonster.pageRef).toEqual({
        canonicalId: "tb/book/loremasters-manual",
        page: 261,
      });
      expect(monster?.TbMonster.dispositions).toEqual(
        expect.arrayContaining([
          { conflictType: "kill", value: 17 },
          { conflictType: "capture", value: 10 },
          { conflictType: "convince", value: 6 },
        ]),
      );
      const abilities = setup.world.get(monsterId, [RawAbilities]) as
        | { RawAbilities: { nature: { rating: number; descriptors: string[] } } }
        | undefined;
      expect(abilities?.RawAbilities.nature.rating).toBe(7);
      expect(abilities?.RawAbilities.nature.descriptors).toEqual([
        "Hunting",
        "Scheming",
        "Subjugating",
      ]);
      const town = setup.world.get(monsterId, [TownAbilities]) as
        | { TownAbilities: { might: number; precedence: number } }
        | undefined;
      expect(town?.TownAbilities.might).toBe(5);
      expect(town?.TownAbilities.precedence).toBe(4);
      const rules = setup.world.get(monsterId, [TbMonsterSpecialRules]) as
        | {
            TbMonsterSpecialRules: {
              entries: {
                name: string;
                text: string;
                pageRef: { canonicalId: string; page: number } | null;
              }[];
            };
          }
        | undefined;
      expect(rules?.TbMonsterSpecialRules.entries.map((r) => r.name)).toEqual([
        "Dominant mind",
        "Shapeshifter",
        "Vampirism",
        "Night walker",
        "Vulnerabilities",
      ]);
      // Every canon special rule deep-links to its rulebook page; the
      // body is empty (the sheet shows the citation, not the prose).
      for (const r of rules!.TbMonsterSpecialRules.entries) {
        expect(r.text).toBe("");
        expect(r.pageRef).toEqual({
          canonicalId: "tb/book/loremasters-manual",
          page: 261,
        });
      }
      const weapons = setup.world.get(monsterId, [TbMonsterWeapons]) as
        | {
            TbMonsterWeapons: {
              entries: {
                name: string;
                conflicts: string[];
                bonuses: { attack: { type: string; value: number } };
              }[];
            };
          }
        | undefined;
      expect(weapons?.TbMonsterWeapons.entries.map((w) => w.name)).toEqual([
        "Hideous Bite",
        "Monstrous Fortitude",
        "Cloak of Shadow",
        "Terrifying Visage",
        "Air of Nobility",
        "Inhuman Alacrity",
        "Predatory Senses",
      ]);
      const hideousBite = weapons!.TbMonsterWeapons.entries[0]!;
      expect(hideousBite.bonuses.attack).toEqual({ type: "success", value: 1 });
      expect(hideousBite.conflicts).toEqual(
        expect.arrayContaining(["kill", "capture", "driveOff"]),
      );
      const derived = setup.world.get(monsterId, [TbMonsterDerivedFrom]) as
        | { TbMonsterDerivedFrom: { templateId: string; overrides: string[] } }
        | undefined;
      expect(derived?.TbMonsterDerivedFrom.templateId).toBe("tb/monster/vampire-lord");
    });

    it("Black Dragon (SG p.179) — numeric stats and citations match the printed stat block", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateMonsterFromCatalog({ templateId: "tb/monster/black-dragon" }),
      );
      expect(res.result.ok).toBe(true);
      const monsterId = setup.world.query([Character, TbMonster])[0]!.id;
      const monster = setup.world.get(monsterId, [TbMonster]) as
        | {
            TbMonster: {
              type: string;
              dispositions: { conflictType: string; value: number }[];
              pageRef: { canonicalId: string; page: number } | null;
            };
          }
        | undefined;
      expect(monster?.TbMonster.type).toBe("dragon");
      expect(monster?.TbMonster.pageRef).toEqual({
        canonicalId: "tb/book/scholars-guide",
        page: 179,
      });
      expect(monster?.TbMonster.dispositions).toEqual(
        expect.arrayContaining([
          { conflictType: "capture", value: 20 },
          { conflictType: "kill", value: 11 },
          { conflictType: "driveOff", value: 7 },
        ]),
      );
      const abilities = setup.world.get(monsterId, [RawAbilities]) as
        | { RawAbilities: { nature: { rating: number } } }
        | undefined;
      expect(abilities?.RawAbilities.nature.rating).toBe(9);
      const town = setup.world.get(monsterId, [TownAbilities]) as
        | { TownAbilities: { might: number; precedence: number } }
        | undefined;
      expect(town?.TownAbilities.might).toBe(6);
      expect(town?.TownAbilities.precedence).toBe(6);
    });

    it("Goblin (SG p.187) — citation deep-links the SG and weapon table is preserved", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateMonsterFromCatalog({ templateId: "tb/monster/goblin" }),
      );
      expect(res.result.ok).toBe(true);
      const monsterId = setup.world.query([Character, TbMonster])[0]!.id;
      const monster = setup.world.get(monsterId, [TbMonster]) as
        | { TbMonster: { pageRef: { canonicalId: string; page: number } | null } }
        | undefined;
      expect(monster?.TbMonster.pageRef).toEqual({
        canonicalId: "tb/book/scholars-guide",
        page: 187,
      });
      const weapons = setup.world.get(monsterId, [TbMonsterWeapons]) as
        | {
            TbMonsterWeapons: {
              entries: ReadonlyArray<{ name: string; conflicts: string[] }>;
            };
          }
        | undefined;
      // Short Sword applies to all three of kill/capture/driveOff
      // (printed K, Cap, D/O row).
      const shortSword = weapons!.TbMonsterWeapons.entries.find(
        (w) => w.name === "Short Sword",
      );
      expect(shortSword).toBeDefined();
      expect(shortSword!.conflicts).toEqual(
        expect.arrayContaining(["kill", "capture", "driveOff"]),
      );
      const rules = setup.world.get(monsterId, [TbMonsterSpecialRules]) as
        | {
            TbMonsterSpecialRules: {
              entries: ReadonlyArray<{
                name: string;
                pageRef: { canonicalId: string; page: number } | null;
              }>;
            };
          }
        | undefined;
      expect(rules!.TbMonsterSpecialRules.entries.map((r) => r.name)).toEqual([
        "Dark sight",
        "Enemy of the sun",
        "Pointy ends",
        "Czar",
      ]);
      for (const r of rules!.TbMonsterSpecialRules.entries) {
        expect(r.pageRef).toEqual({
          canonicalId: "tb/book/scholars-guide",
          page: 187,
        });
      }
    });

    it("Aptrgangr (LMM p.246) — opens the catalog into the LMM book", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateMonsterFromCatalog({ templateId: "tb/monster/aptrgangr" }),
      );
      expect(res.result.ok).toBe(true);
      const monsterId = setup.world.query([Character, TbMonster])[0]!.id;
      const monster = setup.world.get(monsterId, [TbMonster]) as
        | {
            TbMonster: {
              type: string;
              pageRef: { canonicalId: string; page: number } | null;
            };
          }
        | undefined;
      expect(monster?.TbMonster.type).toBe("undead");
      expect(monster?.TbMonster.pageRef).toEqual({
        canonicalId: "tb/book/loremasters-manual",
        page: 246,
      });
    });

    it("equips the catalog armor when the items catalog has been seeded", async () => {
      // Seed the items catalog first so the byrnie entity exists.
      tbSeed({ world: setup.world, registry: setup.registry });
      const indexEntities = setup.world.query([ItemCatalogIndex]);
      const byrnieEntries = (
        indexEntities[0]!.values.ItemCatalogIndex as {
          entries: Record<string, string>;
        }
      ).entries;
      const byrnieId = byrnieEntries["tb/armor/byrnie-6801c4"];
      expect(byrnieId).toBeTruthy();

      const res = await dispatchAsGm(
        setup,
        CreateMonsterFromCatalog({ templateId: "tb/monster/vampire-lord" }),
      );
      expect(res.result.ok).toBe(true);

      // Filter out MonsterTemplate entities (added by tbSeed) so we
      // find the freshly spawned instance, not a catalog template.
      const monsterId = setup.world
        .query([Character, TbMonster])
        .filter((r) => !setup.world.get(r.id, [MonsterTemplate]))[0]!.id;
      const carries = setup.world.get(monsterId, [TbCarries]) as
        | { TbCarries: { entries: { itemId: string; slot: string }[] } }
        | undefined;
      // Armor + one entry per monstrous weapon (Vampire Lord has 7).
      const armorEntries = carries?.TbCarries.entries.filter(
        (e) => e.slot === "torso",
      );
      expect(armorEntries).toHaveLength(1);
      expect(armorEntries![0]!.itemId).toBe(byrnieId);
      const weaponEntries = carries?.TbCarries.entries.filter((e) =>
        e.slot.startsWith("loose:"),
      );
      expect(weaponEntries).toHaveLength(7);
    });

    it("each spawned monstrous weapon is a real item entity with the right TbWeapon + TbConflictResource", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateMonsterFromCatalog({ templateId: "tb/monster/vampire-lord" }),
      );
      expect(res.result.ok).toBe(true);
      const monsterId = setup.world.query([Character, TbMonster])[0]!.id;
      const carries = setup.world.get(monsterId, [TbCarries]) as
        | { TbCarries: { entries: { itemId: string; slot: string }[] } }
        | undefined;
      const weaponEntries = carries!.TbCarries.entries.filter((e) =>
        e.slot.startsWith("loose:"),
      );
      // Pick the first weapon entry (Hideous Bite, +1s Attack).
      const hideousBiteId = weaponEntries[0]!.itemId;
      const ident = setup.world.get(hideousBiteId as never, [ItemIdentity]) as
        | { ItemIdentity: { name: string } }
        | undefined;
      expect(ident?.ItemIdentity.name).toBe("Hideous Bite");
      const wpn = setup.world.get(hideousBiteId as never, [TbWeapon]) as
        | {
            TbWeapon: {
              wield: number;
              conflictBonuses: {
                attack: { type: string; value: number };
              };
            };
          }
        | undefined;
      expect(wpn?.TbWeapon.conflictBonuses.attack).toEqual({
        type: "success",
        value: 1,
      });
      const cr = setup.world.get(hideousBiteId as never, [
        TbConflictResource,
      ]) as
        | {
            TbConflictResource: {
              applicableConflicts: string[];
              kind: string;
            };
          }
        | undefined;
      expect(cr?.TbConflictResource.kind).toBe("weapon");
      expect(cr?.TbConflictResource.applicableConflicts).toEqual(
        expect.arrayContaining(["kill", "capture", "driveOff"]),
      );
    });

    it("spawns weapon item entities (one per monstrous weapon) without the armor when the items catalog isn't seeded", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateMonsterFromCatalog({ templateId: "tb/monster/vampire-lord" }),
      );
      expect(res.result.ok).toBe(true);
      const monsterId = setup.world.query([Character, TbMonster])[0]!.id;
      // TbCarries now exists because of the weapon entries — but no
      // armor entry (the byrnie wasn't resolvable from an empty
      // catalog index).
      const carries = setup.world.get(monsterId, [TbCarries]) as
        | { TbCarries: { entries: { itemId: string; slot: string }[] } }
        | undefined;
      expect(carries).toBeDefined();
      const torsoEntries = carries!.TbCarries.entries.filter(
        (e) => e.slot === "torso",
      );
      expect(torsoEntries).toHaveLength(0);
      const looseEntries = carries!.TbCarries.entries.filter((e) =>
        e.slot.startsWith("loose:"),
      );
      expect(looseEntries).toHaveLength(7);
    });
  });

  describe("CreateBlankMonster", () => {
    it("spawns a minimal monster the GM can edit later", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateBlankMonster({ name: "Cinderclaw" }),
      );
      expect(res.result.ok).toBe(true);
      const monsterId = setup.world.query([Character, TbMonster])[0]!.id;
      const character = setup.world.get(monsterId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      expect(character?.Character.name).toBe("Cinderclaw");
      const monster = setup.world.get(monsterId, [TbMonster]) as
        | {
            TbMonster: {
              dispositions: unknown[];
              pageRef: unknown;
              instinct: string;
              armorDescription: string;
            };
          }
        | undefined;
      expect(monster?.TbMonster.dispositions).toEqual([]);
      // Homebrew monsters carry no rulebook reference; the GM is free
      // to fill in instinct / armorDescription / special-rule bodies
      // by hand without ever seeing a BookCitation.
      expect(monster?.TbMonster.pageRef).toBeNull();
      expect(monster?.TbMonster.instinct).toBe("");
      expect(monster?.TbMonster.armorDescription).toBe("");
      // No TbMonsterDerivedFrom on a blank monster — it didn't come
      // from a template.
      const derived = setup.world.get(monsterId, [TbMonsterDerivedFrom]);
      expect(derived).toBeUndefined();
    });

    it("rejects from non-GM session", async () => {
      const res = await dispatchAsPlayer(
        setup,
        CreateBlankMonster({ name: "Cinderclaw" }),
      );
      expect(res.result.ok).toBe(false);
    });
  });

  describe("Nature rolling", () => {
    it("invokes NatureCheck against a freshly-spawned Vampire Lord", async () => {
      const { invokeRollable } = await import("@vtt/substrate");
      // NatureCheck has its own input shape; we don't load the system
      // plugin (and thus NatureCheck) into the slim monster test
      // plugin. Re-run a fuller-stack registry just for this roll
      // assertion: import the rollable directly + register the
      // resolution-side traits its compute reads.
      const { NatureCheck } = await import("./shared/rollables.js");
      const { Heroic, RawAbilities, Conditions } = await import(
        "./shared/traits.js"
      );
      const { Character: _Char, Team: _Team } = await import(
        "@vtt/characters/shared"
      );
      void _Char;
      void _Team;
      const { definePlugin: dp } = await import("@vtt/substrate");
      const { RequestRoll } = await import("@vtt/resolution/shared");
      const richSetup = (() => {
        const reg = new Registry();
        reg.load(items);
        reg.load(
          dp({
            name: "@vtt/system-torchbearer-monsters-test-roll",
            version: "0",
            dependsOn: ["@vtt/items@^0"],
            gameSystem: true,
            traits: [
              Conditions,
              Heroic,
              RawAbilities,
              ...monstersTestPlugin.traits,
            ].filter(
              (t, i, arr) => arr.findIndex((x) => x.name === t.name) === i,
            ),
            events: monstersTestPlugin.events,
            commands: [...monstersTestPlugin.commands, RequestRoll],
            systems: monstersTestPlugin.systems,
            rollables: [NatureCheck],
          }),
        );
        reg.validate();
        const w = new World();
        const b = new EventBus();
        const p = new CommandPipeline(reg, w, b);
        return { registry: reg, world: w, pipeline: p };
      })();

      await dispatchAsGm(
        richSetup,
        CreateMonsterFromCatalog({ templateId: "tb/monster/vampire-lord" }),
      );
      const monsterId = richSetup.world.query([Character, TbMonster])[0]!.id;
      const result = invokeRollable(
        NatureCheck,
        richSetup.world,
        monsterId,
      );
      // Non-null means every input trait resolved (Heroic added by
      // the spawn system; the rest by the monster traits). The
      // pending-roll panel uses the same input-resolution path, so
      // this is the load-bearing check for "GMs can click Roll
      // Nature on a fresh monster sheet".
      expect(result).not.toBeNull();
      expect(result!.command).toBeDefined();
    });

    it("monster disposition rolls add Nature, full pool by default (within Nature)", async () => {
      const { invokeRollable } = await import("@vtt/substrate");
      const { NatureCheck } = await import("./shared/rollables.js");
      const { definePlugin: dp } = await import("@vtt/substrate");
      const { RequestRoll } = await import("@vtt/resolution/shared");

      const reg = new Registry();
      reg.load(items);
      reg.load(
        dp({
          name: "@vtt/system-torchbearer-monsters-test-dispo",
          version: "0",
          dependsOn: ["@vtt/items@^0"],
          gameSystem: true,
          traits: monstersTestPlugin.traits,
          events: monstersTestPlugin.events,
          commands: [...monstersTestPlugin.commands, RequestRoll],
          systems: monstersTestPlugin.systems,
          rollables: [NatureCheck],
        }),
      );
      reg.validate();
      const w = new World();
      const b = new EventBus();
      const p = new CommandPipeline(reg, w, b);
      const richSetup = { registry: reg, world: w, pipeline: p };

      await dispatchAsGm(
        richSetup,
        CreateMonsterFromCatalog({ templateId: "tb/monster/vampire-lord" }),
      );
      const monsterId = richSetup.world.query([Character, TbMonster])[0]!.id;

      // Within Nature (default): full pool of 7, dispoBase = 7.
      const within = invokeRollable(NatureCheck, richSetup.world, monsterId, {
        dispositionMode: true,
      });
      expect(within).not.toBeNull();
      const withinSpec = within!.spec as {
        pool: { dice: ReadonlyArray<unknown> }[] | unknown[];
        dispoAddTo?: string;
        dispoBase?: number;
        dispoMonsterPool?: string;
      };
      expect(withinSpec.dispoAddTo).toBe("nature");
      expect(withinSpec.dispoBase).toBe(7);
      expect(withinSpec.dispoMonsterPool).toBe("within");

      // Outside Nature: pool is half (ceil(7/2) = 4); dispoBase still 7.
      const outside = invokeRollable(NatureCheck, richSetup.world, monsterId, {
        dispositionMode: true,
        dispositionPool: "outside",
      });
      const outsideSpec = outside!.spec as {
        dispoAddTo?: string;
        dispoBase?: number;
        dispoMonsterPool?: string;
      };
      expect(outsideSpec.dispoAddTo).toBe("nature");
      expect(outsideSpec.dispoBase).toBe(7);
      expect(outsideSpec.dispoMonsterPool).toBe("outside");
    });
  });

  describe("RemoveMonster", () => {
    it("despawns a previously-created monster", async () => {
      await dispatchAsGm(
        setup,
        CreateMonsterFromCatalog({ templateId: "tb/monster/vampire-lord" }),
      );
      const monsterId = setup.world.query([Character, TbMonster])[0]!.id;
      const res = await dispatchAsGm(
        setup,
        RemoveMonster({ monsterId }),
        "c2",
      );
      expect(res.result.ok).toBe(true);
      expect(setup.world.has(monsterId)).toBe(false);
    });
  });
});
