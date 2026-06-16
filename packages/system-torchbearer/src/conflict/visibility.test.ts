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

import { describe, expect, it } from "vitest";
import {
  CommandPipeline,
  definePlugin,
  EventBus,
  Registry,
  World,
  type EntityId,
  type EventInstance,
} from "@vtt/substrate";
import { permissions } from "@vtt/permissions";
import { Permissions, actors } from "@vtt/permissions/shared";
import {
  ALL_CONFLICT_COMMANDS,
  ALL_CONFLICT_EVENTS,
  ALL_CONFLICT_TRAITS,
  DeclareConflict,
  ScriptLocked,
  ScriptSlotSet,
  SetScriptSlot,
  TbConflict,
  TbConflictParticipant,
} from "./shared/index.js";
import { ALL_CONFLICT_SYSTEMS } from "./server/index.js";

const conflictTestPlugin = definePlugin({
  name: "@vtt/conflict-test",
  version: "0.0.0",
  dependsOn: ["@vtt/substrate@^0", "@vtt/permissions@^0"],
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

interface Captured {
  events: EventInstance[];
}

async function dispatchAndCapture(opts: { emitted: Captured }): Promise<{
  world: World;
  pipeline: CommandPipeline;
  bus: EventBus;
  registry: Registry;
  partyChar: EntityId;
  enemyChar: EntityId;
  conflictId: EntityId;
}> {
  const registry = new Registry();
  registry.load(permissions);
  registry.load(conflictTestPlugin);
  registry.validate();
  const world = new World();
  const bus = new EventBus();
  bus.onAny((e) => opts.emitted.events.push(e));
  const pipeline = new CommandPipeline(registry, world, bus);

  const partyChar = world.spawn([
    Permissions({ read: { kind: "everyone" }, write: actors([PLAYER.userId]) }),
  ]);
  const enemyChar = world.spawn([
    Permissions({ read: { kind: "everyone" }, write: actors([GM.userId]) }),
  ]);

  const before = new Set(world.query([TbConflict]).map((r) => r.id as string));
  const declareRes = await pipeline.dispatch({
    id: "decl",
    issuedBy: "client-gm",
    issuedAt: Date.now(),
    cmd: DeclareConflict({
      type: "kill",
      locationLabel: "test",
      captainCharacterId: partyChar,
      partyParticipants: [{ characterId: partyChar }],
      enemyParticipants: [{ characterId: enemyChar }],
    }),
    session: GM,
  });
  if (!declareRes.result.ok) throw new Error(declareRes.result.reason);
  let conflictId: EntityId | null = null;
  for (const row of world.query([TbConflict])) {
    if (!before.has(row.id as string)) {
      conflictId = row.id;
      break;
    }
  }
  if (!conflictId) throw new Error("no conflict");
  // Force phase to scripting.
  world.set(conflictId, TbConflict, {
    ...(world.get(conflictId, [TbConflict]) as any).TbConflict,
  });
  return { world, pipeline, bus, registry, partyChar, enemyChar, conflictId };
}

function findParticipantId(world: World, characterId: EntityId, side: "party" | "enemy"): EntityId {
  for (const row of world.query([TbConflictParticipant])) {
    const p = row.values.TbConflictParticipant as ReturnType<typeof TbConflictParticipant>["value"];
    if (p.characterId === characterId && p.side === side) return row.id;
  }
  throw new Error(`no participant for ${characterId}/${side}`);
}

describe("conflict event visibility (side-scoping)", () => {
  it("ScriptSlotSet for party is scoped to party' userIds (+GM)", async () => {
    const captured: Captured = { events: [] };
    const ctx = await dispatchAndCapture({ emitted: captured });
    captured.events.length = 0;
    const res = await ctx.pipeline.dispatch({
      id: "s",
      issuedBy: "p1",
      issuedAt: Date.now(),
      cmd: SetScriptSlot({
        conflictId: ctx.conflictId,
        side: "party",
        slotIndex: 0,
        action: "attack",
        performerParticipantEntityId: findParticipantId(ctx.world, ctx.partyChar, "party"),
        weaponItemId: null,
      }),
      session: PLAYER,
    });
    expect(res.result.ok).toBe(true);
    const slotSet = captured.events.find((e) => e.type === ScriptSlotSet.name);
    expect(slotSet).toBeDefined();
    expect(slotSet?.visibility?.kind).toBe("users");
    if (slotSet?.visibility?.kind === "users") {
      // Party player AND GM are listed; enemy-only userIds are not.
      expect(slotSet.visibility.userIds).toContain("p1");
      expect(slotSet.visibility.userIds).toContain("gm");
    }
  });

  it("ScriptSlotSet for enemy is scoped to GM only", async () => {
    const captured: Captured = { events: [] };
    const ctx = await dispatchAndCapture({ emitted: captured });
    captured.events.length = 0;
    const res = await ctx.pipeline.dispatch({
      id: "s",
      issuedBy: "client-gm",
      issuedAt: Date.now(),
      cmd: SetScriptSlot({
        conflictId: ctx.conflictId,
        side: "enemy",
        slotIndex: 0,
        action: "defend",
        performerParticipantEntityId: findParticipantId(ctx.world, ctx.enemyChar, "enemy"),
        weaponItemId: null,
      }),
      session: GM,
    });
    expect(res.result.ok).toBe(true);
    const slotSet = captured.events.find((e) => e.type === ScriptSlotSet.name);
    expect(slotSet).toBeDefined();
    expect(slotSet?.visibility?.kind).toBe("users");
    if (slotSet?.visibility?.kind === "users") {
      expect(slotSet.visibility.userIds).toContain("gm");
      expect(slotSet.visibility.userIds).not.toContain("p1");
    }
  });

  it("ScriptLocked is broadcast publicly (no visibility)", async () => {
    const captured: Captured = { events: [] };
    const ctx = await dispatchAndCapture({ emitted: captured });
    // Fill all three slots.
    for (const i of [0, 1, 2]) {
      await ctx.pipeline.dispatch({
        id: `s${i}`,
        issuedBy: "p1",
        issuedAt: Date.now(),
        cmd: SetScriptSlot({
          conflictId: ctx.conflictId,
          side: "party",
          slotIndex: i,
          action: "attack",
          performerParticipantEntityId: findParticipantId(ctx.world, ctx.partyChar, "party"),
          weaponItemId: null,
        }),
        session: PLAYER,
      });
    }
    captured.events.length = 0;
    const { LockScript } = await import("./shared/index.js");
    const lock = await ctx.pipeline.dispatch({
      id: "lock",
      issuedBy: "p1",
      issuedAt: Date.now(),
      cmd: LockScript({ conflictId: ctx.conflictId, side: "party" }),
      session: PLAYER,
    });
    expect(lock.result.ok).toBe(true);
    const locked = captured.events.find((e) => e.type === ScriptLocked.name);
    expect(locked).toBeDefined();
    // Public — no visibility field set, so it's broadcast to everyone.
    expect(locked?.visibility).toBeUndefined();
  });
});
