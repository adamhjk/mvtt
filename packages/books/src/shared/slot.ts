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
  defineSlot,
  type EntityId,
  type QualifiedName,
  QualifiedNameSchema,
  z,
} from "@vtt/substrate";

/**
 * Per-render arguments passed to a BookOverlayTab's `render`. The
 * `bookId` is whichever Book this dock is attached to — passed in
 * rather than re-resolved by every tab so the tab doesn't have to know
 * about which Book is currently active.
 */
export interface BookOverlayTabRenderArgs {
  readonly bookId: EntityId;
}

/**
 * One tab in the book's bottom dock. Plugins fill the slot to add
 * tabs alongside the built-in `Config` tab. Same permissive-on-
 * functions pattern as `@vtt/scene/overlay-tabs` (Zod can't usefully
 * validate a render function shape; the type below is the load-bearing
 * constraint at fill sites).
 */
export type BookOverlayTab = {
  /**
   * Plugin-namespaced id, e.g. `@vtt/books/dock/config`. Persisted as
   * `BooksUiState.dockActiveId` on the per-tab sentinel, so the active
   * tab survives tab-swap and reload.
   */
  id: QualifiedName;
  label: string;
  /**
   * Single character or short symbol shown next to the label in the
   * tab strip. Optional.
   */
  icon?: string;
  /**
   * Higher priority sorts to the left. Built-in Config uses 100;
   * external plugins should pick lower priorities so the built-in
   * stays anchored.
   */
  priority?: number;
  render: (args: BookOverlayTabRenderArgs) => unknown;
};

const BookOverlayTabSchema = z.object({
  id: QualifiedNameSchema,
  label: z.string().min(1),
  icon: z.string().optional(),
  priority: z.number().optional(),
  render: z.any(),
});

export const BookOverlayTabsSlot = defineSlot({
  name: "@vtt/books/overlay-tabs",
  schema: BookOverlayTabSchema,
  description:
    "Tabs that appear in the book's bottom dock. Built-ins: Config (rename + projection settings). Plugins fill this for distinct tabs (e.g. annotations, comments). Projection plugins that just need to add fields to Config should fill `BookConfigSectionsSlot` instead.",
});

/**
 * Per-render arguments for a BookConfigSection's `render`. Mirrors
 * BookOverlayTabRenderArgs — passed `bookId` so sections don't have
 * to re-resolve which book is active.
 */
export interface BookConfigSectionRenderArgs {
  readonly bookId: EntityId;
}

/**
 * One labeled section inside the built-in Config dock tab. Use this
 * (rather than `BookOverlayTabsSlot`) when a projection plugin needs
 * to add settings to the same Config tab the user already opens to
 * rename a book — keeps the UX matching scene's Config tab, which
 * houses *all* book-level settings (name, dimensions, background
 * upload) in one place rather than scattering them across tabs.
 *
 * The render function is responsible for its own labeled wrapper —
 * books's Config tab just stacks them in priority order without
 * imposing a heading.
 */
export type BookConfigSection = {
  id: QualifiedName;
  /**
   * Higher priority sorts toward the top. The built-in Name section
   * uses 100; external plugins should pick lower priorities so Name
   * stays anchored at the top.
   */
  priority?: number;
  render: (args: BookConfigSectionRenderArgs) => unknown;
};

const BookConfigSectionSchema = z.object({
  id: QualifiedNameSchema,
  priority: z.number().optional(),
  render: z.any(),
});

export const BookConfigSectionsSlot = defineSlot({
  name: "@vtt/books/config-sections",
  schema: BookConfigSectionSchema,
  description:
    "Sections that appear inside the book's Config dock tab, below the built-in Name field. Projection plugins fill this with their own settings (e.g. @vtt/pdf-book contributes a PDF upload section) so all per-book settings live in one tab — matching @vtt/scene's Config tab.",
});
