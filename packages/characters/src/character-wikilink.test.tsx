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
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { type EntityId } from "@vtt/substrate";
import { buildTestClient, mountWithClient } from "@vtt/substrate/client-testing";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { ownedBy, Permissions } from "@vtt/permissions/shared";
import { notes } from "@vtt/notes";
import { Note, NotesUiState, Page, BelongsToNote, PageOrdering } from "@vtt/notes/shared";
import { NotesPageProvider } from "@vtt/notes/client";
import { TabSentinel, tabSentinelEntityId } from "@vtt/shell-workbench/shared";
import { characters } from "./manifest.js";
import { Character } from "./shared/traits.js";

beforeEach(() => cleanup());

const ME = "alice";
const ME_CLIENT = "client-alice";

interface Setup {
  noteId: EntityId;
  pageId: EntityId;
  characterId: EntityId;
}

function harness(): {
  dispatched: ReturnType<typeof buildTestClient>["dispatched"];
  client: ReturnType<typeof buildTestClient>["client"];
  world: ReturnType<typeof buildTestClient>["world"];
  setup: Setup;
} {
  let setup: Setup | undefined;
  const h = buildTestClient({
    plugins: [shellWorkbench, notes, identity, permissions, characters],
    clientId: ME_CLIENT,
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
        Online({ clientId: ME_CLIENT, since: 0 }),
      ]);

      const characterId = world.allocateId();
      world.spawnAt(characterId, [Character({ name: "Krell" }), Permissions(ownedBy(ME))]);

      const noteId = world.allocateId();
      const pageId = world.allocateId();
      world.spawnAt(noteId, [
        Note({ title: "Field Notes", createdAt: 0 }),
        Permissions(ownedBy(ME)),
      ]);
      world.spawnAt(pageId, [
        BelongsToNote({ noteId }),
        Page({
          title: "Page",
          body: "talked to [[character:Krell]] today",
          bodyRev: 1,
        }),
        PageOrdering({ ordinal: 0 }),
      ]);

      // Tab sentinel for the rendered NotesPage tab — the workbench's
      // WorkspaceStateApply system would normally spawn this on
      // OpenPage, but tests skip workbench commands.
      world.spawnAt(tabSentinelEntityId("tab-1"), [
        TabSentinel({ tabId: "tab-1" }),
        Permissions(ownedBy(ME)),
        NotesUiState({ activePageId: null, pendingHeadingId: null }),
      ]);

      setup = { noteId, pageId, characterId };
    },
  });
  return {
    dispatched: h.dispatched,
    client: h.client,
    world: h.world,
    setup: setup!,
  };
}

const CHARACTERS_KIND = "@vtt/characters/characters";
const OPEN_PAGE = "@vtt/shell-workbench/OpenPage";
const OPEN_PAGE_NEW_TAB = "@vtt/shell-workbench/OpenPageInNewTab";
const RETARGET_TAB = "@vtt/shell-workbench/RetargetTab";

async function findCharacterChip(): Promise<HTMLElement> {
  const buttons = await screen.findAllByRole("button");
  const chip = buttons.find((b) => b.getAttribute("data-link-kind") === "character");
  expect(chip, "expected a [[character:Krell]] chip with data-link-kind=character").toBeDefined();
  return chip!;
}

describe("character wiki-link click in a note", () => {
  it("plain click dispatches OpenPage targeting the character (focus existing or open new)", async () => {
    const h = harness();
    mountWithClient(
      h as never,
      () =>
        NotesPageProvider.render({
          tabId: "tab-1",
          entityId: h.setup.noteId,
        }) as never,
    );

    const chip = await findCharacterChip();
    fireEvent.click(chip);

    await waitFor(() => {
      const open = h.dispatched.find((c) => c.type === OPEN_PAGE);
      expect(open, "expected OpenPage to be dispatched").toBeDefined();
      expect(open!.payload).toMatchObject({
        pageKind: CHARACTERS_KIND,
        entityId: h.setup.characterId,
      });
    });

    // The notes tab itself must not be retargeted — the user stays in
    // their reading flow; cross-kind links open a separate tab.
    expect(h.dispatched.some((c) => c.type === RETARGET_TAB)).toBe(false);
  });

  it("cmd-click forces a new tab via OpenPageInNewTab", async () => {
    const h = harness();
    mountWithClient(
      h as never,
      () =>
        NotesPageProvider.render({
          tabId: "tab-1",
          entityId: h.setup.noteId,
        }) as never,
    );

    const chip = await findCharacterChip();
    fireEvent.click(chip, { metaKey: true });

    await waitFor(() => {
      const open = h.dispatched.find((c) => c.type === OPEN_PAGE_NEW_TAB);
      expect(open, "expected OpenPageInNewTab to be dispatched on cmd-click").toBeDefined();
      expect(open!.payload).toMatchObject({
        pageKind: CHARACTERS_KIND,
        entityId: h.setup.characterId,
      });
    });
    // And the dedup variant should NOT have fired — cmd-click is
    // explicitly "always new tab."
    expect(h.dispatched.some((c) => c.type === OPEN_PAGE)).toBe(false);
  });
});
