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
import { screen, cleanup, fireEvent, render } from "@solidjs/testing-library";
import {
  buildTestClient,
} from "@vtt/substrate/client-testing";
import { ClientProvider } from "@vtt/substrate/client";
import {
  definePlugin,
  qualifiedName,
  type World,
} from "@vtt/substrate";
import { EntityVisibility, OwnedBy, everyone } from "@vtt/permissions/shared";
import { shellWorkbench } from "@vtt/shell-workbench";
import { TabSentinel, tabSentinelEntityId } from "@vtt/shell-workbench/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "@vtt/notes";
import { books } from "./manifest.js";
import { BooksUiState, SetBooksUiState } from "./shared/index.js";
import { BookOverlayTabsSlot, type BookOverlayTab } from "./shared/slot.js";
import { BooksDock } from "./client/BooksDock.js";

beforeEach(() => cleanup());

const BOOK_ID = "book-1";
const TAB_ID = "tab-1";
const ME = "alice";

/**
 * Spawn the per-tab sentinel a `BooksDock` looks up via `useTabSentinel`.
 * In production the workbench's `WorkspaceStateApply` system spawns this
 * on tab open; tests skip workbench commands and seed it directly.
 */
function seedSentinel(
  world: World,
  initial: { dockOpen: boolean; dockActiveId: string | null } = {
    dockOpen: false,
    dockActiveId: null,
  },
): void {
  world.spawnAt(tabSentinelEntityId(TAB_ID), [
    TabSentinel({ tabId: TAB_ID }),
    OwnedBy({ userId: ME }),
    EntityVisibility({ visibility: everyone() }),
    BooksUiState(initial),
  ]);
}

function harness(opts?: { extraTabs?: BookOverlayTab[] }) {
  const extraTabsPlugin = definePlugin({
    name: "@vtt/test-book-tabs",
    version: "0.0.0",
    fills: {
      [BookOverlayTabsSlot.name]: opts?.extraTabs ?? [],
    },
  });
  return buildTestClient({
    plugins: [shellWorkbench, notes, identity, permissions, books, extraTabsPlugin],
  });
}

function tab(label: string, body: string, priority = 0): BookOverlayTab {
  return {
    id: qualifiedName(`@test/books/${label.toLowerCase()}`) as BookOverlayTab["id"],
    label,
    priority,
    render: () => <div data-testid={`tab-${label}`}>{body}</div>,
  };
}

describe("books BooksDock", () => {
  it("renders one pill per registered tab", () => {
    const h = harness({ extraTabs: [tab("Custom", "custom body")] });
    seedSentinel(h.world);
    render(() => (
      <ClientProvider value={h.client}>
        <BooksDock bookId={BOOK_ID} tabId={TAB_ID} />
      </ClientProvider>
    ));
    expect(screen.getByRole("button", { name: /Config/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Custom/i })).toBeInTheDocument();
  });

  it("clicking a pill dispatches SetBooksUiState with the activated tab", () => {
    const h = harness({ extraTabs: [tab("Custom", "custom body")] });
    seedSentinel(h.world);
    render(() => (
      <ClientProvider value={h.client}>
        <BooksDock bookId={BOOK_ID} tabId={TAB_ID} />
      </ClientProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: /Custom/i }));

    const dispatched = h.dispatched.find(
      (cmd) => cmd.type === SetBooksUiState.name,
    );
    expect(dispatched).toBeDefined();
    expect((dispatched!.payload as { value: { dockOpen: boolean; dockActiveId: string } }).value).toEqual({
      dockOpen: true,
      dockActiveId: expect.stringContaining("@test/books/custom"),
    });
  });

  it("renders the active tab body when the trait is open with a matching id", () => {
    const h = harness({ extraTabs: [tab("Custom", "custom body")] });
    seedSentinel(h.world, {
      dockOpen: true,
      dockActiveId: "@test/books/custom",
    });
    render(() => (
      <ClientProvider value={h.client}>
        <BooksDock bookId={BOOK_ID} tabId={TAB_ID} />
      </ClientProvider>
    ));
    expect(screen.getByTestId("tab-Custom")).toBeInTheDocument();
    expect(screen.getByText("custom body")).toBeInTheDocument();
  });
});
