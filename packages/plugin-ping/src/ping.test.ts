// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CommandPipeline,
  EventBus,
  Registry,
  World,
  definePlugin,
} from "@vtt/substrate";
import { Ping, PingReceived, Pong } from "./shared/index.js";
import { PongRecordingSystem } from "./server/systems.js";

const serverPlugin = definePlugin({
  name: "@vtt/ping",
  version: "0.2.0",
  traits: [Pong],
  events: [PingReceived],
  commands: [Ping],
  systems: [PongRecordingSystem],
});

describe("@vtt/ping", () => {
  let registry: Registry;
  let world: World;
  let bus: EventBus;
  let pipeline: CommandPipeline;

  beforeEach(() => {
    registry = new Registry();
    registry.load(serverPlugin);
    world = new World();
    bus = new EventBus();
    pipeline = new CommandPipeline(registry, world, bus);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T12:00:00.500Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers the trait, event, command, and system", () => {
    expect(registry.traits.get(Pong.name)).toBeDefined();
    expect(registry.events.get(PingReceived.name)).toBeDefined();
    expect(registry.commands.get(Ping.name)).toBeDefined();
    expect(registry.systems.find((s) => s.name === "PongRecording")).toBeDefined();
  });

  it("Ping → PingReceived → spawned entity carrying the Pong trait", async () => {
    const issuedAt = Date.now() - 100;
    const before = world.query([Pong]).length;

    const res = await pipeline.dispatch({
      id: "ping-1",
      issuedBy: "alice",
      issuedAt,
      cmd: Ping({ message: "hello", issuedAt }),
    });

    expect(res.result.ok).toBe(true);
    expect(res.events.map((e) => e.type)).toEqual([PingReceived.name]);

    const rows = world.query([Pong]);
    expect(rows).toHaveLength(before + 1);
    const row = rows.at(-1)!;
    expect(row.values).toMatchObject({
      Pong: { message: "hello", pingedAt: issuedAt, pongedAt: Date.now() },
    });
  });

  it("rejects an empty ping message at the schema layer", () => {
    expect(() => Ping({ message: "", issuedAt: Date.now() })).toThrow();
  });

  it("uses plugin-namespaced ubiquitous-language names", () => {
    expect(Ping.name).toBe("@vtt/ping/Ping");
    expect(PingReceived.name).toBe("@vtt/ping/PingReceived");
    expect(Pong.name).toBe("@vtt/ping/Pong");
  });

  it("each ping spawns a distinct entity", async () => {
    for (let i = 0; i < 3; i++) {
      const issuedAt = Date.now() + i;
      await pipeline.dispatch({
        id: `ping-${i}`,
        issuedBy: "alice",
        issuedAt,
        cmd: Ping({ message: `m-${i}`, issuedAt }),
      });
    }
    const rows = world.query([Pong]);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });
});
