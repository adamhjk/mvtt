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
  RenamePage,
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

function harness() {
  let setup!: { noteId: EntityId; pageA: EntityId };
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
      world.spawnAt(noteId, [
        Note({ title: "TestNote", createdAt: 0 }),
        OwnedBy({ userId: ME_USER_ID }),
        EntityVisibility({ visibility: everyone() }),
      ]);
      world.spawnAt(pageA, [
        BelongsToNote({ noteId }),
        Page({ title: "Original", body: "", bodyRev: 0 }),
        PageOrdering({ ordinal: 0 }),
        Headings({ items: [] }),
        EntityVisibility({ visibility: everyone() }),
      ]);
      const sentinelId = tabSentinelEntityId(TAB_ID);
      world.spawnAt(sentinelId, [
        TabSentinel({ tabId: TAB_ID }),
        OwnedBy({ userId: ME_USER_ID }),
        EntityVisibility({ visibility: everyone() }),
        NotesUiState({ activePageId: pageA, pendingHeadingId: null }),
      ]);
      setup = { noteId, pageA };
    },
  });
  return { ...h, setup };
}

describe("PageTitleField rename", () => {
  it("typing into the title and blurring dispatches RenamePage with the new value", async () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        <NoteView noteId={h.setup.noteId} tabId={TAB_ID} />
      </ClientProvider>
    ));

    const input = (await screen.findByDisplayValue(
      "Original",
    )) as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "Renamed" } });
    fireEvent.blur(input);

    const renames = h.dispatched.filter(
      (c) => c.type === RenamePage.name,
    );
    expect(renames).toHaveLength(1);
    expect(renames[0]!.payload).toEqual({
      pageId: h.setup.pageA,
      title: "Renamed",
    });

    await waitFor(() => {
      const got = h.world.get(h.setup.pageA, [Page]) as
        | { Page: { title: string } }
        | undefined;
      expect(got?.Page.title).toBe("Renamed");
    });
  });
});
