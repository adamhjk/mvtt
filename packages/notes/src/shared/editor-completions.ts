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
 * Plugins fill `EditorCompletionSourcesSlot` with CodeMirror autocomplete
 * sources for the notes editor. Adventures uses this to provide
 * schema-driven completion inside fenced YAML blocks.
 *
 * Each fill carries a factory that takes a context (world + registry +
 * worldId) and returns a CodeMirror `CompletionSource`-compatible
 * function. Notes' editor builds the source list at editor-create
 * time and includes them in the `autocompletion({ override })` array
 * alongside the built-in `wikiCompletions` and `setdesignCompletions`.
 */
export interface EditorCompletionSourceFactory {
  readonly name: string;
  /**
   * Build a CodeMirror autocomplete source. The result must be
   * assignable to CodeMirror's `CompletionSource` type — typed as
   * `unknown` here so this shared module doesn't take a hard
   * dependency on `@codemirror/autocomplete`.
   */
  readonly build: (ctx: EditorCompletionContext) => unknown;
}

export interface EditorCompletionContext {
  readonly world: World;
  readonly registry: Registry;
  readonly worldId: string;
}

export const EditorCompletionSourcesSlot = defineSlot({
  name: "@vtt/notes/editor-completion-sources",
  schema: z.object({
    name: z.string().min(1),
    build: z.any(),
  }),
  description:
    "Plugins contribute additional CodeMirror autocomplete sources for the notes editor (e.g. schema-driven completion inside fenced YAML blocks). Notes builds the source list at editor-create time and adds them to autocompletion({ override }).",
});
