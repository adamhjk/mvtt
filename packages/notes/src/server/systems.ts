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
  defineSystem,
  type EntityId,
  type EventInstance,
  type Visibility,
} from "@vtt/substrate";
import { ConnectionClosed } from "@vtt/substrate";
import { everyone } from "@vtt/permissions/shared";
import { EntityVisibility, OwnedBy } from "@vtt/permissions/shared";
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
} from "../shared/events.js";
import { EndEdit } from "../shared/commands.js";
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
  PAGE_HISTORY_CAP,
} from "../shared/traits.js";
import { extractHeadings } from "../shared/headings.js";

// Note ------------------------------------------------------------------

export const NoteSpawnSystem = defineSystem({
  name: "NoteSpawn",
  on: NoteCreated,
  reads: [],
  writes: [Note, NoteOrdering, OwnedBy, EntityVisibility],
  run: ({ event, world }) => {
    world.spawnAt(event.noteId, [
      Note({ title: event.title, createdAt: event.createdAt }),
      NoteOrdering({ ordinal: event.ordinal }),
      OwnedBy({ userId: event.createdByUserId }),
      EntityVisibility({ visibility: everyone() }),
    ]);
    // The first page is created via a separate `PageAdded` event also
    // emitted by `CreateNote.apply`. The fixpoint runner processes that
    // immediately after this one — so by the time `PageSpawnSystem`
    // looks up the parent note's EntityVisibility, it's been written
    // here.
    return [];
  },
});

export const NoteRenameSystem = defineSystem({
  name: "NoteRename",
  on: NoteRenamed,
  reads: [Note],
  writes: [Note],
  run: ({ event, world }) => {
    const got = world.get(event.noteId, [Note]) as
      | { Note: { title: string; createdAt: number } }
      | undefined;
    if (!got) return [];
    world.set(event.noteId, Note, {
      ...got.Note,
      title: event.title,
    });
    return [];
  },
});

export const NoteVisibilityChangeSystem = defineSystem({
  name: "NoteVisibilityChange",
  on: NoteVisibilityChanged,
  reads: [BelongsToNote],
  writes: [EntityVisibility],
  run: ({ event, world }) => {
    if (!world.has(event.noteId)) return [];
    world.set(event.noteId, EntityVisibility, {
      visibility: event.visibility as Visibility,
    });
    // v1: propagate to every child page wholesale. v2 will preserve
    // page-level narrowing via a separate `PageOwnVisibility` trait
    // and intersect.
    for (const row of world.query([BelongsToNote])) {
      const b = row.values.BelongsToNote as { noteId: EntityId };
      if (b.noteId !== event.noteId) continue;
      world.set(row.id, EntityVisibility, {
        visibility: event.visibility as Visibility,
      });
    }
    return [];
  },
});

export const NoteDeleteSystem = defineSystem({
  name: "NoteDelete",
  on: NoteDeleted,
  reads: [BelongsToNote],
  writes: [],
  run: ({ event, world }) => {
    const cascade: EventInstance[] = [];
    for (const row of world.query([BelongsToNote])) {
      const b = row.values.BelongsToNote as { noteId: EntityId };
      if (b.noteId !== event.noteId) continue;
      cascade.push(PageRemoved({ pageId: row.id }));
    }
    if (world.has(event.noteId)) world.despawn(event.noteId);
    return cascade;
  },
});

// Page ------------------------------------------------------------------

export const PageSpawnSystem = defineSystem({
  name: "PageSpawn",
  on: PageAdded,
  reads: [EntityVisibility],
  writes: [
    Page,
    BelongsToNote,
    PageOrdering,
    Headings,
    PageHistory,
    EntityVisibility,
  ],
  run: ({ event, world }) => {
    // Inherit visibility from the parent note. If the note doesn't
    // exist for some reason, default to everyone.
    const noteVis = world.get(event.noteId, [EntityVisibility]) as
      | { EntityVisibility: { visibility: Visibility } }
      | undefined;
    world.spawnAt(event.pageId, [
      BelongsToNote({ noteId: event.noteId }),
      Page({ title: event.title, body: "", bodyRev: 0 }),
      PageOrdering({ ordinal: event.ordinal }),
      Headings({ items: [] }),
      PageHistory({ entries: [] }),
      EntityVisibility({
        visibility: noteVis?.EntityVisibility.visibility ?? everyone(),
      }),
    ]);
    return [];
  },
});

export const PageRenameSystem = defineSystem({
  name: "PageRename",
  on: PageRenamed,
  reads: [Page],
  writes: [Page],
  run: ({ event, world }) => {
    const got = world.get(event.pageId, [Page]) as
      | { Page: { title: string; body: string; bodyRev: number } }
      | undefined;
    if (!got) return [];
    world.set(event.pageId, Page, {
      ...got.Page,
      title: event.title,
    });
    return [];
  },
});

export const PageRemoveSystem = defineSystem({
  name: "PageRemove",
  on: PageRemoved,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.pageId)) world.despawn(event.pageId);
    return [];
  },
});

export const PageReorderSystem = defineSystem({
  name: "PageReorder",
  on: PagesReordered,
  reads: [],
  writes: [PageOrdering],
  run: ({ event, world }) => {
    event.pageIds.forEach((pid: EntityId, idx: number) => {
      if (world.has(pid)) {
        world.set(pid, PageOrdering, { ordinal: idx });
      }
    });
    return [];
  },
});

/**
 * v1 note: writes the page's EntityVisibility directly. v2 will split
 * `PageOwnVisibility` (user intent) from `EntityVisibility` (computed
 * effective) and intersect on every change. For now, narrowing a page
 * is preserved until the next `NoteVisibilityChanged`, which clobbers it.
 */
export const PageVisibilityChangeSystem = defineSystem({
  name: "PageVisibilityChange",
  on: PageVisibilityChanged,
  reads: [BelongsToNote, EntityVisibility],
  writes: [EntityVisibility],
  run: ({ event, world }) => {
    if (!world.has(event.pageId)) return [];
    if (event.visibility === null) {
      // "inherit" — restore from parent note.
      const got = world.get(event.pageId, [BelongsToNote]) as
        | { BelongsToNote: { noteId: EntityId } }
        | undefined;
      if (!got) return [];
      const noteVis = world.get(got.BelongsToNote.noteId, [EntityVisibility]) as
        | { EntityVisibility: { visibility: Visibility } }
        | undefined;
      world.set(event.pageId, EntityVisibility, {
        visibility: noteVis?.EntityVisibility.visibility ?? everyone(),
      });
    } else {
      world.set(event.pageId, EntityVisibility, {
        visibility: event.visibility as Visibility,
      });
    }
    return [];
  },
});

// Body, drafts, history -------------------------------------------------

export const PageDraftMirrorSystem = defineSystem({
  name: "PageDraftMirror",
  on: PageBodyDraft,
  reads: [],
  writes: [PageDraft],
  run: ({ event, world }) => {
    if (!world.has(event.pageId)) return [];
    world.set(event.pageId, PageDraft, { body: event.body });
    return [];
  },
});

export const PageBodyMirrorSystem = defineSystem({
  name: "PageBodyMirror",
  on: PageBodySet,
  reads: [Page],
  writes: [Page, PageDraft],
  run: ({ event, world }) => {
    if (!world.has(event.pageId)) return [];
    const got = world.get(event.pageId, [Page]) as
      | { Page: { title: string } }
      | undefined;
    if (!got) return [];
    world.set(event.pageId, Page, {
      title: got.Page.title,
      body: event.body,
      bodyRev: event.bodyRev,
    });
    // Clear draft — committed body now matches.
    if (
      world.get(event.pageId, [PageDraft]) !== undefined
    ) {
      world.set(event.pageId, PageDraft, { body: "" });
    }
    return [];
  },
});

export const PageHeadingsSystem = defineSystem({
  name: "PageHeadings",
  on: PageBodySet,
  reads: [],
  writes: [Headings],
  run: ({ event, world }) => {
    if (!world.has(event.pageId)) return [];
    const items = extractHeadings(event.body);
    world.set(event.pageId, Headings, { items });
    return [];
  },
});

export const PageHistoryAppendSystem = defineSystem({
  name: "PageHistoryAppend",
  on: PageBodySet,
  reads: [PageHistory],
  writes: [PageHistory],
  run: ({ event, world }) => {
    if (!world.has(event.pageId)) return [];
    const got = world.get(event.pageId, [PageHistory]) as
      | { PageHistory: { entries: Array<{ rev: number; savedAt: number; savedByUserId: string }> } }
      | undefined;
    const next = [
      ...(got?.PageHistory.entries ?? []),
      {
        rev: event.bodyRev,
        savedAt: event.savedAt,
        savedByUserId: event.savedByUserId,
      },
    ];
    if (next.length > PAGE_HISTORY_CAP) {
      next.splice(0, next.length - PAGE_HISTORY_CAP);
    }
    world.set(event.pageId, PageHistory, { entries: next });
    return [];
  },
});

// Edit lock -------------------------------------------------------------

export const EditBeginSystem = defineSystem({
  name: "EditBegin",
  on: EditBegun,
  reads: [],
  writes: [EditorLock],
  run: ({ event, world }) => {
    if (!world.has(event.pageId)) return [];
    world.set(event.pageId, EditorLock, {
      userId: event.userId,
      clientId: event.clientId,
      since: event.since,
      expires: event.expires,
    });
    return [];
  },
});

export const EditExtendSystem = defineSystem({
  name: "EditExtend",
  on: EditLockExtended,
  reads: [EditorLock],
  writes: [EditorLock],
  run: ({ event, world }) => {
    const got = world.get(event.pageId, [EditorLock]) as
      | { EditorLock: { userId: string; clientId: string; since: number } }
      | undefined;
    if (!got) return [];
    world.set(event.pageId, EditorLock, {
      ...got.EditorLock,
      expires: event.expires,
    });
    return [];
  },
});

export const EditEndSystem = defineSystem({
  name: "EditEnd",
  on: EditEnded,
  reads: [],
  writes: [EditorLock, PageDraft],
  run: ({ event, world }) => {
    if (!world.has(event.pageId)) return [];
    // Clear the lock by writing a dead sentinel — `lockHolder()` and
    // `requireLockHeldBy()` filter on `expires > now`, so any expired
    // lock is treated as "no holder." Schemas require non-empty strings
    // for userId/clientId so we use placeholder sentinels.
    world.set(event.pageId, EditorLock, {
      userId: "-",
      clientId: "-",
      since: 0,
      expires: 0,
    });
    world.set(event.pageId, PageDraft, { body: "" });
    return [];
  },
});

/**
 * Server-only: when a connection drops, emit `EndEdit` for every page
 * whose lock is held by that clientId. Releases stale locks within
 * seconds of disconnect rather than waiting for the heartbeat to lapse.
 *
 * Listens to `ConnectionClosed` (broadcast: false) so the system only
 * runs on the server side and won't echo through clients.
 */
export const LockReleaseSystem = defineSystem({
  name: "LockRelease",
  on: ConnectionClosed,
  reads: [EditorLock],
  writes: [],
  run: ({ event, world }) => {
    const out: EventInstance[] = [];
    const now = Date.now();
    for (const row of world.query([EditorLock])) {
      const lock = row.values.EditorLock as {
        userId: string;
        clientId: string;
        expires: number;
      };
      if (lock.expires <= now) continue;
      if (lock.clientId !== event.clientId) continue;
      out.push(EditEnded({ pageId: row.id }));
    }
    return out;
  },
});

// EditEnded itself doesn't need to be re-routed through a command; the
// emitted event is processed by EditEndSystem above on every side. The
// command-pipeline (server-side) re-runs systems-to-fixpoint on each
// emitted event, so cascading EditEnded events from LockReleaseSystem
// flow through identically.
void EndEdit; // imported for the design link only — silencer
