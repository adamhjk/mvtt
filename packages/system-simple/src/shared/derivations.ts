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

import { defineDerivation } from "@vtt/substrate";
import { MaxHpChanged } from "./events.js";
import { MaxHp, Stats } from "./traits.js";

/**
 * MaxHp = Stats.might × 3. Recomputed whenever Stats changes.
 * Demonstrates the substrate's derivation pipeline end-to-end:
 * input → topo-sorted compute → world.set → emit `*Changed` event →
 * client trait sync → kit's <ValueField> updates.
 */
export const MaxHpDerivation = defineDerivation({
  name: "@vtt/system-simple/max-hp",
  inputs: [Stats] as const,
  output: MaxHp,
  compute: ([stats]) => stats.might * 3,
  toEvent: (entityId, value) => MaxHpChanged({ entityId, value }),
});
