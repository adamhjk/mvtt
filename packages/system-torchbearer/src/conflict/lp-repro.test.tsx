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
 * Reproduction of the "lp conflict" scenario from the live database:
 * a party character that's been toggled to the gm team, and a enemy
 * character. Verify the TeamColumn shows participants.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@solidjs/testing-library";
import { buildTestClient, mountWithClient } from "@vtt/substrate/client-testing";
import { definePlugin, type EntityId } from "@vtt/substrate";
import { permissions } from "@vtt/permissions";
import { Permissions, actors } from "@vtt/permissions/shared";
import { Character, Team } from "@vtt/characters/shared";
import { Identity, Online } from "@vtt/identity/shared";
import {
  ALL_CONFLICT_COMMANDS,
  ALL_CONFLICT_EVENTS,
  ALL_CONFLICT_TRAITS,
  TbConflict,
  TbConflictParticipant,
  TbConflictScript,
} from "./shared/index.js";
import { ALL_CONFLICT_SYSTEMS } from "./server/index.js";
import { TeamColumn } from "./client/TeamColumn.js";

const conflictTestPlugin = definePlugin({
  name: "@vtt/conflict-lp-repro",
  version: "0.0.0",
  dependsOn: ["@vtt/substrate@^0", "@vtt/permissions@^0"],
  traits: [...ALL_CONFLICT_TRAITS],
  events: [...ALL_CONFLICT_EVENTS],
  commands: [...ALL_CONFLICT_COMMANDS],
  systems: [...ALL_CONFLICT_SYSTEMS],
});

afterEach(() => cleanup());

function makeLpHarness(opts: {
  viewerRole: "gm" | "player";
  viewerUserId: string;
  partyTeamKind: "party" | "enemy";
}): {
  harness: ReturnType<typeof buildTestClient>;
  conflictId: EntityId;
} {
  let conflictId: EntityId | null = null;
  const h = buildTestClient({
    plugins: [permissions, conflictTestPlugin],
    setupWorld: ({ world }) => {
      const partyChar = world.spawn([
        Character({ name: "gasf123" }),
        Team({ kind: opts.partyTeamKind }),
        Permissions({
          read: { kind: "everyone" },
          write: actors(["SscZmof"]),
        }),
      ]);
      const enemyChar = world.spawn([
        Character({ name: "gg" }),
        Team({ kind: opts.partyTeamKind === "party" ? "enemy" : "party" }),
        Permissions({
          read: { kind: "everyone" },
          write: actors(["Y78Xxy"]),
        }),
      ]);
      conflictId = world.spawn([
        TbConflict({
          type: "kill",
          locationLabel: "lp",
          captainCharacterId: partyChar,
          gmUserId: "Y78Xxy",
          round: 1,
          revealIndex: 0,
          dispoParty: { current: 5, max: 5 },
          dispoEnemy: { current: 5, max: 5 },
          winner: null,
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
          hp: 0,
          hpMax: 0,
          knockedOut: false,
        }),
      ]);
      world.spawn([
        TbConflictScript({
          conflictId: conflictId!,
          side: "party",
          locked: false,
          slots: [{ status: "empty" }, { status: "empty" }, { status: "empty" }],
        }),
      ]);
      world.spawn([
        TbConflictScript({
          conflictId: conflictId!,
          side: "enemy",
          locked: false,
          slots: [{ status: "empty" }, { status: "empty" }, { status: "empty" }],
        }),
      ]);
      world.spawn([
        Identity({ userId: opts.viewerUserId, role: opts.viewerRole }),
        Online({ clientId: "test-client-1", since: Date.now() }),
      ]);
    },
    session: {
      userId: opts.viewerUserId,
      email: `${opts.viewerUserId}@x.dev`,
      name: opts.viewerUserId,
      role: opts.viewerRole,
    },
  });
  if (!conflictId) throw new Error("setup did not run");
  return { harness: h, conflictId };
}

describe("lp conflict reproduction", () => {
  it("GM viewer sees both participants regardless of teams", () => {
    const { harness, conflictId } = makeLpHarness({
      viewerRole: "gm",
      viewerUserId: "Y78Xxy",
      partyTeamKind: "enemy",
    });
    mountWithClient(harness, () => (
      <>
        <TeamColumn conflictId={conflictId} side="party" title="Party" />
        <TeamColumn conflictId={conflictId} side="enemy" title="Enemy" />
      </>
    ));
    expect(screen.getByTestId("team-column-party").textContent).toContain("gasf123");
    expect(screen.getByTestId("team-column-enemy").textContent).toContain("gg");
  });

  it("declaring a conflict end-to-end spawns ALL participants without id collision", async () => {
    // Regression for the universal-mirror id-collision bug: armor
    // state used to be auto-allocated via world.spawn inside the
    // ConflictDeclaredSystem, which collides with the next
    // server-allocated participant id on the client mirror and
    // silently swallows the second participant's spawnAt error.
    const { CommandPipeline, EventBus, Registry, World } = await import("@vtt/substrate");
    const { permissions: perms } = await import("@vtt/permissions");
    const registry = new Registry();
    registry.load(perms);
    registry.load(conflictTestPlugin);
    registry.validate();
    const world = new World();
    const bus = new EventBus();
    const pipeline = new CommandPipeline(registry, world, bus);
    const partyChar = world.spawn([
      Character({ name: "gasf123" }),
      Team({ kind: "party" }),
      Permissions({
        read: { kind: "everyone" },
        write: actors(["SscZmof"]),
      }),
    ]);
    const enemyChar = world.spawn([
      Character({ name: "gg" }),
      Team({ kind: "enemy" }),
      Permissions({
        read: { kind: "everyone" },
        write: actors(["Y78Xxy"]),
      }),
    ]);
    const { DeclareConflict } = await import("./shared/index.js");
    const res = await pipeline.dispatch({
      id: "decl",
      issuedBy: "client-gm",
      issuedAt: Date.now(),
      cmd: DeclareConflict({
        type: "kill",
        locationLabel: "lp",
        captainCharacterId: partyChar,
        partyParticipants: [{ characterId: partyChar }],
        enemyParticipants: [{ characterId: enemyChar }],
      }),
      session: {
        userId: "Y78Xxy",
        email: "gm@x.dev",
        name: "GM",
        role: "gm",
      },
    });
    expect(res.result.ok).toBe(true);
    // Both participants must exist in the world.
    const participants: Array<{ side: string; characterId: string }> = [];
    for (const row of world.query([TbConflictParticipant])) {
      const p = row.values.TbConflictParticipant as ReturnType<
        typeof TbConflictParticipant
      >["value"];
      participants.push({ side: p.side, characterId: p.characterId });
    }
    expect(participants).toHaveLength(2);
    expect(participants.find((p) => p.side === "party")).toBeDefined();
    expect(participants.find((p) => p.side === "enemy")).toBeDefined();
  });

  it("non-GM viewer sees both participants regardless of teams", () => {
    const { harness, conflictId } = makeLpHarness({
      viewerRole: "player",
      viewerUserId: "SscZmof",
      partyTeamKind: "enemy",
    });
    mountWithClient(harness, () => (
      <>
        <TeamColumn conflictId={conflictId} side="party" title="Party" />
        <TeamColumn conflictId={conflictId} side="enemy" title="Enemy" />
      </>
    ));
    const party = screen.getByTestId("team-column-party");
    const enemy = screen.getByTestId("team-column-enemy");
    expect(party.textContent).toContain("gasf123");
    expect(enemy.textContent).toContain("gg");
    expect(party.textContent).not.toContain("No participants");
    expect(enemy.textContent).not.toContain("No participants");
  });
});
