import type { EventInstance } from "./define.js";
import type { Registry } from "./registry.js";
import type { World } from "./world.js";
import type { EntityId, TraitName } from "./schema.js";
import { runDerivationPass } from "./derivation.js";

/**
 * Run systems against a queue of events until no more events are produced,
 * interleaving derivation passes whenever the system queue drains. The same
 * runner powers the server (driven by command application) and the client
 * (driven by events arriving over the wire). Keeping it in one place is what
 * lets the client deterministically mirror server state.
 *
 * Tick model:
 *   1. Drain the event queue through subscribed systems. Systems may write
 *      traits and emit more events; new events go onto the queue.
 *   2. When the queue drains, run a derivation pass over the set of
 *      (entity, trait) writes that occurred during the tick. Derivations
 *      that change their output write the trait and emit a `*Changed`
 *      event onto the queue.
 *   3. If derivations produced events, loop back to (1). Otherwise we've
 *      reached fixpoint — return everything emitted.
 *
 * Derivations only run when the caller hands in a `dirty` map — a live
 * `Map<EntityId, Set<TraitName>>` that the caller is populating via a
 * `world.subscribe` listener. The pipeline wires this up across `apply()`
 * + the runner so writes from inside `apply` (spawn calls, direct
 * `world.set` calls) feed the first derivation pass. Without `dirty`, the
 * runner is just the original system fixpoint loop.
 */
export function runSystemsToFixpoint(
  registry: Registry,
  world: World,
  initial: ReadonlyArray<EventInstance>,
  dirty?: Map<EntityId, Set<TraitName>>,
): EventInstance[] {
  const all: EventInstance[] = [];
  const queue: EventInstance[] = [...initial];

  const serverDerivations = dirty
    ? registry.derivations.filter((d) => d.where === "server" || d.where === "both")
    : [];

  while (true) {
    // Drain any pending events through systems.
    while (queue.length > 0) {
      const ev = queue.shift()!;
      all.push(ev);
      for (const sys of registry.systems) {
        if (sys.on.name !== ev.type) continue;
        const out = sys.run({ event: ev.payload, world, registry });
        for (const next of out) queue.push(next);
      }
    }

    // Queue empty — try a derivation pass.
    if (!dirty || serverDerivations.length === 0 || dirty.size === 0) break;
    const snapshot = new Map<EntityId, Set<TraitName>>();
    for (const [id, traits] of dirty) snapshot.set(id, new Set(traits));
    dirty.clear();
    const derived = runDerivationPass(serverDerivations, world, snapshot);
    if (derived.length === 0 && dirty.size === 0) break;
    for (const ev of derived) queue.push(ev);
  }

  return all;
}
