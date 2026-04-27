import {
  defineSlot,
  type CommandInstance,
  type EntityId,
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
 * Per-render arguments handed to a PageProvider's `render`. `entityId` is
 * the page's bound entity, or null if the user picked a kind but hasn't
 * named an entity yet — providers render an empty/picker state in that
 * case. `uiState` is whatever the provider stashed last time; `setUiState`
 * persists a new value (dispatched as a workbench command, replicated to
 * the user's other devices).
 *
 * `tabId` is the workbench's own id for this tab — exposed so providers
 * can self-retarget after they've created a new entity (typical pattern:
 * a "Create scene" form spawns a Scene, then dispatches `RetargetTab`
 * to point this tab at the freshly-created id without leaving an empty
 * tab behind).
 */
export interface PageRenderArgs {
  readonly tabId: string;
  readonly entityId: EntityId | null;
  readonly uiState: unknown;
  readonly setUiState: (next: unknown) => void;
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
  priority: z.number().optional(),
});

export interface PaletteCommandContext {
  readonly userId: string;
  readonly role: string;
}

export type PaletteCommand = {
  id: QualifiedName;
  label: string;
  hint?: string;
  run: (ctx: PaletteCommandContext) => CommandInstance | null | void;
  priority?: number;
};

export const PaletteCommandsSlot = defineSlot({
  name: "@vtt/shell-workbench/palette-commands",
  schema: PaletteCommandSchema,
  description:
    "Verbs offered in the quick-switcher alongside Pages. Plugins fill this with cross-cutting actions.",
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
