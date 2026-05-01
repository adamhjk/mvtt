// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { createSignal, type Accessor } from "solid-js";
import type { EntityId } from "@vtt/substrate";

/**
 * A pending "navigate this book to here" request, published by the
 * book wiki-link kind on click and consumed by whichever projection
 * view (PdfReader, future markdown reader, …) is currently rendering
 * the book on screen.
 *
 * `nonce` disambiguates repeat clicks on the same link — clicking
 * `[[book:PHB#42]]` while already on page 42 still bumps the nonce so
 * the consumer sees a fresh request and re-applies the navigation.
 */
export interface PendingBookNav {
  readonly bookId: EntityId;
  readonly page?: number;
  readonly tocTitle?: string;
  readonly nonce: number;
}

let nonceCounter = 0;
const [pending, setPending] = createSignal<PendingBookNav | null>(null);

/**
 * Reactive accessor for the current pending request (or null).
 *
 * Lives in a session-local module signal rather than a per-tab trait
 * because nav hints are transient — published, consumed, cleared. They
 * don't need to survive reloads or replicate to other devices, and a
 * trait write would couple every link click to a network round-trip
 * the user doesn't care about.
 */
export const pendingBookNav: Accessor<PendingBookNav | null> = pending;

/**
 * Publish a pending navigation request. Call site is the book link
 * kind's `activate` — the side effect runs synchronously inside the
 * notes-side dispatcher right before it dispatches `OpenPage`. The
 * receiving projection view subscribes via `pendingBookNav` and
 * navigates the moment the doc + (for TOC nav) outline are ready.
 */
export function publishBookNav(
  req: Omit<PendingBookNav, "nonce">,
): void {
  nonceCounter += 1;
  setPending({ ...req, nonce: nonceCounter });
}

/**
 * Clear the request once the projection view has consumed it. Guarded
 * by `(bookId, nonce)` so a stale clear from a previous request can't
 * blow away a fresh one (e.g., user clicks twice in rapid succession,
 * the consumer's effect is still resolving the first when the second
 * lands).
 */
export function clearBookNav(bookId: EntityId, nonce: number): void {
  const cur = pending();
  if (cur && cur.bookId === bookId && cur.nonce === nonce) {
    setPending(null);
  }
}

/**
 * Test-only reset. Vitest's `beforeEach(cleanup)` doesn't reset module
 * state; tests that exercise the publish/consume cycle should call
 * this to avoid leaking pending requests between cases.
 */
export function __resetPendingBookNavForTests(): void {
  setPending(null);
  nonceCounter = 0;
}
