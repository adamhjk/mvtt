import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import {
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@solidjs/testing-library";
import { buildTestClient, mountWithClient } from "@vtt/substrate/client-testing";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import {
  Identity,
  Online,
  Name,
} from "@vtt/identity/shared";
import {
  EntityVisibility,
  OwnedBy,
} from "@vtt/permissions/shared";
import { everyone } from "@vtt/permissions/shared";
import { notes } from "./manifest.js";
import { Note, Page, BelongsToNote, PageOrdering } from "./shared/index.js";
import {
  NotesPageProvider,
} from "./client/NotesPage.js";

beforeEach(() => cleanup());

const ME_USER_ID = "alice";
const SESSION = {
  userId: ME_USER_ID,
  email: "alice@test.dev",
  name: "Alice",
  role: "player",
};

function harness({ withNote = false }: { withNote?: boolean } = {}) {
  return buildTestClient({
    plugins: [shellWorkbench, identity, permissions, notes],
    session: SESSION,
    setupWorld: ({ world }) => {
      // Player entity matching the test client's clientId so useMe() works.
      world.spawn([
        Identity({ userId: ME_USER_ID, role: "player" }),
        Name({ value: "Alice" }),
        Online({ clientId: "test-client-1", since: 0 }),
      ]);
      if (withNote) {
        const noteId = world.allocateId();
        const pageId = world.allocateId();
        world.spawnAt(noteId, [
          Note({ title: "Goblin Cave", createdAt: 0 }),
          OwnedBy({ userId: ME_USER_ID }),
          EntityVisibility({ visibility: everyone() }),
        ]);
        world.spawnAt(pageId, [
          BelongsToNote({ noteId }),
          Page({ title: "Map", body: "# The Goblin Cave\n\nIt is damp.", bodyRev: 0 }),
          PageOrdering({ ordinal: 0 }),
          EntityVisibility({ visibility: everyone() }),
        ]);
      }
    },
  });
}

describe("NotesPage hub (no entityId)", () => {
  it("renders the empty-state and a create form", () => {
    const h = harness();
    mountWithClient(h, () =>
      NotesPageProvider.render({
        tabId: "tab-1",
        entityId: null,
        uiState: () => null,
        setUiState: () => {},
      }) as never,
    );
    expect(
      screen.getByText(/No notes yet — write the first one\./i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /Title/i }),
    ).toBeInTheDocument();
  });

  it("create form dispatches CreateNote and retargets the tab", async () => {
    const h = harness();
    mountWithClient(h, () =>
      NotesPageProvider.render({
        tabId: "tab-1",
        entityId: null,
        uiState: () => null,
        setUiState: () => {},
      }) as never,
    );
    const input = screen.getByRole("textbox", { name: /Title/i });
    fireEvent.input(input, { target: { value: "Mossfen" } });
    fireEvent.click(screen.getByRole("button", { name: /Create note/i }));
    await waitFor(() => {
      expect(
        h.dispatched.some((c) => c.type === "@vtt/notes/CreateNote"),
      ).toBe(true);
    });
    // After NoteCreated arrives, the form dispatches RetargetTab.
    await waitFor(() => {
      expect(
        h.dispatched.some(
          (c) => c.type === "@vtt/shell-workbench/RetargetTab",
        ),
      ).toBe(true);
    });
  });

  it("with one note, the list shows it and Open dispatches RetargetTab", async () => {
    const h = harness({ withNote: true });
    mountWithClient(h, () =>
      NotesPageProvider.render({
        tabId: "tab-1",
        entityId: null,
        uiState: () => null,
        setUiState: () => {},
      }) as never,
    );
    const titleEl = await screen.findByText("Goblin Cave");
    expect(titleEl).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Open/i })[0]!);
    await waitFor(() => {
      expect(
        h.dispatched.some(
          (c) => c.type === "@vtt/shell-workbench/RetargetTab",
        ),
      ).toBe(true);
    });
  });
});

describe("NotesPage view (with entityId)", () => {
  it("renders the title, page rail, and rendered markdown", async () => {
    const h = harness({ withNote: true });
    const noteId = h.world.query([Note])[0]!.id;
    mountWithClient(h, () =>
      NotesPageProvider.render({
        tabId: "tab-1",
        entityId: noteId,
        uiState: () => null,
        setUiState: () => {},
      }) as never,
    );
    expect(await screen.findByText("Goblin Cave")).toBeInTheDocument();
    // Page rail entry
    expect(screen.getByRole("button", { name: /Map/ })).toBeInTheDocument();
    // Rendered heading from body
    expect(screen.getByRole("heading", { name: /The Goblin Cave/i })).toBeInTheDocument();
    // Edit button shown to owner
    expect(screen.getByRole("button", { name: /^Edit$/ })).toBeInTheDocument();
  });

  it("Edit button dispatches BeginEdit", async () => {
    const h = harness({ withNote: true });
    const noteId = h.world.query([Note])[0]!.id;
    mountWithClient(h, () =>
      NotesPageProvider.render({
        tabId: "tab-1",
        entityId: noteId,
        uiState: () => null,
        setUiState: () => {},
      }) as never,
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Edit$/ }));
    await waitFor(() => {
      expect(
        h.dispatched.some((c) => c.type === "@vtt/notes/BeginEdit"),
      ).toBe(true);
    });
  });
});
