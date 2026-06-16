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
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { buildTestClient, mountWithClient } from "@vtt/substrate/client-testing";
import { TabSentinel, tabSentinelEntityId } from "@vtt/shell-workbench/shared";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "@vtt/notes";
import { Identity, Online, Name } from "@vtt/identity/shared";
import { ownedBy, Permissions } from "@vtt/permissions/shared";
import {
  definePlugin,
  defineTrait,
  EntityId as EntityIdSchema,
  qualifiedName,
  z,
} from "@vtt/substrate";
import { useQuery } from "@vtt/substrate/client";
import { createMemo } from "solid-js";
import { characters } from "../manifest.js";
import { Character } from "../shared/traits.js";
import { PendingRoll } from "../shared/pending.js";
import {
  QuickRollComposerSlot,
  ResolvedRollFeedSlot,
  RollAtelierUiState,
  type QuickRollComposer,
  type ResolvedRollEntry,
  type ResolvedRollFeed,
} from "../shared/atelier.js";
import { RollAtelier } from "./RollAtelier.jsx";

/* --- test fixtures: a fake resolved-roll feed + quick-roll composer --- */

const FakeResolvedRoll = defineTrait({
  name: "@vtt/test/FakeResolvedRoll",
  schema: z.object({
    rolledAt: z.number(),
    title: z.string(),
    origin: EntityIdSchema.nullable().default(null),
  }),
});

const testFeed: ResolvedRollFeed = {
  kind: "@vtt/test/feed",
  useEntries: () => {
    const rows = useQuery([FakeResolvedRoll]);
    const acc = createMemo<ResolvedRollEntry[]>(() =>
      rows().map((r) => {
        const v = r.values.FakeResolvedRoll as {
          rolledAt: number;
          title: string;
          origin: string | null;
        };
        return {
          id: r.id,
          sortKey: v.rolledAt,
          title: v.title,
          subtitle: "result",
          originPendingRollId: v.origin,
          outcome: { tone: "success" as const, text: "Pass · 3s · +1" },
          render: () => <div data-testid={`fake-card-${r.id}`}>{v.title} card</div>,
        };
      }),
    );
    return acc as unknown as () => ResolvedRollEntry[];
  },
};

const testQuickRoll: QuickRollComposer = {
  id: qualifiedName("@vtt/test/quick") as QuickRollComposer["id"],
  render: (args) => (
    <div data-testid="fake-quick-roll">
      <button type="button" data-testid="fake-quick-roll-close" onClick={() => args.onClose()}>
        done
      </button>
    </div>
  ),
};

const testRollFeeds = definePlugin({
  name: "@vtt/test-roll-feeds",
  version: "0.0.0",
  traits: [FakeResolvedRoll],
  fills: {
    [ResolvedRollFeedSlot.name]: [testFeed],
    [QuickRollComposerSlot.name]: [testQuickRoll],
  },
});

function spawnResolved(
  world: import("@vtt/substrate").World,
  args: { title: string; rolledAt: number; origin?: string },
): string {
  return world.spawn([
    FakeResolvedRoll({
      title: args.title,
      rolledAt: args.rolledAt,
      origin: args.origin ?? null,
    }),
  ]);
}

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
    plugins: [shellWorkbench, identity, permissions, notes, characters, testRollFeeds],
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
    Permissions({
      read: { kind: "everyone" },
      write: { kind: "users", userIds: [args.initiatorUserId ?? ME] },
    }),
  ]);
  return { rollId, characterId: charId };
}

beforeEach(() => cleanup());

describe("RollAtelier shell", () => {
  it("renders the empty state when no pending rolls exist", () => {
    const h = harness();
    seedTab(h.world, "tab-1");
    mountWithClient(h, () => <RollAtelier tabId="tab-1" initialSelection={null} />);
    expect(screen.getByTestId("atelier-empty-state")).toBeInTheDocument();
  });

  it("renders one rail pill per pending roll", () => {
    const h = harness();
    seedTab(h.world, "tab-1");
    spawnRoll(h.world, { characterName: "Tarn", openedAt: 1 });
    spawnRoll(h.world, { characterName: "Brunhilda", openedAt: 2 });
    mountWithClient(h, () => <RollAtelier tabId="tab-1" initialSelection={null} />);
    const rail = screen.getByTestId("atelier-rail");
    expect(rail.textContent).toContain("Tarn");
    expect(rail.textContent).toContain("Brunhilda");
    // Pills show WHAT is being rolled (the spec's source label, falling
    // back to the rollable's short name), not the dice count.
    expect(rail.textContent).toContain("skill-check");
  });

  it("selecting a pill mounts a generic editor in the right pane", async () => {
    const h = harness();
    seedTab(h.world, "tab-1");
    const { rollId } = spawnRoll(h.world, {
      characterName: "Tarn",
      openedAt: 1,
    });
    mountWithClient(h, () => <RollAtelier tabId="tab-1" initialSelection={null} />);
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
    mountWithClient(h, () => <RollAtelier tabId="tab-1" initialSelection={null} />);
    // The editor is mounted for the most recent roll — the headline
    // includes the recent character's name.
    const editor = screen.getByTestId("atelier-generic-editor");
    expect(editor.textContent).toContain("Recent");
  });
});

describe("RollAtelier — resolved rolls", () => {
  it("lists resolved rolls in Recent and renders the card in the right pane", async () => {
    const h = harness();
    seedTab(h.world, "tab-1");
    const rollId = spawnResolved(h.world, {
      title: "Goblin ambush",
      rolledAt: 10,
    });
    mountWithClient(h, () => <RollAtelier tabId="tab-1" initialSelection={null} />);
    // Recent pill present…
    expect(screen.getByTestId(`atelier-recent-pill-${rollId}`)).toBeInTheDocument();
    // …showing the colour-coded outcome (pass/fail · successes · margin)…
    const outcome = screen.getByTestId(`atelier-recent-outcome-${rollId}`);
    expect(outcome).toHaveTextContent("Pass · 3s · +1");
    expect(outcome).toHaveAttribute("data-tone", "success");
    // …and with nothing pending, the right pane lands on it (newest
    // resolved fallback), proving the feed → right-pane wiring.
    await waitFor(() => {
      expect(screen.getByTestId(`fake-card-${rollId}`)).toBeInTheDocument();
    });
  });

  it("keeps the just-committed roll selected via originPendingRollId", async () => {
    const h = harness();
    seedTab(h.world, "tab-1");
    const { rollId: pendingId } = spawnRoll(h.world, {
      characterName: "Tarn",
      openedAt: 1,
    });
    mountWithClient(h, () => <RollAtelier tabId="tab-1" initialSelection={null} />);
    // Select the pending roll — its editor shows.
    fireEvent.click(screen.getByTestId(`atelier-rail-pill-${pendingId}`));
    await waitFor(() => expect(screen.getByTestId("atelier-generic-editor")).toBeInTheDocument());
    // Simulate commit: the pending roll despawns and a resolved roll
    // appears stamped with its origin.
    h.world.despawn(pendingId as never);
    const resolvedId = spawnResolved(h.world, {
      title: "Tarn's Fighter test",
      rolledAt: 20,
      origin: pendingId,
    });
    // Selection redirects to the resolved card — no empty Atelier.
    await waitFor(() => {
      expect(screen.getByTestId(`fake-card-${resolvedId}`)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("atelier-generic-editor")).toBeNull();
  });

  it("opens to a newly-requested roll, overriding the persisted selection", async () => {
    const h = harness();
    seedTab(h.world, "tab-1");
    const a = spawnRoll(h.world, { characterName: "Alfa", openedAt: 1 });
    const b = spawnRoll(h.world, { characterName: "Bravo", openedAt: 2 });

    // Open the Atelier targeting roll A — its editor shows.
    mountWithClient(h, () => <RollAtelier tabId="tab-1" initialSelection={a.rollId as never} />);
    await waitFor(() =>
      expect(screen.getByTestId("atelier-generic-editor").textContent).toContain("Alfa"),
    );

    // Requesting roll B re-opens the same tab (same sentinel, selection
    // already persisted to A) with a fresh initialSelection. The Atelier
    // must land on B, not stay on A.
    cleanup();
    mountWithClient(h, () => <RollAtelier tabId="tab-1" initialSelection={b.rollId as never} />);
    await waitFor(() =>
      expect(screen.getByTestId("atelier-generic-editor").textContent).toContain("Bravo"),
    );
    expect(screen.getByTestId("atelier-generic-editor").textContent).not.toContain("Alfa");
  });

  it("opens the quick-roll composer and closes it", async () => {
    const h = harness();
    seedTab(h.world, "tab-1");
    mountWithClient(h, () => <RollAtelier tabId="tab-1" initialSelection={null} />);
    fireEvent.click(screen.getByTestId("atelier-quick-roll"));
    await waitFor(() => expect(screen.getByTestId("fake-quick-roll")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("fake-quick-roll-close"));
    await waitFor(() => expect(screen.queryByTestId("fake-quick-roll")).toBeNull());
  });
});
