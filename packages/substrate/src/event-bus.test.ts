import { describe, it, expect } from "vitest";
import { defineEvent, z } from "./index.js";
import { EventBus } from "./event-bus.js";

const Tick = defineEvent({ name: "@test/clock/Tick", schema: z.object({ n: z.number() }) });
const Tock = defineEvent({ name: "@test/clock/Tock", schema: z.object({ n: z.number() }) });

describe("EventBus", () => {
  it("delivers events to typed subscribers only", () => {
    const bus = new EventBus();
    const ticks: number[] = [];
    const tocks: number[] = [];
    bus.on(Tick.name, (e) => ticks.push((e.payload as { n: number }).n));
    bus.on(Tock.name, (e) => tocks.push((e.payload as { n: number }).n));
    bus.emit(Tick({ n: 1 }));
    bus.emit(Tock({ n: 2 }));
    bus.emit(Tick({ n: 3 }));
    expect(ticks).toEqual([1, 3]);
    expect(tocks).toEqual([2]);
  });

  it("supports a wildcard listener", () => {
    const bus = new EventBus();
    const all: string[] = [];
    bus.onAny((e) => all.push(e.type));
    bus.emit(Tick({ n: 1 }));
    bus.emit(Tock({ n: 2 }));
    expect(all).toEqual([Tick.name, Tock.name]);
  });

  it("returns an unsubscribe function", () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.on(Tick.name, () => count++);
    bus.emit(Tick({ n: 1 }));
    off();
    bus.emit(Tick({ n: 2 }));
    expect(count).toBe(1);
  });
});
