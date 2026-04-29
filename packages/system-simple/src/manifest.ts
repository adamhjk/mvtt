import { definePlugin } from "@vtt/substrate";

/**
 * The "Simple" game system: a minimal but useful baseline. A world
 * bound to this system gets the dice tray, a names-only character
 * sheet, scenes (with token movement), and books (with PDF
 * projection). It's the working end-to-end loop the multi-world
 * plumbing demonstrates against.
 *
 * Real game systems (`@vtt/dnd5e`, `@vtt/blades`, ...) ship later as
 * additional plugins; the only difference is which shared mechanics
 * they pull in via `dependsOn` and what content they fill into slots.
 */
export const systemSimple = definePlugin({
  name: "@vtt/system-simple",
  version: "0.2.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/characters@^0",
    "@vtt/dice-tray@^0",
    "@vtt/scene@^0",
    "@vtt/books@^0",
    "@vtt/pdf-book@^0",
  ],
  gameSystem: true,
});

export default systemSimple;
