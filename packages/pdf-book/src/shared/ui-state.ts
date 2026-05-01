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
 * Per-tab reader state for the PDF viewer. Lives on the workbench's
 * per-tab sentinel entity (one per open tab); plugins look up the
 * sentinel via `useTabSentinel(tabId)` from
 * `@vtt/shell-workbench/client` and bind this trait through
 * `createOptimisticTrait`.
 *
 * Replaces the previous `sessionStorage` shim. Lives in the world
 * trait spine instead, so:
 *   - the user's spot in the PDF survives reloads (sessionStorage
 *     was per-window only),
 *   - replicates to their other connections, and
 *   - the persistence story is uniform with every other plugin.
 *
 * Field semantics match the prior `PersistedReaderState`:
 *   - `page`: 1-based page number; clamped to [1, doc.numPages] on
 *     restore.
 *   - `scale`: `PDFViewer.currentScaleValue` — preset (`"page-width"`,
 *     `"page-fit"`, `"auto"`) or stringified numeric.
 *   - `scrollTop`: pixel offset within the scrollable container, used
 *     to restore mid-page positioning under the same scale.
 *   - `query`: the find query — re-issued at restore so the highlight
 *     overlay reappears.
 *   - `outlineOpen`: whether the outline (TOC) sidebar is visible.
 */
export const PdfReaderState = defineTrait({
  name: "@vtt/pdf-book/ReaderState",
  schema: z
    .object({
      page: z.number().int().min(1).default(1),
      scale: z.string().default("page-width"),
      scrollTop: z.number().default(0),
      query: z.string().default(""),
      outlineOpen: z.boolean().default(false),
    })
    .default({
      page: 1,
      scale: "page-width",
      scrollTop: 0,
      query: "",
      outlineOpen: false,
    }),
  // Strip scrollTop when the value is packaged into a share snapshot.
  // scrollTop is a pixel offset into the viewer's scroll container, and
  // at "page-width" scale that meaning depends on the recipient's window
  // size — replaying the sender's offset on a smaller container lands
  // them N pages earlier than intended (the live bug: GM at page 119
  // shares, recipient lands on 106). The recipient's restore code skips
  // scrollTop when it's zero, so the rAF mid-page-position restore is
  // self-bypassed and the page-number restore wins cleanly.
  shareValue: (value) => ({ ...value, scrollTop: 0 }),
});

export const PdfReaderStateChanged = defineEvent({
  name: "@vtt/pdf-book/ReaderStateChanged",
  schema: z.object({
    entityId: EntityId,
    value: z.object({
      page: z.number().int().min(1),
      scale: z.string(),
      scrollTop: z.number(),
      query: z.string(),
      outlineOpen: z.boolean(),
    }),
  }),
  transient: true,
  broadcast: true,
});

export const SetPdfReaderState = defineCommand({
  name: "@vtt/pdf-book/SetReaderState",
  schema: z.object({
    entityId: EntityId,
    value: z.object({
      page: z.number().int().min(1),
      scale: z.string(),
      scrollTop: z.number(),
      query: z.string(),
      outlineOpen: z.boolean(),
    }),
  }),
  validate: () => ok(),
  apply: ({ cmd }) => [
    PdfReaderStateChanged({ entityId: cmd.entityId, value: cmd.value }),
  ],
});

export const PdfReaderStateMirror = defineSystem({
  name: "PdfReaderStateMirror",
  on: PdfReaderStateChanged,
  reads: [],
  writes: [PdfReaderState],
  run: ({ event, world }) => {
    if (!world.has(event.entityId)) return [];
    world.set(event.entityId, PdfReaderState, event.value);
    return [];
  },
});
