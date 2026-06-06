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
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import {
  buildTestClient,
  mountWithClient,
} from "@vtt/substrate/client-testing";
import { TabSentinel, tabSentinelEntityId } from "@vtt/shell-workbench/shared";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "@vtt/notes";
import { Identity, Online, Name } from "@vtt/identity/shared";
import { ownedBy, Permissions } from "@vtt/permissions/shared";
import { characters } from "../manifest.js";
import { Character } from "../shared/traits.js";
import { PendingRoll } from "../shared/pending.js";
import { RollAtelierUiState } from "../shared/atelier.js";
import { RollAtelier } from "./RollAtelier.jsx";

const ME = "alice";
const SESSION = {
  userId: ME,
  email: "alice@test.dev",
  name: "Alice",
  role: "player",
};

function seedTab(world: import("@vtt/substrate").World, tabId: string) {
  world.spawnAt(tabSentinelEntityId(tabId), [
    TabSentinel({ tabId }),
    Permissions(ownedBy(ME)),
    RollAtelierUiState({ selectedRollId: null, railCollapsed: false }),
  ]);
}

function harness() {
  return buildTestClient({
    plugins: [shellWorkbench, identity, permissions, notes, characters],
    session: SESSION,
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
  args: {
    characterName: string;
    openedAt: number;
    initiatorUserId?: string;
  },
): { rollId: string; characterId: string } {
  const charId = world.spawn([
    Character({ name: args.characterName }),
    Permissions(ownedBy(args.initiatorUserId ?? ME)),
  ]);
  const rollId = world.spawn([
    PendingRoll({
      initiatorUserId: args.initiatorUserId ?? ME,
      initiatorCharacterId: charId,
      rollableName: "@vtt/system-simple/skill-check",
      opts: {},
      contributions: [],
      openedAt: args.openedAt,
    }),
    Permissions({ read: { kind: "everyone" }, write: { kind: "users", userIds: [args.initiatorUserId ?? ME] } }),
  ]);
  return { rollId, characterId: charId };
}

beforeEach(() => cleanup());

describe("RollAtelier shell", () => {
  it("renders the empty state when no pending rolls exist", () => {
    const h = harness();
    seedTab(h.world, "tab-1");
    mountWithClient(h, () => (
      <RollAtelier tabId="tab-1" initialSelection={null} />
    ));
    expect(screen.getByTestId("atelier-empty-state")).toBeInTheDocument();
  });

  it("renders one rail pill per pending roll", () => {
    const h = harness();
    seedTab(h.world, "tab-1");
    spawnRoll(h.world, { characterName: "Tarn", openedAt: 1 });
    spawnRoll(h.world, { characterName: "Brunhilda", openedAt: 2 });
    mountWithClient(h, () => (
      <RollAtelier tabId="tab-1" initialSelection={null} />
    ));
    const rail = screen.getByTestId("atelier-rail");
    expect(rail.textContent).toContain("Tarn");
    expect(rail.textContent).toContain("Brunhilda");
  });

  it("selecting a pill mounts a generic editor in the right pane", async () => {
    const h = harness();
    seedTab(h.world, "tab-1");
    const { rollId } = spawnRoll(h.world, {
      characterName: "Tarn",
      openedAt: 1,
    });
    mountWithClient(h, () => (
      <RollAtelier tabId="tab-1" initialSelection={null} />
    ));
    const pill = screen.getByTestId(`atelier-rail-pill-${rollId}`);
    fireEvent.click(pill);
    await waitFor(() => {
      expect(screen.getByTestId("atelier-generic-editor")).toBeInTheDocument();
    });
  });

  it("auto-selects most-recently-opened roll when selection is null", () => {
    const h = harness();
    seedTab(h.world, "tab-1");
    spawnRoll(h.world, { characterName: "Old", openedAt: 1 });
    spawnRoll(h.world, { characterName: "Recent", openedAt: 99 });
    mountWithClient(h, () => (
      <RollAtelier tabId="tab-1" initialSelection={null} />
    ));
    // The editor is mounted for the most recent roll — the headline
    // includes the recent character's name.
    const editor = screen.getByTestId("atelier-generic-editor");
    expect(editor.textContent).toContain("Recent");
  });
});
