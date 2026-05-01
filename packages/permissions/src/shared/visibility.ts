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

import type { Visibility } from "@vtt/substrate";
import type { Role } from "@vtt/auth";

/**
 * The default — every connected client receives the event. Equivalent to
 * leaving `visibility` unset; provided as a builder so authors can be
 * explicit when the choice matters (`visibility: cmd.private ? gmOnly() :
 * everyone()`).
 */
export const everyone = (): Visibility => ({ kind: "everyone" });

/**
 * Only clients whose session role matches receive the event. The canonical
 * use is `gmOnly()` — secret rolls, GM notes, hidden-DC saves.
 */
export const ofRole = (role: Role): Visibility => ({ kind: "role", role });

export const gmOnly = (): Visibility => ofRole("gm");

/**
 * Only the listed userIds receive the event. Whispers are typically
 * `actors([senderId, recipientId])`; private save-result events are
 * usually `actors([rollerId, gmUserId])`.
 */
export const actors = (userIds: ReadonlyArray<string>): Visibility => ({
  kind: "users",
  userIds: [...userIds],
});

/**
 * Convenience: a private event between two specific users. Identical to
 * `actors` but reads as intent at the call site.
 */
export const whisper = (between: ReadonlyArray<string>): Visibility => actors(between);
