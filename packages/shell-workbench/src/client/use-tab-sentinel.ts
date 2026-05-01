// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import type { EntityId } from "@vtt/substrate";
import { tabSentinelEntityId } from "../shared/tab-sentinel.js";

/**
 * Resolve a tab id to its sentinel entity id. The sentinel is a per-tab
 * entity the workbench spawns for plugins to attach their UI-state traits
 * to (see `design/optimistic-ui-state.md`).
 *
 * The id is derived deterministically from `tabId`, so this is a pure
 * function — no signal subscription needed. The sentinel is guaranteed
 * to exist on every owning side (server + the user's connected clients)
 * for the lifetime of the tab; the workbench's `WorkspaceStateApply`
 * system spawns it idempotently as soon as the tab id appears in
 * `WorkspaceState.tabs` and despawns it when the id is removed.
 *
 * Plugins typically call this inside their `PageProvider.render(args)`,
 * passing `args.tabId`, then hand the result to `createOptimisticTrait`
 * (or any other trait-attached primitive) as the entity id.
 */
export function useTabSentinel(tabId: string): EntityId {
  return tabSentinelEntityId(tabId);
}
