import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
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
  Page,
  BelongsToNote,
  PageOrdering,
  Headings,
} from "./shared/index.js";
import { headingIdFor } from "./shared/headings.js";
import { NoteView } from "./client/NoteView.jsx";

beforeEach(() => cleanup());

const ME_USER_ID = "alice";
const ME_CLIENT = "test-client-1";
const SESSION = {
  userId: ME_USER_ID,
  email: "alice@test.dev",
  name: "Alice",
  role: "player",
};

interface Setup {
  noteId: EntityId;
  pageA: EntityId;
  pageB: EntityId;
  headingId: string;
}

function harness(): {
  client: ReturnType<typeof buildTestClient>["client"];
  pipeline: ReturnType<typeof buildTestClient>["pipeline"];
  bus: ReturnType<typeof buildTestClient>["bus"];
  world: ReturnType<typeof buildTestClient>["world"];
  setup: Setup;
} {
  let setup: Setup | undefined;
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
      const pageA = world.allocateId();
      const pageB = world.allocateId();
      world.spawnAt(noteId, [
        Note({ title: "TestNote", createdAt: 0 }),
        OwnedBy({ userId: ME_USER_ID }),
        EntityVisibility({ visibility: everyone() }),
      ]);
      world.spawnAt(pageA, [
        BelongsToNote({ noteId }),
        Page({
          title: "PageA",
          // Two wiki-links: one to a same-page heading on PageA's own
          // first heading, one cross-page to PageB > Tactics.
          body:
            "# Intro\n\nLink in PageA: [[TestNote > PageA > Intro]] " +
            "and cross page: [[TestNote > PageB > Tactics]]",
          bodyRev: 1,
        }),
        PageOrdering({ ordinal: 0 }),
        Headings({
          items: [
            {
              id: headingIdFor("Intro", 1),
              text: "Intro",
              level: 1 as const,
            },
          ],
        }),
        EntityVisibility({ visibility: everyone() }),
      ]);
      world.spawnAt(pageB, [
        BelongsToNote({ noteId }),
        Page({
          title: "PageB",
          body: "# Tactics\n\nAmbush the cave entrance.",
          bodyRev: 1,
        }),
        PageOrdering({ ordinal: 1 }),
        Headings({
          items: [
            {
              id: headingIdFor("Tactics", 1),
              text: "Tactics",
              level: 1 as const,
            },
          ],
        }),
        EntityVisibility({ visibility: everyone() }),
      ]);

      setup = {
        noteId,
        pageA,
        pageB,
        headingId: headingIdFor("Tactics", 1),
      };
    },
  });
  return { client: h.client, pipeline: h.pipeline, bus: h.bus, world: h.world, setup: setup! };
}

function installScrollSpy(): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: spy,
  });
  return spy;
}

describe("NoteView click → scroll-to-anchor", () => {
  it("clicking a same-page heading link scrolls to the heading", async () => {
    const h = harness();
    const introId = headingIdFor("Intro", 1);
    const scrollSpy = installScrollSpy();

    // uiState starts on PageA.
    const [uiState, setUiState] = (() => {
      let s: unknown = { activePageId: h.setup.pageA };
      const setters: Array<(next: unknown) => void> = [];
      return [
        () => s,
        (next: unknown) => {
          s = next;
          for (const fn of setters) fn(next);
        },
        setters,
      ] as const;
    })();
    void uiState;
    void setUiState;

    // Use a Solid signal so reactivity flows through NoteView's props.
    const { createSignal } = await import("solid-js");
    const [ui, setUi] = createSignal<unknown>({ activePageId: h.setup.pageA });

    render(() => (
      <ClientProvider value={h.client}>
        <NoteView
          noteId={h.setup.noteId}
          tabId="tab-1"
          uiState={ui() as never}
          setUiState={setUi}
        />
      </ClientProvider>
    ));

    // Sanity: PageA's body rendered with the Intro heading present.
    await waitFor(() => {
      expect(document.querySelector(`[id="${introId}"]`)).not.toBeNull();
    });

    // The same-page wiki-link chip resolves to the Intro heading on
    // PageA. There are two chips on the page; we want the first one.
    const chips = await screen.findAllByRole("button");
    // Find the chip whose text matches the same-page heading link.
    const samePageChip = chips.find((b) =>
      (b.textContent ?? "").includes("Intro"),
    );
    expect(samePageChip, "no chip linking to PageA › Intro").toBeDefined();

    fireEvent.click(samePageChip!);

    await waitFor(
      () => {
        expect(scrollSpy).toHaveBeenCalled();
      },
      { timeout: 1000 },
    );
    // Verify the spy fired against the *Intro* heading, not some
    // other element.
    const introEl = document.querySelector(`[id="${introId}"]`);
    expect(scrollSpy.mock.instances).toContain(introEl);
  });

  it("clicking a cross-page heading link switches the page AND scrolls", async () => {
    const h = harness();
    const tacticsId = headingIdFor("Tactics", 1);
    const scrollSpy = installScrollSpy();

    const { createSignal } = await import("solid-js");
    const [ui, setUi] = createSignal<unknown>({ activePageId: h.setup.pageA });

    render(() => (
      <ClientProvider value={h.client}>
        <NoteView
          noteId={h.setup.noteId}
          tabId="tab-1"
          uiState={ui() as never}
          setUiState={setUi}
        />
      </ClientProvider>
    ));

    // Sanity: we're on PageA — the Tactics heading is NOT yet in DOM.
    await waitFor(() => {
      expect(document.querySelector(`[id="${tacticsId}"]`)).toBeNull();
    });

    const chips = await screen.findAllByRole("button");
    const crossPageChip = chips.find((b) =>
      (b.textContent ?? "").includes("Tactics"),
    );
    expect(crossPageChip, "no chip linking to PageB › Tactics").toBeDefined();

    fireEvent.click(crossPageChip!);

    // After click: uiState should now point at PageB and carry the
    // pending heading id.
    await waitFor(() => {
      const u = ui() as { activePageId?: EntityId; pendingHeadingId?: string };
      expect(u.activePageId).toBe(h.setup.pageB);
    });

    // PageB's Tactics heading is now in DOM; the scroll fires against it.
    await waitFor(
      () => {
        expect(document.querySelector(`[id="${tacticsId}"]`)).not.toBeNull();
      },
      { timeout: 1000 },
    );
    await waitFor(
      () => {
        expect(scrollSpy).toHaveBeenCalled();
      },
      { timeout: 1000 },
    );
    const tacticsEl = document.querySelector(`[id="${tacticsId}"]`);
    expect(scrollSpy.mock.instances).toContain(tacticsEl);
  });
});
