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
} from "./editor-reference.js";
import { buildLinkKindIndex } from "./link-kinds.js";

/**
 * The notes-plugin's own contributions to the editor reference panel:
 *
 *   - Wiki-link syntax — the [[kind:body|alias]] grammar and its
 *     shortcuts. Hand-authored because the syntax isn't expressible
 *     as a Zod schema.
 *   - Registered link kinds — discovered from `LinkKindsSlot` at
 *     panel-open time, so every plugin that registers a link kind
 *     gets a row for free.
 *
 * Set-design fenced blocks have their own (small) syntax; if/when
 * `@vtt/notes` wants to document them here, this is the place.
 */
export function buildNotesReferenceSections(ctx: ReferenceProviderContext): ReferenceSection[] {
  const out: ReferenceSection[] = [];

  out.push({
    id: "notes:wiki-link-syntax",
    group: "Wiki links",
    order: 0,
    title: "syntax",
    summary:
      "Cross-reference any kind of entity from inside a note's prose. The body resolves to a live entity; the chip renders the display name.",
    example:
      "Plain link:           [[note title]]\n" +
      "Kind-prefixed:        [[character:Greta]]\n" +
      "Sigil shorthand:      [[@Greta]]            (where '@' is the character kind's sigil)\n" +
      "Note > page:          [[note title > Page Title]]\n" +
      "Note > page > anchor: [[note title > Page Title > heading id]]\n" +
      "Alias:                [[character:Greta|the smith]]\n" +
      "Asset embed:          ![[asset:abc123]]    (renders the image inline)\n" +
      "Note embed:           ![[character:Greta]] (renders the full chip widget inline)",
  });

  // The two forms a carries-style entry can take inside a fenced
  // YAML block. The adventures parser pre-escapes `[[…]]` literals
  // so authors write them bare — no quoting required, even though
  // YAML normally treats `[` as a flow-sequence start.
  out.push({
    id: "notes:yaml-wikilink-usage",
    group: "Wiki links",
    order: 2,
    title: "inside fenced YAML",
    summary:
      "Inside a fenced YAML block, wiki-links work bare — the parser pre-escapes [[…]] so you don't need to quote them.",
    example:
      "# Simple form — just the wiki-link:\n" +
      "carries:\n" +
      "  - [[item:hammer]]\n" +
      "  - [[item:chain shirt]]\n" +
      "\n" +
      "# Object form — pin to a slot and/or set quantity:\n" +
      "carries:\n" +
      "  - item: [[item:hammer]]\n" +
      "    slot: handR\n" +
      "  - item: [[item:traveling ration]]\n" +
      "    quantity: 2\n" +
      "\n" +
      "# Body slots: head, neck, handR, handL, torso, belt, feet,\n" +
      "#             pocket — plus loose:N for unequipped items.",
  });

  // Walk the LinkKindsSlot — one row per registered kind. Drives off
  // the live registry so the table grows with every loaded plugin.
  const linkIdx = buildLinkKindIndex(ctx.registry);
  const fields: ReferenceField[] = [];
  const sorted = [...linkIdx.all].sort((a, b) => a.name.localeCompare(b.name));
  for (const kind of sorted) {
    const sigilPart = kind.sigil ? ` · sigil \`${kind.sigil}\`` : "";
    fields.push({
      path: kind.name,
      type: `[[${kind.name}:…]]${sigilPart}`,
      required: false,
      description: linkKindDescription(kind.name),
    });
  }
  out.push({
    id: "notes:link-kinds",
    group: "Wiki links",
    order: 1,
    title: "registered kinds",
    summary:
      "Every kind currently registered by a loaded plugin. The body after the colon is resolved by that plugin's link-kind definition.",
    fields,
  });

  return out;
}

/**
 * One-line summary for each well-known link kind. Returning undefined
 * is fine — the row just renders without a description, and unknown
 * (e.g. plugin-registered) kinds simply skip the column.
 */
function linkKindDescription(name: string): string | undefined {
  switch (name) {
    case "note":
      return "Link to a note, page, or heading. Without a kind prefix this is the default.";
    case "character":
      return "Link to a character, NPC, or monster entity. Renders the sheet widget on click.";
    case "item":
      return "Link to a catalog item. Embeds (![[item:…]]) render the item card.";
    case "spell":
      return "Link to a spell catalog entry.";
    case "scene":
      return "Link to a scene. Clicking opens the scene tab.";
    case "asset":
      return "Link to an uploaded asset. Use ![[asset:…]] to embed images inline.";
    case "encounter":
      return "Link to an encounter template. Peek shows the recipe + Start encounter button.";
    default:
      return undefined;
  }
}

/** Slot fill exported for plugin registration. */
export const notesReferenceProvider: ReferenceProvider = {
  name: "notes-built-in",
  build: (ctx) => buildNotesReferenceSections(ctx),
};
