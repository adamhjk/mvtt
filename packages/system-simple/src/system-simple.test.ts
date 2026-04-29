import { describe, it, expect } from "vitest";
import { systemSimple } from "./manifest.js";

describe("@vtt/system-simple", () => {
  it("is marked as a game system", () => {
    expect(systemSimple.gameSystem).toBe(true);
  });

  it("declares the baseline shared mechanics as dependencies", () => {
    const names = systemSimple.dependsOn.map((d) => d.split("@", 2).join("@"));
    expect(names).toEqual(
      expect.arrayContaining([
        "@vtt/dice-tray",
        "@vtt/characters",
        "@vtt/scene",
        "@vtt/books",
        "@vtt/pdf-book",
      ]),
    );
  });

  it("contributes no traits/events/commands of its own (it's a marker)", () => {
    expect(systemSimple.traits).toHaveLength(0);
    expect(systemSimple.events).toHaveLength(0);
    expect(systemSimple.commands).toHaveLength(0);
    expect(systemSimple.systems).toHaveLength(0);
  });
});
