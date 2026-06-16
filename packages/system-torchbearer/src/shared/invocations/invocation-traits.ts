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
 * Traditions, circles, ritual kinds
 * ----------------------------------------------------------------------- */

/**
 * Class traditions an invocation belongs to. RAW DH p.98 carries the
 * theurge list; LMM p.41 carries the parallel shaman list — these are
 * the only two canonical invocation lists in TB2. Skald bears relics
 * but draws from both lists (LMM p.20 Gondul L6), so it doesn't get
 * its own tradition tag — `traditionsForClass` maps "skald" onto the
 * union.
 */
export const INVOCATION_TRADITIONS = ["theurge", "shaman"] as const;

export const InvocationTraditionSchema = z.enum(INVOCATION_TRADITIONS);
export type InvocationTradition = z.infer<typeof InvocationTraditionSchema>;

export const InvocationCircleSchema = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
  .default(1);
export type InvocationCircle = z.infer<typeof InvocationCircleSchema>;

/**
 * Ritual resolution kind for an invocation (DH p.98-99):
 *   - `"fixed"`     — fixed Ritualist Ob
 *   - `"factors"`   — Ob built from factor table
 *   - `"versus"`    — versus test (e.g. Wrath of the Lords of Law: Ritualist vs Nature)
 *   - `"skill-swap"`— performs without a roll, swaps Ritualist for another skill
 */
export const InvocationRitualKindSchema = z.enum(["fixed", "factors", "versus", "skill-swap"]);
export type InvocationRitualKind = z.infer<typeof InvocationRitualKindSchema>;

const PageRefSchema = z
  .object({
    canonicalId: z.string().min(1).max(120),
    page: z.number().int().min(1).max(2000),
  })
  .nullable();

/* -------------------------------------------------------------------------
 * InvocationIdentity — name / circle / traditions / page reference
 * ----------------------------------------------------------------------- */

/**
 * Identity of an invocation catalog entity. Mirrors `SpellIdentity`.
 * `pageRef` deep-links to the rulebook for the full effect prose;
 * canon invocations set this, homebrew invocations leave it null and
 * rely on `TbInvocationHomebrewProse`.
 */
export const InvocationIdentity = defineTrait({
  name: "@vtt/system-torchbearer/InvocationIdentity",
  schema: z
    .object({
      name: z.string().min(1).max(120).default(""),
      circle: InvocationCircleSchema,
      traditions: z.array(InvocationTraditionSchema).default([]),
      pageRef: PageRefSchema.default(null),
    })
    .default({ name: "", circle: 1, traditions: [], pageRef: null }),
});

/* -------------------------------------------------------------------------
 * TbInvocationPerforming — at-the-table performance parameters
 * ----------------------------------------------------------------------- */

/**
 * Everything the player needs to perform the invocation without
 * flipping to the rulebook. The full effect prose stays in the book —
 * `pageRef` on `InvocationIdentity` carries the deep-link.
 *
 * `ritualKind` chooses the obstacle resolution path:
 *   - `"fixed"`      — `fixedOb` is the Ritualist obstacle (e.g. Bone Knitter Ob 3)
 *   - `"factors"`    — leave Ob open; the GM/player set it from the invocation's factor table
 *   - `"versus"`     — opens a versus-test pairing against `versusAgainst` on the target
 *   - `"skill-swap"` — no roll required; the invocation grants a skill swap for one test
 *
 * `invocationTime` is a tuple of turn counts: without the relic and with
 * the relic (DH p.99). `immortalBurden` is the parallel tuple for the
 * burden cost (DH p.100). `relicName` + `relicSlot` describe the
 * required relic; `sacramental` is the optional component that grants
 * +1D when present (DH p.100).
 */
export const TbInvocationPerforming = defineTrait({
  name: "@vtt/system-torchbearer/TbInvocationPerforming",
  schema: z
    .object({
      ritualKind: InvocationRitualKindSchema.default("fixed"),
      fixedOb: z.number().int().min(0).max(10).nullable().default(null),
      versusAgainst: z.string().max(40).nullable().default(null),
      invocationTime: z
        .object({
          noRelic: z.number().int().min(0).max(10).default(1),
          withRelic: z.number().int().min(0).max(10).default(0),
        })
        .default({ noRelic: 1, withRelic: 0 }),
      duration: z.string().max(120).default(""),
      immortalBurden: z
        .object({
          noRelic: z.number().int().min(0).max(10).default(2),
          withRelic: z.number().int().min(0).max(10).default(1),
        })
        .default({ noRelic: 2, withRelic: 1 }),
      relicName: z.string().max(240).default(""),
      relicSlot: z.string().max(120).default(""),
      sacramental: z.string().max(240).default(""),
    })
    .default({
      ritualKind: "fixed",
      fixedOb: null,
      versusAgainst: null,
      invocationTime: { noRelic: 1, withRelic: 0 },
      duration: "",
      immortalBurden: { noRelic: 2, withRelic: 1 },
      relicName: "",
      relicSlot: "",
      sacramental: "",
    }),
});

/* -------------------------------------------------------------------------
 * TbInvocationHomebrewProse — inline effect text on homebrew invocations
 * ----------------------------------------------------------------------- */

/**
 * Free-text effect + ritual prose for homebrew invocations. Canon
 * invocations leave this trait absent and rely on
 * `InvocationIdentity.pageRef` for the rulebook deep-link.
 */
export const TbInvocationHomebrewProse = defineTrait({
  name: "@vtt/system-torchbearer/TbInvocationHomebrewProse",
  schema: z
    .object({
      effect: z.string().max(4000).default(""),
      ritual: z.string().max(4000).default(""),
    })
    .default({ effect: "", ritual: "" }),
});

/* -------------------------------------------------------------------------
 * InvocationDerivedFrom — catalog provenance, parallel to SpellDerivedFrom
 * ----------------------------------------------------------------------- */

export const InvocationDerivedFrom = defineTrait({
  name: "@vtt/system-torchbearer/InvocationDerivedFrom",
  schema: z.object({
    templateId: z.string().min(1).max(240),
    pluginName: z.string().min(1).max(120),
    overrides: z.array(z.string().min(1).max(80)).default([]),
    deprecated: z.boolean().optional(),
  }),
});

/* -------------------------------------------------------------------------
 * InvocationCatalogIndex — sentinel pointing templateId -> invocationEntityId
 * ----------------------------------------------------------------------- */

export const InvocationCatalogIndex = defineTrait({
  name: "@vtt/system-torchbearer/InvocationCatalogIndex",
  schema: z
    .object({
      pluginName: z.string().min(1).max(120),
      entries: z.record(z.string(), EntityId).default({}),
    })
    .default({ pluginName: "", entries: {} }),
});

/* -------------------------------------------------------------------------
 * TbInvocationRelics — per-character set of held relics
 * ----------------------------------------------------------------------- */

/**
 * Tracks which invocations a character has the relic for. RAW (DH p.99)
 * couples the relic tightly to the invocation: a relic-bearer pays the
 * shorter time and lower burden; a relic-less ritualist pays the longer
 * time, higher burden, and (for some invocations like Skald's Gondul L6
 * benefit) destroys the relic on success. We just track presence — a
 * boolean per invocation id.
 *
 * Modeling note: relics in TB2 are listed in the rules with both an
 * inventory slot and the invocation they fuel. A future enhancement
 * could bind the held relic to a real item entity; v1 keeps the
 * relationship abstract — the invocation's `relicName` is the printed
 * name, and `TbInvocationRelics` is a flat set on the character.
 */
export const TbInvocationRelics = defineTrait({
  name: "@vtt/system-torchbearer/TbInvocationRelics",
  schema: z
    .object({
      invocationIds: z.array(EntityId).default([]),
    })
    .default({ invocationIds: [] }),
});

/* -------------------------------------------------------------------------
 * TbInvocationRelicLink — back-reference from a relic item to its invocation
 * ----------------------------------------------------------------------- */

/**
 * Lives on the Item entity that materialises a relic in the
 * character's inventory. Carries the id of the invocation the relic
 * fuels — so the inventory tab can label the row "relic for X" and
 * the invocations tab can find / remove the matching item when the
 * player drops the relic. Spawned by `TbRelicAcquiredSystem` when
 * `AcquireRelic` fires; despawned by `TbRelicLostSystem` on the
 * paired `LoseRelic`.
 */
export const TbInvocationRelicLink = defineTrait({
  name: "@vtt/system-torchbearer/TbInvocationRelicLink",
  schema: z.object({
    invocationId: EntityId,
  }),
});

/* -------------------------------------------------------------------------
 * InvocationPerformConsumed — marker on a Roll entity that the post-roll
 * commit button has fired (so it can only be clicked once).
 * ----------------------------------------------------------------------- */

/**
 * Mirrors `SpellCastConsumed` and `AdvancementLogged` — attached to a
 * Roll entity once a player has clicked the post-roll commit button
 * for an invocation perform. Presence suppresses the button on
 * subsequent renders.
 */
export const InvocationPerformConsumed = defineTrait({
  name: "@vtt/system-torchbearer/InvocationPerformConsumed",
  schema: z.object({
    characterId: EntityId,
    invocationId: EntityId,
    burdenAdded: z.number().int().min(0).max(20),
    consumedAt: z.number(),
  }),
});
