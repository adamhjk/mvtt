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

import { z } from "@vtt/substrate";

/**
 * Two-sided team allegiance for a participant. The party side is the
 * player team; the enemy side is the GM team. Naming reflects how
 * Torchbearer rules read — players are "the party" — even when the
 * conflict is convince crowd or trick where "party" is figurative.
 */
export const ConflictSideEnum = z.enum(["party", "enemy"]);
export type ConflictSide = z.infer<typeof ConflictSideEnum>;

export function otherSide(side: ConflictSide): ConflictSide {
  return side === "party" ? "enemy" : "party";
}
