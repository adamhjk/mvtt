// mvtt, an RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of mvtt.
//
// mvtt is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// mvtt is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with mvtt.  If not, see <https://www.gnu.org/licenses/>.

import { defineTrait, EntityId, QualifiedNameSchema, z } from "@vtt/substrate";

/**
 * The shape of a single tab. `pageKind` references a registered PageProvider
 * by qualified name; `entityId` may be null for "kind picked, entity not yet
 * chosen" — providers render an empty/picker state in that case.
 *
 * Per-tab UI state (active page in a note, dock state on a scene/book,
 * PDF reader state, etc.) lives on the per-tab sentinel entity (see
 * `TabSentinel` and `design/optimistic-ui-state.md`), NOT on this tab
 * record. The workbench owns layout; plugins own their slice of state.
 */
const TabSchema = z.object({
  id: z.string().min(1),
  pageKind: QualifiedNameSchema,
  entityId: EntityId.nullable(),
});
export type WorkspaceTab = z.infer<typeof TabSchema>;

/**
 * A leaf in the workspace tree: an ordered list of tabs plus the active one.
 * `paneId` is unique within a WorkspaceState so commands can reference panes
 * by id.
 */
const PaneSchema = z.object({
  paneId: z.string().min(1),
  tabIds: z.array(z.string().min(1)),
  activeTabId: z.string().min(1).nullable(),
});
export type WorkspacePane = z.infer<typeof PaneSchema>;

/**
 * The split tree. Internal nodes are `split` with an axis + proportions per
 * child. Leaves are `pane` referencing a pane id. Recursive shape is encoded
 * via z.lazy. The Workbench validates structural invariants (positive
 * proportions; child count matches proportions length; pane ids resolve)
 * on every mutation.
 */
type WorkspaceTreeShape =
  | { kind: "pane"; paneId: string }
  | {
      kind: "split";
      axis: "row" | "column";
      children: WorkspaceTreeShape[];
      proportions: number[];
    };

const TreeSchema: z.ZodType<WorkspaceTreeShape> = z.lazy(() =>
  z.union([
    z.object({
      kind: z.literal("pane"),
      paneId: z.string().min(1),
    }),
    z.object({
      kind: z.literal("split"),
      axis: z.union([z.literal("row"), z.literal("column")]),
      children: z.array(TreeSchema).min(2),
      proportions: z.array(z.number().positive()).min(2),
    }),
  ]),
);
export type WorkspaceTree = WorkspaceTreeShape;

/**
 * Per-drawer open-state. Drawers are global overlays attached to a
 * workbench edge (bottom/right/left/top); their *definitions* live in
 * the `WorkbenchDrawersSlot` (see slots.ts), and which drawers are open
 * — plus their per-user resized size — lives here.
 *
 * `openedAt` lets a drawer's render-time decide whether to ignore stale
 * persisted state (e.g. a roll-tray that auto-closes after 4s should
 * close itself on remount if `Date.now() - openedAt` already exceeds
 * the dwell window).
 *
 * `keepOpen` is the user-facing "stay open" preference, surfaced as a
 * checkbox in the drawer header. When true, the auto-close timer is
 * skipped — the drawer stays put until the user explicitly closes it.
 * Clicking the drawer's tab to open dispatches `OpenDrawer` with
 * `keepOpen: true`; an auto-open from an event opens with
 * `keepOpen: false`. The user can toggle the field directly via
 * `SetDrawerKeepOpen`. Defaults to false so existing persisted state
 * round-trips cleanly into auto-close-eligible.
 */
const DrawerStateSchema = z.object({
  openedAt: z.number(),
  size: z.number().int().min(40).max(4096).optional(),
  keepOpen: z.boolean().default(false),
});
export type WorkbenchDrawerState = z.infer<typeof DrawerStateSchema>;

/**
 * Per-(world, user) workspace state. Lives on a WorkspaceOwner sentinel
 * entity that the workbench plugin spawns once per (worldId, userId) and
 * scopes via EntityVisibility{actors:[userId]} so only the owning user's
 * connections see it.
 *
 * `tabs` is a flat dictionary so re-targeting/closing is O(1) and tabs can
 * survive being moved between panes without serialising the tree. `panes`
 * is similarly flat. `tree` references panes by `paneId`.
 *
 * `zenPaneId`, when set, is the id of the pane currently maximised — every
 * other pane is hidden until the user toggles back.
 *
 * `openDrawers` keys drawer ids (the `QualifiedName` registered in the
 * drawer slot, e.g. `"@vtt/dice-tray/tray"`) to their open-state. A
 * missing key means the drawer is closed. Defaults to `{}` so existing
 * persisted states without the field round-trip cleanly.
 */
export const WorkspaceState = defineTrait({
  name: "@vtt/shell-workbench/WorkspaceState",
  schema: z.object({
    tabs: z.record(z.string(), TabSchema),
    panes: z.record(z.string(), PaneSchema),
    tree: TreeSchema,
    activePaneId: z.string().min(1),
    zenPaneId: z.string().min(1).nullable(),
    lastInteractedAt: z.number(),
    schemaVersion: z.literal(1),
    openDrawers: z.record(z.string(), DrawerStateSchema).default({}),
  }),
});

/**
 * Marks the entity as a workspace-owner sentinel — one per (worldId, userId).
 * Only the workbench plugin spawns these; OwnedBy carries the userId and
 * EntityVisibility{actors:[userId]} keeps it private to that user's
 * connections.
 */
export const WorkspaceOwner = defineTrait({
  name: "@vtt/shell-workbench/WorkspaceOwner",
  schema: z.object({
    userId: z.string().min(1),
  }),
  // Identity-bound: the userId names the owning user; copying it onto
  // another workspace would mis-attribute the workspace.
  share: false,
});

/**
 * One sentinel entity per open tab. Plugins attach their own per-tab UI-
 * state traits to this entity (see `design/optimistic-ui-state.md`). The
 * sentinel's id is deterministic from `tabId` (see `tabSentinelEntityId`)
 * so server and clients converge without id allocation. Spawned/despawned
 * by the workbench's WorkspaceStateApply system as the user's `tabs`
 * record gains/loses entries; Permissions{actors:[userId]}
 * keep the sentinel scoped to the owning user's connections, just like
 * WorkspaceOwner.
 */
export const TabSentinel = defineTrait({
  name: "@vtt/shell-workbench/TabSentinel",
  schema: z.object({
    tabId: z.string().min(1),
  }),
  // Marker trait whose tabId names the entity itself; it would be wrong to
  // copy onto another tab's sentinel (the recipient gets its own freshly-
  // marked sentinel via TabSharedApplySystem).
  share: false,
});
