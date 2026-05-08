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
import { actors, Permissions, requireRole } from "@vtt/permissions/shared";
import { requireSession } from "@vtt/identity/shared";
import {
  WorkspaceState,
  WorkspaceOwner,
  type WorkspacePane,
  type WorkspaceTab,
  type WorkspaceTree,
} from "./traits.js";
import { tabSentinelEntityId } from "./tab-sentinel.js";
import { TabShared, WorkspaceStateChanged } from "./events.js";

const MAX_PANES = 4;

/**
 * Find a user's WorkspaceOwner entity by userId. Owned-by-userId is the
 * lookup key; the bootstrap-on-join system guarantees one exists for every
 * (worldId, userId) pair after PlayerJoined. Used by `withOwner` for the
 * dispatching user's own workspace, and by cross-user verbs (ShareTab) that
 * need to write into a different user's workspace.
 */
export function findOwnerFor(
  world: World,
  userId: string,
): { entityId: EntityId; state: z.infer<typeof WorkspaceState.schema> } | null {
  for (const row of world.query([WorkspaceOwner, WorkspaceState])) {
    const wo = row.values.WorkspaceOwner as { userId: string };
    if (wo.userId !== userId) continue;
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
  const found = findOwnerFor(ctx.world, auth.userId);
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

/**
 * Find the best same-`pageKind` tab to retarget when the user follows
 * a deep link (`OpenPage` smart-retarget). Returns null if no
 * same-kind tab exists. Ranking, in priority order:
 *
 *   1. Same kind, in a pane *other than* the currently-focused pane —
 *      side-by-side beats in-place navigation.
 *   2. Same kind, in the currently-focused pane.
 *
 * Within each category the most-recently-focused tab wins (per
 * `tab.lastFocusedAt`). Hub tabs (entityId === null) are eligible
 * candidates — they're the same-kind page, just on the hub view.
 */
function findRetargetCandidate(
  state: z.infer<typeof WorkspaceState.schema>,
  pageKind: string,
): { paneId: string; tabId: string } | null {
  // Index tabId → paneId once; multiple lookups would otherwise be O(panes·tabs).
  const tabPane = new Map<string, string>();
  for (const pane of Object.values(state.panes)) {
    for (const tabId of pane.tabIds) tabPane.set(tabId, pane.paneId);
  }
  const otherPane: { tab: WorkspaceTab; paneId: string }[] = [];
  const samePane: { tab: WorkspaceTab; paneId: string }[] = [];
  for (const tab of Object.values(state.tabs)) {
    if (tab.pageKind !== pageKind) continue;
    const paneId = tabPane.get(tab.id);
    if (!paneId) continue; // orphan tab — should never happen, but skip
    if (paneId === state.activePaneId) samePane.push({ tab, paneId });
    else otherPane.push({ tab, paneId });
  }
  const pick = (
    bucket: { tab: WorkspaceTab; paneId: string }[],
  ): { paneId: string; tabId: string } | null => {
    if (bucket.length === 0) return null;
    let best = bucket[0]!;
    for (let i = 1; i < bucket.length; i++) {
      const cand = bucket[i]!;
      if (cand.tab.lastFocusedAt > best.tab.lastFocusedAt) best = cand;
    }
    return { paneId: best.paneId, tabId: best.tab.id };
  };
  return pick(otherPane) ?? pick(samePane);
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

/**
 * Stamp `lastFocusedAt = now` on a tab. Call this on a freshly-cloned
 * `state` (so we mutate in place) wherever a tab is becoming the
 * active tab in its pane — this is what feeds the recency tiebreaker
 * in `findRetargetCandidate`. No-ops gracefully if the tab id is
 * missing or null (e.g. when a pane just emptied).
 */
function bumpTabFocus(
  state: z.infer<typeof WorkspaceState.schema>,
  tabId: string | null,
): void {
  if (!tabId) return;
  const tab = state.tabs[tabId];
  if (!tab) return;
  state.tabs[tabId] = { ...tab, lastFocusedAt: Date.now() };
}

// — commands —————————————————————————————————————————————————————

const PageRefSchema = z.object({
  pageKind: QualifiedNameSchema,
  entityId: EntityId.nullable().optional(),
});

/**
 * Smart "follow this link" verb. Resolves in priority:
 *
 *   1. **Exact match.** A tab for `(pageKind, entityId)` already
 *      exists somewhere → focus it (and activate its pane). Done.
 *   2. **Smart retarget.** No exact match, but a same-`pageKind` tab
 *      exists somewhere → flip that tab's `entityId` to the new
 *      target and focus it. Picks the candidate per
 *      `findRetargetCandidate`: a tab in a pane other than the
 *      active pane wins over one in the active pane (side-by-side
 *      beats in-place); within each bucket the most-recently-focused
 *      tab wins. Hub tabs (`entityId === null`) count as same-kind.
 *   3. **Open new.** No same-kind tab anywhere → open a fresh tab in
 *      the active pane.
 *
 * This is the canonical wikilink / deep-link verb. For the always-new
 * variant use `OpenPageInNewTab`; for always-split use `OpenPageAsSplit`.
 * The client helper `useFollowLink` picks among the three based on
 * keyboard modifiers.
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
    const next = clone(owned.state);

    // 1. Exact match → focus the existing tab.
    const existing = findExistingTab(owned.state, ctx.cmd.pageKind, entityId);
    if (existing) {
      const pane = next.panes[existing.paneId]!;
      pane.activeTabId = existing.tabId;
      next.activePaneId = existing.paneId;
      bumpTabFocus(next, existing.tabId);
      return emit(owned, bumpInteracted(next));
    }

    // 2. Smart retarget → flip the best same-kind tab's entity.
    const candidate = findRetargetCandidate(owned.state, ctx.cmd.pageKind);
    if (candidate) {
      const tab = next.tabs[candidate.tabId]!;
      next.tabs[candidate.tabId] = { ...tab, entityId };
      const pane = next.panes[candidate.paneId]!;
      pane.activeTabId = candidate.tabId;
      next.activePaneId = candidate.paneId;
      bumpTabFocus(next, candidate.tabId);
      return emit(owned, bumpInteracted(next));
    }

    // 3. Open new in the active pane.
    const tabId = newId("tab");
    const tab: WorkspaceTab = {
      id: tabId,
      pageKind: ctx.cmd.pageKind,
      entityId,
      lastFocusedAt: Date.now(),
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
      lastFocusedAt: Date.now(),
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
      lastFocusedAt: Date.now(),
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
      bumpTabFocus(next, pane.activeTabId);
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
    bumpTabFocus(next, ctx.cmd.tabId);
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
      bumpTabFocus(next, from.activeTabId);
    }
    to.tabIds.push(ctx.cmd.tabId);
    to.activeTabId = ctx.cmd.tabId;
    next.activePaneId = ctx.cmd.toPaneId;
    bumpTabFocus(next, ctx.cmd.tabId);
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
    /**
     * Whether the drawer should stay open until the user explicitly
     * closes it. `true` is dispatched when the user clicks the tab —
     * the drawer is sticky and the auto-close timer is skipped. `false`
     * is dispatched on auto-opens (from `autoOpenOn` events), letting
     * the auto-close timer run. Defaults to `false`.
     */
    keepOpen: z.boolean().default(false),
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
    // Don't downgrade an already-sticky drawer when an `auto` re-open
    // arrives — user intent (keep-open) wins over the system. A fresh
    // `keepOpen: true` always upgrades.
    const nextKeepOpen = ctx.cmd.keepOpen || existing?.keepOpen === true;
    next.openDrawers = {
      ...next.openDrawers,
      [ctx.cmd.id]: {
        openedAt: Date.now(),
        keepOpen: nextKeepOpen,
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
      // Toggle-to-open is always a *user* action, so keepOpen = true:
      // the drawer stays open until the user closes it again, no
      // auto-close timer.
      next.openDrawers = {
        ...next.openDrawers,
        [ctx.cmd.id]: { openedAt: Date.now(), keepOpen: true },
      };
    }
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Set the `keepOpen` preference for an open drawer. Surfaced as a
 * checkbox in the drawer header — flipping it on cancels the
 * auto-close timer; flipping it off lets the timer run if the
 * drawer was opened via an `autoOpenOn` event. No-op if the drawer
 * isn't currently open.
 */
export const SetDrawerKeepOpen = defineCommand({
  name: "@vtt/shell-workbench/SetDrawerKeepOpen",
  schema: z.object({
    id: QualifiedNameSchema,
    keepOpen: z.boolean(),
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
    if (!existing) {
      // Drawer isn't open — emit a state-changed event so the
      // optimistic UI converges, but no real change to make.
      return emit(owned, bumpInteracted(next));
    }
    next.openDrawers = {
      ...next.openDrawers,
      [ctx.cmd.id]: { ...existing, keepOpen: ctx.cmd.keepOpen },
    };
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
        keepOpen: existing?.keepOpen ?? false,
        size: ctx.cmd.size,
      },
    };
    return emit(owned, bumpInteracted(next));
  },
});

/**
 * Send a tab into one or more other users' workspaces. The recipient gets
 * a fresh tab pointing at the same `(pageKind, entityId)` plus a snapshot
 * of the sender's per-tab UI-state traits (the page they were on, the zoom
 * level, the active sub-tab, etc.) so they land on the same view.
 *
 * Player-to-player sharing is allowed; only `forceFocus: true` (where the
 * recipient's `activePaneId` is also flipped to the new tab) requires the
 * GM role — letting any player yank another player's screen mid-session
 * is the kind of thing one griefer ruins for everyone.
 *
 * The snapshot is gathered server-side off the sender's tab sentinel —
 * the client never enumerates traits — so a sender can't lie about UI
 * state, and traits whose `share: false` flag marks them identity-bound
 * (TabSentinel, OwnedBy, EntityVisibility) are filtered out before the
 * event ships.
 *
 * Each recipient gets a separate `TabShared` event with its visibility
 * scoped to that recipient via `actors([recipientUserId])`, so the wire
 * cost of a 6-player share is six private one-on-one notifications, not
 * a fan-out the substrate has to filter at delivery time.
 */
export const ShareTab = defineCommand({
  name: "@vtt/shell-workbench/ShareTab",
  schema: z.object({
    tabId: z.string().min(1),
    recipientUserIds: z.array(z.string().min(1)).min(1),
    forceFocus: z.boolean().default(false),
  }),
  validate: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) return fail(r.reason);
    const tab = r.owned.state.tabs[ctx.cmd.tabId];
    if (!tab) return fail(`unknown tab ${ctx.cmd.tabId}`);
    if (ctx.cmd.forceFocus) {
      const role = requireRole(ctx, "gm");
      if (!role.ok) return fail("forceFocus requires the GM role");
    }
    // Refuse self-shares — they'd be a confusing no-op (the sender already
    // has the tab) and they short-circuit the "snapshot ⇒ replay onto a
    // *fresh* sentinel" semantics.
    if (ctx.cmd.recipientUserIds.includes(r.owned.userId)) {
      return fail("cannot share a tab with yourself");
    }
    // Each recipient must have a workspace (joined the world at least once).
    for (const uid of ctx.cmd.recipientUserIds) {
      if (!findOwnerFor(ctx.world, uid)) {
        return fail(`recipient ${uid} has no workspace`);
      }
    }
    return ok();
  },
  apply: (ctx) => {
    const r = withOwner(ctx);
    if (!r.ok) throw new Error("ShareTab.apply called without an owner — validate failed");
    const senderTab = r.owned.state.tabs[ctx.cmd.tabId];
    if (!senderTab) throw new Error("validate should have caught a missing tab");

    // Gather the sender's per-tab UI-state traits off the sentinel and
    // filter to the ones whose definition opts in to sharing. Identity-
    // bound traits (TabSentinel, OwnedBy, EntityVisibility) are written
    // fresh on the recipient by the apply system; unknown traits (a
    // sentinel from a plugin we don't have loaded) are silently skipped.
    const senderSentinelId = tabSentinelEntityId(ctx.cmd.tabId);
    const snapshot: Record<string, unknown> = {};
    for (const [traitName, value] of ctx.world.traitsOn(senderSentinelId)) {
      const meta = ctx.registry.traits.get(traitName);
      if (!meta || meta.share === false) continue;
      // Let the trait sanitise its value before it travels — strips
      // owner-specific fields (PdfReaderState.scrollTop etc.) whose
      // meaning is meaningless on a recipient with a differently-sized
      // viewport. Defaults to identity when the trait doesn't set one.
      snapshot[traitName] = meta.shareValue ? meta.shareValue(value) : value;
    }

    const events = [];
    for (const recipientUserId of ctx.cmd.recipientUserIds) {
      const recipient = findOwnerFor(ctx.world, recipientUserId);
      if (!recipient) {
        throw new Error(`validate should have caught missing recipient ${recipientUserId}`);
      }
      const newTabId = newId("tab");
      const recipientNext = clone(recipient.state);
      recipientNext.tabs[newTabId] = {
        id: newTabId,
        pageKind: senderTab.pageKind,
        entityId: senderTab.entityId,
        lastFocusedAt: Date.now(),
      };
      // Insert into the recipient's currently active pane in both modes;
      // forceFocus only changes whether we *also* activate the new tab.
      const pane = recipientNext.panes[recipientNext.activePaneId];
      if (!pane) {
        // Defensive — every WorkspaceState invariant guarantees activePaneId
        // names a real pane, but if it's malformed we'd rather skip than
        // emit a corrupt event for this recipient.
        continue;
      }
      pane.tabIds.push(newTabId);
      if (ctx.cmd.forceFocus) {
        pane.activeTabId = newTabId;
        bumpTabFocus(recipientNext, newTabId);
      }
      events.push(
        withVisibility(
          TabShared({
            recipientUserId,
            recipientOwnerEntityId: recipient.entityId,
            newTabId,
            pageKind: senderTab.pageKind,
            entityId: senderTab.entityId,
            snapshot,
            forceFocus: ctx.cmd.forceFocus,
            sharedBy: r.owned.userId,
            recipientNext: bumpInteracted(recipientNext),
          }),
          actors([recipientUserId]),
        ),
      );
    }
    return events;
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
  MoveTab,
  SetSplitProportions,
  OpenDrawer,
  CloseDrawer,
  ToggleDrawer,
  SetDrawerKeepOpen,
  ResizeDrawer,
  ShareTab,
] as const;
