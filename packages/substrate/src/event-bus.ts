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
