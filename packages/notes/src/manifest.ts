// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { definePlugin } from "@vtt/substrate";
import {
  BelongsToNote,
  EditorLock,
  Headings,
  Note,
  NoteOrdering,
  Page,
  PageDraft,
  PageHistory,
  PageOrdering,
} from "./shared/traits.js";
import {
  NotesUiState,
  NotesUiStateChanged,
  NotesUiStateMirror,
  SetNotesUiState,
} from "./shared/ui-state.js";
import {
  EditBegun,
  EditEnded,
  EditLockExtended,
  NoteCreated,
  NoteDeleted,
  NoteRenamed,
  NoteVisibilityChanged,
  PageAdded,
  PageBodyDraft,
  PageBodySet,
  PageRemoved,
  PageRenamed,
  PageVisibilityChanged,
  PagesReordered,
} from "./shared/events.js";
import {
  AddPage,
  BeginEdit,
  CreateNote,
  DeleteNote,
  EndEdit,
  ExtendEditLock,
  RemovePage,
  RenameNote,
  RenamePage,
  ReorderPages,
  SetDraftBody,
  SetNoteVisibility,
  SetPageBody,
  SetPageVisibility,
} from "./shared/commands.js";
import {
  EditBeginSystem,
  EditEndSystem,
  EditExtendSystem,
  LockReleaseSystem,
  NoteDeleteSystem,
  NoteRenameSystem,
  NoteSpawnSystem,
  NoteVisibilityChangeSystem,
  PageBodyMirrorSystem,
  PageDraftMirrorSystem,
  PageHeadingsSystem,
  PageHistoryAppendSystem,
  PageRemoveSystem,
  PageRenameSystem,
  PageReorderSystem,
  PageSpawnSystem,
  PageVisibilityChangeSystem,
} from "./server/systems.js";
import { LinkKindsSlot } from "./shared/link-kinds.js";
import { noteLinkKind } from "./shared/note-link-kind.js";
import { PagesSlot } from "@vtt/shell-workbench/shared";
import { NotesPageProvider } from "./client/index.js";

/**
 * `@vtt/notes` — markdown notes with multiple pages, Obsidian-style
 * live-preview editing, wiki-link cross references via the link-kind
 * registry, image embeds via `@vtt/assets`, page-level locking +
 * CAS for collab, FTS5 full-body search, and client-side backlinks.
 */
export const notes = definePlugin({
  name: "@vtt/notes",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    "@vtt/shell-workbench@^0",
  ],
  traits: [
    Note,
    NoteOrdering,
    BelongsToNote,
    Page,
    PageOrdering,
    Headings,
    PageDraft,
    PageHistory,
    EditorLock,
    NotesUiState,
  ],
  events: [
    NoteCreated,
    NoteRenamed,
    NoteDeleted,
    NoteVisibilityChanged,
    PageAdded,
    PageRenamed,
    PageRemoved,
    PagesReordered,
    PageVisibilityChanged,
    EditBegun,
    EditLockExtended,
    EditEnded,
    PageBodyDraft,
    PageBodySet,
    NotesUiStateChanged,
  ],
  commands: [
    CreateNote,
    RenameNote,
    DeleteNote,
    SetNoteVisibility,
    AddPage,
    RenamePage,
    RemovePage,
    ReorderPages,
    SetPageVisibility,
    BeginEdit,
    ExtendEditLock,
    EndEdit,
    SetDraftBody,
    SetPageBody,
    SetNotesUiState,
  ],
  systems: [
    NoteSpawnSystem,
    NoteRenameSystem,
    NoteDeleteSystem,
    NoteVisibilityChangeSystem,
    PageSpawnSystem,
    PageRenameSystem,
    PageRemoveSystem,
    PageReorderSystem,
    PageVisibilityChangeSystem,
    PageBodyMirrorSystem,
    PageDraftMirrorSystem,
    PageHeadingsSystem,
    PageHistoryAppendSystem,
    EditBeginSystem,
    EditExtendSystem,
    EditEndSystem,
    LockReleaseSystem,
    NotesUiStateMirror,
  ],
  slots: [LinkKindsSlot],
  fills: {
    [LinkKindsSlot.name]: [noteLinkKind],
    [PagesSlot.name]: [NotesPageProvider],
  },
});

export default notes;
