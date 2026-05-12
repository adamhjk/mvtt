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

import { type EntityId, type World } from "@vtt/substrate";
import { defineLinkKind, type LinkSuggestion } from "./link-kinds.js";
import {
  Note,
  Headings,
  Page,
  BelongsToNote,
} from "./traits.js";
import {
  NoteCreated,
  NoteRenamed,
  NoteDeleted,
  PageAdded,
  PageRemoved,
  PageRenamed,
  PageBodySet,
} from "./events.js";

interface NoteRef {
  readonly noteId: EntityId;
  /** When set, the link points at a specific page; else the first page. */
  readonly pageId: EntityId | null;
  /**
   * Optional heading anchor inside the resolved page. Either a heading
   * id (starts with `hd:`) or free-form heading text resolved at
   * render time against the page's `Headings` trait.
   */
  readonly anchor: string | null;
}

function isEntityIdShape(s: string): boolean {
  // Substrate ids look like "e\d+".
  return /^e\d+$/.test(s);
}

function resolveNoteByTitle(world: World, title: string): EntityId | null {
  const needle = title.trim().toLowerCase();
  for (const row of world.query([Note])) {
    const v = row.values.Note as { title: string };
    if (v.title.toLowerCase() === needle) return row.id;
  }
  return null;
}

function resolveNoteByName(world: World, raw: string): EntityId | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (isEntityIdShape(trimmed) && world.has(trimmed as EntityId)) {
    const got = world.get(trimmed as EntityId, [Note]);
    if (got) return trimmed as EntityId;
    return null;
  }
  return resolveNoteByTitle(world, trimmed);
}

function resolvePageOfNote(
  world: World,
  noteId: EntityId,
  needle: string,
): EntityId | null {
  const trimmed = needle.trim();
  if (trimmed.length === 0) return null;
  if (isEntityIdShape(trimmed) && world.has(trimmed as EntityId)) {
    const got = world.get(trimmed as EntityId, [BelongsToNote]) as
      | { BelongsToNote: { noteId: EntityId } }
      | undefined;
    if (got && got.BelongsToNote.noteId === noteId) {
      return trimmed as EntityId;
    }
    return null;
  }
  const lower = trimmed.toLowerCase();
  for (const row of world.query([Page, BelongsToNote])) {
    const back = row.values.BelongsToNote as { noteId: EntityId };
    if (back.noteId !== noteId) continue;
    const p = row.values.Page as { title: string };
    if (p.title.toLowerCase() === lower) return row.id;
  }
  return null;
}

function firstPageOf(world: World, noteId: EntityId): EntityId | null {
  let firstId: EntityId | null = null;
  let firstOrdinal = Number.POSITIVE_INFINITY;
  for (const row of world.query([Page, BelongsToNote])) {
    const back = row.values.BelongsToNote as { noteId: EntityId };
    if (back.noteId !== noteId) continue;
    // Use spawn order as a fallback proxy for ordinal — the dedicated
    // PageOrdering import is held in shared/traits but not relevant
    // here; first match works for v1.
    if (firstId === null) {
      firstId = row.id;
      firstOrdinal = 0;
    }
  }
  void firstOrdinal;
  return firstId;
}

/**
 * Split the note kind's body on `>` into up to three path segments:
 * Note > Page > Heading. Each segment may be a title or an entity id;
 * whitespace around `>` is tolerated. Empty segments collapse to null.
 *
 *   "Goblin Cave"                            → note only
 *   "Goblin Cave > Inhabitants"              → note + page
 *   "Goblin Cave > Inhabitants > Tactics"    → note + page + heading
 *   "note:e42>e43>hd:abc"                    → fully-resolved storage form
 *
 * Bodies with more than two `>` collapse the trailing parts back into
 * the heading (so `"a > b > c > d"` becomes `note=a, page=b,
 * heading="c > d"` — odd but won't crash, and the heading resolver
 * will fail gracefully).
 */
function splitNotePath(body: string): {
  note: string;
  page: string | null;
  heading: string | null;
} {
  const trimmed = body.trim();
  if (trimmed.length === 0) return { note: "", page: null, heading: null };
  const firstGt = trimmed.indexOf(">");
  if (firstGt < 0) {
    return { note: trimmed, page: null, heading: null };
  }
  const noteHalf = trimmed.slice(0, firstGt).trim();
  const rest = trimmed.slice(firstGt + 1);
  const secondGt = rest.indexOf(">");
  if (secondGt < 0) {
    const pageHalf = rest.trim();
    return {
      note: noteHalf,
      page: pageHalf.length > 0 ? pageHalf : null,
      heading: null,
    };
  }
  const pageHalf = rest.slice(0, secondGt).trim();
  const headingHalf = rest.slice(secondGt + 1).trim();
  return {
    note: noteHalf,
    page: pageHalf.length > 0 ? pageHalf : null,
    heading: headingHalf.length > 0 ? headingHalf : null,
  };
}

function resolveHeadingOnPage(
  world: World,
  pageId: EntityId,
  needle: string,
): string | null {
  const trimmed = needle.trim();
  if (trimmed.length === 0) return null;
  const h = world.get(pageId, [Headings]) as
    | { Headings: { items: Array<{ id: string; text: string }> } }
    | undefined;
  if (!h) return null;
  // Direct id match (e.g. "hd:k7q2"). Stable across rephrases.
  for (const item of h.Headings.items) {
    if (item.id === trimmed) return item.id;
  }
  const lower = trimmed.toLowerCase();
  for (const item of h.Headings.items) {
    if (item.text.toLowerCase() === lower) return item.id;
  }
  return null;
}

/**
 * Notes' own link kind — handles `[[Goblin Cave]]`, `[[note:e42]]`,
 * `[[Goblin Cave > Inhabitants]]`,
 * `[[Goblin Cave > Inhabitants > Tactics]]`, etc. The default kind,
 * so unprefixed `[[…]]` falls through here.
 *
 * Path grammar: `<note>(\s*>\s*<page>(\s*>\s*<heading>)?)?` where
 * each segment is either a title (case-insensitive exact match) or
 * an entity id (`e\d+`). Headings can also be referenced by their
 * stable `hd:…` id directly (the storage-normalised form).
 *
 * The grammar's separate `#anchor` slot is intentionally unused by
 * this kind — `>` is the only navigation separator for notes.
 */
export const noteLinkKind = defineLinkKind<NoteRef>({
  name: "note",
  parse: (body, _anchor, world) => {
    const { note: noteText, page: pageText, heading: headingText } =
      splitNotePath(body);
    if (noteText.length === 0) return null;

    let noteId: EntityId | null = null;
    if (isEntityIdShape(noteText) && world.has(noteText as EntityId)) {
      noteId = noteText as EntityId;
    } else {
      noteId = resolveNoteByTitle(world, noteText);
    }
    if (noteId === null) return null;
    if (!world.has(noteId)) return null;

    let pageId: EntityId | null = null;
    if (pageText !== null) {
      pageId = resolvePageOfNote(world, noteId, pageText);
      // If a page was specified but doesn't resolve, keep the note ref
      // so the chip still points somewhere. pageId stays null and the
      // renderer falls back to the first page for the heading lookup.
    }

    let anchor: string | null = null;
    if (headingText !== null) {
      const targetPage = pageId ?? firstPageOf(world, noteId);
      anchor = targetPage
        ? resolveHeadingOnPage(world, targetPage, headingText) ?? headingText
        : headingText;
    }

    return { noteId, pageId, anchor };
  },
  display: (ref, world) => {
    const noteGot = world.get(ref.noteId, [Note]) as
      | { Note: { title: string } }
      | undefined;
    if (!noteGot) return "(missing note)";

    const parts: string[] = [noteGot.Note.title];

    const pageId = ref.pageId ?? firstPageOf(world, ref.noteId);
    if (ref.pageId !== null && pageId !== null) {
      const pageGot = world.get(pageId, [Page]) as
        | { Page: { title: string } }
        | undefined;
      if (pageGot) parts.push(pageGot.Page.title);
    }

    if (ref.anchor) {
      let resolved = ref.anchor;
      if (pageId) {
        const h = world.get(pageId, [Headings]) as
          | { Headings: { items: Array<{ id: string; text: string }> } }
          | undefined;
        const heading = h?.Headings.items.find(
          (i) => i.id === ref.anchor || i.text === ref.anchor,
        );
        if (heading) resolved = heading.text;
      }
      parts.push(resolved);
    }

    return parts.join(" › ");
  },
  target: (ref) => ({
    // Prefer the page when one was specified (and resolved); else the
    // note. Tests that look at "what entity does this point at" should
    // see the most-specific resolved id.
    entityId: ref.pageId ?? ref.noteId,
  }),
  activate: (ref, ctx) => {
    if (ctx.modifiers.meta) {
      return {
        type: "navigate",
        pageKind: "@vtt/notes/notes",
        entityId: ref.noteId,
      };
    }
    return {
      type: "peek",
      render: () => null,
    };
  },
  autocomplete: (query, world) => {
    const out: LinkSuggestion[] = [];
    const trimmed = query.trim();
    const segments = trimmed.split(">");
    const depth = segments.length - 1; // 0 = note level, 1 = page level, 2 = heading level

    // ---- Level 0: suggest notes (and matching pages as Note › Page) ----
    if (depth === 0) {
      const needle = trimmed.toLowerCase();
      for (const row of world.query([Note])) {
        const v = row.values.Note as { title: string };
        if (needle.length > 0 && !v.title.toLowerCase().includes(needle)) {
          continue;
        }
        out.push({
          kind: "note",
          body: v.title,
          display: v.title,
          badge: "Note",
        });
      }
      // Page hits as "Note > Page" when the needle has 2+ chars.
      if (needle.length >= 2) {
        for (const row of world.query([Page, BelongsToNote])) {
          const p = row.values.Page as { title: string };
          if (!p.title.toLowerCase().includes(needle)) continue;
          const back = row.values.BelongsToNote as { noteId: EntityId };
          const noteGot = world.get(back.noteId, [Note]) as
            | { Note: { title: string } }
            | undefined;
          if (!noteGot) continue;
          out.push({
            kind: "note",
            body: `${noteGot.Note.title}>${p.title}`,
            display: `${noteGot.Note.title} › ${p.title}`,
            badge: "Page",
          });
        }
      }
      return out;
    }

    // ---- Level 1: `Note >` typed — suggest pages of that note ----
    if (depth === 1) {
      const noteHalf = segments[0]!.trim();
      const pageNeedle = (segments[1] ?? "").trim().toLowerCase();
      if (noteHalf.length === 0) return out;
      const noteId = resolveNoteByName(world, noteHalf);
      if (noteId === null) return out;
      const noteGot = world.get(noteId, [Note]) as
        | { Note: { title: string } }
        | undefined;
      if (!noteGot) return out;
      for (const row of world.query([Page, BelongsToNote])) {
        const back = row.values.BelongsToNote as { noteId: EntityId };
        if (back.noteId !== noteId) continue;
        const p = row.values.Page as { title: string };
        if (pageNeedle.length > 0 && !p.title.toLowerCase().includes(pageNeedle)) {
          continue;
        }
        out.push({
          kind: "note",
          body: `${noteGot.Note.title}>${p.title}`,
          display: `${noteGot.Note.title} › ${p.title}`,
          badge: "Page",
        });
      }
      return out;
    }

    // ---- Level 2: `Note > Page >` typed — suggest headings ----
    if (depth === 2) {
      const noteHalf = segments[0]!.trim();
      const pageHalf = segments[1]!.trim();
      const headingNeedle = (segments[2] ?? "").trim().toLowerCase();
      if (noteHalf.length === 0 || pageHalf.length === 0) return out;
      const noteId = resolveNoteByName(world, noteHalf);
      if (noteId === null) return out;
      const pageId = resolvePageOfNote(world, noteId, pageHalf);
      if (pageId === null) return out;
      const noteGot = world.get(noteId, [Note]) as
        | { Note: { title: string } }
        | undefined;
      const pageGot = world.get(pageId, [Page]) as
        | { Page: { title: string } }
        | undefined;
      const h = world.get(pageId, [Headings]) as
        | { Headings: { items: Array<{ id: string; text: string }> } }
        | undefined;
      if (!noteGot || !pageGot || !h) return out;
      for (const item of h.Headings.items) {
        if (
          headingNeedle.length > 0 &&
          !item.text.toLowerCase().includes(headingNeedle)
        ) {
          continue;
        }
        out.push({
          kind: "note",
          body: `${noteGot.Note.title}>${pageGot.Page.title}>${item.text}`,
          display: `${noteGot.Note.title} › ${pageGot.Page.title} › ${item.text}`,
          badge: "Heading",
        });
      }
      return out;
    }

    return out;
  },
  indexEvents: [
    NoteCreated.name,
    NoteRenamed.name,
    NoteDeleted.name,
    PageAdded.name,
    PageRenamed.name,
    PageRemoved.name,
    PageBodySet.name,
  ],
});
