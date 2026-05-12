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

import type {
  ReferenceField,
  ReferenceProvider,
  ReferenceProviderContext,
  ReferenceSection,
} from "@vtt/notes/shared";
import { buildBlockKindIndex, type AnyBlockKindDef } from "./block-kinds.js";
import { schemaToFields } from "./schema-to-fields.js";

/**
 * Build the example YAML body for a block kind. Uses the kind's
 * `snippet()` output (already authored as a readable starter body)
 * stripped of CodeMirror's `${1:placeholder}` tab-stop markers.
 */
function snippetToExample(snippet: string | undefined): string | undefined {
  if (!snippet) return undefined;
  // CodeMirror snippet placeholders: `${N:default}`, `${N|choices|}`,
  // `${N}`, `${0}` (final stop). We replace each with the default text
  // when present, otherwise the choice list's first option, otherwise
  // a generic ellipsis.
  return snippet
    .replace(/\$\{\d+\|([^|]+)\|[^}]*\}/g, (_m, choices: string) =>
      String(choices).split(",")[0] ?? "",
    )
    .replace(/\$\{\d+:([^}]+)\}/g, (_m, dflt: string) => String(dflt))
    .replace(/\$\{\d+\}/g, "")
    .replace(/\\}/g, "}")
    .replace(/\\\$/g, "$");
}

/**
 * Build one `ReferenceSection` per registered fenced-block kind.
 * Group heading is "Fenced blocks". The section's example is the
 * kind's `snippet()` (the same starter body the editor offers); the
 * field table is the kind's Zod schema flattened by `schemaToFields`.
 *
 * The output is the GM's cheatsheet for the YAML surface — every
 * available key, its type, its default. Whatever game-system plugin
 * is loaded, that's what shows up here.
 */
export function buildBlockReferenceSections(
  ctx: ReferenceProviderContext,
): ReferenceSection[] {
  const idx = buildBlockKindIndex(ctx.registry);
  const sections: ReferenceSection[] = [];
  // Deterministic order — sort by kind name so the cheatsheet doesn't
  // shuffle between renders.
  const sorted = [...idx.all].sort((a, b) => a.name.localeCompare(b.name));
  for (const kind of sorted) {
    const example = (() => {
      try {
        const raw = kind.snippet?.();
        const body = snippetToExample(raw);
        if (!body) return undefined;
        // Render the example as a complete fenced block — copying it
        // into the editor produces a valid starting point.
        return "```" + kind.name + " example\n" + body + "\n```";
      } catch {
        return undefined;
      }
    })();
    let fields: ReferenceField[];
    try {
      fields = schemaToFields(kind.schema);
      fields = enrichWithDynamicCompletions(fields, kind, ctx);
    } catch {
      fields = [];
    }
    sections.push({
      id: `block:${kind.name}`,
      group: "Fenced blocks",
      title: kind.name,
      ...(kind.description ? { summary: kind.description } : {}),
      ...(example ? { example } : {}),
      ...(fields.length > 0 ? { fields } : {}),
    });
  }
  return sections;
}

/**
 * Walk each `ReferenceField` and ask the kind's `complete()` what
 * concrete values are valid at that path. When the kind returns a
 * non-empty list, append a one-line "values: a | b | c" hint to the
 * field's description so the GM sees the dynamic vocabulary the
 * schema can't express on its own (TB body slots, skill ids, etc.).
 *
 * Path mapping: the reference walker uses `[]` for array elements and
 * `<key>` for record keys; the kind's `complete()` expects the
 * autocomplete shape (`*` for array elements, the record's parent
 * path for record-key suggestions). We adapt both forms here so kinds
 * can keep their existing contract with the autocomplete provider.
 */
function enrichWithDynamicCompletions(
  fields: ReferenceField[],
  kind: AnyBlockKindDef,
  ctx: ReferenceProviderContext,
): ReferenceField[] {
  if (!kind.complete) return fields;
  return fields.map((f) => {
    const segments = f.path.split(".");
    // Two call paths to try:
    //   - The field IS a record (path ends with `<key>` placeholder).
    //     Drop the placeholder and ask the parent path for valid keys.
    //   - The field IS a value leaf (no `<key>` suffix). Ask the
    //     completer directly with the path's `[]` markers swapped to
    //     `*`.
    const valuePath = segments
      .filter((s) => s !== "<key>")
      .map((s) => (s === "[]" ? "*" : s));
    let suggestions: ReadonlyArray<{ value: string; detail?: string }> = [];
    try {
      suggestions = kind.complete!(valuePath, {
        world: ctx.world,
        registry: ctx.registry,
      });
    } catch {
      suggestions = [];
    }
    if (suggestions.length === 0) return f;
    const labels = suggestions
      .map((s) => (s.detail ? `${s.value} (${s.detail})` : s.value))
      .join(" | ");
    const next = `values: ${labels}`;
    const description =
      f.description && f.description.length > 0
        ? `${f.description} — ${next}`
        : next;
    return { ...f, description };
  });
}

/** Slot fill exported for plugin registration. */
export const blockReferenceProvider: ReferenceProvider = {
  name: "adventures-block-kinds",
  build: (ctx) => buildBlockReferenceSections(ctx),
};
