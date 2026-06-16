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

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@solidjs/testing-library";
import { buildTestClient, mountWithClient } from "@vtt/substrate/client-testing";
import { definePlugin, type EntityId } from "@vtt/substrate";
import { permissions } from "@vtt/permissions";
import { Permissions, actors } from "@vtt/permissions/shared";
import {
  ALL_CONFLICT_COMMANDS,
  ALL_CONFLICT_EVENTS,
  ALL_CONFLICT_TRAITS,
  TbConflict,
  TbConflictParticipant,
  TbConflictScript,
} from "./shared/index.js";
import { ALL_CONFLICT_SYSTEMS } from "./server/index.js";
import { RoundBand } from "./client/RoundBand.js";
import { TopStripe } from "./client/TopStripe.js";
import { ActionMatrix } from "./client/ActionMatrix.js";

const conflictTestPlugin = definePlugin({
  name: "@vtt/conflict-test-jsdom",
  version: "0.0.0",
  dependsOn: ["@vtt/substrate@^0", "@vtt/permissions@^0"],
  traits: [...ALL_CONFLICT_TRAITS],
  events: [...ALL_CONFLICT_EVENTS],
  commands: [...ALL_CONFLICT_COMMANDS],
  systems: [...ALL_CONFLICT_SYSTEMS],
});

interface Setup {
  conflictId: EntityId;
  partyChar: EntityId;
  enemyChar: EntityId;
}

function makeHarness(opts: { heroSlot0Filled?: boolean; heroSlot0Revealed?: boolean }): {
  harness: ReturnType<typeof buildTestClient>;
  setup: Setup;
} {
  let captured: Setup | null = null;
  const h = buildTestClient({
    plugins: [permissions, conflictTestPlugin],
    setupWorld: ({ world }) => {
      const partyChar = world.spawn([
        Permissions({
          read: { kind: "everyone" },
          write: actors(["p1"]),
        }),
      ]);
      const enemyChar = world.spawn([
        Permissions({
          read: { kind: "everyone" },
          write: actors(["gm"]),
        }),
      ]);
      const conflictId = world.spawn([
        TbConflict({
          type: "kill",
          locationLabel: "Test crypt",
          captainCharacterId: partyChar,
          gmUserId: "gm",
          round: 1,
          revealIndex: 0,
          dispoParty: { current: 6, max: 8 },
          dispoEnemy: { current: 4, max: 7 },
          winner: null,
          endedAt: null,
          partyLocked: false,
          enemyLocked: false,
          revealedSlots: [null, null, null] as const,
        }),
      ]);
      const partyParticipantId = world.spawn([
        TbConflictParticipant({
          conflictId,
          side: "party",
          characterId: partyChar,
          hp: 4,
          hpMax: 4,
          knockedOut: false,
        }),
      ]);
      world.spawn([
        TbConflictParticipant({
          conflictId,
          side: "enemy",
          characterId: enemyChar,
          hp: 3,
          hpMax: 3,
          knockedOut: false,
        }),
      ]);
      const heroSlot0 = opts.heroSlot0Revealed
        ? {
            status: "revealed" as const,
            action: "attack" as const,
            performerParticipantEntityId: partyParticipantId,
            performerCharacterId: partyChar,
            weaponItemId: null,
          }
        : opts.heroSlot0Filled
          ? {
              status: "filled" as const,
              action: "attack" as const,
              performerParticipantEntityId: partyParticipantId,
              performerCharacterId: partyChar,
              weaponItemId: null,
            }
          : { status: "empty" as const };
      world.spawn([
        TbConflictScript({
          conflictId,
          side: "party",
          locked: false,
          slots: [heroSlot0, { status: "empty" }, { status: "empty" }],
        }),
      ]);
      world.spawn([
        TbConflictScript({
          conflictId,
          side: "enemy",
          locked: false,
          slots: [{ status: "empty" }, { status: "empty" }, { status: "empty" }],
        }),
      ]);
      captured = { conflictId, partyChar, enemyChar };
    },
    session: {
      userId: "p1",
      email: "p1@x.dev",
      name: "P1",
      role: "player",
    },
  });
  if (!captured) throw new Error("setup did not run");
  return { harness: h, setup: captured };
}

afterEach(() => cleanup());

describe("<RoundBand>", () => {
  it("shows face-down chips for empty slots", () => {
    const { harness, setup } = makeHarness({});
    mountWithClient(harness, () => (
      <RoundBand
        conflict={{
          id: setup.conflictId,
          type: "kill",
          locationLabel: "Test",
          captainCharacterId: setup.partyChar,
          gmUserId: "gm",
          round: 1,
          revealIndex: 0,
          dispoParty: { current: 6, max: 8 },
          dispoEnemy: { current: 4, max: 7 },
          winner: null,
          endedAt: null,
          partyLocked: false,
          enemyLocked: false,
          revealedSlots: [null, null, null] as const,
        }}
        viewerSide="party"
      />
    ));
    // No "locked" indicator yet.
    expect(screen.queryByTestId("locked-party")).toBeNull();
  });

  it("shows captain's filled chip face-up to teammates (own side)", () => {
    const { harness, setup } = makeHarness({ heroSlot0Filled: true });
    mountWithClient(harness, () => (
      <RoundBand
        conflict={{
          id: setup.conflictId,
          type: "kill",
          locationLabel: "Test",
          captainCharacterId: setup.partyChar,
          gmUserId: "gm",
          round: 1,
          revealIndex: 0,
          dispoParty: { current: 6, max: 8 },
          dispoEnemy: { current: 4, max: 7 },
          winner: null,
          endedAt: null,
          partyLocked: false,
          enemyLocked: false,
          revealedSlots: [null, null, null] as const,
        }}
        viewerSide="party"
      />
    ));
    // The party side shows three chips, one filled.
    const filled = screen.getAllByTestId("slot-chip-filled");
    expect(filled.length).toBe(1);
    expect(filled[0]?.textContent).toBe("A");
  });

  it("shows revealed chip with action color when slot revealed", () => {
    const { harness, setup } = makeHarness({ heroSlot0Revealed: true });
    mountWithClient(harness, () => (
      <RoundBand
        conflict={{
          id: setup.conflictId,
          type: "kill",
          locationLabel: "Test",
          captainCharacterId: setup.partyChar,
          gmUserId: "gm",
          round: 1,
          revealIndex: 0,
          dispoParty: { current: 6, max: 8 },
          dispoEnemy: { current: 4, max: 7 },
          winner: null,
          endedAt: null,
          partyLocked: false,
          enemyLocked: false,
          revealedSlots: [null, null, null] as const,
        }}
        viewerSide="party"
      />
    ));
    const revealed = screen.getAllByTestId("slot-chip-revealed");
    expect(revealed.length).toBeGreaterThanOrEqual(1);
  });
});

describe("<TopStripe>", () => {
  it("renders the round counter from the live trait", () => {
    const { harness, setup } = makeHarness({});
    // The harness's TbConflict trait is set to round=1 by makeHarness;
    // tweak it here so the test reads round 2.
    harness.world.set(setup.conflictId, TbConflict, {
      ...(
        harness.world.get(setup.conflictId, [TbConflict]) as {
          TbConflict: ReturnType<typeof TbConflict>["value"];
        }
      ).TbConflict,
      round: 2,
    });
    mountWithClient(harness, () => <TopStripe conflictId={setup.conflictId} />);
    expect(screen.getByTestId("conflict-round-counter").textContent).toContain("round 2");
  });
});

describe("<ActionMatrix>", () => {
  it("renders all 16 cells", () => {
    const { harness } = makeHarness({});
    mountWithClient(harness, () => <ActionMatrix />);
    // attack-attack, attack-defend, etc.
    const actions = ["attack", "defend", "feint", "maneuver"];
    for (const r of actions) {
      for (const c of actions) {
        expect(screen.getByTestId(`matrix-cell-${r}-${c}`)).toBeDefined();
      }
    }
  });

  it("renders the asymmetric Feint cells per Scholar's Guide p.70", () => {
    const { harness } = makeHarness({});
    mountWithClient(harness, () => <ActionMatrix />);
    // The book prints these row-perspective:
    //   - Defend vs Feint = "—" (defender forfeits, you do not test)
    //   - Feint vs Attack = "—" (feinter forfeits)
    //   - Attack vs Feint = "I" (feinter forfeits, attacker rolls indep)
    //   - Feint vs Defend = "I" (defender forfeits, feinter rolls indep)
    expect(screen.getByTestId("matrix-cell-defend-feint").textContent).toBe("—");
    expect(screen.getByTestId("matrix-cell-feint-attack").textContent).toBe("—");
    expect(screen.getByTestId("matrix-cell-attack-feint").textContent).toBe("I");
    expect(screen.getByTestId("matrix-cell-feint-defend").textContent).toBe("I");
  });

  it("matches the full SG p.70 Action Interaction Table", () => {
    const { harness } = makeHarness({});
    mountWithClient(harness, () => <ActionMatrix />);
    // Rows are your action; cols are your opponent's. Per the book:
    //               Attack Defend Feint Maneuver
    //   Attack       I      V      I     V
    //   Defend       V      I      —     V
    //   Feint        —      I      V     I
    //   Maneuver     V      V      I     I
    const expected: Record<string, Record<string, string>> = {
      attack: { attack: "I", defend: "V", feint: "I", maneuver: "V" },
      defend: { attack: "V", defend: "I", feint: "—", maneuver: "V" },
      feint: { attack: "—", defend: "I", feint: "V", maneuver: "I" },
      maneuver: { attack: "V", defend: "V", feint: "I", maneuver: "I" },
    };
    for (const r of Object.keys(expected)) {
      for (const c of Object.keys(expected[r]!)) {
        expect(screen.getByTestId(`matrix-cell-${r}-${c}`).textContent).toBe(expected[r]![c]!);
      }
    }
  });
});
