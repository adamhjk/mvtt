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
import {
  defineCommand,
  defineEvent,
  defineSystem,
  defineTrait,
  definePlugin,
  fail,
  ok,
  z,
} from "./index.js";
import { World } from "./world.js";
import { EventBus } from "./event-bus.js";
import { Registry } from "./registry.js";
import { CommandPipeline } from "./command-pipeline.js";

const Counter = defineTrait({
  name: "@test/counter/Counter",
  schema: z.object({ n: z.number().int() }),
});

const Increment = defineEvent({
  name: "@test/counter/Increment",
  schema: z.object({ entityId: z.string(), by: z.number().int() }),
});

const Doubled = defineEvent({
  name: "@test/counter/Doubled",
  schema: z.object({ entityId: z.string(), to: z.number().int() }),
});

const Bump = defineCommand({
  name: "@test/counter/Bump",
  schema: z.object({ entityId: z.string(), by: z.number().int() }),
  validate: ({ cmd, world }) => {
    if (!world.has(cmd.entityId)) return fail("missing entity");
    return ok();
  },
  apply: ({ cmd }) => [Increment({ entityId: cmd.entityId, by: cmd.by })],
});

const IncrementSystem = defineSystem({
  name: "Increment",
  on: Increment,
  reads: [Counter],
  writes: [Counter],
  run: ({ event, world }) => {
    const cur = world.get(event.entityId, [Counter]) as { Counter: { n: number } } | undefined;
    if (!cur) return [];
    const next = cur.Counter.n + event.by;
    world.set(event.entityId, Counter, { n: next });
    return next > 0 && next % 2 === 0
      ? [Doubled({ entityId: event.entityId, to: next })]
      : [];
  },
});

function setup() {
  const registry = new Registry();
  registry.load(
    definePlugin({
      name: "@test/plugin",
      version: "0.0.0",
      events: [Increment, Doubled],
      commands: [Bump],
      systems: [IncrementSystem],
      traits: [Counter],
    }),
  );
  const world = new World();
  const bus = new EventBus();
  const pipeline = new CommandPipeline(registry, world, bus);
  return { registry, world, bus, pipeline };
}

describe("CommandPipeline", () => {
  it("rejects a command whose validate fails and emits no events", async () => {
    const { pipeline, bus } = setup();
    const seen: string[] = [];
    bus.onAny((e) => seen.push(e.type));
    const res = await pipeline.dispatch({
      id: "c1",
      issuedBy: "tester",
      issuedAt: 1,
      cmd: Bump({ entityId: "ghost", by: 1 }),
    });
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) expect(res.result.reason).toBe("missing entity");
    expect(res.events).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("applies command, runs systems to fixpoint, and broadcasts", async () => {
    const { pipeline, world, bus } = setup();
    const id = world.spawn([Counter({ n: 1 })]);
    const seen: string[] = [];
    bus.onAny((e) => seen.push(e.type));
    const res = await pipeline.dispatch({
      id: "c1",
      issuedBy: "tester",
      issuedAt: 1,
      cmd: Bump({ entityId: id, by: 1 }),
    });
    expect(res.result.ok).toBe(true);
    expect(res.events.map((e) => e.type)).toEqual([Increment.name, Doubled.name]);
    expect(seen).toEqual([Increment.name, Doubled.name]);
    const got = world.get(id, [Counter]) as { Counter: { n: number } };
    expect(got.Counter.n).toBe(2);
  });

  it("dedups by command id", async () => {
    const { pipeline, world } = setup();
    const id = world.spawn([Counter({ n: 0 })]);
    const env = {
      id: "same-id",
      issuedBy: "tester",
      issuedAt: 1,
      cmd: Bump({ entityId: id, by: 1 }),
    };
    const a = await pipeline.dispatch(env);
    const b = await pipeline.dispatch(env);
    expect(a.result.ok).toBe(true);
    expect(b.result.ok).toBe(false);
    if (!b.result.ok) expect(b.result.reason).toMatch(/duplicate/);
    const got = world.get(id, [Counter]) as { Counter: { n: number } };
    expect(got.Counter.n).toBe(1);
  });

  it("logs events with sequence numbers", async () => {
    const { pipeline, world } = setup();
    const id = world.spawn([Counter({ n: 1 })]);
    await pipeline.dispatch({
      id: "c1",
      issuedBy: "tester",
      issuedAt: 1,
      cmd: Bump({ entityId: id, by: 1 }),
    });
    expect(pipeline.log.map((e) => [e.seq, e.event.type])).toEqual([
      [1, Increment.name],
      [2, Doubled.name],
    ]);
  });
});
