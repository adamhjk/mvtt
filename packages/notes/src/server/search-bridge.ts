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

import type { EntityId, EventInstance, WorldId, WorldRuntime } from "@vtt/substrate";
import type { NotesSearchIndex } from "./search.js";
import {
  NoteCreated,
  NoteRenamed,
  NoteDeleted,
  PageAdded,
  PageBodySet,
  PageRenamed,
  PageRemoved,
} from "../shared/events.js";
import { Note, Page, BelongsToNote } from "../shared/traits.js";

/**
 * Subscribe to a runtime's event bus and keep the FTS index up to
 * date. Returns an unsubscribe handle.
 *
 * Server-only — runs once per world runtime when it boots. Idempotent
 * on bootstrap: if the index already has rows for this world, they're
 * harmlessly re-written by `indexPage`.
 */
export function attachNotesSearchBridge(
  runtime: WorldRuntime,
  index: NotesSearchIndex,
): () => void {
  const worldId = runtime.worldId;
  const world = runtime.world;

  const indexPageById = (pageId: EntityId): void => {
    const pageGot = world.get(pageId, [Page, BelongsToNote]) as
      | {
          Page: { title: string; body: string };
          BelongsToNote: { noteId: EntityId };
        }
      | undefined;
    if (!pageGot) return;
    const noteGot = world.get(pageGot.BelongsToNote.noteId, [Note]) as
      | { Note: { title: string } }
      | undefined;
    if (!noteGot) return;
    index.indexPage({
      worldId: worldId as WorldId,
      noteId: pageGot.BelongsToNote.noteId,
      pageId,
      noteTitle: noteGot.Note.title,
      pageTitle: pageGot.Page.title,
      body: pageGot.Page.body,
    });
  };

  // On bootstrap, walk every existing page and re-index. Cheap; the
  // cold-boot replay has just finished by the time `attachBridge` runs.
  for (const row of world.query([Page, BelongsToNote])) {
    indexPageById(row.id);
  }

  const off = runtime.bus.onAny((ev: EventInstance) => {
    switch (ev.type) {
      case PageAdded.name:
      case PageBodySet.name: {
        const p = ev.payload as { pageId: EntityId };
        indexPageById(p.pageId);
        return;
      }
      case PageRenamed.name: {
        const p = ev.payload as { pageId: EntityId; title: string };
        index.retitlePage(worldId as WorldId, p.pageId, p.title);
        return;
      }
      case NoteRenamed.name: {
        const p = ev.payload as { noteId: EntityId; title: string };
        index.retitleNote(worldId as WorldId, p.noteId, p.title);
        return;
      }
      case PageRemoved.name: {
        const p = ev.payload as { pageId: EntityId };
        index.removePage(worldId as WorldId, p.pageId);
        return;
      }
      case NoteDeleted.name: {
        const p = ev.payload as { noteId: EntityId };
        index.removeNote(worldId as WorldId, p.noteId);
        return;
      }
      case NoteCreated.name: {
        // No bodies yet — first page's PageAdded will arrive next and
        // index itself. Nothing to do here.
        return;
      }
      default:
        return;
    }
  });
  return off;
}
