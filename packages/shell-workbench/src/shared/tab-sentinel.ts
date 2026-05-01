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
