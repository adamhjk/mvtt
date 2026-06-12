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
  defineEvent,
  defineSlot,
  defineSystem,
  defineTrait,
  EntityId,
  ok,
  QualifiedNameSchema,
  z,
  type CommandInstance,
  type EntityId as EntityIdType,
  type QualifiedName,
} from "@vtt/substrate";

/**
 * Workbench page kind for the Roll Atelier — the dedicated tab surface
 * that replaces the cramped chat-rail pending-roll panel. One Atelier
 * tab can show every active pending roll at once with breathing room
 * for the dice pool builder, modifier list, help roster, persona/nature
 * spends, traits/wises invocations, and versus pairing.
 *
 * Plugins consume this constant when filling the workbench's PagesSlot
 * (the `@vtt/characters` manifest registers `RollAtelierPageProvider`),
 * and the auto-focus mount uses it as the target for `OpenPage` when a
 * `PendingRoll` belonging to the current user spawns.
 */
export const ROLL_ATELIER_KIND = "@vtt/characters/roll-atelier";

/**
 * Per-tab UI state for the Roll Atelier. Lives on the workbench's
 * per-tab sentinel entity; the Atelier shell looks the sentinel up via
 * `useTabSentinel(tabId)` and binds this trait through
 * `createOptimisticTrait`.
 *
 * `selectedRollId` is the PendingRoll the right pane is currently
 * editing. When stale (the entity was committed, cancelled, or the
 * referenced PendingRoll vanished), the shell falls back to the most-
 * recently-opened pending roll; with no rolls at all, the shell shows
 * its empty state. Persists across the right pane remounting (the
 * sentinel survives for the tab's lifetime); resets to the page
 * provider's seed when the tab is closed and reopened.
 *
 * `railCollapsed` toggles the left rail's visibility. Mirrors the
 * Notes view's railCollapsed convention for parity.
 *
 * `quickRollOpen` parks the right pane on the freeform "roll arbitrary
 * dice" composer (a `QuickRollComposerSlot` fill) instead of a pending
 * roll's editor or a resolved roll's card. Additive field — defaulted so
 * sentinels written before quick-roll existed decode cleanly.
 *
 * `selectedRollId` may now point at a *resolved* Roll entity (one shown
 * in the rail's "Recent" section), not only a live PendingRoll — the
 * Atelier owns a roll's whole lifecycle, so the same selection slot
 * carries both. When it points at a PendingRoll that just committed, the
 * shell redirects selection to the resolved roll the commit produced (it
 * matches `Formula.meta.originPendingRollId`, surfaced on the resolved
 * feed entry).
 */
export const RollAtelierUiState = defineTrait({
  name: "@vtt/characters/RollAtelierUiState",
  schema: z
    .object({
      selectedRollId: EntityId.nullable().default(null),
      railCollapsed: z.boolean().default(false),
      quickRollOpen: z.boolean().default(false),
    })
    .default({
      selectedRollId: null,
      railCollapsed: false,
      quickRollOpen: false,
    }),
});

const RollAtelierUiStateValue = z.object({
  selectedRollId: EntityId.nullable(),
  railCollapsed: z.boolean(),
  // Additive: older clients (and the SetRollAtelierUiState payloads they
  // send) predate quick-roll. Default keeps those writes parseable.
  quickRollOpen: z.boolean().default(false),
});

export const RollAtelierUiStateChanged = defineEvent({
  name: "@vtt/characters/RollAtelierUiStateChanged",
  schema: z.object({
    entityId: EntityId,
    value: RollAtelierUiStateValue,
  }),
  transient: true,
  broadcast: true,
});

/**
 * Persist a write to the per-tab Atelier UI state. Mirrors the
 * `SetNotesUiState` / `SetCharacterSheetUiState` pattern — passes
 * straight through; the substrate's permissions layer scopes the
 * resulting event to the sentinel's owner.
 */
export const SetRollAtelierUiState = defineCommand({
  name: "@vtt/characters/SetRollAtelierUiState",
  schema: z.object({
    entityId: EntityId,
    value: RollAtelierUiStateValue,
  }),
  validate: () => ok(),
  apply: ({ cmd }) => [
    RollAtelierUiStateChanged({
      entityId: cmd.entityId,
      value: cmd.value,
    }),
  ],
});

export const RollAtelierUiStateMirror = defineSystem({
  name: "RollAtelierUiStateMirror",
  on: RollAtelierUiStateChanged,
  reads: [],
  writes: [RollAtelierUiState],
  run: ({ event, world }) => {
    if (!world.has(event.entityId)) return [];
    world.set(event.entityId, RollAtelierUiState, event.value);
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Slots — game-system fills for the Atelier's right pane and rail
 * ----------------------------------------------------------------------- */

/**
 * Per-render arguments handed to a PendingRoll editor fill (the
 * Atelier's right pane). The editor reads the PendingRoll's traits
 * (rollableName, contributions, opts) live via `useTrait(rollId, …)`
 * and dispatches `ContributeToPendingRoll` / `CommitPendingRoll` /
 * `CancelPendingRoll` directly — this is unlike the old contributor
 * which received a `contribute` callback. Cards in the editor pane
 * read the world end-to-end so the modifier list, pool size, and
 * obstacle picker all stay live across remote contributions.
 */
export interface PendingRollEditorArgs {
  readonly rollId: EntityIdType;
}

/**
 * A registered fill that knows how to render the editor for a
 * particular family of pending rolls (matched by `rollablePrefix`).
 * The Atelier shell mounts at most one editor per pending roll — the
 * highest-priority matching fill wins; ties resolve by id ordering.
 */
export interface PendingRollEditor {
  id: QualifiedName;
  /** Higher priority wins when multiple fills match the same roll. */
  priority?: number;
  /**
   * Optional rollable-name prefix filter. When set, only pending rolls
   * whose `rollableName` starts with this string mount the fill.
   * Game-system plugins use this so the TB editor only mounts on TB
   * pending rolls. Omit to act as a catch-all (rare — the default
   * generic editor is the only sensible omitter).
   */
  rollablePrefix?: string;
  render: (args: PendingRollEditorArgs) => unknown;
}

const PendingRollEditorSchema = z.object({
  id: QualifiedNameSchema,
  priority: z.number().optional(),
  rollablePrefix: z.string().optional(),
  render: z.any(),
});

export const PendingRollEditorsSlot = defineSlot({
  name: "@vtt/characters/pending-roll-editors",
  schema: PendingRollEditorSchema,
  description:
    "Game-system fills that render the editor surface for a PendingRoll inside the Roll Atelier. One fill mounts per active pending roll — the highest-priority matching fill wins.",
});

/**
 * Per-render arguments handed to a rail-accessory fill. Mounted in the
 * Atelier's left rail under the selected pill — system-specific
 * sympathetic information that doesn't belong inside the editor pane
 * itself. The TB plugin uses it for the versus shadow (live mirror of
 * the paired opponent's pool) and the conflict cluster (every pending
 * roll in the same conflict).
 */
export interface RollAtelierRailArgs {
  readonly rollId: EntityIdType;
  /** True when this pill is currently selected (the editor pane is editing it). */
  readonly selected: boolean;
}

export interface RollAtelierRailAccessory {
  id: QualifiedName;
  priority?: number;
  /** Optional rollable-name prefix filter; same semantics as the editor slot. */
  rollablePrefix?: string;
  render: (args: RollAtelierRailArgs) => unknown;
}

const RollAtelierRailSchema = z.object({
  id: QualifiedNameSchema,
  priority: z.number().optional(),
  rollablePrefix: z.string().optional(),
  render: z.any(),
});

export const RollAtelierRailSlot = defineSlot({
  name: "@vtt/characters/roll-atelier-rail",
  schema: RollAtelierRailSchema,
  description:
    "Game-system fills that render rail-side accessories below the selected pill in the Roll Atelier — versus shadows, conflict clusters, etc.",
});

/* -------------------------------------------------------------------------
 * Resolved-roll feed — the Atelier's "Recent rolls" rail section + the
 * right-pane card for a committed roll.
 *
 * `@vtt/characters` sits *below* `@vtt/resolution` / game-system plugins
 * in the dependency graph, so it can't read the `Formula` / `RollResult`
 * traits (those belong to resolution) nor decide how a TB roll vs a plain
 * `/r` roll should render. Instead the plugins that own those rolls fill
 * this slot with a reactive feed: each fill queries its own roll entities
 * and yields compact entries the Atelier merges, sorts, and mounts.
 *
 * Shape mirrors comms's `ChatTimelineContributor` deliberately — a roll
 * card is a roll card whether it lands in chat or the Atelier — but the
 * slot is characters-owned so the Atelier needs no upward dependency.
 * ----------------------------------------------------------------------- */

/**
 * One resolved roll, as surfaced to the Atelier. `render` returns the
 * full card for the right pane (reusing the same component the chat row
 * used); `title` / `subtitle` are the compact rail-pill labels.
 */
export interface ResolvedRollEntry {
  /** The resolved Roll entity id. */
  readonly id: string;
  /** Sort key — `RollResult.rolledAt` (unix millis), newest-largest. */
  readonly sortKey: number;
  /** Compact rail label — usually the roller / speaker display name. */
  readonly title: string;
  /** Optional secondary rail label — notation, total, source, etc. */
  readonly subtitle?: string;
  /**
   * Optional resolved outcome shown prominently (and colour-coded) on the
   * Recent pill: pass/fail (or win/loss/tie), the success count, and the
   * margin. System-specific — the feed computes the human string and a
   * generic `tone`; the rail just colours by tone, staying ignorant of any
   * game system's success model. Absent for rolls with no pass/fail notion
   * (e.g. a plain `/r` total).
   */
  readonly outcome?: {
    readonly tone: "success" | "fail" | "neutral";
    readonly text: string;
  };
  /**
   * The PendingRoll this roll was committed from, when known (the commit
   * path stamps `Formula.meta.originPendingRollId` via `tagRollWithOrigin`).
   * The Atelier uses it to keep the just-committed roll selected: the
   * pending pill despawns and selection redirects to the entry whose
   * `originPendingRollId` matches. Absent for `/r` and quick rolls.
   */
  readonly originPendingRollId?: string | null;
  /** Full card for the right pane. Called once per render. */
  readonly render: () => unknown;
}

/**
 * A registered feed of resolved rolls. `useEntries` is a Solid hook —
 * invoked once during the Atelier's render (same constraint comms imposes
 * on timeline contributors) — and must return an
 * `Accessor<ResolvedRollEntry[]>`. The return type is left loose so this
 * shared module needn't import `solid-js`; the Atelier casts at the call
 * site.
 */
export interface ResolvedRollFeed {
  readonly kind: string;
  readonly useEntries: () => () => ResolvedRollEntry[];
}

const ResolvedRollFeedSchema = z.object({
  kind: z.string().min(1),
  // function values aren't structurally validated; we trust plugins
  useEntries: z.any(),
});

export const ResolvedRollFeedSlot = defineSlot({
  name: "@vtt/characters/resolved-roll-feeds",
  schema: ResolvedRollFeedSchema,
  description:
    "Plugin-supplied feeds of resolved rolls (TB rolls, plain /r rolls, …) shown in the Roll Atelier's Recent section and right-pane card.",
});

/**
 * A registered freeform "roll arbitrary dice" composer for the Atelier's
 * right pane. Filled by `@vtt/resolution` (notation input → `RequestRoll`)
 * — characters can't dispatch `RequestRoll` itself, so the composer lives
 * on the plugin that owns the command. `onClose` returns the right pane to
 * its normal pending/resolved view after a roll is sent (or cancelled).
 */
export interface QuickRollComposerArgs {
  readonly onClose: () => void;
}

export interface QuickRollComposer {
  id: QualifiedName;
  priority?: number;
  render: (args: QuickRollComposerArgs) => unknown;
}

const QuickRollComposerSchema = z.object({
  id: QualifiedNameSchema,
  priority: z.number().optional(),
  render: z.any(),
});

export const QuickRollComposerSlot = defineSlot({
  name: "@vtt/characters/quick-roll-composer",
  schema: QuickRollComposerSchema,
  description:
    "A freeform dice-notation composer mounted in the Roll Atelier's right pane. The plugin owning the roll command (resolution) fills it.",
});

/**
 * Stamp the originating PendingRoll id onto a roll command's `meta` so the
 * resolved roll can be correlated back to the pending roll that produced
 * it. `Formula.meta` is an open passthrough (`z.unknown()`), so this is
 * additive and replay-safe; game-system meta (e.g. TB's `{system, spec}`)
 * rides alongside untouched. Commands whose schema has no `meta` field
 * simply drop it on the server's re-parse — harmless.
 *
 * Used by every PendingRoll editor's commit path; the resolved-roll feeds
 * read `meta.originPendingRollId` back out for sticky selection.
 */
export function tagRollWithOrigin(
  command: CommandInstance,
  pendingRollId: EntityIdType,
): CommandInstance {
  const payload = (command.payload ?? {}) as Record<string, unknown>;
  const prevMeta =
    payload.meta && typeof payload.meta === "object" && !Array.isArray(payload.meta)
      ? (payload.meta as Record<string, unknown>)
      : {};
  return {
    type: command.type,
    payload: {
      ...payload,
      meta: { ...prevMeta, originPendingRollId: pendingRollId },
    },
  };
}
