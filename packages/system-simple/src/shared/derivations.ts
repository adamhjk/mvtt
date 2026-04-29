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
