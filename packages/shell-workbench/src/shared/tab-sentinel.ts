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

/**
 * Deterministic id for the per-tab sentinel entity. Derived from `tabId`
 * so server and clients converge without id allocation, mirroring the
 * `workspace-owner:<userId>` scheme used by `WorkspaceOwner`.
 *
 * Plugins use this (typically via `useTabSentinel(tabId)` on the client)
 * to look up the sentinel they should attach their per-tab UI-state
 * traits to. The sentinel exists for the lifetime of the tab — the
 * workbench's `WorkspaceStateApply` system spawns it when a tab id
 * appears in `WorkspaceState.tabs` and despawns it when it leaves.
 */
export function tabSentinelEntityId(tabId: string): EntityId {
  return `tab-sentinel:${tabId}` as EntityId;
}
