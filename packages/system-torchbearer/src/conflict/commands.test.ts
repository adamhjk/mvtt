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
  type EntityId,
} from "@vtt/substrate";
import { permissions } from "@vtt/permissions";
import { Permissions, actors } from "@vtt/permissions/shared";
import {
  AssignHp,
  ChooseWeapon,
  DeclareConflict,
  LockScript,
  RollDisposition,
  SetScriptSlot,
  TbConflict,
  TbConflictParticipant,
  TbConflictScript,
  ALL_CONFLICT_TRAITS,
  ALL_CONFLICT_EVENTS,
  ALL_CONFLICT_COMMANDS,
} from "./shared/index.js";
import { ALL_CONFLICT_SYSTEMS } from "./server/index.js";

/**
 * Minimal plugin wrapping just the conflict pieces — keeps the unit
 * tests free of the broader Torchbearer plugin's transitive
 * dependencies (skills tab, grind, etc.).
 */
const conflictTestPlugin = definePlugin({
  name: "@vtt/conflict-test",
  version: "0.0.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/permissions@^0",
  ],
  traits: [...ALL_CONFLICT_TRAITS],
  events: [...ALL_CONFLICT_EVENTS],
  commands: [...ALL_CONFLICT_COMMANDS],
  systems: [...ALL_CONFLICT_SYSTEMS],
});

const GM = { userId: "gm", email: "gm@x.dev", name: "GM", role: "gm" } as const;
const PLAYER = {
  userId: "p1",
  email: "p1@x.dev",
  name: "P1",
  role: "player",
} as const;

interface H {
  registry: Registry;
  world: World;
  bus: EventBus;
  pipeline: CommandPipeline;
  partyChar: EntityId;
  enemyChar: EntityId;
  conflictId: EntityId | null;
}

function setup(): H {
  const registry = new Registry();
  registry.load(permissions);
  registry.load(conflictTestPlugin);
  registry.validate();
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  // Stand up a party character owned by p1.
  const partyChar = world.spawn([
    Permissions({
      read: { kind: "everyone" },
      write: actors([PLAYER.userId]),
    }),
  ]);
  // Stand up a enemy character (NPC, GM-owned).
  const enemyChar = world.spawn([
    Permissions({
      read: { kind: "everyone" },
      write: actors([GM.userId]),
    }),
  ]);
  return {
    registry,
    world,
    bus,
    pipeline,
    partyChar,
    enemyChar,
    conflictId: null,
  };
}

/**
 * Find the first participant entity id matching the given character +
 * (optional) side in `h.world`. Tests set up via `declareConflict`
 * spawn one participant per character per side; this helper lets the
 * scripting tests look up the participant id without threading it
 * through the helper.
 */
function findParticipantId(
  h: H,
  characterId: EntityId,
  side?: "party" | "enemy",
): EntityId {
  for (const row of h.world.query([TbConflictParticipant])) {
    const p = row.values.TbConflictParticipant as ReturnType<
      typeof TbConflictParticipant
    >["value"];
    if (p.characterId === characterId && (!side || p.side === side)) {
      return row.id;
    }
  }
  throw new Error(`no participant for ${characterId}`);
}

async function declareConflict(h: H): Promise<EntityId> {
  const before = new Set(
    h.world.query([TbConflict]).map((r) => r.id as string),
  );
  const res = await h.pipeline.dispatch({
    id: "c1",
    issuedBy: "client-gm",
    issuedAt: Date.now(),
    cmd: DeclareConflict({
      type: "kill",
      locationLabel: "Test crypt",
      captainCharacterId: h.partyChar,
      partyParticipants: [
        { characterId: h.partyChar },
      ],
      enemyParticipants: [
        { characterId: h.enemyChar },
      ],
    }),
    session: GM,
  });
  if (!res.result.ok) throw new Error(res.result.reason);
  for (const row of h.world.query([TbConflict])) {
    if (!before.has(row.id as string)) {
      h.conflictId = row.id;
      return row.id;
    }
  }
  throw new Error("no conflict spawned");
}

describe("DeclareConflict", () => {
  let h: H;
  beforeEach(() => {
    h = setup();
  });

  it("only GM may declare", async () => {
    const res = await h.pipeline.dispatch({
      id: "c1",
      issuedBy: "p1",
      issuedAt: Date.now(),
      cmd: DeclareConflict({
        type: "kill",
        locationLabel: "x",
        captainCharacterId: h.partyChar,
        partyParticipants: [{ characterId: h.partyChar }],
        enemyParticipants: [{ characterId: h.enemyChar }],
      }),
      session: PLAYER,
    });
    expect(res.result.ok).toBe(false);
  });

  it("GM declare spawns conflict + script + participants", async () => {
    const conflictId = await declareConflict(h);
    const conf = h.world.get(conflictId, [TbConflict]) as
      | { TbConflict: ReturnType<typeof TbConflict>["value"] }
      | undefined;
    expect(conf).toBeDefined();
    expect(conf!.TbConflict.type).toBe("kill");
    expect(conf!.TbConflict.captainCharacterId).toBe(h.partyChar);
    expect(conf!.TbConflict.endedAt).toBeNull();
    // Two scripts (one per side) spawned.
    let partyScripts = 0;
    let enemyScripts = 0;
    for (const row of h.world.query([TbConflictScript])) {
      const s = row.values.TbConflictScript as ReturnType<typeof TbConflictScript>["value"];
      if (s.conflictId === conflictId) {
        if (s.side === "party") partyScripts += 1;
        else enemyScripts += 1;
        expect(s.locked).toBe(false);
        expect(s.slots[0].status).toBe("empty");
      }
    }
    expect(partyScripts).toBe(1);
    expect(enemyScripts).toBe(1);
    // Participants spawned.
    let partyP = 0;
    let enemyP = 0;
    for (const row of h.world.query([TbConflictParticipant])) {
      const p = row.values.TbConflictParticipant as ReturnType<typeof TbConflictParticipant>["value"];
      if (p.conflictId === conflictId) {
        if (p.side === "party") partyP += 1;
        else enemyP += 1;
      }
    }
    expect(partyP).toBe(1);
    expect(enemyP).toBe(1);
  });
});

describe("RollDisposition + AssignHp", () => {
  it("roll counts 4-6 successes and clamps min to 1", async () => {
    const h = setup();
    const conflictId = await declareConflict(h);
    // Force phase to disposition.
    h.world.set(conflictId, TbConflict, {
      ...(h.world.get(conflictId, [TbConflict]) as any).TbConflict,
    });
    const res = await h.pipeline.dispatch({
      id: "rd",
      issuedBy: "client",
      issuedAt: Date.now(),
      cmd: RollDisposition({
        conflictId,
        side: "party",
        skillId: "fighter",
        poolBefore: 4,
        addToBase: 5,
        diceRoll: [4, 5, 6, 1, 2, 3],
      }),
      session: PLAYER,
    });
    expect(res.result.ok).toBe(true);
    const conf = (
      h.world.get(conflictId, [TbConflict]) as
        | { TbConflict: ReturnType<typeof TbConflict>["value"] }
        | undefined
    )!.TbConflict;
    // 3 successes + 5 base = 8.
    expect(conf.dispoParty.max).toBe(8);
    expect(conf.dispoParty.current).toBe(8);
  });

  /* -------------------------------------------------------------------
   * The Will-vs-Health pivot. The conflict type's `dispoAddTo` says
   * which ability to add to ("Will" for Convince/Capture/Trick;
   * "Health" for Kill/Drive Off/Flee/Pursue). The CALLER is
   * responsible for passing the right rating in `addToBase` — the
   * server just adds and writes. These tests prove the math respects
   * whatever ability the caller looked up.
   * ----------------------------------------------------------------- */

  it("Kill conflict (dispoAddTo=Health): pool + Health rating → dispo", async () => {
    // Kill: TB_CONFLICT_TYPES.kill.dispoAddTo === "Health".
    // Captain Bob has Health 6 and Fighter 5; rolls 5d, gets 3 successes.
    // Final dispo = 3 + 6 = 9.
    const h = setup();
    const conflictId = await declareConflict(h);
    const res = await h.pipeline.dispatch({
      id: "rd-kill",
      issuedBy: "client",
      issuedAt: Date.now(),
      cmd: RollDisposition({
        conflictId,
        side: "party",
        skillId: "fighter",
        poolBefore: 5,
        addToBase: 6, // captain's Health rating
        diceRoll: [4, 5, 6, 1, 2],
      }),
      session: PLAYER,
    });
    expect(res.result.ok).toBe(true);
    const conf = (h.world.get(conflictId, [TbConflict]) as any).TbConflict;
    expect(conf.dispoParty.max).toBe(9);
  });

  it("Trick conflict (dispoAddTo=Will): pool + Will rating → dispo", async () => {
    // Trick: TB_CONFLICT_TYPES.trick.dispoAddTo === "Will".
    // Captain rolls 4d Manipulator, gets 2 successes; Will rating 4.
    // Final dispo = 2 + 4 = 6.
    const h = setup();
    const conflictId = await declareConflict(h);
    const res = await h.pipeline.dispatch({
      id: "rd-trick",
      issuedBy: "client",
      issuedAt: Date.now(),
      cmd: RollDisposition({
        conflictId,
        side: "party",
        skillId: "manipulator",
        poolBefore: 4,
        addToBase: 4, // captain's Will rating
        diceRoll: [5, 4, 1, 1],
      }),
      session: PLAYER,
    });
    expect(res.result.ok).toBe(true);
    const conf = (h.world.get(conflictId, [TbConflict]) as any).TbConflict;
    expect(conf.dispoParty.max).toBe(6);
  });

  it("addToBase=0 still produces a valid dispo (min clamped to 1)", async () => {
    // No successes, no base — engine clamps to a starting dispo of 1
    // per SG p.63 ("minimum starting disposition is 1").
    const h = setup();
    const conflictId = await declareConflict(h);
    const res = await h.pipeline.dispatch({
      id: "rd-zero",
      issuedBy: "client",
      issuedAt: Date.now(),
      cmd: RollDisposition({
        conflictId,
        side: "party",
        skillId: "fighter",
        poolBefore: 1,
        addToBase: 0,
        diceRoll: [1],
      }),
      session: PLAYER,
    });
    expect(res.result.ok).toBe(true);
    const conf = (h.world.get(conflictId, [TbConflict]) as any).TbConflict;
    expect(conf.dispoParty.max).toBe(1);
    expect(conf.dispoParty.current).toBe(1);
  });

  it("party and enemy dispos are independent", async () => {
    const h = setup();
    const conflictId = await declareConflict(h);
    await h.pipeline.dispatch({
      id: "rd-p",
      issuedBy: "client",
      issuedAt: Date.now(),
      cmd: RollDisposition({
        conflictId,
        side: "party",
        skillId: "fighter",
        poolBefore: 4,
        addToBase: 5,
        diceRoll: [4, 5, 6, 1],
      }),
      session: PLAYER,
    });
    await h.pipeline.dispatch({
      id: "rd-e",
      issuedBy: "client-gm",
      issuedAt: Date.now(),
      cmd: RollDisposition({
        conflictId,
        side: "enemy",
        skillId: "manipulator",
        poolBefore: 3,
        addToBase: 3, // monster's Will
        diceRoll: [4, 6, 1],
      }),
      session: GM,
    });
    const conf = (h.world.get(conflictId, [TbConflict]) as any).TbConflict;
    expect(conf.dispoParty.max).toBe(8); // 3s + 5 = 8
    expect(conf.dispoEnemy.max).toBe(5); // 2s + 3 = 5
  });

  it("AssignHp rejects when sum doesn't equal dispoMax", async () => {
    const h = setup();
    const conflictId = await declareConflict(h);
    h.world.set(conflictId, TbConflict, {
      ...(h.world.get(conflictId, [TbConflict]) as any).TbConflict,
      dispoParty: { current: 5, max: 5 },
    });
    const partyP = h.world
      .query([TbConflictParticipant])
      .find((r) => (r.values.TbConflictParticipant as any).side === "party")!.id;
    const res = await h.pipeline.dispatch({
      id: "h",
      issuedBy: "p1",
      issuedAt: Date.now(),
      cmd: AssignHp({
        conflictId,
        side: "party",
        allocations: [{ participantEntityId: partyP, hp: 4 }],
      }),
      session: PLAYER,
    });
    expect(res.result.ok).toBe(false);
  });

  it("AssignHp accepts when sums match", async () => {
    const h = setup();
    const conflictId = await declareConflict(h);
    h.world.set(conflictId, TbConflict, {
      ...(h.world.get(conflictId, [TbConflict]) as any).TbConflict,
      dispoParty: { current: 5, max: 5 },
    });
    const partyP = h.world
      .query([TbConflictParticipant])
      .find((r) => (r.values.TbConflictParticipant as any).side === "party")!.id;
    const res = await h.pipeline.dispatch({
      id: "h",
      issuedBy: "p1",
      issuedAt: Date.now(),
      cmd: AssignHp({
        conflictId,
        side: "party",
        allocations: [{ participantEntityId: partyP, hp: 5 }],
      }),
      session: PLAYER,
    });
    expect(res.result.ok).toBe(true);
    const updated = (
      h.world.get(partyP, [TbConflictParticipant]) as any
    ).TbConflictParticipant;
    expect(updated.hp).toBe(5);
    expect(updated.hpMax).toBe(5);
  });
});

describe("SetScriptSlot + LockScript", () => {
  it("rejects script writes when the dispatcher is on the wrong side", async () => {
    const h = setup();
    const conflictId = await declareConflict(h);
    h.world.set(conflictId, TbConflict, {
      ...(h.world.get(conflictId, [TbConflict]) as any).TbConflict,
    });
    // Unrelated player tries to script the party' side.
    const stranger = { ...PLAYER, userId: "stranger" };
    const res = await h.pipeline.dispatch({
      id: "s",
      issuedBy: "stranger",
      issuedAt: Date.now(),
      cmd: SetScriptSlot({
        conflictId,
        side: "party",
        slotIndex: 0,
        action: "attack",
        performerParticipantEntityId: findParticipantId(h, h.partyChar, "party"),
        weaponItemId: null,
      }),
      session: stranger,
    });
    expect(res.result.ok).toBe(false);
  });

  it("rejects performer not on side", async () => {
    const h = setup();
    const conflictId = await declareConflict(h);
    h.world.set(conflictId, TbConflict, {
      ...(h.world.get(conflictId, [TbConflict]) as any).TbConflict,
    });
    // Party captain trying to script an enemy participant — the
    // performer's participant entity is on the wrong side.
    const res = await h.pipeline.dispatch({
      id: "s",
      issuedBy: "p1",
      issuedAt: Date.now(),
      cmd: SetScriptSlot({
        conflictId,
        side: "party",
        slotIndex: 0,
        action: "attack",
        performerParticipantEntityId: findParticipantId(h, h.enemyChar, "enemy"),
        weaponItemId: null,
      }),
      session: PLAYER,
    });
    expect(res.result.ok).toBe(false);
  });

  it("lock fails if any slot is empty", async () => {
    const h = setup();
    const conflictId = await declareConflict(h);
    h.world.set(conflictId, TbConflict, {
      ...(h.world.get(conflictId, [TbConflict]) as any).TbConflict,
    });
    // Fill only slot 0 then try to lock.
    await h.pipeline.dispatch({
      id: "s0",
      issuedBy: "p1",
      issuedAt: Date.now(),
      cmd: SetScriptSlot({
        conflictId,
        side: "party",
        slotIndex: 0,
        action: "attack",
        performerParticipantEntityId: findParticipantId(h, h.partyChar, "party"),
        weaponItemId: null,
      }),
      session: PLAYER,
    });
    const lock = await h.pipeline.dispatch({
      id: "lock",
      issuedBy: "p1",
      issuedAt: Date.now(),
      cmd: LockScript({ conflictId, side: "party" }),
      session: PLAYER,
    });
    expect(lock.result.ok).toBe(false);
  });

  it("locks when all three slots are filled", async () => {
    const h = setup();
    const conflictId = await declareConflict(h);
    h.world.set(conflictId, TbConflict, {
      ...(h.world.get(conflictId, [TbConflict]) as any).TbConflict,
    });
    for (const i of [0, 1, 2]) {
      await h.pipeline.dispatch({
        id: `s${i}`,
        issuedBy: "p1",
        issuedAt: Date.now(),
        cmd: SetScriptSlot({
          conflictId,
          side: "party",
          slotIndex: i,
          action: "attack",
          performerParticipantEntityId: findParticipantId(h, h.partyChar, "party"),
          weaponItemId: null,
        }),
        session: PLAYER,
      });
    }
    const lock = await h.pipeline.dispatch({
      id: "lock",
      issuedBy: "p1",
      issuedAt: Date.now(),
      cmd: LockScript({ conflictId, side: "party" }),
      session: PLAYER,
    });
    expect(lock.result.ok).toBe(true);
  });
});

describe("multi-spawn participants (4 goblins case)", () => {
  it("DeclareConflict with count>1 expands into N labelled participants", async () => {
    const h = setup();
    const res = await h.pipeline.dispatch({
      id: "c-multi",
      issuedBy: "client-gm",
      issuedAt: Date.now(),
      cmd: DeclareConflict({
        type: "kill",
        locationLabel: "Goblin Lair",
        captainCharacterId: h.partyChar,
        partyParticipants: [{ characterId: h.partyChar }],
        // 4 goblins, plus a singleton enemyChar to verify both shapes
        // coexist.
        enemyParticipants: [
          { characterId: h.enemyChar, count: 4, baseLabel: "Goblin" },
        ],
      }),
      session: GM,
    });
    expect(res.result.ok).toBe(true);
    const enemies = h.world
      .query([TbConflictParticipant])
      .map(
        (r) =>
          r.values.TbConflictParticipant as ReturnType<
            typeof TbConflictParticipant
          >["value"],
      )
      .filter((p) => p.side === "enemy");
    expect(enemies).toHaveLength(4);
    expect(enemies.map((p) => p.label)).toEqual([
      "Goblin 1",
      "Goblin 2",
      "Goblin 3",
      "Goblin 4",
    ]);
    // All four reference the same character id.
    for (const p of enemies) expect(p.characterId).toBe(h.enemyChar);
  });

  it("count===1 leaves the label undefined so the panel reads the live character name", async () => {
    const h = setup();
    await declareConflict(h);
    const enemy = h.world
      .query([TbConflictParticipant])
      .map(
        (r) =>
          r.values.TbConflictParticipant as ReturnType<
            typeof TbConflictParticipant
          >["value"],
      )
      .find((p) => p.side === "enemy");
    expect(enemy).toBeDefined();
    expect(enemy!.label).toBeUndefined();
  });

  it("AddConflictParticipants drops in extra goblins after declaration with auto-numbered labels", async () => {
    const h = setup();
    const conflictId = await declareConflict(h);
    const { AddConflictParticipants } = await import(
      "./shared/commands.js"
    );
    const res = await h.pipeline.dispatch({
      id: "add-goblins",
      issuedBy: "client-gm",
      issuedAt: Date.now(),
      cmd: AddConflictParticipants({
        conflictId,
        side: "enemy",
        characterId: h.enemyChar,
        count: 3,
        baseLabel: "Goblin",
      }),
      session: GM,
    });
    expect(res.result.ok).toBe(true);
    const enemies = h.world
      .query([TbConflictParticipant])
      .map(
        (r) =>
          r.values.TbConflictParticipant as ReturnType<
            typeof TbConflictParticipant
          >["value"],
      )
      .filter((p) => p.side === "enemy" && p.conflictId === conflictId);
    // The original singleton + 3 new auto-labelled rows.
    expect(enemies).toHaveLength(4);
    const labels = enemies.map((p) => p.label).sort();
    expect(labels).toContain("Goblin 1");
    expect(labels).toContain("Goblin 2");
    expect(labels).toContain("Goblin 3");
  });

  it("AddConflictParticipants with count===1 spawns an unlabelled row", async () => {
    const h = setup();
    const conflictId = await declareConflict(h);
    const { AddConflictParticipants } = await import(
      "./shared/commands.js"
    );
    const res = await h.pipeline.dispatch({
      id: "add-one",
      issuedBy: "client-gm",
      issuedAt: Date.now(),
      cmd: AddConflictParticipants({
        conflictId,
        side: "party",
        characterId: h.partyChar,
        count: 1,
      }),
      session: GM,
    });
    expect(res.result.ok).toBe(true);
    const parties = h.world
      .query([TbConflictParticipant])
      .map((r) => ({
        id: r.id,
        ...(r.values.TbConflictParticipant as ReturnType<
          typeof TbConflictParticipant
        >["value"]),
      }))
      .filter((p) => p.side === "party" && p.conflictId === conflictId);
    expect(parties.length).toBeGreaterThanOrEqual(2);
    // The freshly-added party row has no label (count===1).
    const fresh = parties[parties.length - 1]!;
    expect(fresh.label).toBeUndefined();
  });

  it("two participants of the same character can hold different weapons", async () => {
    const h = setup();
    const before = new Set(
      h.world.query([TbConflict]).map((r) => r.id as string),
    );
    const res = await h.pipeline.dispatch({
      id: "c-multi-weap",
      issuedBy: "client-gm",
      issuedAt: Date.now(),
      cmd: DeclareConflict({
        type: "kill",
        locationLabel: "Test",
        captainCharacterId: h.partyChar,
        partyParticipants: [{ characterId: h.partyChar }],
        enemyParticipants: [
          { characterId: h.enemyChar, count: 2, baseLabel: "Goblin" },
        ],
      }),
      session: GM,
    });
    expect(res.result.ok).toBe(true);
    const conflictId = h.world
      .query([TbConflict])
      .map((r) => r.id as string)
      .find((id) => !before.has(id))!;
    h.conflictId = conflictId;
    const goblins = h.world
      .query([TbConflictParticipant])
      .map((r) => ({
        id: r.id,
        ...(r.values.TbConflictParticipant as ReturnType<
          typeof TbConflictParticipant
        >["value"]),
      }))
      .filter((p) => p.side === "enemy" && p.conflictId === conflictId);
    expect(goblins).toHaveLength(2);
    // Goblin 1 picks weapon A; Goblin 2 picks weapon B. Even though
    // they share characterId, the per-participant binding keeps them
    // distinct.
    const weaponA = h.world.spawn([]);
    const weaponB = h.world.spawn([]);
    const r1 = await h.pipeline.dispatch({
      id: "w1",
      issuedBy: "client-gm",
      issuedAt: Date.now(),
      cmd: ChooseWeapon({
        conflictId: h.conflictId,
        participantEntityId: goblins[0]!.id,
        weaponItemId: weaponA,
      }),
      session: GM,
    });
    expect(r1.result.ok).toBe(true);
    const r2 = await h.pipeline.dispatch({
      id: "w2",
      issuedBy: "client-gm",
      issuedAt: Date.now(),
      cmd: ChooseWeapon({
        conflictId: h.conflictId,
        participantEntityId: goblins[1]!.id,
        weaponItemId: weaponB,
      }),
      session: GM,
    });
    expect(r2.result.ok).toBe(true);

    const { TbConflictWeapon } = await import("./shared/traits.js");
    const bindings = h.world.query([TbConflictWeapon]).map(
      (r) =>
        r.values.TbConflictWeapon as ReturnType<
          typeof TbConflictWeapon
        >["value"],
    );
    const g1 = bindings.find((b) => b.participantEntityId === goblins[0]!.id);
    const g2 = bindings.find((b) => b.participantEntityId === goblins[1]!.id);
    expect(g1?.weaponItemId).toBe(weaponA);
    expect(g2?.weaponItemId).toBe(weaponB);
  });
});

describe("ChooseWeapon", () => {

  it("accepts in weapons phase", async () => {
    const h = setup();
    const conflictId = await declareConflict(h);
    // ChooseWeapon is now keyed by participantEntityId so two
    // copies of the same character can hold different weapons —
    // pick the party participant's row from the world.
    const partyParticipant = h.world
      .query([TbConflictParticipant])
      .find((r) => {
        const p = r.values.TbConflictParticipant as ReturnType<
          typeof TbConflictParticipant
        >["value"];
        return p.conflictId === conflictId && p.side === "party";
      });
    expect(partyParticipant).toBeDefined();
    const res = await h.pipeline.dispatch({
      id: "w",
      issuedBy: "p1",
      issuedAt: Date.now(),
      cmd: ChooseWeapon({
        conflictId,
        participantEntityId: partyParticipant!.id,
        weaponItemId: null,
      }),
      session: PLAYER,
    });
    expect(res.result.ok).toBe(true);
  });
});

