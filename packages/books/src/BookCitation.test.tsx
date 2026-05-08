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
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { buildTestClient } from "@vtt/substrate/client-testing";
import { ClientProvider } from "@vtt/substrate/client";
import {
  definePlugin,
  defineSlot,
  defineSurface,
  z,
  type EntityId,
} from "@vtt/substrate";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "@vtt/notes";
import { books } from "./manifest.js";
import { BookCanonical } from "./shared/index.js";
import {
  __resetPendingBookNavForTests,
  pendingBookNav,
} from "./shared/pending-nav.js";
import { BookCitation } from "./client/BookCitation.js";

const workbenchStub = definePlugin({
  name: "@vtt/test-workbench-stub",
  version: "0.0.0",
  slots: [
    defineSlot({ name: "@vtt/shell-workbench/pages", schema: z.any() }),
  ],
  surfaces: [
    defineSurface({
      name: "@vtt/shell-workbench/header",
      kind: "stacked",
      context: z.object({}),
    }),
    defineSurface({
      name: "@vtt/shell-workbench/chat-rail",
      kind: "stacked",
      context: z.object({}),
    }),
  ],
});

beforeEach(() => {
  cleanup();
  __resetPendingBookNavForTests();
});

const ME = "test-me";
const ME_CLIENT = "client-me";

function harness(opts?: { boundBookId?: EntityId | true }) {
  return buildTestClient({
    plugins: [workbenchStub, notes, identity, permissions, books],
    clientId: ME_CLIENT,
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: ME, role: "player" }),
        Name({ value: "Me" }),
        Online({ clientId: ME_CLIENT, since: Date.now() }),
      ]);
      if (opts?.boundBookId) {
        const bookId =
          opts.boundBookId === true ? world.spawn([]) : opts.boundBookId;
        world.set(bookId, BookCanonical, {
          canonicalId: "tb/book/loremasters-manual",
        });
      }
    },
  });
}

describe("BookCitation", () => {
  it("unbound: renders plain text fallback (no button)", () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        <BookCitation
          canonicalId="tb/book/loremasters-manual"
          page={261}
          label="LMM p.261"
        />
      </ClientProvider>
    ));
    expect(screen.queryByRole("button")).toBeNull();
    const span = document.querySelector(
      '[data-canonical-id="tb/book/loremasters-manual"]',
    );
    expect(span?.tagName).toBe("SPAN");
    expect(span?.getAttribute("data-canonical-bound")).toBe("false");
    expect(span?.textContent).toBe("LMM p.261");
  });

  it("unbound: default label is `p.<page>` when none is supplied", () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        <BookCitation canonicalId="tb/book/scholars-guide" page={178} />
      </ClientProvider>
    ));
    const span = document.querySelector(
      '[data-canonical-id="tb/book/scholars-guide"]',
    );
    expect(span?.textContent).toBe("p.178");
  });

  it("bound: renders a button with the label", () => {
    const h = harness({ boundBookId: true });
    render(() => (
      <ClientProvider value={h.client}>
        <BookCitation
          canonicalId="tb/book/loremasters-manual"
          page={261}
          label="LMM p.261"
        />
      </ClientProvider>
    ));
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.getAttribute("data-canonical-bound")).toBe("true");
    expect(btn.textContent).toContain("LMM p.261");
  });

  it("bound click: dispatches OpenPage with the bookId and publishes a pending page-nav", () => {
    const h = harness();
    const bookId = h.world.spawn([]);
    h.world.set(bookId, BookCanonical, {
      canonicalId: "tb/book/loremasters-manual",
    });
    render(() => (
      <ClientProvider value={h.client}>
        <BookCitation
          canonicalId="tb/book/loremasters-manual"
          page={261}
          label="LMM p.261"
        />
      </ClientProvider>
    ));
    fireEvent.click(screen.getByRole("button"));
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]!.type).toBe("@vtt/shell-workbench/OpenPage");
    expect(h.dispatched[0]!.payload).toMatchObject({
      pageKind: "@vtt/books/books",
      entityId: bookId,
    });
    const nav = pendingBookNav();
    expect(nav).not.toBeNull();
    expect(nav!.bookId).toBe(bookId);
    expect(nav!.page).toBe(261);
  });

  it("reactively switches from unbound→bound when the binding lands mid-mount", () => {
    const h = harness();
    render(() => (
      <ClientProvider value={h.client}>
        <BookCitation
          canonicalId="tb/book/loremasters-manual"
          page={261}
          label="LMM p.261"
        />
      </ClientProvider>
    ));
    expect(screen.queryByRole("button")).toBeNull();
    const bookId = h.world.spawn([]);
    h.world.set(bookId, BookCanonical, {
      canonicalId: "tb/book/loremasters-manual",
    });
    expect(screen.getByRole("button").textContent).toContain("LMM p.261");
  });

  it("reactively switches from bound→unbound when the binding is removed", () => {
    const h = harness();
    const bookId = h.world.spawn([]);
    h.world.set(bookId, BookCanonical, {
      canonicalId: "tb/book/loremasters-manual",
    });
    render(() => (
      <ClientProvider value={h.client}>
        <BookCitation
          canonicalId="tb/book/loremasters-manual"
          page={261}
          label="LMM p.261"
        />
      </ClientProvider>
    ));
    expect(screen.getByRole("button")).toBeInTheDocument();
    h.world.remove(bookId, BookCanonical);
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      document.querySelector(
        '[data-canonical-id="tb/book/loremasters-manual"]',
      )?.tagName,
    ).toBe("SPAN");
  });

  it("an aria-label is included for screen readers when bound", () => {
    const h = harness({ boundBookId: true });
    render(() => (
      <ClientProvider value={h.client}>
        <BookCitation
          canonicalId="tb/book/loremasters-manual"
          page={261}
          label="LMM p.261"
        />
      </ClientProvider>
    ));
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toMatch(/loremasters-manual/);
    expect(btn.getAttribute("aria-label")).toMatch(/261/);
  });

  it("custom ariaLabel overrides the default", () => {
    const h = harness({ boundBookId: true });
    render(() => (
      <ClientProvider value={h.client}>
        <BookCitation
          canonicalId="tb/book/loremasters-manual"
          page={261}
          label="LMM p.261"
          ariaLabel="open Loremaster's Manual at the Vampire Lord stat block"
        />
      </ClientProvider>
    ));
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "open Loremaster's Manual at the Vampire Lord stat block",
    );
  });
});
