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

import { defineDerivation } from "@vtt/substrate";
import { MaxHpChanged } from "./events.js";
import { MaxHp, Stats } from "./traits.js";

/**
 * MaxHp = Stats.might × 3. Recomputed whenever Stats changes.
 * Demonstrates the substrate's derivation pipeline end-to-end:
 * input → topo-sorted compute → world.set → emit `*Changed` event →
 * client trait sync → kit's <ValueField> updates.
 *
 * Runs on every side (`where: "both"`): when a `CharacterFieldSet`
 * event arrives at the client and the universal mirror writes Stats,
 * the client's own derivation pass recomputes MaxHp locally so the
 * sheet's HP summary and TrackField update without waiting for a
 * separate server-broadcast trait write — the substrate has no such
 * out-of-band channel, derived traits flow only through derivations.
 */
export const MaxHpDerivation = defineDerivation({
  name: "@vtt/system-simple/max-hp",
  inputs: [Stats] as const,
  output: MaxHp,
  compute: ([stats]) => stats.might * 3,
  toEvent: (entityId, value) => MaxHpChanged({ entityId, value }),
  where: "both",
});
