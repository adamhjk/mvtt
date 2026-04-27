import {
  defineCommand,
  EntityId,
  fail,
  ok,
  QualifiedNameSchema,
  withVisibility,
  z,
  type CommandContext,
  type Result,
  type World,
} from "@vtt/substrate";
import { actors } from "@vtt/permissions/shared";
import { requireSession } from "@vtt/identity/shared";
import { OwnedBy } from "@vtt/permissions/shared";
import {
  WorkspaceState,
  WorkspaceOwner,
  type WorkspacePane,
  type WorkspaceTab,
  type WorkspaceTree,
} from "./traits.js";
import { WorkspaceStateChanged } from "./events.js";

const MAX_PANES = 4;

/**
 * Find this user's WorkspaceOwner entity. Owned-by-userId is the lookup
 * key; the bootstrap-on-join system guarantees one exists for every
 * (worldId, userId) pair after PlayerJoined.
 */
function findOwner(
  world: World,
  userId: string,
): { entityId: EntityId; state: z.infer<typeof WorkspaceState.schema> } | null {
  for (const row of world.query([WorkspaceOwner, OwnedBy, WorkspaceState])) {
    const own = row.values.OwnedBy as { userId: string };
    if (own.userId !== userId) continue;
    return {
      entityId: row.id,
      state: row.values.WorkspaceState as z.infer<typeof WorkspaceState.schema>,
    };
  }
  return null;
}

interface OwnedContext {
  readonly userId: string;
  readonly entityId: EntityId;
  readonly state: z.infer<typeof WorkspaceState.schema>;
}

function withOwner<T>(
  ctx: CommandContext<T>,
): { ok: true; owned: OwnedContext } | { ok: false; reason: string } {
  const auth = requireSession(ctx);
  if (!auth) return { ok: false, reason: "not authenticated" };
  const found = findOwner(ctx.world, auth.userId);
  if (!found) {
    return {
      ok: false,
      reason: "no workspace owner — bootstrap-on-join hasn't run",
    };
  }
  return {
    ok: true,
    owned: { userId: auth.userId, entityId: found.entityId, state: found.state },
  };
}

function emit(owned: OwnedContext, next: z.infer<typeof WorkspaceState.schema>) {
  return [
    withVisibility(
      WorkspaceStateChanged({
        ownerEntityId: owned.entityId,
        userId: owned.userId,
        next,
      }),
      actors([owned.userId]),
    ),
  ];
}

let nextLocalId = 1;
const newId = (kind: string): string =>
  `${kind}-${Date.now().toString(36)}-${(nextLocalId++).toString(36)}`;

/**
 * Count the leaves in a tree. Workbench caps panes at MAX_PANES; commands
 * that would split past that limit are rejected.
 */
function countPanes(tree: WorkspaceTree): number {
  if (tree.kind === "pane") return 1;
  let n = 0;
  for (const c of tree.children) n += countPanes(c);
  return n;
}

/**
 * Replace `targetPaneId` (which must be a pane leaf) with a 2-way split
 * containing the original pane and a new pane in the requested direction.
 * `right`/`bottom` put the new pane after the original; `left`/`top` put
 * it before.
 */
function splitTree(
  tree: WorkspaceTree,
  targetPaneId: string,
  newPaneId: string,
  direction: "left" | "right" | "top" | "bottom",
): WorkspaceTree {
  if (tree.kind === "pane") {
    if (tree.paneId !== targetPaneId) return tree;
    const axis: "row" | "column" =
      direction === "left" || direction === "right" ? "row" : "column";
    const original: WorkspaceTree = { kind: "pane", paneId: targetPaneId };
    const fresh: WorkspaceTree = { kind: "pane", paneId: newPaneId };
    const orderFirst = direction === "right" || direction === "bottom";
    return {
      kind: "split",
      axis,
      children: orderFirst ? [original, fresh] : [fresh, original],
      proportions: [1, 1],
    };
  }
  return {
    kind: "split",
    axis: tree.axis,
    children: tree.children.map((c) =>
      splitTree(c, targetPaneId, newPaneId, direction),
    ),
    proportions: [...tree.proportions],
  };
}

/**
 * Drop a pane from the tree. If a split node ends up with one child after
 * the drop, collapse it to that child. Returns null if removal would
 * produce an empty tree (forbidden — caller must rehome instead).
 */
function removePaneFromTree(
  tree: WorkspaceTree,
  paneId: string,
): WorkspaceTree | null {
  if (tree.kind === "pane") {
    return tree.paneId === paneId ? null : tree;
  }
  const kept: WorkspaceTree[] = [];
  const props: number[] = [];
  for (let i = 0; i < tree.children.length; i++) {
    const c = tree.children[i]!;
    const stripped = removePaneFromTree(c, paneId);
    if (stripped !== null) {
      kept.push(stripped);
      props.push(tree.proportions[i] ?? 1);
    }
  }
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]!;
  return { kind: "split", axis: tree.axis, children: kept, proportions: props };
}

function findExistingTab(
  state: z.infer<typeof WorkspaceState.schema>,
  pageKind: string,
  entityId: EntityId | null,
): { paneId: string; tabId: string } | null {
  for (const tab of Object.values(state.tabs)) {
    if (tab.pageKind !== pageKind) continue;
    const matchEntity =
      entityId === null ? tab.entityId === null : tab.entityId === entityId;
    if (!matchEntity) continue;
    for (const pane of Object.values(state.panes)) {
      if (pane.tabIds.includes(tab.id)) {
        return { paneId: pane.paneId, tabId: tab.id };
      }
    }
  }
  return null;
}

function clone(
  state: z.infer<typeof WorkspaceState.schema>,
): z.infer<typeof WorkspaceState.schema> {
  return {
    ...state,
    tabs: { ...state.tabs },
    panes: Object.fromEntries(
      Object.entries(state.panes).map(([k, p]) => [
        k,
        { ...p, tabIds: [...p.tabIds] },
      ]),
    ),
    tree: structuredClone(state.tree),
  };
}

function bumpInteracted(
  state: z.infer<typeof WorkspaceState.schema>,
): z.infer<typeof WorkspaceState.schema> {
  return { ...state, lastInteractedAt: Date.now() };
}

// — commands —————————————————————————————————————————————————————

const PageRefSchema = z.object({
  pageKind: QualifiedNameSchema,
  entityId: EntityId.nullable().optional(),
});

/**
 * Open a page. If a tab for `(pageKind, entityId)` already exists, focus
 * it (and the pane it lives in). Otherwise open it as a new tab in the
 * **active** pane.
 */
export const OpenPage = defineCommand({
  name: "@vtt/shell-workbench/OpenPage",
  schema: PageRefSchema,
  validate: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) return fail(r.reason);
    return ok();
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) {
      throw new Error("OpenPage.apply called without an owner — validate failed");
    }
    const owned = r.owned;
    const entityId = ctx.cmd.entityId ?? null;
    const existing = findExistingTab(owned.state, ctx.cmd.pageKind, entityId);
    const next = clone(owned.state);
    if (existing) {
      const pane = next.panes[existing.paneId]!;
      pane.activeTabId = existing.tabId;
      next.activePaneId = existing.paneId;
      return emit(owned, bumpInteracted(next));
    }
    const tabId = newId("tab");
    const tab: WorkspaceTab = {
      id: tabId,
      pageKind: ctx.cmd.pageKind,
      entityId,
    };
    next.tabs[tabId] = tab;
    const pane = next.panes[next.activePaneId];
    if (!pane) {
      throw new Error("active pane missing");
    }
    pane.tabIds.push(tabId);
    pane.activeTabId = tabId;
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Always open a fresh tab in the active pane (even if the same page is
 * already open elsewhere). `⌘⏎` from the palette uses this.
 */
export const OpenPageInNewTab = defineCommand({
  name: "@vtt/shell-workbench/OpenPageInNewTab",
  schema: PageRefSchema,
  validate: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) return fail(r.reason);
    return ok();
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    const next = clone(owned.state);
    const tabId = newId("tab");
    next.tabs[tabId] = {
      id: tabId,
      pageKind: ctx.cmd.pageKind,
      entityId: ctx.cmd.entityId ?? null,
    };
    const pane = next.panes[next.activePaneId];
    if (!pane) throw new Error("active pane missing");
    pane.tabIds.push(tabId);
    pane.activeTabId = tabId;
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Open the page in a new pane split off the active one. Rejected if the
 * tree already has MAX_PANES leaves.
 */
export const OpenPageAsSplit = defineCommand({
  name: "@vtt/shell-workbench/OpenPageAsSplit",
  schema: PageRefSchema.extend({
    direction: z.union([
      z.literal("left"),
      z.literal("right"),
      z.literal("top"),
      z.literal("bottom"),
    ]),
  }),
  validate: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) return fail(r.reason);
    if (countPanes(r.owned.state.tree) >= MAX_PANES) {
      return fail(`workspace already has ${MAX_PANES} panes — close one first`);
    }
    return ok();
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    const next = clone(owned.state);
    const newPaneId = newId("pane");
    const tabId = newId("tab");
    next.tabs[tabId] = {
      id: tabId,
      pageKind: ctx.cmd.pageKind,
      entityId: ctx.cmd.entityId ?? null,
    };
    next.panes[newPaneId] = {
      paneId: newPaneId,
      tabIds: [tabId],
      activeTabId: tabId,
    };
    next.tree = splitTree(next.tree, owned.state.activePaneId, newPaneId, ctx.cmd.direction);
    next.activePaneId = newPaneId;
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Close a tab. If the pane empties as a result and the tree has more than
 * one pane, the pane is removed from the tree (and the active pane is
 * reassigned to a sibling). If the pane empties and it's the *only* pane,
 * the pane stays — the user is left with an empty workspace.
 */
export const CloseTab = defineCommand({
  name: "@vtt/shell-workbench/CloseTab",
  schema: z.object({
    paneId: z.string().min(1),
    tabId: z.string().min(1),
  }),
  validate: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) return fail(r.reason);
    const pane = r.owned.state.panes[ctx.cmd.paneId];
    if (!pane) return fail(`unknown pane ${ctx.cmd.paneId}`);
    if (!pane.tabIds.includes(ctx.cmd.tabId)) {
      return fail(`tab ${ctx.cmd.tabId} not in pane ${ctx.cmd.paneId}`);
    }
    return ok();
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    const next = clone(owned.state);
    const pane = next.panes[ctx.cmd.paneId]!;
    pane.tabIds = pane.tabIds.filter((id) => id !== ctx.cmd.tabId);
    delete next.tabs[ctx.cmd.tabId];
    if (pane.activeTabId === ctx.cmd.tabId) {
      pane.activeTabId = pane.tabIds[pane.tabIds.length - 1] ?? null;
    }
    if (pane.tabIds.length === 0 && countPanes(next.tree) > 1) {
      const collapsed = removePaneFromTree(next.tree, ctx.cmd.paneId);
      if (collapsed) {
        next.tree = collapsed;
        delete next.panes[ctx.cmd.paneId];
        if (next.activePaneId === ctx.cmd.paneId) {
          // Pick the leftmost remaining pane.
          next.activePaneId = leftmostPane(next.tree);
        }
        if (next.zenPaneId === ctx.cmd.paneId) next.zenPaneId = null;
      }
    }
    return emit(owned, bumpInteracted(next));
  },
});

function leftmostPane(tree: WorkspaceTree): string {
  if (tree.kind === "pane") return tree.paneId;
  return leftmostPane(tree.children[0]!);
}

/**
 * Re-target an existing tab. Used by the in-header dropdown — change
 * `pageKind` or `entityId` (or both) without churning the tab's identity
 * or per-tab UI state.
 */
export const RetargetTab = defineCommand({
  name: "@vtt/shell-workbench/RetargetTab",
  schema: z.object({
    tabId: z.string().min(1),
    pageKind: QualifiedNameSchema.optional(),
    entityId: EntityId.nullable().optional(),
  }),
  validate: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) return fail(r.reason);
    if (!r.owned.state.tabs[ctx.cmd.tabId]) {
      return fail(`unknown tab ${ctx.cmd.tabId}`);
    }
    return ok();
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    const next = clone(owned.state);
    const tab = next.tabs[ctx.cmd.tabId]!;
    if (ctx.cmd.pageKind !== undefined) tab.pageKind = ctx.cmd.pageKind;
    if (ctx.cmd.entityId !== undefined) tab.entityId = ctx.cmd.entityId;
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Activate a different tab in the named pane (clicking a tab header).
 */
export const FocusTab = defineCommand({
  name: "@vtt/shell-workbench/FocusTab",
  schema: z.object({
    paneId: z.string().min(1),
    tabId: z.string().min(1),
  }),
  validate: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) return fail(r.reason);
    const pane = r.owned.state.panes[ctx.cmd.paneId];
    if (!pane) return fail(`unknown pane ${ctx.cmd.paneId}`);
    if (!pane.tabIds.includes(ctx.cmd.tabId)) {
      return fail(`tab ${ctx.cmd.tabId} not in pane`);
    }
    return ok();
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    const next = clone(owned.state);
    const pane = next.panes[ctx.cmd.paneId]!;
    pane.activeTabId = ctx.cmd.tabId;
    next.activePaneId = ctx.cmd.paneId;
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Make `paneId` the active pane (`⌘N` cycle, or clicking on a pane).
 */
export const FocusPane = defineCommand({
  name: "@vtt/shell-workbench/FocusPane",
  schema: z.object({
    paneId: z.string().min(1),
  }),
  validate: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) return fail(r.reason);
    if (!r.owned.state.panes[ctx.cmd.paneId]) {
      return fail(`unknown pane ${ctx.cmd.paneId}`);
    }
    return ok();
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    const next = clone(owned.state);
    next.activePaneId = ctx.cmd.paneId;
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Toggle zen mode on the active pane. When zen is on, every other pane is
 * hidden until toggled back. Pressing zen on the already-zen pane disables.
 */
export const ToggleZen = defineCommand({
  name: "@vtt/shell-workbench/ToggleZen",
  schema: z.object({}),
  validate: (ctx) => {
    const r = withOwner(ctx);
    return r.ok ? ok() : fail(r.reason);
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    const next = clone(owned.state);
    next.zenPaneId = next.zenPaneId ? null : next.activePaneId;
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Persist the per-tab uiState (scroll position, internal sub-tab, etc.).
 * Replaces verbatim — providers own the shape and decide when to call.
 */
export const SetTabUiState = defineCommand({
  name: "@vtt/shell-workbench/SetTabUiState",
  schema: z.object({
    tabId: z.string().min(1),
    uiState: z.unknown(),
  }),
  validate: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) return fail(r.reason);
    if (!r.owned.state.tabs[ctx.cmd.tabId]) {
      return fail(`unknown tab ${ctx.cmd.tabId}`);
    }
    return ok();
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    const next = clone(owned.state);
    const tab = next.tabs[ctx.cmd.tabId]!;
    tab.uiState = ctx.cmd.uiState;
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Move a tab to another pane (drag-to-pane, or palette "open in pane N").
 * The target pane must exist in the tree.
 */
export const MoveTab = defineCommand({
  name: "@vtt/shell-workbench/MoveTab",
  schema: z.object({
    tabId: z.string().min(1),
    fromPaneId: z.string().min(1),
    toPaneId: z.string().min(1),
  }),
  validate: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) return fail(r.reason);
    const from = r.owned.state.panes[ctx.cmd.fromPaneId];
    const to = r.owned.state.panes[ctx.cmd.toPaneId];
    if (!from) return fail(`unknown source pane ${ctx.cmd.fromPaneId}`);
    if (!to) return fail(`unknown target pane ${ctx.cmd.toPaneId}`);
    if (!from.tabIds.includes(ctx.cmd.tabId)) {
      return fail(`tab ${ctx.cmd.tabId} not in pane ${ctx.cmd.fromPaneId}`);
    }
    return ok();
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    const next = clone(owned.state);
    const from = next.panes[ctx.cmd.fromPaneId]!;
    const to = next.panes[ctx.cmd.toPaneId]!;
    from.tabIds = from.tabIds.filter((id) => id !== ctx.cmd.tabId);
    if (from.activeTabId === ctx.cmd.tabId) {
      from.activeTabId = from.tabIds[from.tabIds.length - 1] ?? null;
    }
    to.tabIds.push(ctx.cmd.tabId);
    to.activeTabId = ctx.cmd.tabId;
    next.activePaneId = ctx.cmd.toPaneId;
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Walk `path` from the tree root, returning the addressed node or null.
 * Path semantics: each element is a child index into a split's children.
 * An empty path returns the root.
 */
function walkPath(tree: WorkspaceTree, path: ReadonlyArray<number>): WorkspaceTree | null {
  let node: WorkspaceTree = tree;
  for (const idx of path) {
    if (node.kind !== "split") return null;
    const child = node.children[idx];
    if (!child) return null;
    node = child;
  }
  return node;
}

/**
 * Replace the addressed node in `tree` with `next`, returning a fresh
 * tree. Path semantics match `walkPath`.
 */
function replaceAtPath(
  tree: WorkspaceTree,
  path: ReadonlyArray<number>,
  next: WorkspaceTree,
): WorkspaceTree {
  if (path.length === 0) return next;
  if (tree.kind !== "split") {
    throw new Error("path passes through a non-split node");
  }
  const head = path[0]!;
  const child = tree.children[head];
  if (!child) throw new Error(`no child at index ${head}`);
  return {
    kind: "split",
    axis: tree.axis,
    children: tree.children.map((c, i) =>
      i === head ? replaceAtPath(c, path.slice(1), next) : c,
    ),
    proportions: [...tree.proportions],
  };
}

/**
 * Resize the divider(s) of an internal split node. The client computes
 * the new proportions during a drag and commits on mouseup; the server
 * persists them to the user's WorkspaceState and replicates to other
 * connections (so a desktop drag updates the user's phone in flight).
 *
 * Validation: path must address a split node, proportions length must
 * match the split's child count, every entry must be > 0 (so a pane
 * can't be dragged to literal zero size — the renderer enforces a
 * sensible minimum during drag too).
 */
export const SetSplitProportions = defineCommand({
  name: "@vtt/shell-workbench/SetSplitProportions",
  schema: z.object({
    path: z.array(z.number().int().nonnegative()),
    proportions: z.array(z.number().positive()).min(2),
  }),
  validate: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) return fail(r.reason);
    const target = walkPath(r.owned.state.tree, ctx.cmd.path);
    if (!target) return fail(`no node at path ${JSON.stringify(ctx.cmd.path)}`);
    if (target.kind !== "split") return fail("path does not address a split node");
    if (ctx.cmd.proportions.length !== target.children.length) {
      return fail(
        `proportions length ${ctx.cmd.proportions.length} doesn't match split's ${target.children.length} children`,
      );
    }
    return ok();
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    const target = walkPath(owned.state.tree, ctx.cmd.path);
    if (!target || target.kind !== "split") {
      throw new Error("validate should have caught this");
    }
    const next = clone(owned.state);
    next.tree = replaceAtPath(next.tree, ctx.cmd.path, {
      kind: "split",
      axis: target.axis,
      children: target.children,
      proportions: [...ctx.cmd.proportions],
    });
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Open a drawer by id. Idempotent: opening an already-open drawer just
 * bumps `openedAt` (so the autoCloseAfterMs timer the workbench owns
 * resets). The drawer's actual definition lives in the
 * `WorkbenchDrawersSlot` — this command only writes the open-state
 * record onto WorkspaceState.
 */
export const OpenDrawer = defineCommand({
  name: "@vtt/shell-workbench/OpenDrawer",
  schema: z.object({
    id: QualifiedNameSchema,
  }),
  validate: (ctx) => {
    const r = withOwner(ctx);
    return r.ok ? ok() : fail(r.reason);
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    const next = clone(owned.state);
    const existing = next.openDrawers[ctx.cmd.id];
    next.openDrawers = {
      ...next.openDrawers,
      [ctx.cmd.id]: {
        openedAt: Date.now(),
        // Preserve a previously-resized size when re-opening; otherwise
        // omit so the renderer falls back to the drawer's defaultSize.
        ...(existing?.size !== undefined ? { size: existing.size } : {}),
      },
    };
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Close a drawer by id. No-op if it wasn't open.
 */
export const CloseDrawer = defineCommand({
  name: "@vtt/shell-workbench/CloseDrawer",
  schema: z.object({
    id: QualifiedNameSchema,
  }),
  validate: (ctx) => {
    const r = withOwner(ctx);
    return r.ok ? ok() : fail(r.reason);
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    if (!owned.state.openDrawers[ctx.cmd.id]) {
      // Nothing to change. Still emit a state-changed event so the
      // dispatcher's optimistic UI converges with everyone else's;
      // alternatively we could no-op, but the round-trip is cheap.
      return emit(owned, bumpInteracted(clone(owned.state)));
    }
    const next = clone(owned.state);
    const { [ctx.cmd.id]: _gone, ...rest } = next.openDrawers;
    next.openDrawers = rest;
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Toggle: closes if open, opens if closed. Convenience for launcher
 * buttons that should dispatch one command regardless of current state.
 */
export const ToggleDrawer = defineCommand({
  name: "@vtt/shell-workbench/ToggleDrawer",
  schema: z.object({
    id: QualifiedNameSchema,
  }),
  validate: (ctx) => {
    const r = withOwner(ctx);
    return r.ok ? ok() : fail(r.reason);
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    const next = clone(owned.state);
    if (next.openDrawers[ctx.cmd.id]) {
      const { [ctx.cmd.id]: _gone, ...rest } = next.openDrawers;
      next.openDrawers = rest;
    } else {
      next.openDrawers = {
        ...next.openDrawers,
        [ctx.cmd.id]: { openedAt: Date.now() },
      };
    }
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Persist a user-resized drawer size. Only meaningful when the drawer
 * is currently open; the apply still records it (so the next open uses
 * the persisted value), and the validate doesn't reject closed drawers
 * — the user might be configuring a default before opening.
 */
export const ResizeDrawer = defineCommand({
  name: "@vtt/shell-workbench/ResizeDrawer",
  schema: z.object({
    id: QualifiedNameSchema,
    size: z.number().int().min(40).max(4096),
  }),
  validate: (ctx) => {
    const r = withOwner(ctx);
    return r.ok ? ok() : fail(r.reason);
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("validate failed");
    const owned = r.owned;
    const next = clone(owned.state);
    const existing = next.openDrawers[ctx.cmd.id];
    next.openDrawers = {
      ...next.openDrawers,
      [ctx.cmd.id]: {
        openedAt: existing?.openedAt ?? Date.now(),
        size: ctx.cmd.size,
      },
    };
    return emit(owned, bumpInteracted(next));
  },
});

export const allCommands = [
  OpenPage,
  OpenPageInNewTab,
  OpenPageAsSplit,
  CloseTab,
  RetargetTab,
  FocusTab,
  FocusPane,
  ToggleZen,
  SetTabUiState,
  MoveTab,
  SetSplitProportions,
  OpenDrawer,
  CloseDrawer,
  ToggleDrawer,
  ResizeDrawer,
] as const;
