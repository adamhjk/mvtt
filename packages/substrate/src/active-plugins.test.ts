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
import { definePlugin, resolveActivePlugins, listGameSystems } from "./index.js";

const infra = (name: string) =>
  definePlugin({ name, version: "0", dependsOn: ["@vtt/substrate@^0"] });

const sharedMech = (name: string, deps: string[] = []) =>
  definePlugin({
    name,
    version: "0",
    dependsOn: ["@vtt/substrate@^0", ...deps],
  });

const gameSys = (name: string, deps: string[]) =>
  definePlugin({
    name,
    version: "0",
    dependsOn: ["@vtt/substrate@^0", ...deps],
    gameSystem: true,
  });

describe("resolveActivePlugins", () => {
  it("includes infrastructure plus game system plus its transitive deps", () => {
    const auth = infra("@vtt/auth");
    const identity = infra("@vtt/identity");
    const dice = sharedMech("@vtt/dice-tray");
    const characters = sharedMech("@vtt/characters", ["@vtt/identity@^0"]);
    const simple = gameSys("@vtt/system-simple", ["@vtt/dice-tray@^0", "@vtt/characters@^0"]);
    // An optional plugin that has nothing to do with this game system —
    // must NOT be activated.
    const irrelevant = sharedMech("@vtt/some-other-mechanic");

    const result = resolveActivePlugins({
      infrastructure: [auth, identity],
      optional: [dice, characters, simple, irrelevant],
      gameSystemPlugin: "@vtt/system-simple",
    });

    const names = result.plugins.map((p) => p.name).sort();
    expect(names).toEqual(
      [
        "@vtt/auth",
        "@vtt/identity",
        "@vtt/dice-tray",
        "@vtt/characters",
        "@vtt/system-simple",
      ].sort(),
    );
    expect(names).not.toContain("@vtt/some-other-mechanic");
    expect(result.gameSystem.name).toBe("@vtt/system-simple");
  });

  it("infrastructure plugins come before game-system plugins (load order)", () => {
    const auth = infra("@vtt/auth");
    const dice = sharedMech("@vtt/dice-tray");
    const simple = gameSys("@vtt/system-simple", ["@vtt/dice-tray@^0"]);

    const result = resolveActivePlugins({
      infrastructure: [auth],
      optional: [dice, simple],
      gameSystemPlugin: "@vtt/system-simple",
    });

    const names: string[] = result.plugins.map((p) => p.name);
    expect(names.indexOf("@vtt/auth")).toBeLessThan(names.indexOf("@vtt/dice-tray"));
    expect(names.indexOf("@vtt/dice-tray")).toBeLessThan(names.indexOf("@vtt/system-simple"));
  });

  it("ignores @vtt/substrate dependsOn (auto-loaded by Registry)", () => {
    const simple = gameSys("@vtt/system-simple", []);
    const result = resolveActivePlugins({
      infrastructure: [],
      optional: [simple],
      gameSystemPlugin: "@vtt/system-simple",
    });
    expect(result.plugins.map((p) => p.name)).toEqual(["@vtt/system-simple"]);
  });

  it("throws if game system plugin is not registered", () => {
    expect(() =>
      resolveActivePlugins({
        infrastructure: [],
        optional: [],
        gameSystemPlugin: "@vtt/nonexistent",
      }),
    ).toThrow(/unknown game-system plugin/);
  });

  it("throws if the named plugin exists but isn't marked gameSystem", () => {
    const dice = sharedMech("@vtt/dice-tray");
    expect(() =>
      resolveActivePlugins({
        infrastructure: [],
        optional: [dice],
        gameSystemPlugin: "@vtt/dice-tray",
      }),
    ).toThrow(/not marked gameSystem/);
  });

  it("throws if a transitive dep is missing from the active set", () => {
    const simple = gameSys("@vtt/system-simple", ["@vtt/dice-tray@^0"]);
    expect(() =>
      resolveActivePlugins({
        infrastructure: [],
        optional: [simple],
        gameSystemPlugin: "@vtt/system-simple",
      }),
    ).toThrow(/@vtt\/dice-tray.*not present/);
  });

  it("handles diamond dependencies without duplicating", () => {
    const identity = infra("@vtt/identity");
    const a = sharedMech("@vtt/a", ["@vtt/identity@^0"]);
    const b = sharedMech("@vtt/b", ["@vtt/identity@^0"]);
    const game = gameSys("@vtt/g", ["@vtt/a@^0", "@vtt/b@^0"]);
    const result = resolveActivePlugins({
      infrastructure: [identity],
      optional: [a, b, game],
      gameSystemPlugin: "@vtt/g",
    });
    const names: string[] = result.plugins.map((p) => p.name);
    expect(names.filter((n) => n === "@vtt/identity")).toHaveLength(1);
  });
});

describe("listGameSystems", () => {
  it("returns only plugins marked gameSystem: true", () => {
    const a = definePlugin({ name: "@vtt/a", version: "0" });
    const b = definePlugin({ name: "@vtt/b", version: "0", gameSystem: true });
    const c = definePlugin({ name: "@vtt/c", version: "0", gameSystem: true });
    expect(listGameSystems([a, b, c]).map((p) => p.name)).toEqual(["@vtt/b", "@vtt/c"]);
  });
});
