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
import { definePlugin, EntityId, Registry, World } from "@vtt/substrate";
import { adventures } from "@vtt/adventures";
import {
  BlockKindsSlot,
  buildBlockKindIndex,
} from "@vtt/adventures/shared";
import { runBlockParse, blockEntityId } from "@vtt/adventures/server";
import { Permissions } from "@vtt/permissions/shared";
import { permissions as permissionsPlugin } from "@vtt/permissions";
import { Character, Team } from "@vtt/characters/shared";
import { ItemIdentity, ItemEconomics } from "@vtt/items/shared";
import { Page, BelongsToNote, PageBodySet, MarkdownPostRenderSlot, EditorCompletionSourcesSlot, NotesReferenceSlot } from "@vtt/notes/shared";
import {
  CharacterTraits,
  Conditions,
  Heroic,
  Identity,
  MonsterTemplate,
  Pools,
  RawAbilities,
  Relics,
  Skills,
  TbMonster,
  TownAbilities,
  WhatYouFightFor,
  Wises,
} from "./shared/index.js";
import { TbCarries, TbItemSlotOptions } from "./shared/items/index.js";
import {
  characterBlockKind,
  monsterBlockKind,
} from "./shared/blocks/character.js";
import { npcBlockKind } from "./shared/blocks/npc.js";
import { TbNpc } from "./shared/npc-traits.js";
import {
  SpellIdentity,
  TbLibrary,
  TbMemoryPalace,
} from "./shared/spells/spell-traits.js";
import {
  InvocationIdentity,
  TbInvocationRelics,
} from "./shared/invocations/invocation-traits.js";

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
  traits: [Character, Team],
});

const itemsStub = definePlugin({
  name: "@vtt/items",
  version: "0.1.0",
  traits: [ItemIdentity, ItemEconomics],
});

const tbCharacterBlocksStub = definePlugin({
  name: "@vtt/system-torchbearer-character-blocks-test",
  version: "0",
  dependsOn: [
    "@vtt/permissions@^0",
    "@vtt/characters@^0",
    "@vtt/items@^0",
    "@vtt/adventures@^0",
  ],
  traits: [
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
    TbMonster,
    MonsterTemplate,
    TbCarries,
    TbItemSlotOptions,
    TbNpc,
    SpellIdentity,
    TbLibrary,
    TbMemoryPalace,
    InvocationIdentity,
    TbInvocationRelics,
    Relics,
  ],
  fills: {
    [BlockKindsSlot.name]: [
      characterBlockKind as never,
      monsterBlockKind as never,
      npcBlockKind as never,
    ],
  },
});

function setup() {
  const registry = new Registry();
  registry.load(permissionsPlugin);
  registry.load(charactersStub);
  registry.load(itemsStub);
  registry.load(notesStub);
  registry.load(adventures);
  registry.load(tbCharacterBlocksStub);
  registry.validate();
  const world = new World();
  return { registry, world };
}

describe("TB character block kind", () => {
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

  function parseBody(body: string) {
    const idx = buildBlockKindIndex(registry);
    return runBlockParse(world, pageId, body, idx);
  }

  it("a fully-specified character projects every TB stat trait", () => {
    parseBody(
      [
        "```character Greta the Smith",
        "stock: Human",
        "class: Warrior",
        "level: 3",
        "will: 4",
        "health: 5",
        "nature:",
        "  rating: 4",
        "  descriptors: [Demanding, Forging, Boasting]",
        "skills:",
        "  fighter: 4",
        "  smith: 5",
        "traits:",
        "  - { name: Stubborn, level: 1 }",
        "wises: [Forge-wise]",
        "belief: A weapon should be tested in a real fight.",
        "goal: Reach Bywater.",
        "instinct: Always check the weight.",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "greta-the-smith");
    expect(world.has(eid)).toBe(true);
    const got = world.get(eid, [
      Character,
      Identity,
      RawAbilities,
      Skills,
      Wises,
      CharacterTraits,
      WhatYouFightFor,
    ]) as
      | {
          Character: { name: string };
          Identity: { stock: string; class: string; level: number };
          RawAbilities: {
            will: { rating: number };
            health: { rating: number };
            nature: { rating: number; descriptors: string[] };
          };
          Skills: { entries: Record<string, { rating: number }> };
          Wises: { entries: Array<{ name: string }> };
          CharacterTraits: { entries: Array<{ name: string; level: number }> };
          WhatYouFightFor: { belief: string; goal: string; instinct: string };
        }
      | undefined;
    expect(got).toBeDefined();
    expect(got!.Character.name).toBe("Greta the Smith");
    expect(got!.Identity.stock).toBe("Human");
    expect(got!.Identity.class).toBe("Warrior");
    expect(got!.Identity.level).toBe(3);
    expect(got!.RawAbilities.will.rating).toBe(4);
    expect(got!.RawAbilities.nature.rating).toBe(4);
    expect(got!.Skills.entries.fighter?.rating).toBe(4);
    expect(got!.Skills.entries.smith?.rating).toBe(5);
    expect(got!.Wises.entries.map((w) => w.name)).toContain("Forge-wise");
    expect(got!.CharacterTraits.entries[0]!.name).toBe("Stubborn");
    expect(got!.WhatYouFightFor.belief).toContain("real fight");
  });

  it("Conditions and Pools are spawnIfMissing — set once, preserved on re-save", () => {
    parseBody(
      ["```character Test", "stock: Human", "will: 3", "```"].join("\n"),
    );
    const eid = blockEntityId(pageId, "test");
    // Mutate runtime state
    world.set(eid, Conditions, {
      fresh: false,
      hungryThirsty: true, // simulating mid-fight hunger
      angry: false,
      afraid: false,
      exhausted: false,
      injured: false,
      sick: false,
      dead: false,
    });
    // Re-save the block
    parseBody(
      ["```character Test", "stock: Human", "will: 4", "```"].join("\n"),
    );
    // Authored fields update
    const ra = world.get(eid, [RawAbilities]) as
      | { RawAbilities: { will: { rating: number } } }
      | undefined;
    expect(ra!.RawAbilities.will.rating).toBe(4);
    // Runtime state preserved
    const cond = world.get(eid, [Conditions]) as
      | { Conditions: { hungryThirsty: boolean } }
      | undefined;
    expect(cond!.Conditions.hungryThirsty).toBe(true);
  });

  it("a sparse character body fills in safe defaults", () => {
    parseBody(["```character Plain Folk", "```"].join("\n"));
    const eid = blockEntityId(pageId, "plain-folk");
    expect(world.has(eid)).toBe(true);
    const ra = world.get(eid, [RawAbilities]) as
      | { RawAbilities: { will: { rating: number }; nature: { rating: number } } }
      | undefined;
    expect(ra!.RawAbilities.will.rating).toBe(0);
    expect(ra!.RawAbilities.nature.rating).toBe(0);
  });

  it("permissions default to gmOnly read+write (matches NpcSpawningSystem)", () => {
    parseBody(["```character Test", "```"].join("\n"));
    const eid = blockEntityId(pageId, "test");
    const perms = world.get(eid, [Permissions]) as
      | { Permissions: { read: { kind: string; role?: string }; write: { kind: string; role?: string } } }
      | undefined;
    // gmOnly() builds a role-based visibility: { kind: "role", role: "gm" }.
    expect(perms!.Permissions.read).toMatchObject({ kind: "role", role: "gm" });
    expect(perms!.Permissions.write).toMatchObject({ kind: "role", role: "gm" });
  });

  it("carries: resolves to TbCarries entries pointing at real items", () => {
    // Seed a mace item entity the carries block can reference.
    const maceId = world.spawn([
      ItemIdentity({ name: "Mace", description: "", img: "" }),
      ItemEconomics({}),
      TbItemSlotOptions({ options: { handR: 1, handL: 1 } }),
    ]);
    parseBody(
      [
        "```character Skarra",
        "stock: Human",
        "carries:",
        "  - item: [[item:Mace]]",
        "    slot: handR",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "skarra");
    const carries = world.get(eid, [TbCarries]) as
      | {
          TbCarries: {
            entries: ReadonlyArray<{
              slot: string;
              channel: string;
              itemId: string;
              slotsConsumed: number;
              quantity: number;
            }>;
          };
        }
      | undefined;
    expect(carries).toBeDefined();
    expect(carries!.TbCarries.entries.length).toBe(1);
    const entry = carries!.TbCarries.entries[0]!;
    expect(entry.itemId).toBe(maceId);
    expect(entry.slot).toBe("handR");
    expect(entry.channel).toBe("carried");
    expect(entry.slotsConsumed).toBe(1);
    expect(entry.quantity).toBe(1);
  });

  it("carries: works without quoting the wiki-link (the YAML preprocessor handles `[[…]]`)", () => {
    const ringId = world.spawn([
      ItemIdentity({ name: "Signet Ring", description: "", img: "" }),
      ItemEconomics({}),
      TbItemSlotOptions({ options: { handR: 1, handL: 1 } }),
    ]);
    // Bare [[item:Signet Ring]] — no quotes. This would normally
    // break YAML (flow seq), but the adventures parser pre-escapes
    // wiki-links so authors don't have to quote them.
    parseBody(
      [
        "```character Test",
        "carries:",
        "  - [[item:Signet Ring]]",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "test");
    const carries = world.get(eid, [TbCarries]) as
      | { TbCarries: { entries: ReadonlyArray<{ itemId: string }> } }
      | undefined;
    expect(carries!.TbCarries.entries.length).toBe(1);
    expect(carries!.TbCarries.entries[0]!.itemId).toBe(ringId);
  });

  it("carries: alias form [[item:id|Display]] resolves to the entity id", () => {
    const swordId = world.spawn([
      ItemIdentity({ name: "Iron Sword", description: "", img: "" }),
      ItemEconomics({}),
      TbItemSlotOptions({ options: { handR: 1, handL: 1 } }),
    ]);
    parseBody(
      [
        "```character Test",
        "carries:",
        `  - [[item:${swordId}|Sword]]`,
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "test");
    const carries = world.get(eid, [TbCarries]) as
      | { TbCarries: { entries: ReadonlyArray<{ itemId: string }> } }
      | undefined;
    expect(carries!.TbCarries.entries[0]!.itemId).toBe(swordId);
  });

  it("carries: unknown item reference is skipped (rather than crashing)", () => {
    parseBody(
      [
        "```character Test",
        "carries:",
        "  - [[item:Nonexistent Sword]]",
        "  - item: [[item:Also Missing]]",
        "    slot: handR",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "test");
    const carries = world.get(eid, [TbCarries]) as
      | { TbCarries: { entries: ReadonlyArray<unknown> } }
      | undefined;
    expect(carries).toBeDefined();
    expect(carries!.TbCarries.entries.length).toBe(0);
  });

  it("spellbook / memory / invocations / urdr / burden seed the arcane traits", () => {
    // Pre-seed two spell catalog entities and one invocation so the
    // wiki-link resolver can find them at parse time.
    const wayfinderId = world.spawn([
      SpellIdentity({
        name: "Wayfinder's Friend",
        circle: 1,
        school: "Divination",
        pageRef: null,
      }),
    ]);
    const majorHealingId = world.spawn([
      SpellIdentity({
        name: "Major Healing",
        circle: 2,
        school: "Conjuration",
        pageRef: null,
      }),
    ]);
    const stoneOfStrengthId = world.spawn([
      InvocationIdentity({
        name: "Stone of Strength",
        circle: 1,
        traditions: [],
        pageRef: null,
      } as never),
    ]);
    parseBody(
      [
        "```character Iselda Theurge",
        "stock: Human",
        "class: Theurge",
        "will: 4",
        "spellbook:",
        "  - [[spell:Wayfinder's Friend]]",
        "  - [[spell:Major Healing]]",
        "memory:",
        "  - [[spell:Wayfinder's Friend]]",
        "  - [[spell:Major Healing]]",
        "invocations:",
        "  - [[invocation:Stone of Strength]]",
        "urdr: 2",
        "burden: 1",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "iselda-theurge");
    expect(world.has(eid)).toBe(true);

    const library = world.get(eid, [TbLibrary]) as
      | { TbLibrary: { spellIds: ReadonlyArray<string> } }
      | undefined;
    expect(library).toBeDefined();
    expect([...library!.TbLibrary.spellIds].sort()).toEqual(
      [wayfinderId, majorHealingId].sort(),
    );

    const palace = world.get(eid, [TbMemoryPalace]) as
      | {
          TbMemoryPalace: {
            capacity: number;
            memorized: ReadonlyArray<{
              spellId: string;
              slotsConsumed: number;
              cast: boolean;
            }>;
          };
        }
      | undefined;
    expect(palace).toBeDefined();
    // Two spells: circle 1 (Wayfinder) + circle 2 (Major Healing) = 3 slots.
    expect(palace!.TbMemoryPalace.capacity).toBe(3);
    expect(palace!.TbMemoryPalace.memorized).toHaveLength(2);
    // slotsConsumed mirrors the spell's printed circle.
    const wm = palace!.TbMemoryPalace.memorized.find(
      (m) => m.spellId === wayfinderId,
    );
    const mh = palace!.TbMemoryPalace.memorized.find(
      (m) => m.spellId === majorHealingId,
    );
    expect(wm?.slotsConsumed).toBe(1);
    expect(mh?.slotsConsumed).toBe(2);

    const inv = world.get(eid, [TbInvocationRelics]) as
      | { TbInvocationRelics: { invocationIds: ReadonlyArray<string> } }
      | undefined;
    expect(inv).toBeDefined();
    expect(inv!.TbInvocationRelics.invocationIds).toEqual([stoneOfStrengthId]);

    const relics = world.get(eid, [Relics]) as
      | { Relics: { urdr: number; burden: number } }
      | undefined;
    expect(relics).toBeDefined();
    expect(relics!.Relics.urdr).toBe(2);
    expect(relics!.Relics.burden).toBe(1);
  });

  it("palace_capacity overrides the sum-of-circles default", () => {
    world.spawn([
      SpellIdentity({
        name: "Spark",
        circle: 1,
        school: "Evocation",
        pageRef: null,
      }),
    ]);
    parseBody(
      [
        "```character Studious Wizard",
        "memory:",
        "  - [[spell:Spark]]",
        "palace_capacity: 5",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "studious-wizard");
    const palace = world.get(eid, [TbMemoryPalace]) as
      | { TbMemoryPalace: { capacity: number } }
      | undefined;
    expect(palace!.TbMemoryPalace.capacity).toBe(5);
  });

  it("unresolved spell references drop silently (no TbLibrary if every entry missed)", () => {
    parseBody(
      [
        "```character Unknown Spells",
        "spellbook:",
        "  - [[spell:Spell That Doesnt Exist]]",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "unknown-spells");
    const library = world.get(eid, [TbLibrary]);
    expect(library).toBeUndefined();
  });
});

describe("TB monster block kind", () => {
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

  function parseBody(body: string) {
    const idx = buildBlockKindIndex(registry);
    return runBlockParse(world, pageId, body, idx);
  }

  it("projects to Character + TbMonster + MonsterTemplate marker", () => {
    parseBody(
      [
        "```monster Goblin Scout",
        "type: humanoid",
        "might: 2",
        "precedence: 1",
        "nature:",
        "  rating: 3",
        "  descriptors: [Lurking, Stabbing, Stealing]",
        "disposition:",
        "  kill: 5",
        "  capture: 4",
        "  drive_off: 3",
        "instinct: Always run when outnumbered.",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "goblin-scout");
    expect(world.has(eid)).toBe(true);
    const got = world.get(eid, [
      Character,
      TbMonster,
      MonsterTemplate,
      RawAbilities,
      TownAbilities,
    ]) as
      | {
          Character: { name: string };
          TbMonster: {
            type: string;
            instinct: string;
            dispositions: Array<{ conflictType: string; value: number }>;
          };
          MonsterTemplate: Record<string, never>;
          RawAbilities: { nature: { rating: number; descriptors: string[] } };
          TownAbilities: { might: number; precedence: number };
        }
      | undefined;
    expect(got).toBeDefined();
    expect(got!.Character.name).toBe("Goblin Scout");
    expect(got!.TbMonster.type).toBe("humanoid");
    expect(got!.TbMonster.instinct).toBe("Always run when outnumbered.");
    expect(got!.TbMonster.dispositions).toEqual(
      expect.arrayContaining([
        { conflictType: "kill", value: 5 },
        { conflictType: "capture", value: 4 },
        { conflictType: "drive_off", value: 3 },
      ]),
    );
    expect(got!.RawAbilities.nature.rating).toBe(3);
    expect(got!.TownAbilities.might).toBe(2);
  });

  it("the marker MonsterTemplate distinguishes templates from instances", () => {
    parseBody(
      [
        "```monster One",
        "might: 1",
        "```",
        "",
        "```character Two",
        "stock: Human",
        "```",
      ].join("\n"),
    );
    const templates = world.query([MonsterTemplate]);
    expect(templates.length).toBe(1);
    const all = world.query([Character]);
    expect(all.length).toBe(2);
  });

  it("a sparse monster body fills in safe defaults except the required might", () => {
    parseBody(["```monster Mystery", "might: 3", "```"].join("\n"));
    const eid = blockEntityId(pageId, "mystery");
    expect(world.has(eid)).toBe(true);
    const got = world.get(eid, [TbMonster]) as
      | { TbMonster: { dispositions: ReadonlyArray<unknown>; type: string } }
      | undefined;
    expect(got!.TbMonster.type).toBe("beast");
    expect(got!.TbMonster.dispositions).toEqual([]);
  });

  it("Conditions and Pools are spawnIfMissing for monsters too — preserved on re-save", () => {
    parseBody(["```monster Goblin", "might: 2", "nature:", "  rating: 3", "```"].join("\n"));
    const eid = blockEntityId(pageId, "goblin");
    world.set(eid, Conditions, {
      fresh: false,
      hungryThirsty: false,
      angry: false,
      afraid: true,
      exhausted: false,
      injured: false,
      sick: false,
      dead: false,
    });
    parseBody(["```monster Goblin", "might: 5", "nature:", "  rating: 3", "```"].join("\n"));
    const cond = world.get(eid, [Conditions]) as
      | { Conditions: { afraid: boolean } }
      | undefined;
    expect(cond!.Conditions.afraid).toBe(true);
  });

  it("editing a monster block updates the template entity in place", () => {
    parseBody(["```monster Bear", "might: 4", "```"].join("\n"));
    const eid = blockEntityId(pageId, "bear");
    const before = (world.get(eid, [TownAbilities]) as { TownAbilities: { might: number } })
      .TownAbilities.might;
    expect(before).toBe(4);
    parseBody(["```monster Bear", "might: 5", "```"].join("\n"));
    const after = (world.get(eid, [TownAbilities]) as { TownAbilities: { might: number } })
      .TownAbilities.might;
    expect(after).toBe(5);
  });

  it("weapons: and armor: resolve to TbCarries entries with sensible slots", () => {
    // Seed item entities for the weapons + armor references.
    const clawsId = world.spawn([
      ItemIdentity({ name: "Claws", description: "", img: "" }),
      ItemEconomics({}),
      TbItemSlotOptions({ options: { handR: 1, handL: 1 } }),
    ]);
    const hideId = world.spawn([
      ItemIdentity({ name: "Thick Hide", description: "", img: "" }),
      ItemEconomics({}),
      TbItemSlotOptions({ options: { torso: 1 } }),
    ]);
    parseBody(
      [
        "```monster Wolf",
        "might: 3",
        "nature:",
        "  rating: 4",
        "weapons:",
        "  - [[item:Claws]]",
        "armor: [[item:Thick Hide]]",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "wolf");
    const carries = world.get(eid, [TbCarries]) as
      | {
          TbCarries: {
            entries: ReadonlyArray<{
              slot: string;
              channel: string;
              itemId: string;
            }>;
          };
        }
      | undefined;
    expect(carries!.TbCarries.entries.length).toBe(2);
    const byItem = new Map(
      carries!.TbCarries.entries.map((e) => [e.itemId, e]),
    );
    expect(byItem.get(clawsId)?.slot).toBe("handR"); // default-preferred hand
    expect(byItem.get(clawsId)?.channel).toBe("carried");
    expect(byItem.get(hideId)?.slot).toBe("torso");
    expect(byItem.get(hideId)?.channel).toBe("default");
  });
});

describe("TB npc block kind", () => {
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

  function parseBody(body: string) {
    const idx = buildBlockKindIndex(registry);
    return runBlockParse(world, pageId, body, idx);
  }

  it("projects to Character + TbNpc (the NPC marker)", () => {
    parseBody(
      [
        "```npc Skarra Wormtongue",
        "role: Smuggler",
        "stock: Human",
        "class: Warrior",
        "level: 4",
        "will: 2",
        "health: 5",
        "nature:",
        "  rating: 5",
        "  descriptors: [Beguiling, Slithering, Devouring]",
        "skills:",
        "  fighter: 5",
        "  persuader: 5",
        "wises: [Bywater-wise]",
        "notes: |",
        "  Lurks at the docks after dark.",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "skarra-wormtongue");
    expect(world.has(eid)).toBe(true);
    const got = world.get(eid, [Character, TbNpc, Identity, Skills]) as
      | {
          Character: { name: string };
          TbNpc: { role: string; description: string; pageRef: null };
          Identity: { stock: string; class: string };
          Skills: { entries: Record<string, { rating: number }> };
        }
      | undefined;
    expect(got).toBeDefined();
    expect(got!.Character.name).toBe("Skarra Wormtongue");
    expect(got!.TbNpc.role).toBe("Smuggler");
    expect(got!.TbNpc.description).toContain("docks after dark");
    expect(got!.TbNpc.pageRef).toBeNull();
    expect(got!.Identity.stock).toBe("Human");
    expect(got!.Skills.entries.persuader?.rating).toBe(5);
  });

  it("an npc-block carries: resolves to TbCarries entries just like character", () => {
    const maceId = world.spawn([
      ItemIdentity({ name: "Mace", description: "", img: "" }),
      ItemEconomics({}),
      TbItemSlotOptions({ options: { handR: 1, handL: 1 } }),
    ]);
    parseBody(
      [
        "```npc Skarra",
        "role: Smuggler",
        "carries:",
        "  - item: [[item:Mace]]",
        "    slot: handR",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "skarra");
    const carries = world.get(eid, [TbCarries]) as
      | { TbCarries: { entries: ReadonlyArray<{ itemId: string; slot: string }> } }
      | undefined;
    expect(carries!.TbCarries.entries.length).toBe(1);
    expect(carries!.TbCarries.entries[0]!.itemId).toBe(maceId);
    expect(carries!.TbCarries.entries[0]!.slot).toBe("handR");
  });

  it("changing the fence kind from `character` to `npc` flips PC ↔ NPC", () => {
    // First save: as a `character` (PC) — no TbNpc trait.
    parseBody(
      [
        "```character Greta",
        "# id: greta",
        "stock: Human",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "greta");
    expect(world.has(eid)).toBe(true);
    expect(world.get(eid, [TbNpc])).toBeUndefined();
    // Re-save: same id annotation, but now an `npc` block. The
    // entity should now carry TbNpc.
    parseBody(
      [
        "```npc Greta",
        "# id: greta",
        "role: Folk",
        "stock: Human",
        "```",
      ].join("\n"),
    );
    const after = world.get(eid, [TbNpc]) as
      | { TbNpc: { role: string } }
      | undefined;
    expect(after).toBeDefined();
    expect(after!.TbNpc.role).toBe("Folk");
  });

  it("a sparse npc body still gets a default role", () => {
    parseBody(["```npc Stranger", "```"].join("\n"));
    const eid = blockEntityId(pageId, "stranger");
    const got = world.get(eid, [TbNpc]) as
      | { TbNpc: { role: string } }
      | undefined;
    expect(got!.TbNpc.role).toBe("Folk");
  });

  it("populates every NPC-relevant field from the block body", () => {
    parseBody(
      [
        "```npc Skarra Wormtongue",
        "role: Smuggler",
        "team: enemy",
        "stock: Human",
        "class: Warrior",
        "level: 4",
        "age: 38",
        "home: Bywater Docks",
        "raiment: Black leathers, silver chain",
        "parents: Dead. Drowned.",
        "mentor: Cyranus the Quiet",
        "friend: Marrow the Tanner",
        "enemy: The Wharfmaster",
        "belief: A coin in hand outweighs a promise in the wind.",
        "creed: Trust the river, not the bank.",
        "goal: Move the shipment before dawn.",
        "instinct: Always slip the second knife into your boot.",
        "notes: |",
        "  Lurks at the docks after dark.",
        "  Owes a favor to [[character:Marrow the Tanner]].",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "skarra-wormtongue");
    const got = world.get(eid, [TbNpc, Identity, WhatYouFightFor, Team]) as
      | {
          TbNpc: { role: string; description: string };
          Identity: {
            stock: string;
            class: string;
            level: number;
            age: number;
            home: string;
            raiment: string;
            parents: string;
            mentor: string;
            friend: string;
            enemy: string;
          };
          WhatYouFightFor: {
            belief: string;
            creed: string;
            goal: string;
            instinct: string;
          };
          Team: { kind: string };
        }
      | undefined;
    expect(got).toBeDefined();
    expect(got!.TbNpc.role).toBe("Smuggler");
    expect(got!.TbNpc.description).toContain("Lurks at the docks");
    expect(got!.TbNpc.description).toContain("Marrow the Tanner");
    expect(got!.Team.kind).toBe("enemy");
    expect(got!.Identity.age).toBe(38);
    expect(got!.Identity.home).toBe("Bywater Docks");
    expect(got!.Identity.raiment).toContain("Black leathers");
    expect(got!.Identity.parents).toBe("Dead. Drowned.");
    expect(got!.Identity.mentor).toBe("Cyranus the Quiet");
    expect(got!.Identity.friend).toBe("Marrow the Tanner");
    expect(got!.Identity.enemy).toBe("The Wharfmaster");
    expect(got!.WhatYouFightFor.belief).toContain("coin in hand");
    expect(got!.WhatYouFightFor.creed).toBe("Trust the river, not the bank.");
    expect(got!.WhatYouFightFor.goal).toContain("shipment");
    expect(got!.WhatYouFightFor.instinct).toContain("second knife");
  });

  it("respects an authored pageRef for canonical NPCs", () => {
    parseBody(
      [
        "```npc Beronin",
        "role: Alchemist",
        "pageRef:",
        "  canonicalId: tb2-lmm",
        "  page: 262",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "beronin");
    const got = world.get(eid, [TbNpc]) as
      | { TbNpc: { pageRef: { canonicalId: string; page: number } | null } }
      | undefined;
    expect(got!.TbNpc.pageRef).toEqual({
      canonicalId: "tb2-lmm",
      page: 262,
    });
  });

  it("`team: party` flips an npc to the party team for friendly NPCs", () => {
    parseBody(
      [
        "```npc Greta",
        "role: Smith",
        "team: party",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "greta");
    const got = world.get(eid, [Team]) as
      | { Team: { kind: string } }
      | undefined;
    expect(got!.Team.kind).toBe("party");
  });
});

