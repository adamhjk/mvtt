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
 */
export const RollAtelierUiState = defineTrait({
  name: "@vtt/characters/RollAtelierUiState",
  schema: z
    .object({
      selectedRollId: EntityId.nullable().default(null),
      railCollapsed: z.boolean().default(false),
    })
    .default({
      selectedRollId: null,
      railCollapsed: false,
    }),
});

const RollAtelierUiStateValue = z.object({
  selectedRollId: EntityId.nullable(),
  railCollapsed: z.boolean(),
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
