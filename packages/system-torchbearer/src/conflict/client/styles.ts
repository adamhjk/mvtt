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

/**
 * Shared style tokens for the conflict Reference Board. Keeps colour
 * and type choices consistent across all the components without
 * shipping yet another CSS module — components reference these
 * constants in their inline class strings.
 */

import type { ConflictAction } from "../shared/actions.js";

/**
 * Action chip colours. The four action types are load-bearing for
 * play — players need to recognise them at a glance — so we keep
 * the bespoke red/blue/purple/green here even though the rest of
 * the UI moves to design-token greys/greens. These render only on
 * face-up chips and matrix cells; everything else uses the standard
 * `bg-surface` / `text-fg` tokens.
 */
export const ACTION_COLORS: Readonly<Record<ConflictAction, string>> = {
  attack: "#B83227",
  defend: "#225D9B",
  feint: "#6E3FA1",
  maneuver: "#2F8A4A",
};

export const ACTION_LETTERS: Readonly<Record<ConflictAction, string>> = {
  attack: "A",
  defend: "D",
  feint: "F",
  maneuver: "M",
};

export const ACTION_LABELS: Readonly<Record<ConflictAction, string>> = {
  attack: "Attack",
  defend: "Defend",
  feint: "Feint",
  maneuver: "Maneuver",
};

