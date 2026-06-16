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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { startServer, type ServerHandle } from "@vtt/substrate/server";
import { definePlugin, InMemoryWorldsRepository, type EntityId } from "@vtt/substrate";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "@vtt/notes";
import { items } from "@vtt/items";
import { ItemIdentity } from "@vtt/items/shared";
import { characters } from "@vtt/characters";
import { Character } from "@vtt/characters/shared";
import type { AuthSession } from "@vtt/auth";
import {
  AssignLightCoverage,
  GRIND_SENTINEL_ID,
  Grind,
  LightCoverage,
  LightCoverageChanged,
  LightCoverageSystem,
  lightSourceKey,
  TbCarries,
} from "@vtt/system-torchbearer/shared";

// A light-only host game system: just enough of the Torchbearer surface to
// exercise the AssignLightCoverage wire payload (which gained dimCharacterIds).
// Keeps the smoke off the full TB plugin graph — this is a transport test.
const lightHost = definePlugin({
  name: "@vtt/light-smoke-host",
  version: "0",
  dependsOn: ["@vtt/characters@^0", "@vtt/items@^0"],
  traits: [TbCarries, Grind, LightCoverage],
  events: [LightCoverageChanged],
  commands: [AssignLightCoverage],
  systems: [LightCoverageSystem],
  gameSystem: true,
});

const GM: AuthSession = {
  userId: "gm-1",
  email: "gm@test.dev",
  name: "GM",
  role: "gm",
};

interface AckMsg {
  kind: "ack";
  commandId: string;
  ok: boolean;
  reason?: string;
}
interface EventMsg {
  kind: "event";
  seq: number;
  event: { type: string; payload: Record<string, unknown> };
}
type Msg =
  | { kind: "hello"; clientId: string }
  | { kind: "snapshot"; atSeq: number }
  | { kind: "synced" }
  | AckMsg
  | EventMsg;

describe("light coverage wire smoke", () => {
  let handle: ServerHandle;
  let worldId: string;
  let ws: WebSocket;
  const messages: Msg[] = [];

  beforeAll(async () => {
    const worldsRepo = new InMemoryWorldsRepository();
    await worldsRepo.migrate();
    const world = await worldsRepo.insert({
      id: "light-smoke",
      name: "Light smoke",
      gameSystemPlugin: lightHost.name,
      ownerUserId: GM.userId,
    });
    worldId = world.id;
    handle = await startServer({
      port: 0,
      infrastructure: [shellWorkbench, identity, permissions, notes],
      optional: [items, characters, lightHost],
      worldsRepo,
      authenticateUpgrade: async () => GM,
      extractRecipient: (s) => {
        const sess = s as AuthSession | null;
        return sess ? { userId: sess.userId, role: sess.role } : null;
      },
    });
  });

  afterAll(async () => {
    if (ws && ws.readyState === ws.OPEN) ws.close();
    if (handle) await handle.close();
  });

  it("round-trips AssignLightCoverage carrying dimCharacterIds across the wire", async () => {
    ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?worldId=${worldId}`);
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as Msg));
    await new Promise<void>((r) => ws.on("open", () => r()));

    // Seed the prerequisites server-side: the grind sentinel and a holder
    // carrying a lit torch, plus two more PCs.
    const runtime = handle.worldsRegistry.get(worldId)!;
    runtime.world.spawnAt(GRIND_SENTINEL_ID, [
      Grind({ turn: 0 }),
      LightCoverage({ assignments: {} }),
    ]);
    const torchId = runtime.world.spawn([ItemIdentity({ name: "Torch" })]);
    const holderId = runtime.world.spawn([
      Character({ name: "Bryn" }),
      TbCarries({
        entries: [
          {
            slot: "handR",
            slotIndex: 0,
            channel: "carried",
            slotsConsumed: 1,
            itemId: torchId as EntityId,
            quantity: 1,
            state: { lit: true, turnsRemaining: 2 },
          },
        ],
      }),
    ]);
    const dimCharId = runtime.world.spawn([Character({ name: "Eowyn" })]);

    // Torch covers 2 in full (bearer + 1) and 2 in dim. Assign one dim char.
    ws.send(
      JSON.stringify({
        kind: "command",
        id: "assign-light",
        issuedAt: Date.now(),
        cmd: {
          type: AssignLightCoverage.name,
          payload: {
            holderId,
            entryIndex: 0,
            coveredCharacterIds: [],
            dimCharacterIds: [dimCharId],
          },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));

    // The command was accepted across the wire.
    const acks = messages.filter((m): m is AckMsg => m.kind === "ack");
    expect(acks.find((a) => a.commandId === "assign-light")?.ok).toBe(true);

    // The mirror persisted both rings — holder auto-included in full, the
    // dim char round-tripped through the new wire field.
    const cov = runtime.world.get(GRIND_SENTINEL_ID, [LightCoverage]) as {
      LightCoverage: {
        assignments: Record<
          string,
          { coveredCharacterIds: EntityId[]; dimCharacterIds: EntityId[] }
        >;
      };
    };
    const key = lightSourceKey(holderId, 0);
    expect(cov.LightCoverage.assignments[key]!.coveredCharacterIds).toEqual([holderId]);
    expect(cov.LightCoverage.assignments[key]!.dimCharacterIds).toEqual([dimCharId]);

    // The broadcast event carried dimCharacterIds on the wire.
    const lightEvent = messages
      .filter((m): m is EventMsg => m.kind === "event")
      .find((m) => m.event.type === LightCoverageChanged.name);
    expect(lightEvent?.event.payload.dimCharacterIds).toEqual([dimCharId]);
  });
});
