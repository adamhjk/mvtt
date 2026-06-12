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
  defineSlot,
  type CommandInstance,
  type EntityId,
  type EventName,
  type QualifiedName,
  QualifiedNameSchema,
  type TraitMeta,
  z,
} from "@vtt/substrate";

/**
 * Context passed to a PageProvider's `list` and `defaultEntity` hooks.
 * `world` is the per-recipient view of the World — query results already
 * respect EntityVisibility (a player can't list things they can't see).
 *
 * Plugins shouldn't capture `ctx` across renders; it's the caller's job to
 * re-invoke `list` whenever the underlying queries change. The Workbench's
 * picker/palette wrap `list` in a Solid memo that re-runs on the trait
 * mutations the provider implies.
 */
export interface PageProviderContext {
  readonly world: import("@vtt/substrate").World;
  readonly registry: import("@vtt/substrate").Registry;
  readonly userId: string;
  readonly role: string;
}

/**
 * One row in a PageProvider's listing — what shows up in the picker
 * dropdown and the palette. `id` is an entity in the World; `label` is
 * what the user reads. `hint` is optional secondary search text (tags,
 * subtitle, kind name) so palette fuzzy match has more to chew on.
 */
export interface PageEntity {
  readonly id: EntityId;
  readonly label: string;
  readonly hint?: string;
}

/**
 * Per-render arguments handed to a PageProvider's `render`.
 *
 * `tabId` is the workbench's own id for this tab — exposed so providers
 * can self-retarget after they've created a new entity (typical pattern:
 * a "Create scene" form spawns a Scene, then dispatches `RetargetTab`
 * to point this tab at the freshly-created id without leaving an empty
 * tab behind).
 *
 * `entityId` is the page's bound entity, or null if the user picked a
 * kind but hasn't named an entity yet — providers render an empty/
 * picker state in that case. **Stable for the lifetime of one render**:
 * the workbench keys the Show on `(tabId, pageKind, entityId)`, so any
 * change to entityId tears down the provider and calls `render` again
 * with the new id. This matches the closure-capture semantics of
 * `useTrait(entityId, …)` — providers don't need to thread reactive
 * entityId changes through their tree.
 *
 * Per-tab UI state lives on the workbench's per-tab sentinel entity,
 * NOT on the provider's render args. Plugins use
 * `useTabSentinel(tabId)` from `@vtt/shell-workbench/client` and bind
 * their UI traits via `createOptimisticTrait` from `@vtt/substrate/client`.
 * See `design/optimistic-ui-state.md`.
 */
export interface PageRenderArgs {
  readonly tabId: string;
  readonly entityId: EntityId | null;
}

/**
 * Plugins teach the workbench what kinds of content can appear in tabs by
 * filling this slot.
 *
 * Functions can't be structurally validated by Zod, so the schema is
 * permissive on `reads`, `list`, `defaultEntity`, and `render`
 * (`z.any()`) — the type below is the load-bearing constraint at fill
 * sites. This mirrors `@vtt/comms/chat-input-handlers`'s approach.
 */
const PageProviderSchema = z.object({
  kind: QualifiedNameSchema,
  icon: z.string().optional(),
  label: z.string().min(1),
  reads: z.any(),
  list: z.any(),
  defaultEntity: z.any().optional(),
  render: z.any(),
  // Zod strips unknown keys by default; declare the optional callback so
  // the registry's slot-validate pass keeps it on the parsed value.
  summarizeTabState: z.any().optional(),
  /** See PageProvider['palettePrefix']. Required here so Zod doesn't strip it. */
  palettePrefix: z.string().optional(),
  /** See PageProvider['publishPaletteQuery']. */
  publishPaletteQuery: z.any().optional(),
  /**
   * Higher priority wins when multiple plugins register for the same kind.
   * Mirrors view priority. Default 0.
   */
  priority: z.number().optional(),
});

export type PageProvider = {
  kind: QualifiedName;
  icon?: string;
  label: string;
  /**
   * Traits this provider's `list` and `defaultEntity` callbacks read.
   * The workbench subscribes to changes on this set via the substrate's
   * fine-grained `world.subscribe(name)` mechanism, so consumers (tab
   * strip, palette, overflow menu) re-render only when an entity matching
   * one of these traits actually changes — not on every world mutation.
   *
   * Declare every trait your queries actually touch. Too narrow leaves
   * the UI stale; too wide just costs a few extra memo runs. (Compare
   * with the substrate's `defineSystem({ reads, writes, ... })` which
   * uses the same convention for parallel-system scheduling.)
   */
  reads: ReadonlyArray<TraitMeta>;
  list: (ctx: PageProviderContext) => ReadonlyArray<PageEntity>;
  defaultEntity?: (ctx: PageProviderContext) => EntityId | null;
  render: (args: PageRenderArgs) => unknown;
  /**
   * Optional. Build a one-line description of the per-tab UI state
   * currently attached to `sentinelId` — "page 11 · zoom 110%", "page 5",
   * etc. — for surfaces that show *what* a share is about to carry. The
   * Workbench's share dropdown calls this so the dispatcher can see what
   * will travel before they hit Send. Return null to hide the line (no
   * meaningful summary, e.g. defaults).
   *
   * Pure read — must not dispatch commands or mutate the world. The
   * sentinel may not exist (the tab hasn't fully spawned yet); return
   * null in that case.
   */
  summarizeTabState?: (args: {
    sentinelId: EntityId;
    world: import("@vtt/substrate").World;
  }) => string | null;
  /**
   * Optional command-palette prefix that lets users invoke this page
   * with a payload — e.g. `palettePrefix: "rules"` enables typing
   * `rules: weaver` to open the Rules page and pre-run a search for
   * "weaver". The palette parses the leading `<prefix>:` and calls
   * `publishPaletteQuery(rest)` before dispatching `OpenPage` with
   * `entityId: null`. Providers without a prefix are still openable
   * via their page-root entry by name; they just don't accept a
   * trailing payload.
   *
   * Lowercase, no colon. Match is case-insensitive.
   */
  palettePrefix?: string;
  /**
   * Companion to `palettePrefix`: invoked before the palette dispatches
   * `OpenPage` so the page-root view can pick up the query through a
   * session-local signal (see `@vtt/rules-corpus/shared/pending-search`
   * for the reference). Pure side-effect; no return value.
   */
  publishPaletteQuery?: (query: string) => void;
  priority?: number;
};

export const PagesSlot = defineSlot({
  name: "@vtt/shell-workbench/pages",
  schema: PageProviderSchema,
  description:
    "PageProviders. Each teaches the workbench one kind of content that can fill a tab.",
});

/**
 * Per-fill schema for ad-hoc verbs in the command palette. `run` may either
 * dispatch a CommandInstance (returned for the workbench to dispatch) or
 * perform local side effects and return null/undefined.
 */
const PaletteCommandSchema = z.object({
  id: QualifiedNameSchema,
  label: z.string().min(1),
  hint: z.string().optional(),
  run: z.any(),
  visibleTo: z.any().optional(),
  priority: z.number().optional(),
});

export interface PaletteCommandContext {
  readonly userId: string;
  readonly role: string;
  /**
   * The client handle for the current connection. Used by verbs that
   * need to subscribe to bus events (e.g. wait for a server-allocated
   * id to land) or dispatch follow-up commands beyond the single
   * return value of `run`. Most verbs only need `userId` / `role`
   * and can ignore this.
   */
  readonly client: import("@vtt/substrate/client").ClientHandle;
}

export type PaletteCommand = {
  id: QualifiedName;
  label: string;
  hint?: string;
  run: (ctx: PaletteCommandContext) => CommandInstance | null | void;
  /**
   * Optional visibility predicate. Returning false hides the verb
   * from the palette for this user. Useful for GM-only spawn verbs
   * that would just fail server-side validation in a player session.
   * Defaults to "always visible".
   */
  visibleTo?: (ctx: PaletteCommandContext) => boolean;
  priority?: number;
};

export const PaletteCommandsSlot = defineSlot({
  name: "@vtt/shell-workbench/palette-commands",
  schema: PaletteCommandSchema,
  description:
    "Verbs offered in the quick-switcher alongside Pages. Plugins fill this with cross-cutting actions.",
});

/**
 * One dynamic, world-derived palette entry — unlike a `PaletteCommand`
 * (a static verb), these are generated per-render from world state, so a
 * plugin can offer "Roll Tarn — Will", "Roll Tarn — Fighter", … one entry
 * per (character × rollable). Each carries a prebuilt `command` dispatched
 * verbatim when the user picks it; the quick-switcher fuzzy-matches on
 * `label` (so typing `roll tarn will` narrows to it) and shows `tag` in
 * the left mono-caps column.
 */
export interface PaletteAction {
  /** Stable key for `<For>` and result selection — unique across providers. */
  readonly id: string;
  /** Fuzzy-searched, shown as the entry body. */
  readonly label: string;
  /** Optional secondary search text / right-hand hint. */
  readonly hint?: string;
  /** Left mono-caps column label (e.g. "roll"). Defaults to "action". */
  readonly tag?: string;
  /** Dispatched verbatim when this entry is chosen. */
  readonly command: CommandInstance;
}

/**
 * A registered generator of dynamic palette entries. `list` runs each
 * time the quick-switcher rebuilds its corpus (provider/world changes);
 * `reads` declares which traits it depends on so the switcher subscribes
 * for fine-grained reactivity, exactly like `PageProvider.reads`.
 */
export type PaletteActionProvider = {
  id: QualifiedName;
  reads: ReadonlyArray<TraitMeta>;
  list: (ctx: PageProviderContext) => ReadonlyArray<PaletteAction>;
};

const PaletteActionProviderSchema = z.object({
  id: QualifiedNameSchema,
  // `reads` and `list` are runtime-opaque (a trait-array and a function);
  // the types above are the load-bearing constraint at the call site.
  reads: z.any(),
  list: z.any(),
});

export const PaletteActionsSlot = defineSlot({
  name: "@vtt/shell-workbench/palette-actions",
  schema: PaletteActionProviderSchema,
  description:
    "Generators of dynamic, world-derived quick-switcher entries (e.g. 'Roll <Character> — <Ability>') that dispatch a prebuilt command when chosen.",
});

/**
 * Per-fill schema for chat-rail widgets — small components that stack
 * above the chat composer (presence indicator, dice tray summary, etc.).
 * `render` is a Solid component reference; rendered in `priority` order.
 */
const ChatRailWidgetSchema = z.object({
  id: QualifiedNameSchema,
  render: z.any(),
  priority: z.number().optional(),
});

export type ChatRailWidget = {
  id: QualifiedName;
  render: () => unknown;
  priority?: number;
};

export const ChatRailWidgetsSlot = defineSlot({
  name: "@vtt/shell-workbench/chat-rail-widgets",
  schema: ChatRailWidgetSchema,
  description:
    "Small widgets that stack above the chat composer in the right rail.",
});

/**
 * Per-fill schema for status-strip widgets — compact, always-visible
 * controls anchored to the **right** of the bottom drawer strip (the
 * persistent footer that holds the dice-tray tab). Unlike a drawer,
 * these never collapse: the whole control lives in the bar, so a GM can
 * read and adjust the grind clock at a glance without opening anything.
 * `render` is a Solid component; rendered right-to-left in priority order.
 */
const WorkbenchStatusItemSchema = z.object({
  id: QualifiedNameSchema,
  render: z.any(),
  priority: z.number().optional(),
});

export type WorkbenchStatusItem = {
  id: QualifiedName;
  render: () => unknown;
  priority?: number;
};

export const WorkbenchStatusSlot = defineSlot({
  name: "@vtt/shell-workbench/status",
  schema: WorkbenchStatusItemSchema,
  description:
    "Compact, always-visible widgets pinned to the right of the bottom drawer strip (e.g. the grind clock). They live in the bar — no drawer to open.",
});

/**
 * One row in the notifications overlay. Same shape as a chat-timeline
 * entry — these are the actionable "something happened at the table"
 * cards (a light burns out, the grind takes its toll, a skill is ready
 * to advance) that used to live in chat. They're entity-backed and
 * persist until acted on, so the overlay is a live projection of those
 * entities, not an ephemeral toast queue.
 */
export interface NotificationEntry {
  /** Stable id for `<For>` keying — usually the backing entity id. */
  readonly id: string;
  /** Sort key (unix millis by convention); newest shown at the top. */
  readonly sortKey: number;
  /** Returns the card JSX. Called once per render. */
  readonly render: () => unknown;
}

/**
 * A registered notification feed. `useEntries` is a Solid hook invoked
 * once during the overlay's render and must return an
 * `Accessor<NotificationEntry[]>`. The loose return type avoids a
 * `solid-js` import in `shared/`; the overlay casts at the call site.
 * Structurally identical to comms's `ChatTimelineContributor`, so a card
 * feed can move from chat to the overlay without changing its shape.
 */
export interface NotificationFeed {
  readonly kind: string;
  readonly useEntries: () => () => NotificationEntry[];
}

const NotificationFeedSchema = z.object({
  kind: z.string().min(1),
  useEntries: z.any(),
});

export const NotificationsSlot = defineSlot({
  name: "@vtt/shell-workbench/notifications",
  schema: NotificationFeedSchema,
  description:
    "Live feeds of actionable table-event cards (light burnout, grind toll, advancement) projected into the floating notifications overlay.",
});

/**
 * Edges a drawer can slide from. The workbench reserves one drawer per
 * edge in v1; if multiple plugins ever fight for the same edge later,
 * the resolution is to escalate to a tabbed-dock pattern (mirrors
 * `SceneOverlayTabsSlot`) — but for now, fill conflicts just sort by
 * priority and the highest wins.
 */
export type DrawerEdge = "bottom" | "right" | "left" | "top";

/**
 * Per-render arguments handed to a drawer's `render`. `close` dispatches
 * `CloseDrawer({ id })` for this drawer; the drawer's own UI typically
 * binds it to a close button or an outside-click. `size` is the
 * current drawer size in pixels (from `WorkspaceState.openDrawers[id].size`,
 * falling back to `defaultSize`) so the rendered content can lay itself
 * out responsively.
 */
export interface WorkbenchDrawerRenderArgs {
  readonly close: () => void;
  readonly size: number;
}

/**
 * One drawer registration. Plugins fill `WorkbenchDrawersSlot` to add a
 * global slide-out panel attached to a workbench edge. Drawers are not
 * tabs — they're transient overlays attached to events ("a roll
 * happened", "music started", "GM notes toggled"), not documents you
 * navigate to. Open/close state lives in `WorkspaceState.openDrawers`
 * and replicates to the user's other devices.
 *
 * Permissive-on-functions, like other plugin-fill slot types: Zod can't
 * structurally validate a render function; the type below is the
 * load-bearing constraint at fill sites.
 */
export type WorkbenchDrawer = {
  /**
   * Plugin-namespaced id, e.g. `@vtt/dice-tray/tray`. Used as the key
   * in `openDrawers` and as the launcher button's stable target.
   */
  id: QualifiedName;
  label: string;
  icon?: string;
  edge: DrawerEdge;
  /**
   * Initial size in pixels (height for top/bottom, width for
   * left/right) when the drawer first opens. Users can resize past
   * this; the resized value persists per-user via `ResizeDrawer`.
   * Falls back to a sensible default per-edge if omitted.
   */
  defaultSize?: number;
  /**
   * If set, the workbench subscribes to this event on the bus and
   * dispatches `OpenDrawer({ id })` on each occurrence. Declarative —
   * keeps the "react to bus event → open drawer" wiring out of every
   * drawer plugin. Drawers can still call `OpenDrawer` imperatively.
   */
  autoOpenOn?: EventName;
  /**
   * If set, the workbench schedules a `CloseDrawer({ id })` dispatch
   * `autoCloseAfterMs` milliseconds after the drawer opens. Bumped on
   * every subsequent `OpenDrawer` for the same id (so a fresh roll
   * resets the dwell timer). Drawers that need to manage closure
   * themselves (with custom dwell logic) should leave this unset and
   * dispatch `CloseDrawer` from their own render.
   */
  autoCloseAfterMs?: number;
  /**
   * Higher priority sorts the launcher button to the left within the
   * launcher cluster. When two fills register for the same `id`,
   * priority breaks the tie. Defaults to 0.
   */
  priority?: number;
  render: (args: WorkbenchDrawerRenderArgs) => unknown;
};

const DrawerEdgeSchema = z.union([
  z.literal("bottom"),
  z.literal("right"),
  z.literal("left"),
  z.literal("top"),
]);

const WorkbenchDrawerSchema = z.object({
  id: QualifiedNameSchema,
  label: z.string().min(1),
  icon: z.string().optional(),
  edge: DrawerEdgeSchema,
  defaultSize: z.number().int().positive().optional(),
  autoOpenOn: QualifiedNameSchema.optional(),
  autoCloseAfterMs: z.number().int().positive().optional(),
  priority: z.number().optional(),
  render: z.any(),
});

export const WorkbenchDrawersSlot = defineSlot({
  name: "@vtt/shell-workbench/drawers",
  schema: WorkbenchDrawerSchema,
  description:
    "Slide-out drawers anchored to a workbench edge. Unlike Pages, drawers are transient overlays driven by events, not documents you navigate to.",
});
