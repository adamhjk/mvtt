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

import { defineSlot, z, type Registry, type World } from "@vtt/substrate";

/**
 * One row in the schema-derived field table shown for a section.
 *
 * A reference section is typically generated from a Zod schema (see
 * `@vtt/adventures/shared` `schemaToFields`), but the type is open
 * enough that a hand-authored section (e.g. wiki-link syntax) can
 * also contribute rows.
 */
export interface ReferenceField {
  /** Dotted path: `nature.descriptors`, `weapon.attack`. */
  readonly path: string;
  /**
   * Short type description: `string`, `number`, `enum: a | b | c`,
   * `array<...>`, `wikilink:item`, `dice`, etc.
   */
  readonly type: string;
  /** Default value (stringified) if the schema provides one. */
  readonly default?: string;
  /** True for required (no default + not optional). */
  readonly required: boolean;
  /** Human-readable description (Zod `.describe()` minus internal brands). */
  readonly description?: string;
}

/**
 * One section in the note-editor's syntax reference panel.
 *
 * Each section is self-contained: a title, a one-line summary, an
 * optional copy-pasteable example, and an optional field table.
 *
 * Sections are grouped under a `group` heading in the panel — a plugin
 * may contribute multiple sections under the same group (e.g. one per
 * block kind). Sections within a group are sorted by `order` then by
 * `title`.
 */
export interface ReferenceSection {
  /** Stable id — used for keying React/Solid lists. */
  readonly id: string;
  /** Group heading shown above this section, e.g. "Fenced blocks". */
  readonly group: string;
  /** Section heading, e.g. "item", "character", "wiki-links". */
  readonly title: string;
  /**
   * One-line summary shown directly under the title.
   * Markdown-free plain text.
   */
  readonly summary?: string;
  /**
   * Multi-line example the GM can copy. Rendered in a `<pre>` block
   * with a copy button; clicking the example pastes it at the cursor
   * in the editor.
   */
  readonly example?: string;
  /**
   * Field table — typically derived from a Zod schema. Empty/absent
   * for sections that document syntax without a flat field list (e.g.
   * wiki-links).
   */
  readonly fields?: ReadonlyArray<ReferenceField>;
  /**
   * Sort key within a group. Lower comes first. Defaults to 0; ties
   * break by `title`.
   */
  readonly order?: number;
}

export interface ReferenceProvider {
  /** Stable name — for telemetry / debugging. */
  readonly name: string;
  /**
   * Build the reference sections for the current world. Called at most
   * once per editor open (cached for the session of the open panel).
   *
   * `world` and `registry` let providers walk the live registry to
   * discover what's loaded (e.g. adventures enumerates the
   * `BlockKindsSlot` fills; notes enumerates `LinkKindsSlot` fills).
   */
  readonly build: (ctx: ReferenceProviderContext) => ReadonlyArray<ReferenceSection>;
}

export interface ReferenceProviderContext {
  readonly world: World;
  readonly registry: Registry;
}

/**
 * Plugins fill `NotesReferenceSlot` with a `ReferenceProvider`. The
 * note editor's "Reference" side panel reads every fill, builds every
 * section, sorts them by `(group, order, title)`, and renders the
 * result as a scannable cheatsheet.
 *
 * This is intentionally minimal: a section is just title + optional
 * example + optional field table. The point of the slot is to let
 * each plugin own the documentation for the syntax it contributes —
 * fenced block kinds, wiki-link kinds, future markdown extensions —
 * without the editor having to know any of it up front.
 */
export const NotesReferenceSlot = defineSlot({
  name: "@vtt/notes/reference-providers",
  schema: z.object({
    name: z.string().min(1),
    build: z.any(),
  }),
  description:
    "Plugins contribute reference sections (group + title + example + field table) shown in the note editor's side panel. Each provider is asked to enumerate its sections at panel-open time.",
});
