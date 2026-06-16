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
import {
  ALL_ACTIONS,
  TB_ACTION_INDEP_OB,
  TB_ACTION_MATRIX,
  TB_ACTION_RULES,
  TB_CONFLICT_TYPES,
  ALL_CONFLICT_TYPES,
  dispoRollLabel,
  testForAction,
  type ConflictAction,
  type ConflictType,
  type MatchupCell,
} from "./shared/index.js";

describe("@vtt/system-torchbearer/conflict — static rules", () => {
  describe("action interaction matrix (SG p.70)", () => {
    /**
     * The book's table verbatim — row = your action, col = opponent's.
     * `V` = versus, `I` = independent, `—` = do not roll.
     *
     *                Attack    Defend    Feint     Maneuver
     *     Attack       I         V         I          V
     *     Defend       V         I         —          V
     *     Feint        —         I         V          I
     *     Maneuver     V         V         I          I
     */
    const BOOK: Readonly<Record<ConflictAction, Readonly<Record<ConflictAction, MatchupCell>>>> = {
      attack: {
        attack: "independent",
        defend: "versus",
        feint: "independent",
        maneuver: "versus",
      },
      defend: {
        attack: "versus",
        defend: "independent",
        feint: "noTest",
        maneuver: "versus",
      },
      feint: {
        attack: "noTest",
        defend: "independent",
        feint: "versus",
        maneuver: "independent",
      },
      maneuver: {
        attack: "versus",
        defend: "versus",
        feint: "independent",
        maneuver: "independent",
      },
    };

    // 16 cells parameterised — every cell asserted against the printed table.
    for (const row of ALL_ACTIONS) {
      for (const col of ALL_ACTIONS) {
        it(`row=${row} col=${col} → ${BOOK[row][col]} (book p.70)`, () => {
          expect(TB_ACTION_MATRIX[row][col]).toBe(BOOK[row][col]);
          expect(testForAction(row, col)).toBe(BOOK[row][col]);
        });
      }
    }

    it("uses only the three cell values the book legend lists", () => {
      const allowed: ReadonlyArray<MatchupCell> = ["versus", "independent", "noTest"];
      for (const r of ALL_ACTIONS) {
        for (const c of ALL_ACTIONS) {
          expect(allowed).toContain(TB_ACTION_MATRIX[r][c]);
        }
      }
    });

    /* -------------------------------------------------------------------
     * Asymmetric Feint cases — both sides looked up independently. The
     * load-bearing rule from SG p.68 / the table's `—` cells.
     * ----------------------------------------------------------------- */
    describe("asymmetric Feint matchups (each side reads its own row)", () => {
      it("Defend(party) vs Feint(enemy): party forfeits, enemy rolls indep", () => {
        // Party row is Defend, looking at Feint column.
        expect(testForAction("defend", "feint")).toBe("noTest");
        // Enemy row is Feint, looking at Defend column.
        expect(testForAction("feint", "defend")).toBe("independent");
      });

      it("Feint(party) vs Defend(enemy): party rolls indep, enemy forfeits", () => {
        expect(testForAction("feint", "defend")).toBe("independent");
        expect(testForAction("defend", "feint")).toBe("noTest");
      });

      it("Attack(party) vs Feint(enemy): party rolls indep, enemy forfeits", () => {
        // Attacker rolls Ob 0; feinter is drawn out of position.
        expect(testForAction("attack", "feint")).toBe("independent");
        expect(testForAction("feint", "attack")).toBe("noTest");
      });

      it("Feint(party) vs Attack(enemy): party forfeits, enemy rolls indep", () => {
        expect(testForAction("feint", "attack")).toBe("noTest");
        expect(testForAction("attack", "feint")).toBe("independent");
      });
    });

    /* -------------------------------------------------------------------
     * Symmetric same-action matchups — both sides read the same value.
     * ----------------------------------------------------------------- */
    describe("symmetric same-action matchups", () => {
      it("Attack vs Attack: both roll independent", () => {
        expect(testForAction("attack", "attack")).toBe("independent");
      });
      it("Defend vs Defend: both roll independent (Ob 3 each)", () => {
        expect(testForAction("defend", "defend")).toBe("independent");
      });
      it("Feint vs Feint: versus", () => {
        expect(testForAction("feint", "feint")).toBe("versus");
      });
      it("Maneuver vs Maneuver: both roll independent", () => {
        expect(testForAction("maneuver", "maneuver")).toBe("independent");
      });
    });

    /* -------------------------------------------------------------------
     * Versus-test matchups — single shared roll. The block-vs-strike
     * pairs (Attack/Defend, Defend/Maneuver) and the shared trick
     * (Feint/Feint).
     * ----------------------------------------------------------------- */
    describe("versus matchups (single shared roll)", () => {
      const versusPairs: ReadonlyArray<readonly [ConflictAction, ConflictAction]> = [
        ["attack", "defend"],
        ["defend", "attack"],
        ["attack", "maneuver"],
        ["maneuver", "attack"],
        ["defend", "maneuver"],
        ["maneuver", "defend"],
        ["feint", "feint"],
      ];
      for (const [row, col] of versusPairs) {
        it(`${row} vs ${col} = versus`, () => {
          expect(testForAction(row, col)).toBe("versus");
        });
      }
    });

    /* -------------------------------------------------------------------
     * Independent matchups — Maneuver-vs-Feint splits both sides into
     * indep rolls per book p.69 ("feinter rolls indep Ob 0; maneuver
     * tests as normal").
     * ----------------------------------------------------------------- */
    describe("independent matchups", () => {
      it("Maneuver(party) vs Feint(enemy): both roll independent", () => {
        expect(testForAction("maneuver", "feint")).toBe("independent");
        expect(testForAction("feint", "maneuver")).toBe("independent");
      });
    });

    it("Defend's independent obstacle is 3", () => {
      expect(TB_ACTION_INDEP_OB.defend).toBe(3);
    });
    it("Attack/Feint/Maneuver indep obstacles are 0", () => {
      expect(TB_ACTION_INDEP_OB.attack).toBe(0);
      expect(TB_ACTION_INDEP_OB.feint).toBe(0);
      expect(TB_ACTION_INDEP_OB.maneuver).toBe(0);
    });

    it("rule text is non-empty for all four actions", () => {
      for (const a of ALL_ACTIONS) {
        expect(TB_ACTION_RULES[a].description.length).toBeGreaterThan(20);
        expect(TB_ACTION_RULES[a].label.length).toBeGreaterThan(0);
      }
    });
  });

  describe("conflict types", () => {
    it("includes the 8 canonical conflict types + other", () => {
      expect(ALL_CONFLICT_TYPES).toContain("kill");
      expect(ALL_CONFLICT_TYPES).toContain("driveOff");
      expect(ALL_CONFLICT_TYPES).toContain("capture");
      expect(ALL_CONFLICT_TYPES).toContain("convince");
      expect(ALL_CONFLICT_TYPES).toContain("convinceCrowd");
      expect(ALL_CONFLICT_TYPES).toContain("flee");
      expect(ALL_CONFLICT_TYPES).toContain("pursue");
      expect(ALL_CONFLICT_TYPES).toContain("trick");
      expect(ALL_CONFLICT_TYPES).toContain("other");
    });

    it("kill rolls Fighter + Health", () => {
      const k = TB_CONFLICT_TYPES.kill;
      expect(k.dispoSkill).toEqual({ kind: "skill", id: "fighter" });
      expect(k.dispoAddTo).toBe("Health");
      expect(k.actionSkill.attack).toEqual(["fighter"]);
      expect(k.actionSkill.defend).toEqual(["health"]);
      expect(k.armorApplies).toBe(true);
      expect(k.backpackPenalty).toBe(true);
    });

    it("convince rolls Persuader + Will, no armor", () => {
      const c = TB_CONFLICT_TYPES.convince;
      expect(c.dispoSkill).toEqual({ kind: "skill", id: "persuader" });
      expect(c.dispoAddTo).toBe("Will");
      expect(c.armorApplies).toBe(false);
      expect(c.actionSkill.feint).toEqual(["manipulator"]);
    });

    it("flee allows Scout or Rider for dispo and Attack/Feint actions", () => {
      const f = TB_CONFLICT_TYPES.flee;
      expect(f.dispoSkill).toEqual({ kind: "oneOf", ids: ["scout", "rider"] });
      expect(f.actionSkill.attack).toEqual(["scout", "rider"]);
      expect(f.actionSkill.feint).toEqual(["scout", "rider"]);
      expect(f.actionSkill.defend).toEqual(["health"]);
      expect(f.actionSkill.maneuver).toEqual(["health"]);
    });

    it("capture pairs Fighter+Hunter actions", () => {
      const c = TB_CONFLICT_TYPES.capture;
      expect(c.actionSkill.attack).toEqual(["fighter"]);
      expect(c.actionSkill.defend).toEqual(["hunter"]);
    });

    /* ---------------------------------------------------------------
     * Disposition roll prompt — what skill / which ability per
     * conflict type. SG p.63-64 / LM p.106. The prompt the captain
     * sees in the disposition box has to match the book.
     * ------------------------------------------------------------- */
    describe("disposition roll prompts (SG p.63-64 / LM p.106)", () => {
      const expected: Readonly<Record<Exclude<ConflictType, "other">, string>> = {
        kill: "Roll Fighter and add to Health",
        driveOff: "Roll Fighter and add to Health",
        capture: "Roll Fighter or Hunter and add to Will",
        convince: "Roll Persuader and add to Will",
        convinceCrowd: "Roll Orator and add to Will",
        flee: "Roll Scout or Rider and add to Health",
        pursue: "Roll Scout or Rider and add to Health",
        trick: "Roll Manipulator and add to Will",
      };
      for (const t of Object.keys(expected) as Array<keyof typeof expected>) {
        it(`${t} → "${expected[t]}"`, () => {
          expect(dispoRollLabel(TB_CONFLICT_TYPES[t])).toBe(expected[t]);
        });
      }
      it("'other' has no canonical roll prompt", () => {
        expect(dispoRollLabel(TB_CONFLICT_TYPES.other)).toBeNull();
      });
      it("every non-'other' conflict type names exactly one ability (Will or Health)", () => {
        for (const id of ALL_CONFLICT_TYPES) {
          if (id === "other") continue;
          const def = TB_CONFLICT_TYPES[id];
          expect(["Will", "Health"]).toContain(def.dispoAddTo);
        }
      });
    });
  });
});
