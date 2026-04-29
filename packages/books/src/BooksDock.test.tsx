import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, render } from "@solidjs/testing-library";
import {
  buildTestClient,
} from "@vtt/substrate/client-testing";
import { ClientProvider } from "@vtt/substrate/client";
import { definePlugin, qualifiedName } from "@vtt/substrate";
import { shellWorkbench } from "@vtt/shell-workbench";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { books } from "./manifest.js";
import { BookOverlayTabsSlot, type BookOverlayTab } from "./shared/slot.js";
import { BooksDock } from "./client/BooksDock.js";

beforeEach(() => cleanup());

const BOOK_ID = "book-1";

function harness(opts?: { extraTabs?: BookOverlayTab[] }) {
  const extraTabsPlugin = definePlugin({
    name: "@vtt/test-book-tabs",
    version: "0.0.0",
    fills: {
      [BookOverlayTabsSlot.name]: opts?.extraTabs ?? [],
    },
  });
  return buildTestClient({
    plugins: [shellWorkbench, identity, permissions, books, extraTabsPlugin],
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
    render(() => (
      <ClientProvider value={h.client}>
        <BooksDock bookId={BOOK_ID} uiState={{}} setUiState={() => {}} />
      </ClientProvider>
    ));
    expect(screen.getByRole("button", { name: /Config/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Custom/i })).toBeInTheDocument();
  });

  it("clicking a pill opens the dock with that tab active in uiState", () => {
    const h = harness({ extraTabs: [tab("Custom", "custom body")] });
    const setUiState = vi.fn();
    render(() => (
      <ClientProvider value={h.client}>
        <BooksDock bookId={BOOK_ID} uiState={{}} setUiState={setUiState} />
      </ClientProvider>
    ));
    fireEvent.click(screen.getByRole("button", { name: /Custom/i }));
    expect(setUiState).toHaveBeenCalledWith(
      expect.objectContaining({
        bookDockOpen: true,
        bookDockActive: expect.stringContaining("@test/books/custom"),
      }),
    );
  });

  it("renders the active tab body when uiState.bookDockOpen is true", () => {
    const h = harness({ extraTabs: [tab("Custom", "custom body")] });
    render(() => (
      <ClientProvider value={h.client}>
        <BooksDock
          bookId={BOOK_ID}
          uiState={{
            bookDockOpen: true,
            bookDockActive: "@test/books/custom",
          }}
          setUiState={() => {}}
        />
      </ClientProvider>
    ));
    expect(screen.getByTestId("tab-Custom")).toBeInTheDocument();
    expect(screen.getByText("custom body")).toBeInTheDocument();
  });
});
