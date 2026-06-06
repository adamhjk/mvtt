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

import "@testing-library/jest-dom/vitest";
import { describe, expect, it, beforeEach } from "vitest";
import { cleanup, waitFor } from "@solidjs/testing-library";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "@vtt/notes";
import { Identity, Online, Name } from "@vtt/identity/shared";
import { ownedBy, Permissions } from "@vtt/permissions/shared";
import { characters } from "../manifest.js";
import { Character } from "../shared/traits.js";
import { PendingRoll } from "../shared/pending.js";
import { ROLL_ATELIER_KIND } from "../shared/atelier.js";
import { AtelierAutoFocusMount } from "./AtelierAutoFocusMount.jsx";

const ME = "alice";
const OTHER = "bob";

function buildHarness() {
  return buildTestClient({
    plugins: [shellWorkbench, identity, permissions, notes, characters],
    session: {
      userId: ME,
      email: "alice@test.dev",
      name: "Alice",
      role: "player",
    },
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: ME, role: "player" }),
        Name({ value: "Alice" }),
        Online({ clientId: "test-client-1", since: 0 }),
      ]);
    },
  });
}

function spawnRoll(
  world: import("@vtt/substrate").World,
  args: { initiatorUserId: string; openedAt: number },
): string {
  const charId = world.spawn([
    Character({ name: "X" }),
    Permissions(ownedBy(args.initiatorUserId)),
  ]);
  return world.spawn([
    PendingRoll({
      initiatorUserId: args.initiatorUserId,
      initiatorCharacterId: charId,
      rollableName: "@vtt/system-simple/skill-check",
      opts: {},
      contributions: [],
      openedAt: args.openedAt,
    }),
    Permissions({ read: { kind: "everyone" }, write: { kind: "users", userIds: [args.initiatorUserId] } }),
  ]);
}

beforeEach(() => cleanup());

describe("AtelierAutoFocusMount", () => {
  it("dispatches OpenPage(roll-atelier) when my own pending roll spawns", async () => {
    const h = buildHarness();
    mountWithClient(h, () => <AtelierAutoFocusMount />);

    spawnRoll(h.world, { initiatorUserId: ME, openedAt: 1 });

    await waitFor(() => {
      const openPages = h.dispatched.filter(
        (c) => c.type === "@vtt/shell-workbench/OpenPage",
      );
      expect(openPages.length).toBeGreaterThan(0);
      const last = openPages.at(-1) as
        | { payload: { pageKind: string } }
        | undefined;
      expect(last?.payload.pageKind).toBe(ROLL_ATELIER_KIND);
    });
  });

  it("does NOT dispatch OpenPage when another user's pending roll spawns", async () => {
    const h = buildHarness();
    mountWithClient(h, () => <AtelierAutoFocusMount />);

    spawnRoll(h.world, { initiatorUserId: OTHER, openedAt: 1 });

    // Give the effect a tick to run.
    await new Promise((r) => setTimeout(r, 50));
    const openPages = h.dispatched.filter(
      (c) => c.type === "@vtt/shell-workbench/OpenPage",
    );
    expect(openPages.length).toBe(0);
  });

  it("is idempotent — repeated re-renders of the same roll dispatch once", async () => {
    const h = buildHarness();
    mountWithClient(h, () => <AtelierAutoFocusMount />);

    spawnRoll(h.world, { initiatorUserId: ME, openedAt: 1 });
    spawnRoll(h.world, { initiatorUserId: ME, openedAt: 2 });
    // Touch the world again to provoke an extra re-evaluation of the effect.
    h.world.subscribe(() => undefined);

    await waitFor(() => {
      const openPages = h.dispatched.filter(
        (c) => c.type === "@vtt/shell-workbench/OpenPage",
      );
      // Exactly one OpenPage per spawned mine — not three.
      expect(openPages.length).toBe(2);
    });
  });
});
