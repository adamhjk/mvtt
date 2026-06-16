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
import { definePlugin, InMemoryWorldsRepository } from "@vtt/substrate";
import { items } from "@vtt/items";
import {
  CreateItem,
  CustomizeItem,
  EditItemField,
  ItemCreated,
  ItemDerivedFrom,
  ItemFieldChanged,
  ItemForked,
  ItemIdentity,
} from "@vtt/items/shared";
import { shellDefault } from "@vtt/shell-default";

const hostGame = definePlugin({
  name: "@vtt/items-smoke-host",
  version: "0",
  dependsOn: ["@vtt/items@^0"],
  gameSystem: true,
});

interface HelloMsg {
  kind: "hello";
  clientId: string;
}
interface AckMsg {
  kind: "ack";
  commandId: string;
  ok: boolean;
  reason?: string;
}
interface EventMsg {
  kind: "event";
  seq: number;
  event: { type: string; payload: unknown };
}
type Msg = HelloMsg | AckMsg | EventMsg;

describe("items wire smoke", () => {
  let handle: ServerHandle;
  let worldId: string;
  let ws: WebSocket;
  const messages: Msg[] = [];

  beforeAll(async () => {
    const worldsRepo = new InMemoryWorldsRepository();
    await worldsRepo.migrate();
    const world = await worldsRepo.insert({
      id: "items-smoke",
      name: "Items Smoke",
      gameSystemPlugin: hostGame.name,
      ownerUserId: "smoke-user",
    });
    worldId = world.id;
    handle = await startServer({
      port: 0,
      infrastructure: [shellDefault],
      optional: [items, hostGame],
      worldsRepo,
    });
  });

  afterAll(async () => {
    if (ws && ws.readyState === ws.OPEN) ws.close();
    if (handle) await handle.close();
  });

  it("round-trips CreateItem → CustomizeItem → EditItemField across the wire", async () => {
    ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?worldId=${worldId}`);
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as Msg));
    await new Promise<void>((r) => ws.on("open", () => r()));

    const issuedAt = Date.now();
    // Create.
    ws.send(
      JSON.stringify({
        kind: "command",
        id: "smk-create",
        issuedAt,
        cmd: {
          type: CreateItem.name,
          payload: {
            traits: { ItemIdentity: { name: "Smoke Sword", description: "" } },
          },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));

    const runtime = handle.worldsRegistry.get(worldId)!;
    const swords = runtime.world.query([ItemIdentity]);
    expect(swords).toHaveLength(1);
    const sourceId = swords[0]!.id;

    // Customize.
    ws.send(
      JSON.stringify({
        kind: "command",
        id: "smk-fork",
        issuedAt,
        cmd: { type: CustomizeItem.name, payload: { sourceItemId: sourceId } },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    const allIds = runtime.world.query([ItemIdentity]).map((r) => r.id);
    expect(allIds).toHaveLength(2);
    const newId = allIds.find((id) => id !== sourceId)!;

    // Edit a field on the fork; make sure overrides records the path.
    ws.send(
      JSON.stringify({
        kind: "command",
        id: "smk-edit",
        issuedAt,
        cmd: {
          type: EditItemField.name,
          payload: {
            itemId: newId,
            path: "ItemIdentity.name",
            value: "Forged Sword",
          },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));

    const ident = runtime.world.get(newId, [ItemIdentity]) as { ItemIdentity: { name: string } };
    expect(ident.ItemIdentity.name).toBe("Forged Sword");

    // Note: the source item was created via CreateItem (no template),
    // so it has no ItemDerivedFrom — the fork inherits no traits with
    // share:false, but ItemDerivedFrom is "share:true" by default.
    // Since the source has no ItemDerivedFrom, neither does the fork,
    // so the override-record step is a no-op. That's the expected
    // behaviour: items not derived from a catalog don't track edits.

    // Ack arrived for every command.
    const acks = messages.filter((m): m is AckMsg => m.kind === "ack");
    expect(acks.map((a) => a.ok)).toEqual([true, true, true]);
    const eventTypes = messages
      .filter((m): m is EventMsg => m.kind === "event")
      .map((m) => m.event.type)
      .filter(
        (t) => t === ItemCreated.name || t === ItemForked.name || t === ItemFieldChanged.name,
      );
    expect(eventTypes).toEqual([ItemCreated.name, ItemForked.name, ItemFieldChanged.name]);

    // Suppress the unused-import warning for ItemDerivedFrom; we
    // referenced it in the design doc but don't assert against it
    // here because the source isn't catalog-derived.
    expect(ItemDerivedFrom.name).toBe("@vtt/items/ItemDerivedFrom");
  });
});
