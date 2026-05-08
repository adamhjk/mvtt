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
import { definePlugin, defineSlot, defineSurface, z } from "@vtt/substrate";
import { Identity, Name, Online } from "@vtt/identity/shared";
import { identity } from "@vtt/identity";
import { permissions } from "@vtt/permissions";
import { notes } from "@vtt/notes";
import { books } from "./manifest.js";
import {
  BookCanonical,
  seedCanonicalBookCatalog,
  SetBookCanonical,
} from "./shared/index.js";
import { BookCanonicalConfigSection } from "./client/BookCanonicalConfigSection.js";

// Stub the workbench surfaces/slots @vtt/identity targets so the
// notes/books deps load cleanly in jsdom (mirrors the trick
// PdfConfigSection.test.tsx uses).
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

beforeEach(() => cleanup());

const ME = "test-me";
const ME_CLIENT = "client-me";

function harness(opts?: { asGm?: boolean; seed?: boolean }) {
  return buildTestClient({
    plugins: [workbenchStub, notes, identity, permissions, books],
    clientId: ME_CLIENT,
    setupWorld: ({ world }) => {
      world.spawn([
        Identity({ userId: ME, role: opts?.asGm ? "gm" : "player" }),
        Name({ value: "Me" }),
        Online({ clientId: ME_CLIENT, since: Date.now() }),
      ]);
      if (opts?.seed !== false) {
        seedCanonicalBookCatalog(world, "@vtt/system-torchbearer", [
          { id: "tb/book/scholars-guide", name: "TB2: Scholar's Guide" },
          { id: "tb/book/loremasters-manual", name: "TB2: Loremaster's Manual" },
        ]);
      }
    },
  });
}

describe("BookCanonicalConfigSection", () => {
  it("has a stable id and priority that sorts above PdfConfigSection (80)", () => {
    expect(BookCanonicalConfigSection.id).toBe("@vtt/books/config-canonical");
    expect(BookCanonicalConfigSection.priority).toBe(90);
  });

  it("omits the section entirely when no plugin has registered any canonical books", () => {
    const h = harness({ asGm: true, seed: false });
    const bookId = h.world.spawn([]);
    render(() => (
      <ClientProvider value={h.client}>
        {BookCanonicalConfigSection.render({ bookId }) as never}
      </ClientProvider>
    ));
    expect(screen.queryByLabelText("canonical rulebook")).toBeNull();
  });

  it("renders one option per registered canonical book entry plus a (none) row", () => {
    const h = harness({ asGm: true });
    const bookId = h.world.spawn([]);
    render(() => (
      <ClientProvider value={h.client}>
        {BookCanonicalConfigSection.render({ bookId }) as never}
      </ClientProvider>
    ));
    const select = screen.getByLabelText("canonical rulebook") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual([
      "",
      "tb/book/loremasters-manual",
      "tb/book/scholars-guide",
    ]);
  });

  it("disables options already claimed by a different Book in the world", () => {
    const h = harness({ asGm: true });
    const otherBookId = h.world.spawn([]);
    h.world.set(otherBookId, BookCanonical, {
      canonicalId: "tb/book/scholars-guide",
    });
    const myBookId = h.world.spawn([]);
    render(() => (
      <ClientProvider value={h.client}>
        {BookCanonicalConfigSection.render({ bookId: myBookId }) as never}
      </ClientProvider>
    ));
    const select = screen.getByLabelText("canonical rulebook") as HTMLSelectElement;
    const sg = Array.from(select.options).find(
      (o) => o.value === "tb/book/scholars-guide",
    )!;
    expect(sg.disabled).toBe(true);
    expect(sg.textContent).toMatch(/already bound/i);
  });

  it("does NOT disable an option this same Book already holds (so re-select is a no-op rebind)", () => {
    const h = harness({ asGm: true });
    const bookId = h.world.spawn([]);
    h.world.set(bookId, BookCanonical, {
      canonicalId: "tb/book/scholars-guide",
    });
    render(() => (
      <ClientProvider value={h.client}>
        {BookCanonicalConfigSection.render({ bookId }) as never}
      </ClientProvider>
    ));
    const select = screen.getByLabelText("canonical rulebook") as HTMLSelectElement;
    expect(select.value).toBe("tb/book/scholars-guide");
    const sg = Array.from(select.options).find(
      (o) => o.value === "tb/book/scholars-guide",
    )!;
    expect(sg.disabled).toBe(false);
  });

  it("dispatches SetBookCanonical on selection (binding a new id)", () => {
    const h = harness({ asGm: true });
    const bookId = h.world.spawn([]);
    render(() => (
      <ClientProvider value={h.client}>
        {BookCanonicalConfigSection.render({ bookId }) as never}
      </ClientProvider>
    ));
    const select = screen.getByLabelText("canonical rulebook") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "tb/book/loremasters-manual" } });
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]!.type).toBe(SetBookCanonical.name);
    expect(h.dispatched[0]!.payload).toEqual({
      bookId,
      canonicalId: "tb/book/loremasters-manual",
    });
  });

  it("(none) dispatches SetBookCanonical with canonicalId=null (unbind)", () => {
    const h = harness({ asGm: true });
    const bookId = h.world.spawn([]);
    h.world.set(bookId, BookCanonical, {
      canonicalId: "tb/book/scholars-guide",
    });
    render(() => (
      <ClientProvider value={h.client}>
        {BookCanonicalConfigSection.render({ bookId }) as never}
      </ClientProvider>
    ));
    const select = screen.getByLabelText("canonical rulebook") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "" } });
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]!.payload).toEqual({ bookId, canonicalId: null });
  });

  it("disables the dropdown for non-GM viewers", () => {
    const h = harness({ asGm: false });
    const bookId = h.world.spawn([]);
    render(() => (
      <ClientProvider value={h.client}>
        {BookCanonicalConfigSection.render({ bookId }) as never}
      </ClientProvider>
    ));
    const select = screen.getByLabelText("canonical rulebook") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });
});
