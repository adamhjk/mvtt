import { defineTrait, EntityId, QualifiedNameSchema, z } from "@vtt/substrate";

/**
 * The shape of a single tab. `pageKind` references a registered PageProvider
 * by qualified name; `entityId` may be null for "kind picked, entity not yet
 * chosen" — providers render an empty/picker state in that case. `uiState`
 * is opaque per-tab JSON the provider owns (scroll position, sub-tab inside
 * a sheet). The Workbench treats it as transparent JSON.
 */
const TabSchema = z.object({
  id: z.string().min(1),
  pageKind: QualifiedNameSchema,
  entityId: EntityId.nullable(),
  uiState: z.unknown().optional(),
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
});
