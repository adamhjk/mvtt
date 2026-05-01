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

import { describe, it, expect } from "vitest";
import {
  defineSlot,
  defineSurface,
  defineView,
  definePlugin,
  z,
} from "./index.js";
import { Registry } from "./registry.js";

const Sidebar = defineSurface({
  name: "@test/shell/sidebar",
  kind: "stacked",
  context: z.object({}),
});

const Header = defineSurface({
  name: "@test/shell/header",
  kind: "stacked",
  context: z.object({}),
});

describe("Registry surface validation", () => {
  it("passes when every view targets a declared surface", () => {
    const ViewA = defineView({
      name: "ViewA",
      surface: Sidebar,
      render: () => null,
    });
    const r = new Registry();
    r.load(
      definePlugin({
        name: "@test/shell",
        version: "0.0.0",
        surfaces: [Sidebar, Header],
      }),
    );
    r.load(
      definePlugin({
        name: "@test/widget",
        version: "0.0.0",
        views: [ViewA],
      }),
    );
    expect(() => r.validate()).not.toThrow();
  });

  it("rejects a view whose surface is not declared anywhere", () => {
    const ViewA = defineView({
      name: "ViewA",
      surface: Sidebar,
      render: () => null,
    });
    const r = new Registry();
    r.load(
      definePlugin({
        name: "@test/widget",
        version: "0.0.0",
        views: [ViewA],
      }),
    );
    expect(() => r.validate()).toThrow(/unknown surface/);
  });

  it("orders views by descending priority within a surface", () => {
    const Lo = defineView({ name: "Lo", surface: Sidebar, priority: 0, render: () => null });
    const Hi = defineView({ name: "Hi", surface: Sidebar, priority: 100, render: () => null });
    const Mid = defineView({ name: "Mid", surface: Sidebar, priority: 50, render: () => null });
    const r = new Registry();
    r.load(
      definePlugin({
        name: "@test/shell",
        version: "0.0.0",
        surfaces: [Sidebar],
      }),
    );
    r.load(
      definePlugin({
        name: "@test/widget",
        version: "0.0.0",
        views: [Lo, Hi, Mid],
      }),
    );
    expect(r.viewsForSurface(Sidebar.name).map((v) => v.name)).toEqual(["Hi", "Mid", "Lo"]);
  });
});

describe("Registry slots and fills", () => {
  const QuickRolls = defineSlot({
    name: "@test/dice/quick-rolls",
    schema: z.string().regex(/^\d+d\d+/),
  });
  const SpellTemplates = defineSlot({
    name: "@test/spells/templates",
    schema: z.object({ id: z.string(), level: z.number().int().min(0) }),
  });

  it("accumulates fills from multiple plugins and exposes them via fillsForSlot", () => {
    const r = new Registry();
    r.load(
      definePlugin({
        name: "@test/dice",
        version: "0.0.0",
        slots: [QuickRolls],
      }),
    );
    r.load(
      definePlugin({
        name: "@test/dice-presets",
        version: "0.0.0",
        fills: { [QuickRolls.name]: ["1d20", "2d6+3"] },
      }),
    );
    r.load(
      definePlugin({
        name: "@test/dice-extra",
        version: "0.0.0",
        fills: { [QuickRolls.name]: ["4d6kh3"] },
      }),
    );
    r.validate();
    expect(r.fillsForSlot(QuickRolls)).toEqual(["1d20", "2d6+3", "4d6kh3"]);
  });

  it("fillsForSlot returns [] for an unfilled but declared slot", () => {
    const r = new Registry();
    r.load(definePlugin({ name: "@test/dice", version: "0.0.0", slots: [QuickRolls] }));
    r.validate();
    expect(r.fillsForSlot(QuickRolls)).toEqual([]);
  });

  it("rejects fills for an undeclared slot at validate time", () => {
    const r = new Registry();
    r.load(
      definePlugin({
        name: "@test/orphan",
        version: "0.0.0",
        fills: { [QuickRolls.name]: ["1d20"] },
      }),
    );
    expect(() => r.validate()).toThrow(/fills unknown slot/);
  });

  it("rejects fill values that don't match the slot's schema", () => {
    const r = new Registry();
    r.load(
      definePlugin({
        name: "@test/spells",
        version: "0.0.0",
        slots: [SpellTemplates],
      }),
    );
    r.load(
      definePlugin({
        name: "@test/spell-pack",
        version: "0.0.0",
        fills: {
          [SpellTemplates.name]: [
            { id: "fireball", level: 3 },
            { id: "missing-level" }, // bad
            { id: "magic-missile", level: 1 },
          ],
        },
      }),
    );
    expect(() => r.validate()).toThrow(/failed schema/);
  });

  it("buffer fills until validate(), so plugin load order doesn't matter", () => {
    const r = new Registry();
    // Filler loaded BEFORE the plugin that declares the slot — should not
    // throw at load time, only validate enforces the contract.
    expect(() =>
      r.load(
        definePlugin({
          name: "@test/dice-presets",
          version: "0.0.0",
          fills: { [QuickRolls.name]: ["1d20"] },
        }),
      ),
    ).not.toThrow();
    r.load(definePlugin({ name: "@test/dice", version: "0.0.0", slots: [QuickRolls] }));
    r.validate();
    expect(r.fillsForSlot(QuickRolls)).toEqual(["1d20"]);
  });
});
