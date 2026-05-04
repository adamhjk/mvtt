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

import { createSignal, type Accessor } from "solid-js";

/**
 * A pending "open the Rules page and run this query" request,
 * published by the command palette's `rules: <query>` syntax and
 * consumed by `RulesSearchAllView` once it mounts.
 *
 * `nonce` disambiguates repeat invocations — re-running the same query
 * (palette → enter → palette → enter on the same string) bumps the
 * nonce so the consumer's effect re-fires the search.
 *
 * Mirrors `@vtt/books/shared/pending-nav` — we keep the request as a
 * session-local signal rather than a per-tab trait because palette
 * intent is transient (published, consumed, cleared) and shouldn't
 * survive reloads or replicate to other devices.
 */
export interface PendingRulesQuery {
  readonly query: string;
  readonly nonce: number;
}

let nonceCounter = 0;
const [pending, setPending] = createSignal<PendingRulesQuery | null>(null);

/** Reactive accessor for the current pending query (or null). */
export const pendingRulesQuery: Accessor<PendingRulesQuery | null> = pending;

/**
 * Publish a pending search request. The palette calls this immediately
 * before dispatching `OpenPage` for the Rules page; `RulesSearchAllView`
 * picks it up as soon as its `createEffect` runs and clears it once
 * the search has been fired.
 */
export function publishRulesQuery(query: string): void {
  nonceCounter += 1;
  setPending({ query, nonce: nonceCounter });
}

/**
 * Clear the request. Guarded by `nonce` so a stale clear from a
 * previous request can't blow away a fresh one (rapid double-invoke
 * from the palette).
 */
export function clearRulesQuery(nonce: number): void {
  const cur = pending();
  if (cur && cur.nonce === nonce) {
    setPending(null);
  }
}

/**
 * Test-only reset. Module-state signals don't reset between vitest
 * cases unless we ask; tests that publish/consume should call this in
 * `beforeEach` to avoid cross-test bleed.
 */
export function __resetPendingRulesQueryForTests(): void {
  setPending(null);
  nonceCounter = 0;
}
