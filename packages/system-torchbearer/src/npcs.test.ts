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
import { ItemCatalogIndex, ItemIdentity } from "@vtt/items/shared";
import { Character, Team } from "@vtt/characters/shared";
import { Permissions } from "@vtt/permissions/shared";
import {
  CharacterTraits,
  Conditions,
  CreateBlankNpc,
  CreateNpcFromCatalog,
  Heroic,
  Identity,
  NpcCreated,
  NpcRemoved,
  Pools,
  RawAbilities,
  RemoveNpc,
  Skills,
  TbNpc,
  TbNpcDerivedFrom,
  NpcTemplate,
  TownAbilities,
  WhatYouFightFor,
  Wises,
} from "./shared/index.js";
import {
  NpcRemovalSystem,
  NpcSpawningSystem,
} from "./server/npc-systems.js";
import { TbCarries } from "./shared/items/index.js";
import {
  TbArmor,
  TbContainer,
  TbItemSlotOptions,
  TbItemSpecialRules,
  TbSkillBonuses,
  TbSupply,
  TbWeapon,
} from "./shared/items/item-traits.js";
import {
  // Arcane traits — the seed merges spellbooks / scrolls / spell
  // entities through the items catalog, so the registry needs them
  // even though the NPC system doesn't write them itself.
  SpellCatalogIndex,
  SpellDerivedFrom,
  SpellIdentity,
  TbScroll,
  TbSpellBook,
  TbSpellCasting,
  TbSpellLearning,
  // Invocation traits — the seed also seeds invocation entities and
  // a relic item per invocation.
  InvocationCatalogIndex,
  InvocationDerivedFrom,
  InvocationIdentity,
  TbInvocationPerforming,
  TbInvocationRelicLink,
  TbConflictResource,
} from "./shared/index.js";
import { tbSeed } from "./data/seed.js";

/**
 * Minimal plugin that registers only what the NPC spawn path needs —
 * Character / Identity / Permissions / Team / TB ability + condition
 * traits + Skills/Wises/CharacterTraits/Heroic/Pools/WhatYouFightFor +
 * NPC traits. Avoids dragging in shell-workbench / comms / resolution
 * the full TB manifest carries.
 */
const npcsTestPlugin = definePlugin({
  name: "@vtt/system-torchbearer-npcs-test",
  version: "0",
  // The NPC spawn path resolves catalog gear via ItemCatalogIndex,
  // and the spawn system writes onto TbCarries — so the test plugin
  // depends on @vtt/items + the TB-side item traits (TbWeapon,
  // TbArmor, TbCarries, …) being loaded.
  dependsOn: ["@vtt/items@^0"],
  gameSystem: true,
  traits: [
    Character,
    Identity,
    Permissions,
    Team,
    Conditions,
    Heroic,
    Pools,
    WhatYouFightFor,
    RawAbilities,
    TownAbilities,
    Skills,
    Wises,
    CharacterTraits,
    TbCarries,
    TbArmor,
    TbContainer,
    TbItemSlotOptions,
    TbItemSpecialRules,
    TbSkillBonuses,
    TbSupply,
    TbWeapon,
    SpellIdentity,
    TbSpellCasting,
    TbSpellLearning,
    SpellDerivedFrom,
    SpellCatalogIndex,
    TbSpellBook,
    TbScroll,
    InvocationIdentity,
    TbInvocationPerforming,
    InvocationDerivedFrom,
    InvocationCatalogIndex,
    TbInvocationRelicLink,
    TbConflictResource,
    TbNpc,
    TbNpcDerivedFrom,
  ],
  events: [NpcCreated, NpcRemoved],
  commands: [CreateBlankNpc, CreateNpcFromCatalog, RemoveNpc],
  systems: [NpcSpawningSystem, NpcRemovalSystem],
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
  registry.load(npcsTestPlugin);
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

describe("@vtt/system-torchbearer NPCs", () => {
  let setup: Setup;
  beforeEach(() => {
    setup = makeSetup();
  });

  describe("CreateNpcFromCatalog", () => {
    it("rejects from non-GM session", async () => {
      const res = await dispatchAsPlayer(
        setup,
        CreateNpcFromCatalog({ templateId: "tb/npc/alchemist" }),
      );
      expect(res.result.ok).toBe(false);
    });

    it("rejects unknown template ids", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateNpcFromCatalog({ templateId: "tb/npc/does-not-exist" }),
      );
      expect(res.result.ok).toBe(false);
    });

    it("spawns an Alchemist with the canonical SG p.201 stat block", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateNpcFromCatalog({ templateId: "tb/npc/alchemist" }),
      );
      expect(res.result.ok).toBe(true);
      const npcs = setup.world.query([Character, TbNpc]);
      expect(npcs).toHaveLength(1);
      const npcId = npcs[0]!.id;
      const character = setup.world.get(npcId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      expect(character?.Character.name).toBe("Alchemist");
      const team = setup.world.get(npcId, [Team]) as
        | { Team: { kind: string } }
        | undefined;
      // NPCs default to enemy; the GM flips on the sheet for friendlies.
      expect(team?.Team.kind).toBe("enemy");
      const npc = setup.world.get(npcId, [TbNpc]) as
        | {
            TbNpc: {
              role: string;
              description: string;
              gear: string[];
              pageRef: { canonicalId: string; page: number } | null;
            };
          }
        | undefined;
      expect(npc?.TbNpc.role).toBe("Alchemist");
      // Catalog spawns ship empty prose — the sheet shows the
      // BookCitation deep-link, not paraphrased rulebook text.
      expect(npc?.TbNpc.description).toBe("");
      expect(npc?.TbNpc.pageRef).toEqual({
        canonicalId: "tb/book/scholars-guide",
        page: 201,
      });
      const abilities = setup.world.get(npcId, [RawAbilities]) as
        | {
            RawAbilities: {
              will: { rating: number };
              health: { rating: number };
              nature: { rating: number; descriptors: string[] };
            };
          }
        | undefined;
      expect(abilities?.RawAbilities.will.rating).toBe(6);
      expect(abilities?.RawAbilities.health.rating).toBe(3);
      expect(abilities?.RawAbilities.nature.rating).toBe(2);
      const town = setup.world.get(npcId, [TownAbilities]) as
        | {
            TownAbilities: {
              resources: { rating: number };
              circles: { rating: number };
              might: number;
              precedence: number;
            };
          }
        | undefined;
      expect(town?.TownAbilities.resources.rating).toBe(5);
      expect(town?.TownAbilities.circles.rating).toBe(4);
      expect(town?.TownAbilities.might).toBe(2);
      expect(town?.TownAbilities.precedence).toBe(1);

      const skills = setup.world.get(npcId, [Skills]) as
        | { Skills: { entries: Record<string, { rating: number }> } }
        | undefined;
      expect(skills?.Skills.entries.alchemist?.rating).toBe(5);
      expect(skills?.Skills.entries.healer?.rating).toBe(3);
      expect(skills?.Skills.entries.loreMaster?.rating).toBe(2);
      // Skills not on the catalog row are zeroed.
      expect(skills?.Skills.entries.fighter?.rating).toBe(0);

      const wises = setup.world.get(npcId, [Wises]) as
        | { Wises: { entries: Array<{ name: string }> } }
        | undefined;
      expect(wises?.Wises.entries.map((w) => w.name)).toEqual([
        "Chemistry-wise",
        "Herb-wise",
      ]);

      const traits = setup.world.get(npcId, [CharacterTraits]) as
        | {
            CharacterTraits: {
              entries: Array<{ name: string; level: number }>;
            };
          }
        | undefined;
      expect(traits?.CharacterTraits.entries).toEqual([
        expect.objectContaining({ name: "Curious", level: 2 }),
        expect.objectContaining({ name: "Wise", level: 2 }),
      ]);

      const derived = setup.world.get(npcId, [TbNpcDerivedFrom]) as
        | { TbNpcDerivedFrom: { templateId: string; overrides: string[] } }
        | undefined;
      expect(derived?.TbNpcDerivedFrom.templateId).toBe("tb/npc/alchemist");
    });

    it("Bandit (SG p.202) — fighter/scout/manipulator NPC carries the right skills", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateNpcFromCatalog({ templateId: "tb/npc/bandit" }),
      );
      expect(res.result.ok).toBe(true);
      const npcId = setup.world.query([Character, TbNpc])[0]!.id;
      const skills = setup.world.get(npcId, [Skills]) as
        | { Skills: { entries: Record<string, { rating: number }> } }
        | undefined;
      expect(skills?.Skills.entries.scout?.rating).toBe(4);
      expect(skills?.Skills.entries.fighter?.rating).toBe(3);
      expect(skills?.Skills.entries.manipulator?.rating).toBe(3);
      expect(skills?.Skills.entries.hunter?.rating).toBe(2);
    });

    it("Beronin (SG p.262) — named personality whose printed gear becomes equipped catalog items", async () => {
      // Seed the items catalog first so the gear template ids resolve.
      tbSeed({ world: setup.world, registry: setup.registry });
      const res = await dispatchAsGm(
        setup,
        CreateNpcFromCatalog({ templateId: "tb/npc/beronin-bandit-chief" }),
      );
      expect(res.result.ok).toBe(true);
      // Filter out NpcTemplate entities (added by tbSeed) so we find
      // the freshly spawned instance, not a catalog template.
      const npcId = setup.world
        .query([Character, TbNpc])
        .filter((r) => !setup.world.get(r.id, [NpcTemplate]))[0]!.id;
      const character = setup.world.get(npcId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      expect(character?.Character.name).toBe("Beronin");
      const npc = setup.world.get(npcId, [TbNpc]) as
        | { TbNpc: { role: string } }
        | undefined;
      expect(npc?.TbNpc.role).toBe("Bandit Chief, Dwarf");
      // Printed gear line — leather armor, helmet, sword, dagger —
      // becomes real catalog item entities equipped onto TbCarries.
      // This is the load-bearing check that NPC gear surfaces in
      // conflict (the conflict weapon picker reads TbCarries).
      const carries = setup.world.get(npcId, [TbCarries]) as
        | { TbCarries: { entries: Array<{ slot: string; itemId: string }> } }
        | undefined;
      expect(carries).toBeDefined();
      const carriedNames = carries!.TbCarries.entries.map((e) => {
        const ident = setup.world.get(e.itemId as never, [ItemIdentity]) as
          | { ItemIdentity: { name: string } }
          | undefined;
        return ident?.ItemIdentity.name ?? "?";
      });
      expect(carriedNames).toEqual(
        expect.arrayContaining(["Leather Armor", "Helmet", "Sword", "Dagger"]),
      );
      const skills = setup.world.get(npcId, [Skills]) as
        | { Skills: { entries: Record<string, { rating: number }> } }
        | undefined;
      // Beronin's signature: Fighter 5 (vs the standard Bandit's 3).
      expect(skills?.Skills.entries.fighter?.rating).toBe(5);
    });

    it("Soldier — chain + spear + shield equipped onto TbCarries from the catalog", async () => {
      tbSeed({ world: setup.world, registry: setup.registry });
      const res = await dispatchAsGm(
        setup,
        CreateNpcFromCatalog({ templateId: "tb/npc/soldier" }),
      );
      expect(res.result.ok).toBe(true);
      const npcId = setup.world
        .query([Character, TbNpc])
        .filter((r) => !setup.world.get(r.id, [NpcTemplate]))[0]!.id;
      const carries = setup.world.get(npcId, [TbCarries]) as
        | { TbCarries: { entries: Array<{ slot: string; itemId: string }> } }
        | undefined;
      expect(carries).toBeDefined();
      // Each carry entry's item is a real TbWeapon or TbArmor entity.
      const equipped = carries!.TbCarries.entries.map((e) => {
        const ident = setup.world.get(e.itemId as never, [ItemIdentity]) as
          | { ItemIdentity: { name: string } }
          | undefined;
        return { slot: e.slot, name: ident?.ItemIdentity.name ?? "?" };
      });
      expect(equipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ slot: "torso", name: "Chain Armor" }),
          expect.objectContaining({ slot: "head", name: "Helmet" }),
          expect.objectContaining({ slot: "handR", name: "Spear" }),
          expect.objectContaining({ slot: "handL", name: "Shield" }),
        ]),
      );
    });

    it("Alchemist — no printed gear, no TbCarries trait", async () => {
      tbSeed({ world: setup.world, registry: setup.registry });
      const res = await dispatchAsGm(
        setup,
        CreateNpcFromCatalog({ templateId: "tb/npc/alchemist" }),
      );
      expect(res.result.ok).toBe(true);
      const npcId = setup.world
        .query([Character, TbNpc])
        .filter((r) => !setup.world.get(r.id, [NpcTemplate]))[0]!.id;
      // Empty gear list ⇒ no TbCarries trait. The sheet's GearSection
      // renders the "no gear equipped" empty state.
      const carries = setup.world.get(npcId, [TbCarries]);
      expect(carries).toBeUndefined();
    });

    it("Soldier with no items catalog seeded — gear is silently dropped, no crash", async () => {
      // Same lenient policy as the monster spawn path: if the items
      // catalog isn't seeded yet (race during world boot), the spawn
      // proceeds without the gear entries — the GM can equip later.
      const res = await dispatchAsGm(
        setup,
        CreateNpcFromCatalog({ templateId: "tb/npc/soldier" }),
      );
      expect(res.result.ok).toBe(true);
      const npcId = setup.world.query([Character, TbNpc])[0]!.id;
      const carries = setup.world.get(npcId, [TbCarries]);
      expect(carries).toBeUndefined();
    });

    it("Smith (SG p.209) — uses the SG-extended Smith skill", async () => {
      // The Smith craft is in LORE_MASTER_SKILLS with id "smith".
      const res = await dispatchAsGm(
        setup,
        CreateNpcFromCatalog({ templateId: "tb/npc/smith" }),
      );
      expect(res.result.ok).toBe(true);
      const npcId = setup.world.query([Character, TbNpc])[0]!.id;
      const skills = setup.world.get(npcId, [Skills]) as
        | { Skills: { entries: Record<string, { rating: number }> } }
        | undefined;
      expect(skills?.Skills.entries.smith?.rating).toBe(5);
    });

    it("Beekeeper (SG p.202) — uses the NPC-only Beekeeper skill", async () => {
      // Beekeeper is one of the six NPC-only crafts the SG denizens
      // chapter introduces (the joke skills).
      const res = await dispatchAsGm(
        setup,
        CreateNpcFromCatalog({ templateId: "tb/npc/beekeeper" }),
      );
      expect(res.result.ok).toBe(true);
      const npcId = setup.world.query([Character, TbNpc])[0]!.id;
      const skills = setup.world.get(npcId, [Skills]) as
        | { Skills: { entries: Record<string, { rating: number }> } }
        | undefined;
      expect(skills?.Skills.entries.beekeeper?.rating).toBe(5);
      expect(skills?.Skills.entries.brewer?.rating).toBe(2);
    });

    it("Noble (SG p.207) — uses the Popinjay NPC-only skill", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateNpcFromCatalog({ templateId: "tb/npc/noble" }),
      );
      expect(res.result.ok).toBe(true);
      const npcId = setup.world.query([Character, TbNpc])[0]!.id;
      const skills = setup.world.get(npcId, [Skills]) as
        | { Skills: { entries: Record<string, { rating: number }> } }
        | undefined;
      expect(skills?.Skills.entries.popinjay?.rating).toBe(5);
    });

    it("`name` override replaces the printed role on this instance", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateNpcFromCatalog({
          templateId: "tb/npc/bandit",
          name: "Bran the Bold",
        }),
      );
      expect(res.result.ok).toBe(true);
      const npcId = setup.world.query([Character, TbNpc])[0]!.id;
      const character = setup.world.get(npcId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      expect(character?.Character.name).toBe("Bran the Bold");
      const npc = setup.world.get(npcId, [TbNpc]) as
        | { TbNpc: { role: string } }
        | undefined;
      // Role still reads "Bandit" (the printed denizen label) — only
      // the display name is overridden.
      expect(npc?.TbNpc.role).toBe("Bandit");
    });
  });

  describe("CreateBlankNpc", () => {
    it("spawns a minimal NPC the GM can edit later", async () => {
      const res = await dispatchAsGm(
        setup,
        CreateBlankNpc({ name: "Old Bran" }),
      );
      expect(res.result.ok).toBe(true);
      const npcId = setup.world.query([Character, TbNpc])[0]!.id;
      const character = setup.world.get(npcId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      expect(character?.Character.name).toBe("Old Bran");
      const npc = setup.world.get(npcId, [TbNpc]) as
        | {
            TbNpc: {
              role: string;
              description: string;
              pageRef: unknown;
            };
          }
        | undefined;
      expect(npc?.TbNpc.role).toBe("Folk");
      expect(npc?.TbNpc.description).toBe("");
      // Homebrew NPCs carry no rulebook reference.
      expect(npc?.TbNpc.pageRef).toBeNull();
      const skills = setup.world.get(npcId, [Skills]) as
        | { Skills: { entries: Record<string, { rating: number }> } }
        | undefined;
      // Empty Skills record is still seeded with every catalog skill at
      // rating 0 — the sheet's "add skill" dropdown reads from this.
      expect(skills?.Skills.entries.fighter?.rating).toBe(0);
      // No TbNpcDerivedFrom on a blank NPC — it didn't come from a template.
      const derived = setup.world.get(npcId, [TbNpcDerivedFrom]);
      expect(derived).toBeUndefined();
    });

    it("rejects from non-GM session", async () => {
      const res = await dispatchAsPlayer(
        setup,
        CreateBlankNpc({ name: "Old Bran" }),
      );
      expect(res.result.ok).toBe(false);
    });
  });

  describe("Conflict participation surfaces", () => {
    it("an NPC carries Character + Team{enemy} so the conflict declare form lists it", async () => {
      // The conflict declare form queries `[Character, Team]` to
      // partition combatants — see ConflictPage.tsx DeclareConflictForm.
      // This test is the load-bearing check that NPCs show up there.
      await dispatchAsGm(
        setup,
        CreateNpcFromCatalog({ templateId: "tb/npc/soldier" }),
      );
      const enemyRows = setup.world
        .query([Character, Team])
        .filter(
          (r) => (r.values.Team as { kind: string }).kind === "enemy",
        );
      expect(enemyRows).toHaveLength(1);
    });
  });

  describe("Rolling against an NPC", () => {
    it("invokes WillCheck against a freshly-spawned Alchemist", async () => {
      const { invokeRollable } = await import("@vtt/substrate");
      const { WillCheck } = await import("./shared/rollables.js");
      const { definePlugin: dp } = await import("@vtt/substrate");
      const { RequestRoll } = await import("@vtt/resolution/shared");
      const richSetup = (() => {
        const reg = new Registry();
        reg.load(items);
        reg.load(
          dp({
            name: "@vtt/system-torchbearer-npcs-test-roll",
            version: "0",
            dependsOn: ["@vtt/items@^0"],
            gameSystem: true,
            traits: npcsTestPlugin.traits,
            events: npcsTestPlugin.events,
            commands: [...npcsTestPlugin.commands, RequestRoll],
            systems: npcsTestPlugin.systems,
            rollables: [WillCheck],
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
        CreateNpcFromCatalog({ templateId: "tb/npc/alchemist" }),
      );
      const npcId = richSetup.world.query([Character, TbNpc])[0]!.id;
      const result = invokeRollable(WillCheck, richSetup.world, npcId);
      // Non-null means every input trait resolved (Identity / Heroic /
      // Conditions / RawAbilities / Character) — load-bearing for "GMs
      // can click Roll Will on a fresh NPC sheet".
      expect(result).not.toBeNull();
      expect(result!.command).toBeDefined();
    });

    it("invokes SkillCheck against an NPC's rated skill (Bandit's Fighter 3)", async () => {
      const { invokeRollable } = await import("@vtt/substrate");
      const { SkillCheck } = await import("./shared/rollables.js");
      const { definePlugin: dp } = await import("@vtt/substrate");
      const { RequestRoll } = await import("@vtt/resolution/shared");
      const richSetup = (() => {
        const reg = new Registry();
        reg.load(items);
        reg.load(
          dp({
            name: "@vtt/system-torchbearer-npcs-test-skill",
            version: "0",
            dependsOn: ["@vtt/items@^0"],
            gameSystem: true,
            traits: npcsTestPlugin.traits,
            events: npcsTestPlugin.events,
            commands: [...npcsTestPlugin.commands, RequestRoll],
            systems: npcsTestPlugin.systems,
            rollables: [SkillCheck],
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
        CreateNpcFromCatalog({ templateId: "tb/npc/bandit" }),
      );
      const npcId = richSetup.world.query([Character, TbNpc])[0]!.id;
      const result = invokeRollable(SkillCheck, richSetup.world, npcId, {
        skillId: "fighter",
      });
      expect(result).not.toBeNull();
      const spec = result!.spec as { baseDice: number; sourceId: string };
      // Bandit's printed Fighter rating is 3.
      expect(spec.sourceId).toBe("fighter");
      expect(spec.baseDice).toBe(3);
    });
  });

  describe("RemoveNpc", () => {
    it("despawns a previously-created NPC", async () => {
      await dispatchAsGm(
        setup,
        CreateNpcFromCatalog({ templateId: "tb/npc/alchemist" }),
      );
      const npcId = setup.world.query([Character, TbNpc])[0]!.id;
      const res = await dispatchAsGm(
        setup,
        RemoveNpc({ npcId }),
        "c2",
      );
      expect(res.result.ok).toBe(true);
      expect(setup.world.has(npcId)).toBe(false);
    });
  });
});
