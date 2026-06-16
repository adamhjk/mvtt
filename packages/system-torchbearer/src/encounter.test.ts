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
import { CommandPipeline, definePlugin, EntityId, EventBus, Registry, World } from "@vtt/substrate";
import { adventures } from "@vtt/adventures";
import { BlockKindsSlot, buildBlockKindIndex, EncounterTemplate } from "@vtt/adventures/shared";
import { runBlockParse, blockEntityId } from "@vtt/adventures/server";
import { permissions as permissionsPlugin } from "@vtt/permissions";
import { Permissions } from "@vtt/permissions/shared";
import { Character, Team } from "@vtt/characters/shared";
// Inline AuthSession shape — avoids declaring @vtt/auth as a direct
// dep just for one test fixture. The substrate threads `session`
// through as `unknown`; the type here is documentation, not enforcement.
type AuthSession = {
  userId: string;
  email: string;
  name: string;
  role: "gm" | "player";
};
import {
  Page,
  BelongsToNote,
  PageBodySet,
  MarkdownPostRenderSlot,
  EditorCompletionSourcesSlot,
  NotesReferenceSlot,
} from "@vtt/notes/shared";
import {
  CharacterTraits,
  Conditions,
  Heroic,
  Identity,
  MonsterCopy,
  MonsterTemplate,
  Pools,
  RawAbilities,
  Skills,
  TbMonster,
  TbMonsterSpecialRules,
  TbMonsterWeapons,
  TownAbilities,
  WhatYouFightFor,
  Wises,
} from "./shared/index.js";
import {
  EncounterStarted,
  MonsterCopySpawned,
  MonsterCopySpawningSystem,
  StartEncounter,
} from "./shared/encounter-commands.js";
import { ConflictDeclared } from "./conflict/shared/index.js";
import { characterBlockKind, encounterBlockKind, monsterBlockKind } from "./shared/blocks/index.js";

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

const tbEncounterTestPlugin = definePlugin({
  name: "@vtt/system-torchbearer-encounter-test",
  version: "0",
  dependsOn: ["@vtt/permissions@^0", "@vtt/characters@^0", "@vtt/adventures@^0"],
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
    TbMonsterWeapons,
    TbMonsterSpecialRules,
    MonsterTemplate,
    MonsterCopy,
  ],
  events: [EncounterStarted, MonsterCopySpawned, ConflictDeclared],
  commands: [StartEncounter],
  systems: [MonsterCopySpawningSystem],
  fills: {
    [BlockKindsSlot.name]: [
      characterBlockKind as never,
      monsterBlockKind as never,
      encounterBlockKind as never,
    ],
  },
});

function setup() {
  const registry = new Registry();
  registry.load(permissionsPlugin);
  registry.load(charactersStub);
  registry.load(notesStub);
  registry.load(adventures);
  registry.load(tbEncounterTestPlugin);
  registry.validate();
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  return { registry, world, bus, pipeline };
}

const gmSession: AuthSession = {
  userId: "gm-user",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

function buildPage(world: World): EntityId {
  const noteId = world.spawn([]);
  return world.spawn([Page({ title: "p", body: "", bodyRev: 0 }), BelongsToNote({ noteId })]);
}

describe("TB encounter block kind", () => {
  let registry: Registry;
  let world: World;
  let pageId: EntityId;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
    pageId = buildPage(world);
  });

  function parse(body: string) {
    const idx = buildBlockKindIndex(registry);
    return runBlockParse(world, pageId, body, idx);
  }

  it("a fully-specified encounter block projects to EncounterTemplate", () => {
    parse(
      [
        "```encounter Bywater Bridge Ambush",
        "type: kill",
        "location: note:Bywater Bridge",
        "sides:",
        "  - name: enemies",
        "    participants:",
        "      - character:Skarra",
        "      - 4× character:goblin scout",
        "  - name: pcs",
        "    participants: []",
        "trigger: PCs cross the bridge after dusk.",
        "read_aloud: |",
        "  Three torches flare on the far bank.",
        "treasure: 47 silver, [[item:serpent ring]]",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "bywater-bridge-ambush");
    const got = world.get(eid, [EncounterTemplate]) as
      | {
          EncounterTemplate: {
            name: string;
            type: string;
            locationRef: { kind: string; body: string } | null;
            sides: Array<{
              name: string;
              participants: Array<{
                kind: string;
                body: string;
                quantity?: number;
              }>;
            }>;
            trigger: string;
            readAloud: string;
            treasure: string;
          };
        }
      | undefined;
    expect(got).toBeDefined();
    expect(got!.EncounterTemplate.name).toBe("Bywater Bridge Ambush");
    expect(got!.EncounterTemplate.type).toBe("kill");
    expect(got!.EncounterTemplate.locationRef).toEqual({
      kind: "note",
      body: "Bywater Bridge",
    });
    const enemies = got!.EncounterTemplate.sides.find((s) => s.name === "enemies")!;
    expect(enemies.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "character", body: "Skarra" }),
        expect.objectContaining({
          kind: "character",
          body: "goblin scout",
          quantity: 4,
        }),
      ]),
    );
    expect(got!.EncounterTemplate.trigger).toContain("dusk");
    expect(got!.EncounterTemplate.readAloud).toContain("torches flare");
    expect(got!.EncounterTemplate.treasure).toContain("47 silver");
  });

  it("a sparse encounter body fills in defaults", () => {
    parse(["```encounter Quick Fight", "```"].join("\n"));
    const eid = blockEntityId(pageId, "quick-fight");
    const got = world.get(eid, [EncounterTemplate]) as
      | { EncounterTemplate: { type: string; sides: Array<unknown> } }
      | undefined;
    expect(got).toBeDefined();
    expect(got!.EncounterTemplate.type).toBe("kill");
    expect(got!.EncounterTemplate.sides.length).toBe(1);
  });

  it("supports the explicit object form of participant quantification", () => {
    parse(
      [
        "```encounter Big Brawl",
        "sides:",
        "  - name: enemies",
        "    participants:",
        "      - { qty: 7, ref: character:goblin }",
        "```",
      ].join("\n"),
    );
    const eid = blockEntityId(pageId, "big-brawl");
    const got = world.get(eid, [EncounterTemplate]) as
      | { EncounterTemplate: { sides: Array<{ participants: Array<{ quantity?: number }> }> } }
      | undefined;
    expect(got!.EncounterTemplate.sides[0]!.participants[0]).toEqual(
      expect.objectContaining({ kind: "character", body: "goblin", quantity: 7 }),
    );
  });
});

describe("StartEncounter — hybrid binding", () => {
  let registry: Registry;
  let world: World;
  let pipeline: CommandPipeline;
  let pageId: EntityId;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
    pipeline = s.pipeline;
    pageId = buildPage(world);
  });

  function parse(body: string) {
    const idx = buildBlockKindIndex(registry);
    return runBlockParse(world, pageId, body, idx);
  }

  async function dispatchAsGm(cmd: ReturnType<typeof StartEncounter>) {
    return pipeline.dispatch({
      id: `cmd-${Math.random()}`,
      issuedBy: gmSession.userId,
      issuedAt: Date.now(),
      session: gmSession as never,
      cmd,
    });
  }

  it("bindings: a singular reference resolves to the existing entity (no copy spawned)", async () => {
    // Author Skarra (character) + an encounter that names her singular.
    parse(
      [
        "```character Skarra",
        "stock: Human",
        "will: 5",
        "```",
        "",
        "```encounter Solo Fight",
        "sides:",
        "  - name: enemies",
        "    participants:",
        "      - character:Skarra",
        "```",
      ].join("\n"),
    );
    const skarraId = blockEntityId(pageId, "skarra");
    const encId = blockEntityId(pageId, "solo-fight");
    const res = await dispatchAsGm(StartEncounter({ templateId: encId }));
    expect(res.result.ok).toBe(true);
    const started = res.events.find((e) => e.type === EncounterStarted.name);
    expect(started).toBeDefined();
    const sides = (started!.payload as { sides: Array<{ participantIds: EntityId[] }> }).sides;
    expect(sides[0]!.participantIds).toEqual([skarraId]);
    // No copies spawned for singular.
    expect(world.query([MonsterCopy])).toHaveLength(0);
  });

  it("bindings: a quantified reference spawns N MonsterCopy entities from a MonsterTemplate", async () => {
    parse(
      [
        "```monster Goblin Scout",
        "might: 2",
        "nature:",
        "  rating: 3",
        "  descriptors: [Lurking]",
        "```",
        "",
        "```encounter Mob Fight",
        "sides:",
        "  - name: enemies",
        "    participants:",
        "      - 4× character:Goblin Scout",
        "```",
      ].join("\n"),
    );
    const encId = blockEntityId(pageId, "mob-fight");
    const res = await dispatchAsGm(StartEncounter({ templateId: encId }));
    expect(res.result.ok).toBe(true);
    const started = res.events.find((e) => e.type === EncounterStarted.name);
    const participantIds = (started!.payload as { sides: Array<{ participantIds: EntityId[] }> })
      .sides[0]!.participantIds;
    expect(participantIds).toHaveLength(4);
    // Each id is a real entity carrying MonsterCopy + Character (cloned from template).
    const copies = world.query([MonsterCopy]);
    expect(copies).toHaveLength(4);
    const copyIds = copies.map((r) => r.id);
    expect(copyIds.sort()).toEqual([...participantIds].sort());
    for (const cid of participantIds) {
      const copy = world.get(cid, [MonsterCopy, Character, TbMonster]) as
        | {
            MonsterCopy: { templateId: EntityId; ordinal: number };
            Character: { name: string };
            TbMonster: unknown;
          }
        | undefined;
      expect(copy).toBeDefined();
      expect(copy!.Character.name).toMatch(/Goblin Scout #\d+/);
      expect(copy!.MonsterCopy.templateId).toBe(blockEntityId(pageId, "goblin-scout"));
    }
  });

  it("re-starting the encounter spawns a FRESH set of copies (new ids, no reuse)", async () => {
    parse(
      [
        "```monster Goblin",
        "might: 2",
        "nature:",
        "  rating: 3",
        "```",
        "",
        "```encounter Repeat",
        "sides:",
        "  - name: enemies",
        "    participants:",
        "      - 2× character:Goblin",
        "```",
      ].join("\n"),
    );
    const encId = blockEntityId(pageId, "repeat");
    const res1 = await dispatchAsGm(StartEncounter({ templateId: encId }));
    const res2 = await dispatchAsGm(StartEncounter({ templateId: encId }));
    expect(res1.result.ok).toBe(true);
    expect(res2.result.ok).toBe(true);
    const ids1 = (
      res1.events.find((e) => e.type === EncounterStarted.name)!.payload as {
        sides: Array<{ participantIds: EntityId[] }>;
      }
    ).sides[0]!.participantIds;
    const ids2 = (
      res2.events.find((e) => e.type === EncounterStarted.name)!.payload as {
        sides: Array<{ participantIds: EntityId[] }>;
      }
    ).sides[0]!.participantIds;
    expect(ids1.length).toBe(2);
    expect(ids2.length).toBe(2);
    expect(new Set(ids1).size + new Set(ids2).size).toBe(4); // no overlap
  });

  it("editing the monster template AFTER spawning copies leaves existing copies unchanged", async () => {
    parse(
      [
        "```monster Wolf",
        "might: 3",
        "nature:",
        "  rating: 4",
        "```",
        "",
        "```encounter Howl",
        "sides:",
        "  - name: enemies",
        "    participants:",
        "      - 2× character:Wolf",
        "```",
      ].join("\n"),
    );
    const encId = blockEntityId(pageId, "howl");
    const res = await dispatchAsGm(StartEncounter({ templateId: encId }));
    expect(res.result.ok).toBe(true);
    const sides = (
      res.events.find((e) => e.type === EncounterStarted.name)!.payload as {
        sides: Array<{ participantIds: EntityId[] }>;
      }
    ).sides;
    const copyIds = sides[0]!.participantIds;
    const beforeMight = (
      world.get(copyIds[0]!, [TownAbilities]) as { TownAbilities: { might: number } } | undefined
    )?.TownAbilities.might;
    expect(beforeMight).toBe(3);

    // Bump the template's might from 3 to 5
    parse(
      [
        "```monster Wolf",
        "might: 5",
        "nature:",
        "  rating: 4",
        "```",
        "",
        "```encounter Howl",
        "sides:",
        "  - name: enemies",
        "    participants:",
        "      - 2× character:Wolf",
        "```",
      ].join("\n"),
    );
    // Existing copies are unchanged.
    const afterMight = (
      world.get(copyIds[0]!, [TownAbilities]) as { TownAbilities: { might: number } } | undefined
    )?.TownAbilities.might;
    expect(afterMight).toBe(3);

    // A fresh start picks up the new might.
    const res2 = await dispatchAsGm(StartEncounter({ templateId: encId }));
    const newCopyIds = (
      res2.events.find((e) => e.type === EncounterStarted.name)!.payload as {
        sides: Array<{ participantIds: EntityId[] }>;
      }
    ).sides[0]!.participantIds;
    const newMight = (
      world.get(newCopyIds[0]!, [TownAbilities]) as { TownAbilities: { might: number } } | undefined
    )?.TownAbilities.might;
    expect(newMight).toBe(5);
  });

  it("missing participants are reported in the EncounterStarted event without crashing", async () => {
    parse(
      [
        "```encounter Ghost Encounter",
        "sides:",
        "  - name: enemies",
        "    participants:",
        "      - character:NonExistent NPC",
        "```",
      ].join("\n"),
    );
    const encId = blockEntityId(pageId, "ghost-encounter");
    const res = await dispatchAsGm(StartEncounter({ templateId: encId }));
    expect(res.result.ok).toBe(true);
    const started = res.events.find((e) => e.type === EncounterStarted.name)!;
    const sides = (
      started.payload as {
        sides: Array<{
          participantIds: EntityId[];
          missing: Array<{ kind: string; body: string }>;
        }>;
      }
    ).sides;
    expect(sides[0]!.missing).toEqual([{ kind: "character", body: "NonExistent NPC" }]);
    expect(sides[0]!.participantIds).toEqual([]);
  });

  it("a quantified reference targeting a non-template marks it missing (refuses to spawn)", async () => {
    // Authoring `4× character:Skarra` where Skarra is a singular
    // character (not a MonsterTemplate). The grammar accepts it but
    // the spawn step refuses because Skarra is unique.
    parse(
      [
        "```character Skarra",
        "stock: Human",
        "```",
        "",
        "```encounter Bad",
        "sides:",
        "  - name: enemies",
        "    participants:",
        "      - 4× character:Skarra",
        "```",
      ].join("\n"),
    );
    const encId = blockEntityId(pageId, "bad");
    const res = await dispatchAsGm(StartEncounter({ templateId: encId }));
    expect(res.result.ok).toBe(true);
    const started = res.events.find((e) => e.type === EncounterStarted.name)!;
    const sides = (
      started.payload as {
        sides: Array<{
          missing: Array<{ kind: string; body: string }>;
          participantIds: EntityId[];
        }>;
      }
    ).sides;
    expect(sides[0]!.missing).toEqual([{ kind: "character", body: "Skarra" }]);
    expect(sides[0]!.participantIds).toEqual([]);
  });
});

describe("StartEncounter — orchestrates ConflictDeclared", () => {
  let registry: Registry;
  let world: World;
  let pipeline: CommandPipeline;
  let pageId: EntityId;

  beforeEach(() => {
    const s = setup();
    registry = s.registry;
    world = s.world;
    pipeline = s.pipeline;
    pageId = buildPage(world);
  });

  function parse(body: string) {
    const idx = buildBlockKindIndex(registry);
    return runBlockParse(world, pageId, body, idx);
  }

  async function dispatchAsGm(cmd: ReturnType<typeof StartEncounter>) {
    return pipeline.dispatch({
      id: `cmd-${Math.random()}`,
      issuedBy: gmSession.userId,
      issuedAt: Date.now(),
      session: gmSession as never,
      cmd,
    });
  }

  it("emits ConflictDeclared with party and enemy participants", async () => {
    // Spawn a party PC manually (no character block).
    const pc = world.spawn([Character({ name: "Greta the PC" }), Team({ kind: "party" })]);
    parse(
      [
        "```character Skarra",
        "stock: Human",
        "will: 5",
        "```",
        "",
        "```encounter Bywater Bridge Ambush",
        "type: kill",
        "sides:",
        "  - name: pcs",
        "    participants: []",
        "  - name: enemies",
        "    participants:",
        "      - character:Skarra",
        "```",
      ].join("\n"),
    );
    const encId = blockEntityId(pageId, "bywater-bridge-ambush");
    const res = await dispatchAsGm(StartEncounter({ templateId: encId }));
    expect(res.result.ok).toBe(true);
    const declared = res.events.find((e) => e.type === ConflictDeclared.name);
    expect(declared).toBeDefined();
    const payload = declared!.payload as {
      type: string;
      captainCharacterId: EntityId;
      partyParticipants: ReadonlyArray<{ characterId: EntityId }>;
      enemyParticipants: ReadonlyArray<{ characterId: EntityId }>;
    };
    expect(payload.type).toBe("kill");
    expect(payload.captainCharacterId).toBe(pc);
    expect(payload.partyParticipants[0]!.characterId).toBe(pc);
    expect(payload.enemyParticipants).toHaveLength(1);
    expect(payload.enemyParticipants[0]!.characterId).toBe(blockEntityId(pageId, "skarra"));
  });

  it("auto-resolves an empty 'pcs' side from the world's party Characters", async () => {
    const pc1 = world.spawn([Character({ name: "PC One" }), Team({ kind: "party" })]);
    const pc2 = world.spawn([Character({ name: "PC Two" }), Team({ kind: "party" })]);
    // Decoy non-party char that should NOT be picked up.
    world.spawn([Character({ name: "Decoy" }), Team({ kind: "enemy" })]);
    parse(
      [
        "```monster Goblin",
        "might: 2",
        "nature:",
        "  rating: 3",
        "```",
        "",
        "```encounter Mob Fight",
        "type: kill",
        "sides:",
        "  - name: enemies",
        "    participants:",
        "      - 2× character:Goblin",
        "```",
      ].join("\n"),
    );
    const encId = blockEntityId(pageId, "mob-fight");
    const res = await dispatchAsGm(StartEncounter({ templateId: encId }));
    expect(res.result.ok).toBe(true);
    const declared = res.events.find((e) => e.type === ConflictDeclared.name);
    expect(declared).toBeDefined();
    const payload = declared!.payload as {
      partyParticipants: ReadonlyArray<{ characterId: EntityId }>;
    };
    expect(payload.partyParticipants.map((p) => p.characterId).sort()).toEqual([pc1, pc2].sort());
  });

  it("maps the YAML 'drive_off' to the conflict enum 'driveOff'", async () => {
    world.spawn([Character({ name: "PC" }), Team({ kind: "party" })]);
    parse(
      [
        "```monster Wolf",
        "might: 3",
        "nature:",
        "  rating: 4",
        "```",
        "",
        "```encounter Howl",
        "type: drive_off",
        "sides:",
        "  - name: enemies",
        "    participants:",
        "      - 2× character:Wolf",
        "```",
      ].join("\n"),
    );
    const encId = blockEntityId(pageId, "howl");
    const res = await dispatchAsGm(StartEncounter({ templateId: encId }));
    expect(res.result.ok).toBe(true);
    const declared = res.events.find((e) => e.type === ConflictDeclared.name);
    expect((declared!.payload as { type: string }).type).toBe("driveOff");
  });

  it("skips ConflictDeclared if no party characters can be resolved", async () => {
    parse(
      [
        "```monster Goblin",
        "might: 2",
        "nature:",
        "  rating: 3",
        "```",
        "",
        "```encounter Lonely",
        "type: kill",
        "sides:",
        "  - name: enemies",
        "    participants:",
        "      - 1× character:Goblin",
        "```",
      ].join("\n"),
    );
    const encId = blockEntityId(pageId, "lonely");
    const res = await dispatchAsGm(StartEncounter({ templateId: encId }));
    expect(res.result.ok).toBe(true);
    expect(res.events.find((e) => e.type === ConflictDeclared.name)).toBeUndefined();
    expect(res.events.find((e) => e.type === EncounterStarted.name)).toBeDefined();
  });
});

// Reference Permissions to keep tree-shaker honest.
void Permissions;
