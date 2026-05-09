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
  defineSystem,
  defineTrait,
  EntityId,
  ok,
  z,
} from "@vtt/substrate";

/**
 * Per-tab UI state for a character sheet view. Lives on the workbench's
 * per-tab sentinel entity (one per open tab); `SheetShell` looks the
 * sentinel up via `useTabSentinel(tabId)` from `@vtt/shell-workbench/client`
 * and binds this trait through `createOptimisticTrait`.
 *
 * `activeTabId` is the qualified name of the sub-tab the user last
 * selected on this workbench tab (Abilities & Skills, Inventory, …).
 * Survives the sheet remounting when the user navigates away and back,
 * and survives the workbench tab being retargeted onto a different
 * character — `SheetShell` falls back to the first available sub-tab
 * when the stored id isn't in the projected tab list.
 */
export const CharacterSheetUiState = defineTrait({
  name: "@vtt/characters/SheetUiState",
  schema: z
    .object({
      activeTabId: z.string().nullable().default(null),
    })
    .default({ activeTabId: null }),
});

const CharacterSheetUiStateValue = z.object({
  activeTabId: z.string().nullable(),
});

export const CharacterSheetUiStateChanged = defineEvent({
  name: "@vtt/characters/SheetUiStateChanged",
  schema: z.object({
    entityId: EntityId,
    value: CharacterSheetUiStateValue,
  }),
  transient: true,
  broadcast: true,
});

/**
 * Persist a write to the per-tab character sheet UI state. The
 * substrate's permissions layer scopes the resulting event to the
 * sentinel's owner, so no extra ownership check is needed here —
 * mirroring the `SetNotesUiState` shape.
 */
export const SetCharacterSheetUiState = defineCommand({
  name: "@vtt/characters/SetSheetUiState",
  schema: z.object({
    entityId: EntityId,
    value: CharacterSheetUiStateValue,
  }),
  validate: () => ok(),
  apply: ({ cmd }) => [
    CharacterSheetUiStateChanged({
      entityId: cmd.entityId,
      value: cmd.value,
    }),
  ],
});

export const CharacterSheetUiStateMirror = defineSystem({
  name: "CharacterSheetUiStateMirror",
  on: CharacterSheetUiStateChanged,
  reads: [],
  writes: [CharacterSheetUiState],
  run: ({ event, world }) => {
    if (!world.has(event.entityId)) return [];
    world.set(event.entityId, CharacterSheetUiState, event.value);
    return [];
  },
});
