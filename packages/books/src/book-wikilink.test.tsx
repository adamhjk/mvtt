import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { type EntityId } from "@vtt/substrate";
import { buildTestClient, mountWithClient } from "@vtt/substrate/client-testing";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { EntityVisibility, OwnedBy, everyone } from "@vtt/permissions/shared";
import { notes } from "@vtt/notes";
import {
  Note,
  NotesUiState,
  Page,
  BelongsToNote,
  PageOrdering,
} from "@vtt/notes/shared";
import { NotesPageProvider } from "@vtt/notes/client";
import { TabSentinel, tabSentinelEntityId } from "@vtt/shell-workbench/shared";
import { books } from "./manifest.js";
import { Book } from "./shared/traits.js";
import {
  pendingBookNav,
  __resetPendingBookNavForTests,
} from "./shared/pending-nav.js";

beforeEach(() => {
  cleanup();
  __resetPendingBookNavForTests();
});

const ME = "alice";
const ME_CLIENT = "client-alice";

interface Setup {
  noteId: EntityId;
  pageId: EntityId;
  bookId: EntityId;
}

function harness(noteBody: string): {
  dispatched: ReturnType<typeof buildTestClient>["dispatched"];
  client: ReturnType<typeof buildTestClient>["client"];
  world: ReturnType<typeof buildTestClient>["world"];
  setup: Setup;
} {
  let setup: Setup | undefined;
  const h = buildTestClient({
    plugins: [shellWorkbench, notes, identity, permissions, books],
    clientId: ME_CLIENT,
    session: {
      userId: ME,
      email: "alice@test.dev",
      name: "Alice",
      role: "gm",
    },
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: ME, role: "gm" }),
        Name({ value: "Alice" }),
        Online({ clientId: ME_CLIENT, since: 0 }),
      ]);

      const bookId = world.allocateId();
      world.spawnAt(bookId, [
        Book({ name: "Player's Handbook" }),
        OwnedBy({ userId: ME }),
        EntityVisibility({ visibility: everyone() }),
      ]);

      const noteId = world.allocateId();
      const pageId = world.allocateId();
      world.spawnAt(noteId, [
        Note({ title: "Field Notes", createdAt: 0 }),
        OwnedBy({ userId: ME }),
        EntityVisibility({ visibility: everyone() }),
      ]);
      world.spawnAt(pageId, [
        BelongsToNote({ noteId }),
        Page({ title: "Page", body: noteBody, bodyRev: 1 }),
        PageOrdering({ ordinal: 0 }),
        EntityVisibility({ visibility: everyone() }),
      ]);

      // Tab sentinel for the rendered NotesPage tab — the workbench's
      // WorkspaceStateApply system would normally spawn this on
      // OpenPage, but tests skip workbench commands.
      world.spawnAt(tabSentinelEntityId("tab-1"), [
        TabSentinel({ tabId: "tab-1" }),
        OwnedBy({ userId: ME }),
        EntityVisibility({ visibility: everyone() }),
        NotesUiState({ activePageId: null, pendingHeadingId: null }),
      ]);

      setup = { noteId, pageId, bookId };
    },
  });
  return {
    dispatched: h.dispatched,
    client: h.client,
    world: h.world,
    setup: setup!,
  };
}

const BOOKS_KIND = "@vtt/books/books";
const OPEN_PAGE = "@vtt/shell-workbench/OpenPage";

async function clickBookChip(): Promise<void> {
  const buttons = await screen.findAllByRole("button");
  const chip = buttons.find(
    (b) => b.getAttribute("data-link-kind") === "book",
  );
  expect(chip, "expected a chip with data-link-kind=book").toBeDefined();
  fireEvent.click(chip!);
}

describe("book wiki-link click in a note", () => {
  it("plain `[[book:Name]]` dispatches OpenPage and publishes no nav request", async () => {
    const h = harness("see [[book:Player's Handbook]] for combat rules");
    mountWithClient(h as never, () =>
      NotesPageProvider.render({
        tabId: "tab-1",
        entityId: h.setup.noteId,
      }) as never,
    );

    await clickBookChip();
    await waitFor(() => {
      const open = h.dispatched.find((c) => c.type === OPEN_PAGE);
      expect(open, "expected OpenPage").toBeDefined();
      expect(open!.payload).toMatchObject({
        pageKind: BOOKS_KIND,
        entityId: h.setup.bookId,
      });
    });
    expect(pendingBookNav()).toBeNull();
  });

  it("`[[book:Name#42]]` publishes a page nav request and dispatches OpenPage", async () => {
    const h = harness("see [[book:Player's Handbook#42]] for the combat rules");
    mountWithClient(h as never, () =>
      NotesPageProvider.render({
        tabId: "tab-1",
        entityId: h.setup.noteId,
      }) as never,
    );

    await clickBookChip();
    await waitFor(() => {
      const open = h.dispatched.find((c) => c.type === OPEN_PAGE);
      expect(open).toBeDefined();
      expect(open!.payload).toMatchObject({
        pageKind: BOOKS_KIND,
        entityId: h.setup.bookId,
      });
    });
    const nav = pendingBookNav();
    expect(nav).not.toBeNull();
    expect(nav!.bookId).toBe(h.setup.bookId);
    expect(nav!.page).toBe(42);
  });

  it("`[[book:Name#Chapter 1]]` publishes a TOC nav request and dispatches OpenPage", async () => {
    const h = harness(
      "jump to [[book:Player's Handbook#Chapter 1: Step-By-Step Characters]] now",
    );
    mountWithClient(h as never, () =>
      NotesPageProvider.render({
        tabId: "tab-1",
        entityId: h.setup.noteId,
      }) as never,
    );

    await clickBookChip();
    await waitFor(() => {
      expect(
        h.dispatched.some((c) => c.type === OPEN_PAGE),
      ).toBe(true);
    });
    const nav = pendingBookNav();
    expect(nav).not.toBeNull();
    expect(nav!.bookId).toBe(h.setup.bookId);
    expect(nav!.tocTitle).toBe("Chapter 1: Step-By-Step Characters");
  });
});
