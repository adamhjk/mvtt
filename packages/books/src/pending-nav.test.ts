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
import { type EntityId } from "@vtt/substrate";
import {
  pendingBookNav,
  publishBookNav,
  clearBookNav,
  __resetPendingBookNavForTests,
} from "./shared/pending-nav.js";

beforeEach(() => __resetPendingBookNavForTests());

describe("pendingBookNav signal", () => {
  it("starts null", () => {
    expect(pendingBookNav()).toBeNull();
  });

  it("publishBookNav writes the request with a fresh nonce", () => {
    publishBookNav({ bookId: "e1" as EntityId, page: 42 });
    const nav = pendingBookNav();
    expect(nav).not.toBeNull();
    expect(nav!.bookId).toBe("e1");
    expect(nav!.page).toBe(42);
    expect(typeof nav!.nonce).toBe("number");
  });

  it("repeat publishes mint distinct nonces so consumers see fresh requests", () => {
    publishBookNav({ bookId: "e1" as EntityId, page: 42 });
    const a = pendingBookNav()!.nonce;
    publishBookNav({ bookId: "e1" as EntityId, page: 42 });
    const b = pendingBookNav()!.nonce;
    expect(a).not.toBe(b);
  });

  it("clearBookNav clears when (bookId, nonce) match", () => {
    publishBookNav({ bookId: "e1" as EntityId, page: 42 });
    const nav = pendingBookNav()!;
    clearBookNav(nav.bookId, nav.nonce);
    expect(pendingBookNav()).toBeNull();
  });

  it("clearBookNav with a stale nonce is a no-op (a fresh request isn't blown away)", () => {
    publishBookNav({ bookId: "e1" as EntityId, page: 42 });
    const oldNonce = pendingBookNav()!.nonce;
    publishBookNav({ bookId: "e1" as EntityId, page: 100 });
    // Stale clear from a previous request that lost the race.
    clearBookNav("e1" as EntityId, oldNonce);
    const cur = pendingBookNav();
    expect(cur).not.toBeNull();
    expect(cur!.page).toBe(100);
  });

  it("clearBookNav with a different bookId is a no-op", () => {
    publishBookNav({ bookId: "e1" as EntityId, page: 42 });
    const nav = pendingBookNav()!;
    clearBookNav("e2" as EntityId, nav.nonce);
    expect(pendingBookNav()).not.toBeNull();
  });

});
