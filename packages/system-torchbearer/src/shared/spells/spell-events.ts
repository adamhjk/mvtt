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

import { defineEvent, EntityId, z } from "@vtt/substrate";

/* -------------------------------------------------------------------------
 * Library mutations
 * ----------------------------------------------------------------------- */

export const SpellAddedToLibrary = defineEvent({
  name: "@vtt/system-torchbearer/SpellAddedToLibrary",
  schema: z.object({
    characterId: EntityId,
    spellId: EntityId,
  }),
});

export const SpellRemovedFromLibrary = defineEvent({
  name: "@vtt/system-torchbearer/SpellRemovedFromLibrary",
  schema: z.object({
    characterId: EntityId,
    spellId: EntityId,
  }),
});

export const LibraryLocationSet = defineEvent({
  name: "@vtt/system-torchbearer/LibraryLocationSet",
  schema: z.object({
    characterId: EntityId,
    location: z.enum(["home", "loner"]),
    lonerLocation: z.string().max(240),
  }),
});

/* -------------------------------------------------------------------------
 * Spell book mutations
 * ----------------------------------------------------------------------- */

export const SpellAddedToBook = defineEvent({
  name: "@vtt/system-torchbearer/SpellAddedToBook",
  schema: z.object({
    bookId: EntityId,
    spellId: EntityId,
  }),
});

export const SpellRemovedFromBook = defineEvent({
  name: "@vtt/system-torchbearer/SpellRemovedFromBook",
  schema: z.object({
    bookId: EntityId,
    spellId: EntityId,
  }),
});

/* -------------------------------------------------------------------------
 * Scroll mutations
 * ----------------------------------------------------------------------- */

export const ScrollSpawned = defineEvent({
  name: "@vtt/system-torchbearer/ScrollSpawned",
  schema: z.object({
    scrollId: EntityId,
    /** Spell scribed onto the scroll, or null for a blank scroll. */
    spellId: EntityId.nullable(),
    /** Holder of the scroll at spawn time, or null for floor / void spawn. */
    holderId: EntityId.nullable(),
  }),
});

export const ScrollConsumed = defineEvent({
  name: "@vtt/system-torchbearer/ScrollConsumed",
  schema: z.object({
    scrollId: EntityId,
  }),
});

/**
 * A blank scroll has had a spell scribed onto it (DH p.95). The
 * universal-mirror system stamps `TbScroll.spellId`. When the source
 * was the magician's memory palace, a paired
 * `MemoryPalaceSpellMarkedCast` event removes the spell from the
 * palace (RAW p.90 — scribing is one of the three ways to remove a
 * spell from the palace).
 */
export const ScrollScribed = defineEvent({
  name: "@vtt/system-torchbearer/ScrollScribed",
  schema: z.object({
    scrollId: EntityId,
    spellId: EntityId,
    /** "library" | "palace" — recorded for audit / chat. */
    fromSource: z.enum(["library", "palace"]),
    characterId: EntityId,
  }),
});

/* -------------------------------------------------------------------------
 * Memory palace mutations
 * ----------------------------------------------------------------------- */

export const MemoryPalaceFilled = defineEvent({
  name: "@vtt/system-torchbearer/MemoryPalaceFilled",
  schema: z.object({
    characterId: EntityId,
    picks: z
      .array(
        z.object({
          spellId: EntityId,
          slotsConsumed: z.number().int().min(1).max(5),
        }),
      )
      .min(1),
  }),
});

export const MemoryPalaceCleared = defineEvent({
  name: "@vtt/system-torchbearer/MemoryPalaceCleared",
  schema: z.object({
    characterId: EntityId,
  }),
});

export const MemoryPalaceCapacityChanged = defineEvent({
  name: "@vtt/system-torchbearer/MemoryPalaceCapacityChanged",
  schema: z.object({
    characterId: EntityId,
    capacity: z.number().int().min(0).max(20),
  }),
});

export const MemoryPalaceSpellMarkedCast = defineEvent({
  name: "@vtt/system-torchbearer/MemoryPalaceSpellMarkedCast",
  schema: z.object({
    characterId: EntityId,
    spellId: EntityId,
  }),
});

/* -------------------------------------------------------------------------
 * Cast lifecycle — paired with TbRollMeta.spellCast on the roll
 * ----------------------------------------------------------------------- */

export const SpellCastInitiated = defineEvent({
  name: "@vtt/system-torchbearer/SpellCastInitiated",
  schema: z.object({
    characterId: EntityId,
    spellId: EntityId,
    sourceKind: z.enum(["palace", "spellbook", "scroll"]),
    bookId: EntityId.optional(),
    scrollId: EntityId.optional(),
    /** Assigned roll id (= the Roll entity allocated by the request). */
    rollId: EntityId.optional(),
  }),
});

export const SpellCastConsumeLogged = defineEvent({
  name: "@vtt/system-torchbearer/SpellCastConsumeLogged",
  schema: z.object({
    rollId: EntityId,
    characterId: EntityId,
    spellId: EntityId,
    sourceKind: z.enum(["palace", "spellbook", "scroll"]),
    bookId: EntityId.optional(),
    scrollId: EntityId.optional(),
    consumedAt: z.number(),
  }),
});

/* -------------------------------------------------------------------------
 * Catalog provenance — fork-on-customize, parallels ItemForked
 * ----------------------------------------------------------------------- */

export const SpellForked = defineEvent({
  name: "@vtt/system-torchbearer/SpellForked",
  schema: z.object({
    sourceSpellId: EntityId,
    newSpellId: EntityId,
  }),
});

/* -------------------------------------------------------------------------
 * Catalog management — homebrew spell create / remove / edit
 * ----------------------------------------------------------------------- */

/**
 * A new catalog spell entity has been created (CreateBlankSpell).
 * Spells are catalog records, not world-spawned actors — this event
 * adds an entry to the catalog. The universal-mirror system stamps
 * SpellIdentity + TbSpellCasting + TbSpellLearning + TbSpellHomebrewProse
 * with sensible defaults.
 */
export const SpellCreated = defineEvent({
  name: "@vtt/system-torchbearer/SpellCreated",
  schema: z.object({
    spellId: EntityId,
    name: z.string().min(1).max(120),
  }),
});

/**
 * A spell entity has been despawned (RemoveSpell).
 */
export const SpellRemoved = defineEvent({
  name: "@vtt/system-torchbearer/SpellRemoved",
  schema: z.object({
    spellId: EntityId,
  }),
});

/**
 * A field on a spell entity has been edited via the Arcane page's
 * detail editor. The universal-mirror system applies a deep-set
 * inside the named trait.
 */
export const SpellFieldEdited = defineEvent({
  name: "@vtt/system-torchbearer/SpellFieldEdited",
  schema: z.object({
    spellId: EntityId,
    trait: z.enum(["SpellIdentity", "TbSpellCasting", "TbSpellLearning", "TbSpellHomebrewProse"]),
    path: z.array(z.string().min(1).max(60)),
    value: z.unknown(),
  }),
});
