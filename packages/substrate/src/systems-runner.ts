import type { EventInstance } from "./define.js";
import type { Registry } from "./registry.js";
import type { World } from "./world.js";

/**
 * Run systems against a queue of events until no more events are produced.
 *
 * The same runner powers the server (driven by command application) and the
 * client (driven by events arriving over the wire). Keeping it in one place
 * is what lets the client deterministically mirror server state.
 */
export function runSystemsToFixpoint(
  registry: Registry,
  world: World,
  initial: ReadonlyArray<EventInstance>,
): EventInstance[] {
  const all: EventInstance[] = [];
  const queue: EventInstance[] = [...initial];
  while (queue.length > 0) {
    const ev = queue.shift()!;
    all.push(ev);
    for (const sys of registry.systems) {
      if (sys.on.name !== ev.type) continue;
      const out = sys.run({ event: ev.payload, world });
      for (const next of out) queue.push(next);
    }
  }
  return all;
}
