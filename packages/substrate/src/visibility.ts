// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

/**
 * Per-event visibility metadata. The substrate uses this to decide which
 * connections receive a broadcast and which are filtered out — the trust
 * model's marquee feature: GM-only rolls, whispers, save-result private
 * fields. Plugins build values via the `@vtt/permissions` builders
 * (`everyone()`, `gmOnly()`, `actors([...])`); the substrate stays
 * auth-agnostic and just evaluates the structure.
 *
 * Serialisable: stored verbatim on persisted event rows so a "since: N"
 * reconnect can replay tail events with the same filtering applied.
 */
export type Visibility =
  | { kind: "everyone" }
  | { kind: "role"; role: string }
  | { kind: "users"; userIds: string[] };

/**
 * What the substrate knows about a connected client when evaluating
 * visibility. Pulled from the auth session via `ServerOptions.extractRecipient`.
 * Plugins are free to add their own session-shape — the substrate only
 * cares that `userId` and `role` come out somewhere.
 */
export interface Recipient {
  readonly userId: string;
  readonly role: string;
}

/**
 * Should this recipient receive an event with this visibility? `undefined`
 * visibility (the common case) means the event is public — everyone gets it.
 * If a non-public visibility is set but we don't know the recipient (no
 * extractRecipient configured, or the session was malformed), default to
 * deny — better to drop a private event than to leak it.
 */
export function matches(vis: Visibility | undefined, recipient: Recipient | null): boolean {
  if (!vis || vis.kind === "everyone") return true;
  if (!recipient) return false;
  if (vis.kind === "role") return recipient.role === vis.role;
  if (vis.kind === "users") return vis.userIds.includes(recipient.userId);
  return false;
}

import type { EventInstance } from "./define.js";

/**
 * Attach visibility metadata to an event instance. The substrate's
 * broadcast and persistence paths read it; plugins use the `@vtt/permissions`
 * builders to construct typical shapes:
 *
 *   apply: ({ cmd }) => [
 *     withVisibility(RollResolved({ ...payload }), gmOnly()),
 *   ]
 */
export function withVisibility<T>(
  event: EventInstance<T>,
  visibility: Visibility,
): EventInstance<T> {
  return { ...event, visibility };
}
