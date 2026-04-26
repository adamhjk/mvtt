import { describe, it, expect } from "vitest";
import { defineTrait, z } from "./index.js";
import { World } from "./world.js";

const Health = defineTrait({
  name: "@test/world/Health",
  schema: z.object({ current: z.number().int(), max: z.number().int().positive() }),
});

const Name = defineTrait({
  name: "@test/world/Name",
  schema: z.object({ value: z.string() }),
});

describe("World", () => {
  it("spawns entities with traits and reads them back", () => {
    const w = new World();
    const id = w.spawn([Health({ current: 5, max: 10 }), Name({ value: "hero" })]);
    const got = w.get(id, [Health, Name]) as { Health: { current: number; max: number }; Name: { value: string } };
    expect(got).toBeDefined();
    expect(got.Health.current).toBe(5);
    expect(got.Name.value).toBe("hero");
  });

  it("returns undefined when a required trait is missing", () => {
    const w = new World();
    const id = w.spawn([Health({ current: 5, max: 10 })]);
    expect(w.get(id, [Health, Name])).toBeUndefined();
  });

  it("set replaces a trait atomically and notifies subscribers", () => {
    const w = new World();
    const id = w.spawn([Health({ current: 5, max: 10 })]);
    const calls: Array<{ id: string; trait: string }> = [];
    w.subscribe((eid, trait) => calls.push({ id: eid, trait }));
    w.set(id, Health, { current: 3, max: 10 });
    const got = w.get(id, [Health]) as { Health: { current: number } };
    expect(got.Health.current).toBe(3);
    expect(calls).toEqual([{ id, trait: "@test/world/Health" }]);
  });

  it("spawn notifies subscribers for every initial trait", () => {
    const w = new World();
    const calls: Array<{ id: string; trait: string }> = [];
    w.subscribe((eid, trait) => calls.push({ id: eid, trait }));
    const id = w.spawn([Health({ current: 5, max: 10 }), Name({ value: "x" })]);
    expect(calls).toEqual([
      { id, trait: "@test/world/Health" },
      { id, trait: "@test/world/Name" },
    ]);
  });

  it("despawn notifies subscribers for every removed trait", () => {
    const w = new World();
    const id = w.spawn([Health({ current: 5, max: 10 }), Name({ value: "x" })]);
    const calls: Array<{ id: string; trait: string }> = [];
    w.subscribe((eid, trait) => calls.push({ id: eid, trait }));
    w.despawn(id);
    expect(calls).toEqual([
      { id, trait: "@test/world/Health" },
      { id, trait: "@test/world/Name" },
    ]);
  });

  it("restore fires subscribers for every (entity, trait) in the union of old and new state", () => {
    // Old state: e1 has Health
    const w = new World();
    const before = w.spawn([Health({ current: 1, max: 1 })]);
    const calls: Array<{ id: string; trait: string }> = [];
    w.subscribe((eid, trait) => calls.push({ id: eid, trait }));

    // New state: e2 has Name, Health (different entity ids entirely)
    w.restore({
      nextId: 7,
      entities: {
        e2: { "@test/world/Name": { value: "after" }, "@test/world/Health": { current: 9, max: 9 } },
      },
    });

    // The pre-existing entity's Health is gone → notify; new entity's two
    // traits arrive → notify. Order is "old first, new second", deduped.
    expect(calls).toEqual([
      { id: before, trait: "@test/world/Health" },
      { id: "e2", trait: "@test/world/Name" },
      { id: "e2", trait: "@test/world/Health" },
    ]);

    expect(w.query([Name]).map((r) => r.id)).toEqual(["e2"]);
  });

  it("query returns only entities with all required traits", () => {
    const w = new World();
    const a = w.spawn([Health({ current: 1, max: 1 }), Name({ value: "a" })]);
    w.spawn([Health({ current: 2, max: 2 })]); // no Name
    const out = w.query([Health, Name]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(a);
  });

  it("rejects setting a trait on an unknown entity", () => {
    const w = new World();
    expect(() => w.set("missing", Health, { current: 1, max: 1 })).toThrow();
  });

  it("validates trait writes against the schema", () => {
    const w = new World();
    const id = w.spawn([Health({ current: 5, max: 10 })]);
    expect(() => w.set(id, Health, { current: 5, max: 0 })).toThrow();
  });
});
