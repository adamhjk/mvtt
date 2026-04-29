import { definePlugin } from "@vtt/substrate";

/**
 * The "Simple" game system: minimal everything. A world bound to this
 * system gets the dice tray and a names-only character sheet — exactly
 * what was here before the per-world game-system selector existed,
 * packaged so the multi-world plumbing has a working end-to-end loop
 * to demonstrate against.
 *
 * Real game systems (`@vtt/dnd5e`, `@vtt/blades`, ...) ship later as
 * additional plugins; the only difference is which shared mechanics
 * they pull in via `dependsOn` and what content they fill into slots.
 */
export const systemSimple = definePlugin({
  name: "@vtt/system-simple",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/characters@^0",
    "@vtt/dice-tray@^0",
  ],
  gameSystem: true,
});

export default systemSimple;
