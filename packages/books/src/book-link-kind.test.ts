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

import { describe, it, expect, beforeEach } from "vitest";
import { World, type EntityId } from "@vtt/substrate";
import { Book, BookCanonical } from "./shared/traits.js";
import { bookLinkKind } from "./shared/book-link-kind.js";
import { pendingBookNav, __resetPendingBookNavForTests } from "./shared/pending-nav.js";

const noModifiers = {
  modifiers: { meta: false, shift: false, alt: false },
} as const;

beforeEach(() => __resetPendingBookNavForTests());

describe("bookLinkKind.parse", () => {
  it("resolves a name match (case-insensitive)", () => {
    const world = new World();
    const id = world.allocateId();
    world.spawnAt(id, [Book({ name: "Player's Handbook" })]);

    const ref = bookLinkKind.parse("player's handbook", null, world);
    expect(ref).toEqual({ bookId: id });
  });

  it("captures a numeric anchor as a page number", () => {
    const world = new World();
    const id = world.allocateId();
    world.spawnAt(id, [Book({ name: "PHB" })]);

    const ref = bookLinkKind.parse("PHB", "42", world);
    expect(ref).toEqual({ bookId: id, page: 42 });
  });

  it("captures a non-numeric anchor as a TOC title", () => {
    const world = new World();
    const id = world.allocateId();
    world.spawnAt(id, [Book({ name: "PHB" })]);

    const ref = bookLinkKind.parse("PHB", "Chapter 1: Step-By-Step Characters", world);
    expect(ref).toEqual({
      bookId: id,
      tocTitle: "Chapter 1: Step-By-Step Characters",
    });
  });

  it("rejects an empty body", () => {
    const world = new World();
    expect(bookLinkKind.parse("", null, world)).toBeNull();
    expect(bookLinkKind.parse("   ", null, world)).toBeNull();
  });

  it("rejects an unknown name", () => {
    const world = new World();
    expect(bookLinkKind.parse("ghostbook", null, world)).toBeNull();
  });

  it("rejects an entity id that exists but isn't a Book", () => {
    const world = new World();
    const id = world.allocateId();
    world.spawnAt(id, []);
    expect(bookLinkKind.parse(id, null, world)).toBeNull();
  });

  it("resolves by canonical id (BookCanonical trait)", () => {
    // The GM may have named the Book anything ("Scholar's Guide",
    // "scholars-guide.pdf", "SG", …) but bound it to the
    // tb/book/scholars-guide canonical role. Adventure / catalog
    // content cites the canonical id so it resolves in any world.
    const world = new World();
    const id = world.allocateId();
    world.spawnAt(id, [
      Book({ name: "Scholar's Guide" }),
      BookCanonical({ canonicalId: "tb/book/scholars-guide" }),
    ]);

    const ref = bookLinkKind.parse("tb/book/scholars-guide", "240", world);
    expect(ref).toEqual({ bookId: id, page: 240 });
  });

  it("falls through canonical-id resolution when no Book holds the role", () => {
    const world = new World();
    const id = world.allocateId();
    world.spawnAt(id, [Book({ name: "Scholar's Guide" })]);
    // No BookCanonical trait → canonical-id lookup yields null.
    expect(bookLinkKind.parse("tb/book/scholars-guide", null, world)).toBeNull();
  });

  it("canonical-id lookup ignores book entities without the trait", () => {
    const world = new World();
    const a = world.allocateId();
    world.spawnAt(a, [Book({ name: "Other Book" })]);
    const b = world.allocateId();
    world.spawnAt(b, [Book({ name: "Real PHB" }), BookCanonical({ canonicalId: "dnd/book/phb" })]);
    const ref = bookLinkKind.parse("dnd/book/phb", null, world);
    expect(ref).toEqual({ bookId: b });
  });
});

describe("bookLinkKind.activate", () => {
  it("returns navigate and does not publish a nav request for a bare book link", () => {
    const ref = { bookId: "e9" as EntityId };
    const out = bookLinkKind.activate(ref, noModifiers);
    expect(out).toEqual({
      type: "navigate",
      pageKind: "@vtt/books/books",
      entityId: "e9",
    });
    // Bare `[[book:Name]]` opens the book but doesn't request a
    // specific page — no signal write.
    expect(pendingBookNav()).toBeNull();
  });

  it("publishes a page nav request and returns plain navigate for a page anchor", () => {
    const ref = { bookId: "e9" as EntityId, page: 17 };
    const out = bookLinkKind.activate(ref, noModifiers);
    expect(out).toEqual({
      type: "navigate",
      pageKind: "@vtt/books/books",
      entityId: "e9",
    });
    const nav = pendingBookNav();
    expect(nav).not.toBeNull();
    expect(nav!.bookId).toBe("e9");
    expect(nav!.page).toBe(17);
    expect(nav!.tocTitle).toBeUndefined();
    expect(typeof nav!.nonce).toBe("number");
  });

  it("publishes a TOC nav request and returns plain navigate for a TOC anchor", () => {
    const ref = { bookId: "e9" as EntityId, tocTitle: "Chapter 1" };
    const out = bookLinkKind.activate(ref, noModifiers);
    expect(out).toEqual({
      type: "navigate",
      pageKind: "@vtt/books/books",
      entityId: "e9",
    });
    const nav = pendingBookNav();
    expect(nav).not.toBeNull();
    expect(nav!.bookId).toBe("e9");
    expect(nav!.tocTitle).toBe("Chapter 1");
    expect(nav!.page).toBeUndefined();
  });

  it("each activate call mints a fresh nonce so repeat clicks are distinguishable", () => {
    bookLinkKind.activate({ bookId: "e9" as EntityId, page: 17 }, noModifiers);
    const a = pendingBookNav()!.nonce;
    bookLinkKind.activate({ bookId: "e9" as EntityId, page: 17 }, noModifiers);
    const b = pendingBookNav()!.nonce;
    expect(a).not.toBe(b);
  });
});

describe("bookLinkKind.display", () => {
  it("reads Book.name and decorates with the page number", () => {
    const world = new World();
    const id = world.allocateId();
    world.spawnAt(id, [Book({ name: "PHB" })]);
    expect(bookLinkKind.display({ bookId: id, page: 7 }, world)).toBe("PHB · p7");
  });

  it("reads Book.name and decorates with the TOC title", () => {
    const world = new World();
    const id = world.allocateId();
    world.spawnAt(id, [Book({ name: "PHB" })]);
    expect(bookLinkKind.display({ bookId: id, tocTitle: "Combat" }, world)).toBe("PHB · Combat");
  });

  it("falls back to a placeholder when the entity is gone", () => {
    const world = new World();
    expect(bookLinkKind.display({ bookId: "e404" as EntityId }, world)).toBe("(missing book)");
  });
});
