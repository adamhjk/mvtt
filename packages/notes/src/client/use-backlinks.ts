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

import { createMemo, type Accessor } from "solid-js";
import { useQuery } from "@vtt/substrate/client";
import { Page, BelongsToNote, Note, parseLinks, type WikiLinkRef } from "../shared/index.js";
import type { EntityId } from "@vtt/substrate";

export interface BacklinkEntry {
  /** The page that contains the link. */
  readonly sourcePageId: EntityId;
  /** Display name for that page (its `Page.title`). */
  readonly sourcePageTitle: string;
  /** Display name of the page's parent note. */
  readonly sourceNoteTitle: string;
  /** The wiki-link ref pointing at the target. */
  readonly ref: WikiLinkRef;
}

/**
 * Compute "what links here" for a target referenced as `[[kind:body]]`.
 *
 * Walks every visible NotePage's body, parses out wiki-links, filters
 * to those whose `kind === target.kind` and `body === target.body`.
 * Naturally visibility-filtered: the substrate's snapshot filter only
 * delivers pages the recipient is allowed to see, so the inverted
 * index here is implicitly per-recipient.
 *
 * v1 doesn't yet resolve typed-by-title bodies — a link `[[Goblin
 * Cave]]` (body = "Goblin Cave") and a normalised storage form
 * `[[note:e42|Goblin Cave]]` (body = "e42") are different inputs to
 * the matcher. The note kind's `parse(body, …)` function resolves both
 * to the same noteId at render time; this memo accepts either form via
 * the optional `noteId` field that overrides body matching when set.
 */
export function useBacklinks(target: {
  kind: string;
  body?: string;
  /** Override `body` — match any link whose resolved noteId matches. */
  noteId?: EntityId;
}): Accessor<BacklinkEntry[]> {
  const pages = useQuery([Page, BelongsToNote]);
  const notes = useQuery([Note]);

  return createMemo(() => {
    const noteTitleById = new Map<EntityId, string>();
    for (const r of notes()) {
      noteTitleById.set(r.id, (r.values.Note as { title: string }).title);
    }

    const out: BacklinkEntry[] = [];
    for (const row of pages()) {
      const page = row.values.Page as { title: string; body: string };
      if (!page.body) continue;
      const refs = parseLinks(page.body);
      for (const ref of refs) {
        if (ref.kind !== target.kind) continue;
        if (target.noteId !== undefined) {
          // Match by id either via direct body OR via title-resolution
          // happening higher up. v1 just compares bodies; bodies are
          // typically the entity id post-normalisation.
          if (ref.body !== target.noteId && ref.body !== target.body) continue;
        } else if (target.body !== undefined && ref.body !== target.body) {
          continue;
        }
        const back = row.values.BelongsToNote as { noteId: EntityId };
        out.push({
          sourcePageId: row.id,
          sourcePageTitle: page.title,
          sourceNoteTitle: noteTitleById.get(back.noteId) ?? "(unknown note)",
          ref,
        });
      }
    }
    return out;
  });
}
