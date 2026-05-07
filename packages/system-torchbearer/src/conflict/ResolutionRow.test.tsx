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

/**
 * Component-level tests for the reveal cascade — specifically that
 * each side's per-slot panel reads the correct row of the action
 * interaction matrix (SG p.70). The matrix is asymmetric for the
 * Feint cells, so the bug we're guarding against is "the enemy
 * column shows the party's row's value".
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@solidjs/testing-library";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { definePlugin, type EntityId } from "@vtt/substrate";
import { permissions } from "@vtt/permissions";
import { Permissions, actors } from "@vtt/permissions/shared";
import { Character, Team } from "@vtt/characters/shared";
import {
  ALL_CONFLICT_COMMANDS,
  ALL_CONFLICT_EVENTS,
  ALL_CONFLICT_TRAITS,
  TbConflict,
  TbConflictParticipant,
  TbConflictScript,
  type ConflictAction,
  type ConflictType,
} from "./shared/index.js";
import { ALL_CONFLICT_SYSTEMS } from "./server/index.js";
import { ResolutionRow } from "./client/ResolutionRow.js";

// Lightweight plugin — only the traits we need to mount the
// ResolutionRow without dragging in the full characters plugin's
// workbench / notes slot fills.
const charsLite = definePlugin({
  name: "@vtt/conflict-resrow-chars-lite",
  version: "0.0.0",
  dependsOn: ["@vtt/substrate@^0", "@vtt/permissions@^0"],
  traits: [Character, Team],
});

const conflictTestPlugin = definePlugin({
  name: "@vtt/conflict-test-resrow",
  version: "0.0.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/permissions@^0",
    "@vtt/conflict-resrow-chars-lite@^0",
  ],
  traits: [...ALL_CONFLICT_TRAITS],
  events: [...ALL_CONFLICT_EVENTS],
  commands: [...ALL_CONFLICT_COMMANDS],
  systems: [...ALL_CONFLICT_SYSTEMS],
});

afterEach(() => cleanup());

interface Mount {
  conflictId: EntityId;
}

function mountReveal(opts: {
  type: ConflictType;
  partyAction: ConflictAction;
  enemyAction: ConflictAction;
}): Mount {
  let conflictId: EntityId | null = null;
  const h = buildTestClient({
    plugins: [permissions, charsLite, conflictTestPlugin],
    setupWorld: ({ world }) => {
      const partyChar = world.spawn([
        Character({ name: "Beren" }),
        Permissions({ read: { kind: "everyone" }, write: actors(["p1"]) }),
      ]);
      const enemyChar = world.spawn([
        Character({ name: "Goblin" }),
        Permissions({ read: { kind: "everyone" }, write: actors(["gm"]) }),
      ]);
      conflictId = world.spawn([
        TbConflict({
          type: opts.type,
          locationLabel: "test",
          captainCharacterId: partyChar,
          gmUserId: "gm",
          round: 1,
          revealIndex: 1, // slot 0 is revealed; cards 1-2 are pending
          partyLocked: true,
          enemyLocked: true,
          revealedSlots: [
            {
              partyAction: opts.partyAction,
              // Pre-launch: tests don't spawn TbConflictParticipant
              // entities (they short-circuit straight to revealedSlots),
              // so we synthesize plausible participant ids that match
              // the EntityId branding. The runtime never reads these
              // back via TbConflictParticipant in this test — only the
              // chat row's PerformerName lookup, which falls through to
              // the live character name.
              partyPerformerParticipantEntityId: ("e:" +
                partyChar) as typeof partyChar,
              partyPerformerCharacterId: partyChar,
              partyWeaponItemId: null,
              enemyAction: opts.enemyAction,
              enemyPerformerParticipantEntityId: ("e:" +
                enemyChar) as typeof enemyChar,
              enemyPerformerCharacterId: enemyChar,
              enemyWeaponItemId: null,
            },
            null,
            null,
          ],
          dispoParty: { current: 5, max: 5 },
          dispoEnemy: { current: 5, max: 5 },
          winner: null,
          endedAt: null,
        }),
      ]);
      world.spawn([
        TbConflictParticipant({
          conflictId: conflictId!,
          side: "party",
          characterId: partyChar,
          hp: 5,
          hpMax: 5,
          knockedOut: false,
        }),
      ]);
      world.spawn([
        TbConflictParticipant({
          conflictId: conflictId!,
          side: "enemy",
          characterId: enemyChar,
          hp: 5,
          hpMax: 5,
          knockedOut: false,
        }),
      ]);
      // Locked + empty scripts (status doesn't matter — UI reads
      // revealedSlots from the conflict for revealed entries).
      world.spawn([
        TbConflictScript({
          conflictId: conflictId!,
          side: "party",
          locked: true,
          slots: [
            { status: "empty" },
            { status: "empty" },
            { status: "empty" },
          ],
        }),
        Permissions({
          read: actors(["p1", "gm"]),
          write: actors(["p1", "gm"]),
        }),
      ]);
      world.spawn([
        TbConflictScript({
          conflictId: conflictId!,
          side: "enemy",
          locked: true,
          slots: [
            { status: "empty" },
            { status: "empty" },
            { status: "empty" },
          ],
        }),
        Permissions({ read: actors(["gm"]), write: actors(["gm"]) }),
      ]);
    },
    session: {
      userId: "p1",
      email: "p1@x.dev",
      name: "P1",
      role: "player",
    },
  });
  if (!conflictId) throw new Error("setup did not run");
  mountWithClient(h, () => <ResolutionRow conflictId={conflictId!} />);
  return { conflictId };
}

function partyColumn(): HTMLElement {
  return screen.getByTestId("side-column-party");
}
function enemyColumn(): HTMLElement {
  return screen.getByTestId("side-column-enemy");
}
function symbolKind(col: HTMLElement): string | null {
  const sym = col.querySelector("[data-testid='test-symbol']");
  return sym?.getAttribute("data-kind") ?? null;
}

/* -------------------------------------------------------------------------
 * Asymmetric Feint matchups — the load-bearing rule from SG p.68.
 * Each side reads its own row, so the four cells produce four
 * different (party, enemy) display pairs.
 * ----------------------------------------------------------------------- */

describe("ResolutionRow — asymmetric Feint matchups (SG p.70)", () => {
  it("Defend(party) vs Feint(enemy): party forfeits, enemy rolls Independent", () => {
    mountReveal({ type: "kill", partyAction: "defend", enemyAction: "feint" });
    expect(symbolKind(partyColumn())).toBe("noTest");
    expect(partyColumn().textContent).toMatch(/do not roll/i);
    expect(symbolKind(enemyColumn())).toBe("independent");
    expect(enemyColumn().textContent).toMatch(/Fighter/i);
    expect(enemyColumn().textContent).toMatch(/Ob 0/);
  });

  it("Feint(party) vs Defend(enemy): party rolls Independent, enemy forfeits", () => {
    mountReveal({ type: "kill", partyAction: "feint", enemyAction: "defend" });
    expect(symbolKind(partyColumn())).toBe("independent");
    expect(partyColumn().textContent).toMatch(/Fighter/i);
    expect(partyColumn().textContent).toMatch(/Ob 0/);
    expect(symbolKind(enemyColumn())).toBe("noTest");
    expect(enemyColumn().textContent).toMatch(/do not roll/i);
  });

  it("Attack(party) vs Feint(enemy): party rolls Independent, enemy forfeits", () => {
    mountReveal({ type: "kill", partyAction: "attack", enemyAction: "feint" });
    expect(symbolKind(partyColumn())).toBe("independent");
    expect(partyColumn().textContent).toMatch(/Fighter/i);
    expect(partyColumn().textContent).toMatch(/Ob 0/);
    expect(symbolKind(enemyColumn())).toBe("noTest");
    expect(enemyColumn().textContent).toMatch(/do not roll/i);
  });

  it("Feint(party) vs Attack(enemy): party forfeits, enemy rolls Independent", () => {
    mountReveal({ type: "kill", partyAction: "feint", enemyAction: "attack" });
    expect(symbolKind(partyColumn())).toBe("noTest");
    expect(partyColumn().textContent).toMatch(/do not roll/i);
    expect(symbolKind(enemyColumn())).toBe("independent");
    expect(enemyColumn().textContent).toMatch(/Fighter/i);
    expect(enemyColumn().textContent).toMatch(/Ob 0/);
  });
});

/* -------------------------------------------------------------------------
 * Symmetric matchups — both sides see the same prompt.
 * ----------------------------------------------------------------------- */

describe("ResolutionRow — symmetric matchups", () => {
  it("Attack vs Defend: party rolls Versus, enemy rolls Versus", () => {
    mountReveal({ type: "kill", partyAction: "attack", enemyAction: "defend" });
    expect(symbolKind(partyColumn())).toBe("versus");
    expect(symbolKind(enemyColumn())).toBe("versus");
    expect(partyColumn().textContent).toMatch(/versus your opponent's pool/i);
    expect(enemyColumn().textContent).toMatch(/versus your opponent's pool/i);
    expect(partyColumn().textContent).toMatch(/Fighter/i);
    expect(enemyColumn().textContent).toMatch(/Health/i);
  });

  it("Attack vs Attack: both roll Independent", () => {
    mountReveal({ type: "kill", partyAction: "attack", enemyAction: "attack" });
    expect(symbolKind(partyColumn())).toBe("independent");
    expect(symbolKind(enemyColumn())).toBe("independent");
    expect(partyColumn().textContent).toMatch(/Ob 0/);
    expect(enemyColumn().textContent).toMatch(/Ob 0/);
  });

  it("Defend vs Defend: both roll Independent at Ob 3", () => {
    mountReveal({ type: "kill", partyAction: "defend", enemyAction: "defend" });
    expect(symbolKind(partyColumn())).toBe("independent");
    expect(symbolKind(enemyColumn())).toBe("independent");
    expect(partyColumn().textContent).toMatch(/Ob 3/);
    expect(enemyColumn().textContent).toMatch(/Ob 3/);
  });

  it("Maneuver vs Feint: both roll Independent (Ob 0)", () => {
    mountReveal({
      type: "kill",
      partyAction: "maneuver",
      enemyAction: "feint",
    });
    expect(symbolKind(partyColumn())).toBe("independent");
    expect(symbolKind(enemyColumn())).toBe("independent");
  });
});

/* -------------------------------------------------------------------------
 * Skill mapping per conflict type (SG p.70 / LM p.106).
 * ----------------------------------------------------------------------- */

describe("ResolutionRow — per-conflict-type skill mapping", () => {
  it("Convince conflict: Attack uses Persuader, Feint uses Manipulator", () => {
    mountReveal({
      type: "convince",
      partyAction: "attack",
      enemyAction: "feint",
    });
    expect(partyColumn().textContent).toMatch(/Persuader/i);
    // Enemy forfeits on attack/feint asymmetric, so no skill rendered.
    expect(enemyColumn().textContent).toMatch(/do not roll/i);
  });

  it("Flee conflict: Attack lists 'Scout or Rider'", () => {
    mountReveal({
      type: "flee",
      partyAction: "attack",
      enemyAction: "defend",
    });
    expect(partyColumn().textContent).toMatch(/Scout or Rider/i);
    expect(enemyColumn().textContent).toMatch(/Health/i);
  });

  it("Trick conflict: Defend uses Lore Master", () => {
    mountReveal({
      type: "trick",
      partyAction: "defend",
      enemyAction: "attack",
    });
    expect(partyColumn().textContent).toMatch(/Lore Master/i);
    expect(enemyColumn().textContent).toMatch(/Manipulator/i);
  });
});

/* -------------------------------------------------------------------------
 * Header chip — describes the matchup at a glance.
 * ----------------------------------------------------------------------- */

describe("ResolutionRow — matchup header chip", () => {
  it("Defend(party) vs Feint(enemy) header reads 'Party forfeits'", () => {
    mountReveal({ type: "kill", partyAction: "defend", enemyAction: "feint" });
    expect(screen.getByTestId("slot-card-0").textContent).toMatch(/party forfeits/i);
  });

  it("Feint(party) vs Defend(enemy) header reads 'Enemy forfeits'", () => {
    mountReveal({ type: "kill", partyAction: "feint", enemyAction: "defend" });
    expect(screen.getByTestId("slot-card-0").textContent).toMatch(/enemy forfeits/i);
  });

  it("Attack vs Defend header reads 'Versus test'", () => {
    mountReveal({ type: "kill", partyAction: "attack", enemyAction: "defend" });
    expect(screen.getByTestId("slot-card-0").textContent).toMatch(/versus test/i);
  });

  it("Attack vs Attack header reads 'Independent test'", () => {
    mountReveal({ type: "kill", partyAction: "attack", enemyAction: "attack" });
    expect(screen.getByTestId("slot-card-0").textContent).toMatch(/independent test/i);
  });
});
