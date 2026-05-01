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
 * Per-tab UI state for a Notes view. Lives on the workbench's per-tab
 * sentinel entity (one per open tab); plugins look up the sentinel via
 * `useTabSentinel(tabId)` from `@vtt/shell-workbench/client` and bind
 * this trait through `createOptimisticTrait`.
 *
 * `activePageId` is the page the user is currently reading inside the
 * note (the page rail's selection). It survives tab focus changes,
 * reloads, and cross-note retargets — when a retarget lands on a note
 * that doesn't include the previously-active page, NoteView falls back
 * to the first page.
 *
 * `pendingHeadingId` is the heading the next page render should scroll
 * into view, set by cross-note wiki-link clicks (the outgoing handler
 * writes it BEFORE retargeting the tab so the destination NoteView
 * picks it up on first mount). The receiving NoteView consumes it once
 * and clears the field so it doesn't re-fire on rehydration.
 *
 * `railCollapsed` toggles the page-rail sidebar. The PDF reader's TOC
 * sidebar is the visual analogue. Persisted per-tab so toggling on
 * one tab doesn't affect another open note.
 *
 * `pageSortMode` controls how the page rail sorts: "manual" (the
 * authored ordinal — drag-reorderable) or "alpha" (alphabetical by
 * page title — read-only).
 */
const PageSortMode = z.enum(["manual", "alpha"]);

export const NotesUiState = defineTrait({
  name: "@vtt/notes/UiState",
  schema: z
    .object({
      activePageId: EntityId.nullable().default(null),
      pendingHeadingId: z.string().nullable().default(null),
      railCollapsed: z.boolean().default(false),
      pageSortMode: PageSortMode.default("manual"),
    })
    .default({
      activePageId: null,
      pendingHeadingId: null,
      railCollapsed: false,
      pageSortMode: "manual",
    }),
});

const NotesUiStateValue = z.object({
  activePageId: EntityId.nullable(),
  pendingHeadingId: z.string().nullable(),
  railCollapsed: z.boolean(),
  pageSortMode: PageSortMode,
});

export const NotesUiStateChanged = defineEvent({
  name: "@vtt/notes/UiStateChanged",
  schema: z.object({
    entityId: EntityId,
    value: NotesUiStateValue,
  }),
  transient: true,
  broadcast: true,
});

/**
 * Persist a write to the per-tab Notes UI state. The substrate enforces
 * the standard `validate`/`apply` split — plugins use this through
 * `createOptimisticTrait`'s `write` callback, never directly.
 *
 * Authoritative writer is the owning client; the substrate's permissions
 * layer scopes events to the user's connections (matching the sentinel's
 * EntityVisibility), so no extra ownership check is needed here.
 */
export const SetNotesUiState = defineCommand({
  name: "@vtt/notes/SetUiState",
  schema: z.object({
    entityId: EntityId,
    value: NotesUiStateValue,
  }),
  validate: () => ok(),
  apply: ({ cmd }) => [
    NotesUiStateChanged({ entityId: cmd.entityId, value: cmd.value }),
  ],
});

export const NotesUiStateMirror = defineSystem({
  name: "NotesUiStateMirror",
  on: NotesUiStateChanged,
  reads: [],
  writes: [NotesUiState],
  run: ({ event, world }) => {
    if (!world.has(event.entityId)) return [];
    world.set(event.entityId, NotesUiState, event.value);
    return [];
  },
});
