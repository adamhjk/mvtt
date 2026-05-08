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

// Parse a free-text relic-slot annotation (as printed in the rulebook
// inside square brackets — e.g. "worn/head or pack 1", "carried 1,
// belt 1; wielded 1", "pocket") into a `TbItemSlotOptions.options`
// record so the spawned relic item can be placed in the same slots as
// any other catalog item. Tolerant of every variant the catalog uses
// (commas, semicolons, "or", "worn/", "hand/", parentheticals).
//
// Unknown tokens are skipped — e.g. "raiment" maps to torso, "tattoo"
// is dropped (a tattoo doesn't consume a body slot), "inventory as
// weapon" maps to carried.

const SLOT_ALIAS: Record<string, string> = {
  head: "head",
  neck: "neck",
  torso: "torso",
  belt: "belt",
  feet: "feet",
  pocket: "pocket",
  carried: "carried",
  pack: "pack",
  pouch: "pouch",
  quiver: "quiver",
  hands: "hands",
  wornhand: "wornHand",
  // Rulebook-only synonyms:
  raiment: "torso", // worn clothing — torso slot
  wielded: "carried", // a wielded weapon takes a carried slot
  weapon: "carried", // "inventory as weapon" → carried
  inventory: "carried", // ditto
};

/**
 * Parse the printed slot annotation into a `TbItemSlotOptions.options`
 * record. Returns an empty object when the text doesn't map to any
 * real slot; the caller should fall back to a default placement.
 */
export function parseRelicSlotOptions(text: string): Record<string, number> {
  if (!text) return {};
  const out: Record<string, number> = {};
  // Split on "or", commas, and semicolons. Strip parentheticals and
  // the "worn/" / "hand/" prefixes that are display-only.
  const tokens = text
    .split(/(?:\s*(?:,|;|\bor\b)\s*)+/i)
    .map((t) =>
      t
        .toLowerCase()
        .replace(/\([^)]*\)/g, "")
        .replace(/^worn\//, "")
        .replace(/^hand\//, "")
        .replace(/^worn\b/, "")
        .trim(),
    )
    .filter((t) => t.length > 0);
  for (const token of tokens) {
    // Pull the first word as the slot name and the first numeric run
    // (anywhere in the token) as the count. This handles compact
    // forms ("torso 2"), bare names ("pocket"), and the rulebook's
    // multi-word phrasings ("inventory as weapon" → carried).
    const nameMatch = token.match(/^([a-z]+)/);
    if (!nameMatch) continue;
    const countMatch = token.match(/(\d+)/);
    const name = nameMatch[1]!;
    const count = countMatch ? parseInt(countMatch[1]!, 10) : 1;
    const canonical = SLOT_ALIAS[name];
    if (!canonical) continue;
    // Multiple mentions (e.g. "torso 1, torso 2") collapse to the
    // larger requirement so we never under-allocate.
    out[canonical] = Math.max(out[canonical] ?? 0, count);
  }
  return out;
}
