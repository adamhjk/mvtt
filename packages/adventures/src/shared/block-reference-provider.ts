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
import { buildBlockKindIndex } from "./block-kinds.js";
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

/** Slot fill exported for plugin registration. */
export const blockReferenceProvider: ReferenceProvider = {
  name: "adventures-block-kinds",
  build: (ctx) => buildBlockReferenceSections(ctx),
};
