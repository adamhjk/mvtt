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

import { defineTrait, EntityId, z } from "@vtt/substrate";

/* -------------------------------------------------------------------------
 * Schools, casting kinds, page references
 * ----------------------------------------------------------------------- */

export const SPELL_SCHOOLS = [
  "Abjuration",
  "Conjuration",
  "Divination",
  "Enchantment",
  "Evocation",
  "Illusion",
  "Necromancy",
  "Transmutation",
  "Other",
] as const;

export const SpellSchoolSchema = z.enum(SPELL_SCHOOLS);
export type SpellSchool = z.infer<typeof SpellSchoolSchema>;

export const SpellCircleSchema = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
  .default(1);
export type SpellCircle = z.infer<typeof SpellCircleSchema>;

export const SpellCastingKindSchema = z.enum(["fixed", "factors", "versus"]);
export type SpellCastingKind = z.infer<typeof SpellCastingKindSchema>;

export const SpellCastingTimeSchema = z.enum([
  "free",
  "action",
  "one-turn",
  "multi-turn",
]);

const PageRefSchema = z
  .object({
    canonicalId: z.string().min(1).max(120),
    page: z.number().int().min(1).max(2000),
  })
  .nullable();

/* -------------------------------------------------------------------------
 * SpellIdentity — name / circle / school / page reference
 * ----------------------------------------------------------------------- */

/**
 * Identity of a spell catalog entity. Mirrors `ItemIdentity` in spirit.
 * The name is the canonical printed name; circle (1–5) sets folio /
 * memory-palace slot consumption (DH p.90, p.92); school is a
 * descriptive bucket the picker groups by.
 *
 * `pageRef` deep-links to the rulebook for the full effect prose. Canon
 * spells set this; homebrew spells leave it null and rely on
 * `TbSpellHomebrewProse` for inline text.
 */
export const SpellIdentity = defineTrait({
  name: "@vtt/system-torchbearer/SpellIdentity",
  schema: z
    .object({
      name: z.string().min(1).max(120).default(""),
      circle: SpellCircleSchema,
      school: SpellSchoolSchema.default("Other"),
      pageRef: PageRefSchema.default(null),
    })
    .default({ name: "", circle: 1, school: "Other", pageRef: null }),
});

/* -------------------------------------------------------------------------
 * TbSpellCasting — at-the-table casting parameters
 * ----------------------------------------------------------------------- */

/**
 * Everything a player needs to actually cast the spell without
 * flipping to the rulebook. The full effect prose stays in the
 * book — `pageRef` on `SpellIdentity` carries the deep-link.
 *
 * `kind` chooses the obstacle resolution path:
 *   - `"fixed"`   — `fixedOb` is the Arcanist obstacle (e.g. Wayfinder's Friend Ob 2)
 *   - `"factors"` — leave Ob open; the GM/player set it from the spell's factor table
 *   - `"versus"`  — opens a versus-test pairing against `versusSkill` on the target
 *
 * `materials` and `focus` are short free-text labels; an empty string
 * means "this spell has no materials / no focus." When set, they
 * surface as toggleable +1D contributions in the pending-roll panel
 * (DH p.94: "Materials grant +1D and are consumed; a Focus grants +1D
 * and can be reused.").
 */
export const TbSpellCasting = defineTrait({
  name: "@vtt/system-torchbearer/TbSpellCasting",
  schema: z
    .object({
      kind: SpellCastingKindSchema.default("fixed"),
      fixedOb: z.number().int().min(0).max(10).nullable().default(null),
      versusSkill: z.string().max(40).nullable().default(null),
      castingTime: SpellCastingTimeSchema.default("action"),
      duration: z.string().max(120).default(""),
      materials: z.string().max(240).default(""),
      focus: z.string().max(240).default(""),
    })
    .default({
      kind: "fixed",
      fixedOb: null,
      versusSkill: null,
      castingTime: "action",
      duration: "",
      materials: "",
      focus: "",
    }),
});

/* -------------------------------------------------------------------------
 * TbSpellLearning — Scribe / Learn obstacles
 * ----------------------------------------------------------------------- */

/**
 * Scholar Ob to scribe the spell into a spell book or scroll, and
 * Lore Master Ob to learn it from a written source. RAW DH p.96.
 */
export const TbSpellLearning = defineTrait({
  name: "@vtt/system-torchbearer/TbSpellLearning",
  schema: z
    .object({
      scribeOb: z.number().int().min(0).max(10).default(2),
      learnOb: z.number().int().min(0).max(10).default(2),
    })
    .default({ scribeOb: 2, learnOb: 2 }),
});

/* -------------------------------------------------------------------------
 * TbSpellHomebrewProse — inline effect text on homebrew spells
 * ----------------------------------------------------------------------- */

/**
 * Free-text effect + casting prose for homebrew spells. Canon spells
 * leave this trait absent and rely on `SpellIdentity.pageRef` for the
 * rulebook deep-link.
 */
export const TbSpellHomebrewProse = defineTrait({
  name: "@vtt/system-torchbearer/TbSpellHomebrewProse",
  schema: z
    .object({
      effect: z.string().max(4000).default(""),
      casting: z.string().max(4000).default(""),
    })
    .default({ effect: "", casting: "" }),
});

/* -------------------------------------------------------------------------
 * SpellDerivedFrom — catalog provenance, parallel to ItemDerivedFrom
 * ----------------------------------------------------------------------- */

/**
 * Records that a spell entity originated from a catalog template.
 * Carried by canonical seeds and survives forks via `CustomizeSpell`
 * (the fork emits a fresh entity referencing the same template plus
 * the per-field overrides the GM has applied). Mirrors
 * `@vtt/items/shared.ItemDerivedFrom`.
 */
export const SpellDerivedFrom = defineTrait({
  name: "@vtt/system-torchbearer/SpellDerivedFrom",
  schema: z.object({
    templateId: z.string().min(1).max(240),
    pluginName: z.string().min(1).max(120),
    overrides: z.array(z.string().min(1).max(80)).default([]),
    deprecated: z.boolean().optional(),
  }),
});

/* -------------------------------------------------------------------------
 * SpellCatalogIndex — sentinel pointing templateId -> spellEntityId
 * ----------------------------------------------------------------------- */

/**
 * One sentinel per plugin that ships a spell catalog. The merge engine
 * reads this to decide "is template X already seeded?" and the
 * scroll-template seed reads it to resolve which spell entity a
 * `tb/scroll/<name>` template should bind to. Same shape as
 * `ItemCatalogIndex`.
 */
export const SpellCatalogIndex = defineTrait({
  name: "@vtt/system-torchbearer/SpellCatalogIndex",
  schema: z
    .object({
      pluginName: z.string().min(1).max(120),
      entries: z.record(z.string(), EntityId).default({}),
    })
    .default({ pluginName: "", entries: {} }),
});

/* -------------------------------------------------------------------------
 * TbLibrary — per-character at-home spell collection
 * ----------------------------------------------------------------------- */

/**
 * The character's at-home library of spells (DH p.92). A magician's
 * library starts with the three spells from their starting school and
 * grows whenever they visit it with new spells in their spell books.
 *
 * `location` defaults to `"home"` — RAW p.92 also supports loner
 * libraries hidden at a campaign-map location; we model that with a
 * free-text `lonerLocation` until scenes grow real markers.
 */
export const TbLibrary = defineTrait({
  name: "@vtt/system-torchbearer/TbLibrary",
  schema: z
    .object({
      spellIds: z.array(EntityId).default([]),
      location: z.enum(["home", "loner"]).default("home"),
      lonerLocation: z.string().max(240).default(""),
    })
    .default({ spellIds: [], location: "home", lonerLocation: "" }),
});

/* -------------------------------------------------------------------------
 * TbMemoryPalace — volatile, slot-bounded memorized-spells container
 * ----------------------------------------------------------------------- */

/**
 * The aetheric matrix in the magician's mind (DH p.89). Capacity grows
 * with class level (Magician Lv1 = 1; Magus benefit = +1; etc.). Each
 * memorized spell consumes slots equal to its circle.
 *
 * `slotsConsumed` on each entry is the rule's snapshot — it's frozen
 * at memorize time so a mid-campaign rules-tweak to a spell's circle
 * doesn't retroactively rewrite what's in the palace. `cast: true`
 * marks an already-cast slot; the slot stays occupied (visually
 * greyed) until the next memorize cycle empties the palace.
 */
export const TbMemoryPalace = defineTrait({
  name: "@vtt/system-torchbearer/TbMemoryPalace",
  schema: z
    .object({
      capacity: z.number().int().min(0).max(20).default(0),
      memorized: z
        .array(
          z.object({
            spellId: EntityId,
            slotsConsumed: z.number().int().min(1).max(5).default(1),
            cast: z.boolean().default(false),
          }),
        )
        .default([]),
    })
    .default({ capacity: 0, memorized: [] }),
});

/* -------------------------------------------------------------------------
 * TbSpellBook — folio-bounded spell container, lives on an item entity
 * ----------------------------------------------------------------------- */

/**
 * A spell-book item's contents. Canon books have 5 folios (DH p.92);
 * a spell consumes folios equal to its circle. Lives on the item
 * entity so a stolen / dropped book carries its spells with it.
 *
 * Schema validation: sum of contained spell circles must be ≤ folios.
 * That invariant is enforced at command-validation time, not by the
 * trait shape, so the trait can be applied incrementally during seed
 * and migration.
 */
export const TbSpellBook = defineTrait({
  name: "@vtt/system-torchbearer/TbSpellBook",
  schema: z
    .object({
      folios: z.number().int().min(0).max(20).default(5),
      contents: z.array(EntityId).default([]),
    })
    .default({ folios: 5, contents: [] }),
});

/* -------------------------------------------------------------------------
 * TbScroll — single-spell consumable item
 * ----------------------------------------------------------------------- */

/**
 * Scrolls are single-use spells (DH p.95). Each scroll holds exactly
 * one spell; casting from it costs the same Arcanist roll as casting
 * from memory but consumes the scroll on success. A blank scroll
 * (`spellId: null`) is a writable medium — RAW LMM has these as
 * scribing material.
 */
export const TbScroll = defineTrait({
  name: "@vtt/system-torchbearer/TbScroll",
  schema: z
    .object({
      spellId: EntityId.nullable().default(null),
      consumed: z.boolean().default(false),
    })
    .default({ spellId: null, consumed: false }),
});

/* -------------------------------------------------------------------------
 * SpellCastConsumed — marker on a Roll entity that the post-roll
 * consume button has fired (so it can only be clicked once).
 * ----------------------------------------------------------------------- */

/**
 * Mirrors `AdvancementLogged` and `TraitUsageLogged` — attached to a
 * Roll entity once a player has clicked the post-roll commit button
 * for a spell cast. Presence suppresses the button on subsequent
 * renders.
 *
 * `outcome` is denormalised at click time so audit / replay can
 * reconstruct what the click did even if the source state has since
 * changed.
 */
export const SpellCastConsumed = defineTrait({
  name: "@vtt/system-torchbearer/SpellCastConsumed",
  schema: z.object({
    characterId: EntityId,
    spellId: EntityId,
    sourceKind: z.enum(["palace", "spellbook", "scroll"]),
    bookId: EntityId.optional(),
    scrollId: EntityId.optional(),
    consumedAt: z.number(),
  }),
});

