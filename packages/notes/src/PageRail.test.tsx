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
import { describe, it, expect, beforeEach } from "vitest";
import {
  cleanup,
  render,
  fireEvent,
  waitFor,
  screen,
} from "@solidjs/testing-library";
import { ClientProvider } from "@vtt/substrate/client";
import { buildTestClient } from "@vtt/substrate/client-testing";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { Identity, Name, Online } from "@vtt/identity/shared";
import {
  EntityVisibility,
  OwnedBy,
  everyone,
} from "@vtt/permissions/shared";
import { type EntityId } from "@vtt/substrate";
import { notes } from "./manifest.js";
import {
  Note,
  NotesUiState,
  Page,
  BelongsToNote,
  PageOrdering,
  Headings,
  ReorderPages,
} from "./shared/index.js";
import { TabSentinel, tabSentinelEntityId } from "@vtt/shell-workbench/shared";
import { NoteView } from "./client/NoteView.jsx";

const TAB_ID = "tab-1";
const ME_USER_ID = "alice";
const ME_CLIENT = "test-client-1";
const SESSION = {
  userId: ME_USER_ID,
  email: "alice@test.dev",
  name: "Alice",
  role: "player",
};

beforeEach(() => cleanup());

interface PageInsert {
  title: string;
  ordinal: number;
}

/**
 * Spawn a note + N pages in insertion order, plus a tab sentinel
 * with the given UiState patch. Returns the relevant ids so tests
 * can assert against specific pages.
 */
function harness(
  pages: ReadonlyArray<PageInsert>,
  uiPatch: {
    activePageId?: EntityId | null;
    railCollapsed?: boolean;
    pageSortMode?: "manual" | "alpha";
  } = {},
) {
  let setup!: { noteId: EntityId; pageIds: EntityId[] };
  const h = buildTestClient({
    plugins: [shellWorkbench, identity, permissions, notes],
    session: SESSION,
    clientId: ME_CLIENT,
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: ME_USER_ID, role: "player" }),
        Name({ value: "Alice" }),
        Online({ clientId: ME_CLIENT, since: 0 }),
      ]);
      const noteId = world.allocateId();
      world.spawnAt(noteId, [
        Note({ title: "Goblin Cave", createdAt: 0 }),
        OwnedBy({ userId: ME_USER_ID }),
        EntityVisibility({ visibility: everyone() }),
      ]);
      const pageIds: EntityId[] = [];
      for (const p of pages) {
        const id = world.allocateId();
        pageIds.push(id);
        world.spawnAt(id, [
          BelongsToNote({ noteId }),
          Page({ title: p.title, body: "", bodyRev: 0 }),
          PageOrdering({ ordinal: p.ordinal }),
          Headings({ items: [] }),
          EntityVisibility({ visibility: everyone() }),
        ]);
      }
      const sentinelId = tabSentinelEntityId(TAB_ID);
      world.spawnAt(sentinelId, [
        TabSentinel({ tabId: TAB_ID }),
        OwnedBy({ userId: ME_USER_ID }),
        EntityVisibility({ visibility: everyone() }),
        NotesUiState({
          activePageId: uiPatch.activePageId ?? pageIds[0]!,
          pendingHeadingId: null,
          railCollapsed: uiPatch.railCollapsed ?? false,
          pageSortMode: uiPatch.pageSortMode ?? "manual",
        }),
      ]);
      setup = { noteId, pageIds };
    },
  });
  return { ...h, setup };
}

function mount(client: ReturnType<typeof buildTestClient>["client"], noteId: EntityId) {
  return render(() => (
    <ClientProvider value={client}>
      <NoteView noteId={noteId} tabId={TAB_ID} />
    </ClientProvider>
  ));
}

describe("PageRail layout", () => {
  it("renders the Add page button before the first page row", async () => {
    const h = harness([
      { title: "Aardvark", ordinal: 0 },
      { title: "Zebra", ordinal: 1 },
    ]);
    mount(h.client, h.setup.noteId);

    const addBtn = await screen.findByRole("button", { name: /Add page/i });
    const firstPageBtn = screen.getByRole("button", { name: /Aardvark/ });
    // Add button DOM-precedes the first page row.
    expect(
      addBtn.compareDocumentPosition(firstPageBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not render the History footer", () => {
    const h = harness([{ title: "Map", ordinal: 0 }]);
    mount(h.client, h.setup.noteId);
    // The old footer's heading was "History · N" — should be gone.
    expect(screen.queryByText(/History ·/i)).toBeNull();
  });
});

describe("PageRail collapse", () => {
  it("toggle button hides the rail and re-shows it", async () => {
    const h = harness([{ title: "Map", ordinal: 0 }]);
    mount(h.client, h.setup.noteId);

    // Sanity: rail visible — the Pages header is in the DOM.
    expect(await screen.findByText(/^Pages$/)).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /hide pages/i });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.queryByText(/^Pages$/)).toBeNull();
    });

    // Persisted to the sentinel's UiState.
    const sentinelId = tabSentinelEntityId(TAB_ID);
    await waitFor(() => {
      const got = h.world.get(sentinelId, [NotesUiState]) as
        | { UiState: { railCollapsed: boolean } }
        | undefined;
      expect(got?.UiState.railCollapsed).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: /show pages/i }));
    await waitFor(() => {
      expect(screen.queryByText(/^Pages$/)).not.toBeNull();
    });
  });
});

describe("PageRail sort mode", () => {
  it("alphabetical mode reorders the visible list without dispatching", async () => {
    const h = harness([
      { title: "Zebra", ordinal: 0 },
      { title: "Aardvark", ordinal: 1 },
      { title: "Mongoose", ordinal: 2 },
    ]);
    mount(h.client, h.setup.noteId);

    // Each page row is an <li> that uniquely contains its title; reading
    // textContent off the rows isolates page order from the rest of the
    // rail's button chrome (drag-handle glyph, sort toggles, the ✕ on the
    // active row, etc.) so the test stays stable as that chrome evolves.
    const TITLES = ["Zebra", "Aardvark", "Mongoose"] as const;
    const orderedTitles = (): string[] => {
      const allLis = Array.from(document.querySelectorAll("li"));
      return allLis
        .map((li) => {
          const text = li.textContent ?? "";
          return TITLES.find((t) => text.includes(t));
        })
        .filter((t): t is (typeof TITLES)[number] => Boolean(t));
    };

    // Default (manual) order: Zebra, Aardvark, Mongoose.
    expect(orderedTitles()).toEqual(["Zebra", "Aardvark", "Mongoose"]);

    // Switch to alphabetical.
    fireEvent.click(screen.getByRole("button", { name: /alphabetical/i }));

    await waitFor(() => {
      expect(orderedTitles()).toEqual(["Aardvark", "Mongoose", "Zebra"]);
    });

    // Switching to alpha doesn't dispatch a server reorder.
    expect(
      h.dispatched.some((c) => c.type === ReorderPages.name),
    ).toBe(false);
  });
});

describe("PageRail drag reorder", () => {
  it("drop fires ReorderPages with the new manual order", async () => {
    const h = harness([
      { title: "Zebra", ordinal: 0 },
      { title: "Aardvark", ordinal: 1 },
      { title: "Mongoose", ordinal: 2 },
    ]);
    mount(h.client, h.setup.noteId);
    const [zebraId, aardvarkId, mongooseId] = h.setup.pageIds;

    const zebraRow = (
      await screen.findByRole("button", { name: /Zebra/ })
    ).closest("li") as HTMLLIElement;
    const mongooseRow = (
      await screen.findByRole("button", { name: /Mongoose/ })
    ).closest("li") as HTMLLIElement;
    expect(zebraRow).toBeTruthy();
    expect(mongooseRow).toBeTruthy();

    // jsdom's DataTransfer is not constructible; supply a minimal stub
    // good enough for the rail's three accesses (effectAllowed,
    // setData, dropEffect).
    const dt = {
      effectAllowed: "",
      dropEffect: "",
      setData: () => {},
    };
    fireEvent.dragStart(zebraRow, { dataTransfer: dt });
    fireEvent.dragOver(mongooseRow, { dataTransfer: dt });
    fireEvent.drop(mongooseRow, { dataTransfer: dt });
    fireEvent.dragEnd(zebraRow);

    await waitFor(() => {
      const dispatched = h.dispatched.filter(
        (c) => c.type === ReorderPages.name,
      );
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.payload).toEqual({
        noteId: h.setup.noteId,
        // Zebra moved to Mongoose's slot → Aardvark, Mongoose, Zebra.
        pageIds: [aardvarkId, mongooseId, zebraId],
      });
    });
  });

  it("no drag in alphabetical mode (drop is a no-op)", async () => {
    const h = harness(
      [
        { title: "Zebra", ordinal: 0 },
        { title: "Aardvark", ordinal: 1 },
      ],
      { pageSortMode: "alpha" },
    );
    mount(h.client, h.setup.noteId);

    const aardvarkRow = (
      await screen.findByRole("button", { name: /Aardvark/ })
    ).closest("li") as HTMLLIElement;
    const zebraRow = (
      await screen.findByRole("button", { name: /Zebra/ })
    ).closest("li") as HTMLLIElement;

    const dt = {
      effectAllowed: "",
      dropEffect: "",
      setData: () => {},
    };
    fireEvent.dragStart(aardvarkRow, { dataTransfer: dt });
    fireEvent.dragOver(zebraRow, { dataTransfer: dt });
    fireEvent.drop(zebraRow, { dataTransfer: dt });

    expect(
      h.dispatched.some((c) => c.type === ReorderPages.name),
    ).toBe(false);
  });
});
