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

import { z } from "@vtt/substrate";

/**
 * Marker key embedded in a Zod schema's `description` field via JSON.
 * The autocomplete provider walks the schema tree, parses any
 * description matching this shape, and treats the leaf as a
 * special-purpose slot (wiki-link target, dice expression).
 *
 * Top-level helpers — never extend the Zod prototype, which would
 * couple us to a specific Zod version.
 */
const ADVENTURES_BRAND_PREFIX = "@vtt/adventures/brand:";

/**
 * Mark a string slot as a wiki-link to the given kind. The
 * autocomplete provider sees the marker and switches its completion
 * source to live entities of that kind (filtered by visibility).
 *
 * @example
 *   const ItemRef = wikiLink("item");
 *   const NpcSchema = z.object({
 *     carries: z.array(ItemRef),
 *   });
 */
export function wikiLink<K extends string>(
  kind: K,
): z.ZodString {
  const meta = JSON.stringify({ wikiLink: kind });
  return z.string().describe(`${ADVENTURES_BRAND_PREFIX}${meta}`);
}

/**
 * Mark a string slot as a dice expression (e.g. `2d6+1`, `1d6 < 4`).
 * The autocomplete provider offers static suggestions and lints
 * partial expressions.
 */
export function dice(): z.ZodString {
  const meta = JSON.stringify({ dice: true });
  return z.string().describe(`${ADVENTURES_BRAND_PREFIX}${meta}`);
}

/**
 * Read brand metadata back out of a schema node, if any.
 * Returns null for un-branded schemas; otherwise returns the parsed
 * marker object.
 */
export function readBrand(
  schema: z.ZodTypeAny,
): { wikiLink?: string; dice?: boolean } | null {
  const desc = schema.description;
  if (typeof desc !== "string") return null;
  if (!desc.startsWith(ADVENTURES_BRAND_PREFIX)) return null;
  try {
    return JSON.parse(desc.slice(ADVENTURES_BRAND_PREFIX.length)) as {
      wikiLink?: string;
      dice?: boolean;
    };
  } catch {
    return null;
  }
}
