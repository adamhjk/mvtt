import { describe, it, expect } from "vitest";
import {
  isPluginName,
  isQualifiedName,
  pluginName,
  qualifiedName,
  traitName,
  eventName,
  commandName,
  surfaceName,
  slotName,
  QualifiedNameSchema,
  defineTrait,
  defineEvent,
  defineCommand,
  defineSurface,
  defineSlot,
  ok,
  z,
  type TraitName,
  type EventName,
  type CommandName,
  type SurfaceName,
  type SlotName,
  type PluginName,
} from "./index.js";
import { Registry } from "./registry.js";

describe("qualified-name brands", () => {
  it.each([
    "@vtt/scene/Position",
    "@vtt/d20-initiative/EndTurn",
    "@vtt/dnd5e/HitDice",
    "@scope/plugin-name/SomeType",
  ])("accepts %s", (s) => {
    expect(isQualifiedName(s)).toBe(true);
    expect(qualifiedName(s)).toBe(s);
  });

  it.each([
    "Position",
    "@vtt/Position",
    "vtt/scene/Position",
    "@vtt/scene/",
    "@/scene/Position",
    "@vtt//Position",
    "@vtt/scene/Position/Extra",
    "",
  ])("rejects %s", (s) => {
    expect(isQualifiedName(s)).toBe(false);
    expect(() => qualifiedName(s)).toThrow();
  });

  it("validates via a Zod schema at the wire boundary", () => {
    expect(QualifiedNameSchema.parse("@vtt/scene/Position")).toBe("@vtt/scene/Position");
    expect(() => QualifiedNameSchema.parse("not-qualified")).toThrow();
  });

  it("definers reject malformed names at definition time", () => {
    expect(() =>
      defineTrait({ name: "Health", schema: z.object({}) }),
    ).toThrow();
    expect(() =>
      defineEvent({ name: "@vtt/Pong", schema: z.object({}) }),
    ).toThrow();
    expect(() =>
      defineCommand({
        name: "Ping",
        schema: z.object({}),
        validate: () => ok(),
        apply: () => [],
      }),
    ).toThrow();
    expect(() =>
      defineSurface({
        name: "side-panel",
        kind: "stacked",
        context: z.object({}),
      }),
    ).toThrow();
    expect(() =>
      defineSlot({ name: "spell-templates", schema: z.object({}) }),
    ).toThrow();
  });

  it("kinds are not interchangeable at the type level", () => {
    const tn: TraitName = traitName("@test/x/A");
    const en: EventName = eventName("@test/x/A");
    const cn: CommandName = commandName("@test/x/A");
    const sn: SurfaceName = surfaceName("@test/x/A");
    const sln: SlotName = slotName("@test/x/A");

    // values are equal at runtime — the brand exists only in the type system
    expect(tn).toBe(en);
    expect(tn).toBe(cn);
    expect(tn).toBe(sn);
    expect(tn).toBe(sln);

    // But the type system rejects cross-kind use:
    const reg = new Registry();
    // @ts-expect-error — TraitName is not assignable to EventName key
    reg.events.get(tn);
    // @ts-expect-error — EventName is not assignable to CommandName key
    reg.commands.get(en);
    // @ts-expect-error — CommandName is not assignable to TraitName key
    reg.traits.get(cn);
    // @ts-expect-error — SurfaceName is not assignable to TraitName key
    reg.traits.get(sn);
    // @ts-expect-error — SlotName is not assignable to SurfaceName key
    reg.surfaces.get(sln);
  });

  it.each([
    "@vtt/scene",
    "@vtt/d20-initiative",
    "@scope/plugin-name",
  ])("plugin name accepts %s (two-segment)", (s) => {
    expect(isPluginName(s)).toBe(true);
    expect(pluginName(s)).toBe(s);
  });

  it.each([
    "vtt/scene",
    "@vtt",
    "@vtt/scene/Position", // three segments — that's a QualifiedName, not a PluginName
    "@/scene",
    "",
  ])("plugin name rejects %s", (s) => {
    expect(isPluginName(s)).toBe(false);
    expect(() => pluginName(s)).toThrow();
  });

  it("PluginName is distinct from QualifiedName", () => {
    const pn: PluginName = pluginName("@vtt/scene");
    expect(typeof pn).toBe("string");
    // @ts-expect-error — PluginName isn't a QualifiedName
    const qn: TraitName = pn;
    void qn;
  });
});
