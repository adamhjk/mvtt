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

export { parseLinks, parseInner, formatLink } from "./wiki-link.js";
export type { WikiLinkRef, ParseOptions } from "./wiki-link.js";
export { extractHeadings } from "./headings.js";
export type { HeadingItem } from "./headings.js";
export {
  defineLinkKind,
  buildLinkKindIndex,
  LinkKindsSlot,
  DEFAULT_LINK_KIND,
} from "./link-kinds.js";
export type {
  AnyLinkKindDef,
  LinkActivation,
  LinkActivationContext,
  LinkKindDef,
  LinkKindIndex,
  LinkSuggestion,
} from "./link-kinds.js";
export { noteLinkKind } from "./note-link-kind.js";
export {
  MarkdownPostRenderSlot,
  type MarkdownPostRender,
  type MarkdownPostRenderContext,
} from "./post-render.js";
export {
  EditorCompletionSourcesSlot,
  type EditorCompletionSourceFactory,
  type EditorCompletionContext,
} from "./editor-completions.js";
export {
  NotesReferenceSlot,
  type ReferenceField,
  type ReferenceSection,
  type ReferenceProvider,
  type ReferenceProviderContext,
} from "./editor-reference.js";
export {
  BelongsToNote,
  EditorLock,
  Headings,
  Note,
  NoteOrdering,
  Page,
  PageDraft,
  PageHistory,
  PageOrdering,
  PAGE_HISTORY_CAP,
} from "./traits.js";
export {
  NotesUiState,
  NotesUiStateChanged,
  SetNotesUiState,
  NotesUiStateMirror,
} from "./ui-state.js";
export {
  EditBegun,
  EditEnded,
  EditLockExtended,
  LinkAdded,
  LinkRemoved,
  NoteCreated,
  NoteDeleted,
  NoteRenamed,
  PageAdded,
  PageBodyDraft,
  PageBodySet,
  PageRemoved,
  PageRenamed,
  PagesReordered,
} from "./events.js";
export {
  AddPage,
  BeginEdit,
  CreateNote,
  DeleteNote,
  EDITOR_LOCK_TTL_MS,
  EndEdit,
  ExtendEditLock,
  RemovePage,
  RenameNote,
  RenamePage,
  ReorderPages,
  SetDraftBody,
  SetPageBody,
} from "./commands.js";
