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

import { describe, expect, it } from "vitest";
import { tbOutcome } from "./client/chat-timeline.js";
import { TB_ROLL_META_SYSTEM, type TbRollSpec } from "./shared/index.js";

type Die = { sides: number | "F"; value: number };
const d6 = (...vals: number[]): Die[] => vals.map((value) => ({ sides: 6, value }));

function spec(over: Partial<TbRollSpec> = {}): TbRollSpec {
  return {
    kind: "ability",
    source: "Will",
    sourceId: "will",
    baseDice: 4,
    pool: 4,
    bonusSuccesses: 0,
    heroic: false,
    successTarget: 4,
    baseObstacle: 2,
    obstacle: 2,
    modifiers: [],
    caption: "Bryn — Will",
    ...over,
  } as TbRollSpec;
}

/** A peer Roll row carrying its own TB spec + comparable total. */
function row(id: string, versusTestId: string, total: number) {
  return {
    id,
    values: {
      Formula: { meta: { system: TB_ROLL_META_SYSTEM, spec: spec({ versusTestId }) } },
      RollResult: { total },
    },
  };
}

describe("tbOutcome — Recent-pill outcome", () => {
  it("independent pass shows pass, successes, and positive margin", () => {
    // 4 successes (6,5,4,4) vs Ob 2 → margin +2.
    const out = tbOutcome("self", spec({ obstacle: 2 }), d6(6, 5, 4, 4, 1), []);
    expect(out).toEqual({ tone: "success", text: "Pass · 4s vs Ob 2 · +2" });
  });

  it("independent fail shows fail, successes, and negative margin", () => {
    // 1 success (5) vs Ob 4 → margin −3.
    const out = tbOutcome("self", spec({ obstacle: 4 }), d6(5, 1, 2, 2), []);
    expect(out).toEqual({ tone: "fail", text: "Fail · 1s vs Ob 4 · −3" });
  });

  it("meeting the obstacle exactly is a pass with +0 margin", () => {
    // 2 successes (5,6) vs Ob 2 → margin +0.
    const out = tbOutcome("self", spec({ obstacle: 2 }), d6(5, 6, 1, 2), []);
    expect(out).toEqual({ tone: "success", text: "Pass · 2s vs Ob 2 · +0" });
  });

  it("with no obstacle, any success passes and only the count shows", () => {
    expect(tbOutcome("self", spec({ obstacle: null }), d6(5, 1, 1, 1), [])).toEqual({
      tone: "success",
      text: "Pass · 1s",
    });
    expect(tbOutcome("self", spec({ obstacle: null }), d6(1, 1, 1, 1), [])).toEqual({
      tone: "fail",
      text: "Fail · 0s",
    });
  });

  it("versus win shows win, both counts, and the margin", () => {
    const self = spec({ versusTestId: "v1" });
    // mine = 4 successes (6,5,4,4); opponent total 2 → win by 2.
    const out = tbOutcome("self", self, d6(6, 5, 4, 4), [
      { id: "self", values: {} },
      row("opp", "v1", 2),
    ]);
    expect(out).toEqual({ tone: "success", text: "Win · 4s vs 2s · +2" });
  });

  it("versus loss shows loss and a negative margin", () => {
    const self = spec({ versusTestId: "v1" });
    // mine = 1 success (5); opponent total 3 → loss by 2.
    const out = tbOutcome("self", self, d6(5, 1, 2, 2), [row("opp", "v1", 3)]);
    expect(out).toEqual({ tone: "fail", text: "Loss · 1s vs 3s · −2" });
  });

  it("versus with no opponent yet shows the count awaiting a foe", () => {
    const self = spec({ versusTestId: "v1" });
    const out = tbOutcome("self", self, d6(6, 5, 1, 1), []);
    expect(out).toEqual({ tone: "neutral", text: "2s · vs ?" });
  });

  it("disposition shows the disposition value (neutral)", () => {
    // dispoBase 4 + 2 rolled successes (6,5) → 6.
    const out = tbOutcome(
      "self",
      spec({ dispositionMode: true, dispoBase: 4, obstacle: null }),
      d6(6, 5, 1, 1),
      [],
    );
    expect(out).toEqual({ tone: "neutral", text: "Disposition 6" });
  });
});
