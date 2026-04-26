import type { EventInstance } from "./define.js";
import type { EventName } from "./schema.js";

type Handler = (event: EventInstance) => void;

export class EventBus {
  private handlers = new Map<EventName, Set<Handler>>();
  private wildcard = new Set<Handler>();

  on(type: EventName, fn: Handler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  onAny(fn: Handler): () => void {
    this.wildcard.add(fn);
    return () => this.wildcard.delete(fn);
  }

  emit(event: EventInstance): void {
    const set = this.handlers.get(event.type);
    if (set) for (const fn of set) fn(event);
    for (const fn of this.wildcard) fn(event);
  }
}
