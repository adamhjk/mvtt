// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { defineTrait, EntityId, z } from "@vtt/substrate";

/**
 * Top-level Note. Carries the title only; pages are separate
 * NotePage entities linked back via `BelongsToNote`. Visibility +
 * ownership come from `@vtt/permissions` traits attached on creation.
 */
export const Note = defineTrait({
  name: "@vtt/notes/Note",
  schema: z.object({
    title: z.string().min(1).max(200),
    createdAt: z.number().int().nonnegative(),
  }),
});

/**
 * Sidebar ordering for the notes picker. Server-allocated on create;
 * shifts on `ReorderNotes`. Lower ordinal sorts earlier.
 */
export const NoteOrdering = defineTrait({
  name: "@vtt/notes/NoteOrdering",
  schema: z.object({
    ordinal: z.number(),
  }),
});

/**
 * Back-link from a NotePage to its parent Note. Cascading delete is
 * driven by this — `NoteDeleted` fires `RemovePage` for every page
 * carrying this trait pointing at the gone note.
 */
export const BelongsToNote = defineTrait({
  name: "@vtt/notes/BelongsToNote",
  schema: z.object({
    noteId: EntityId,
  }),
});

/**
 * The page itself. `body` is the canonical markdown after the latest
 * durable save (`PageBodySet`). `bodyRev` is incremented on every
 * durable save and used for CAS when reconnects race with takeover.
 */
export const Page = defineTrait({
  name: "@vtt/notes/Page",
  schema: z.object({
    title: z.string().min(1).max(200),
    body: z.string(),
    bodyRev: z.number().int().nonnegative(),
  }),
});

export const PageOrdering = defineTrait({
  name: "@vtt/notes/PageOrdering",
  schema: z.object({
    ordinal: z.number(),
  }),
});

/**
 * Derived index of the headings inside `Page.body`. Maintained
 * exclusively by `PageBodyParseSystem`; never written from a command's
 * apply or from any other system. Heading ids are content-hashed so
 * incoming wiki-link `#anchor` references stay stable across rephrases.
 */
export const Headings = defineTrait({
  name: "@vtt/notes/Headings",
  schema: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        level: z.number().int().min(1).max(6),
      }),
    ),
  }),
});

/**
 * Transient: the live in-flight body during an active edit session.
 * Not persisted; reconstructed from broadcast on reconnect. Other
 * readers' rendered views blend `PageDraft.body` over `Page.body`
 * when present so they see the editing user's keystrokes sub-second.
 *
 * Cleared on `EditEnded` (and on lock-release via the same path).
 */
export const PageDraft = defineTrait({
  name: "@vtt/notes/PageDraft",
  schema: z.object({
    body: z.string(),
  }),
  transient: true,
});

/**
 * Capped metadata-only history. Entries are appended on every durable
 * `PageBodySet` (checkpoint or final) and trimmed to the last
 * `PAGE_HISTORY_CAP` (20). Bodies are not stored here — they live in
 * the event log, addressable by `(pageId, rev)`.
 */
export const PageHistory = defineTrait({
  name: "@vtt/notes/PageHistory",
  schema: z.object({
    entries: z.array(
      z.object({
        rev: z.number().int().nonnegative(),
        savedAt: z.number().int().nonnegative(),
        savedByUserId: z.string().min(1),
      }),
    ),
  }),
});

/**
 * Active editing lock on a page. Holder identified by
 * `userId+clientId` (so two tabs of the same user contend for the
 * lock). `expires` is bumped by the heartbeat (`ExtendEditLock`); on
 * disconnect the substrate's `ConnectionClosed` event is mirrored
 * server-side into a `LockReleaseSystem` that emits `EditEnded`.
 *
 * Trait-level transient: server restart drops all locks. The
 * heartbeat would lapse anyway, so this is fine and avoids restart
 * recovering stale locks.
 */
export const EditorLock = defineTrait({
  name: "@vtt/notes/EditorLock",
  schema: z.object({
    userId: z.string().min(1),
    clientId: z.string().min(1),
    since: z.number().int().nonnegative(),
    expires: z.number().int().nonnegative(),
  }),
  transient: true,
});

export const PAGE_HISTORY_CAP = 20;
