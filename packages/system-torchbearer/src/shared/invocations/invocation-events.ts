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
 * Relic mutations (per-character)
 * ----------------------------------------------------------------------- */

export const RelicAcquired = defineEvent({
  name: "@vtt/system-torchbearer/RelicAcquired",
  schema: z.object({
    characterId: EntityId,
    invocationId: EntityId,
  }),
});

export const RelicLost = defineEvent({
  name: "@vtt/system-torchbearer/RelicLost",
  schema: z.object({
    characterId: EntityId,
    invocationId: EntityId,
  }),
});

/* -------------------------------------------------------------------------
 * Perform lifecycle — paired with TbRollSpec.invocationPerform on the roll
 * ----------------------------------------------------------------------- */

export const InvocationPerformInitiated = defineEvent({
  name: "@vtt/system-torchbearer/InvocationPerformInitiated",
  schema: z.object({
    characterId: EntityId,
    invocationId: EntityId,
    withRelic: z.boolean(),
    /** Assigned roll id (= the Roll entity allocated by the request). */
    rollId: EntityId.optional(),
  }),
});

export const InvocationPerformConsumeLogged = defineEvent({
  name: "@vtt/system-torchbearer/InvocationPerformConsumeLogged",
  schema: z.object({
    rollId: EntityId,
    characterId: EntityId,
    invocationId: EntityId,
    burdenAdded: z.number().int().min(0).max(20),
    consumedAt: z.number(),
  }),
});

/* -------------------------------------------------------------------------
 * Catalog management — homebrew invocation create / remove / edit
 * ----------------------------------------------------------------------- */

/**
 * A new catalog invocation entity has been created. The
 * universal-mirror system stamps InvocationIdentity +
 * TbInvocationPerforming + TbInvocationHomebrewProse with sensible
 * defaults.
 */
export const InvocationCreated = defineEvent({
  name: "@vtt/system-torchbearer/InvocationCreated",
  schema: z.object({
    invocationId: EntityId,
    name: z.string().min(1).max(120),
  }),
});

export const InvocationRemoved = defineEvent({
  name: "@vtt/system-torchbearer/InvocationRemoved",
  schema: z.object({
    invocationId: EntityId,
  }),
});

export const InvocationFieldEdited = defineEvent({
  name: "@vtt/system-torchbearer/InvocationFieldEdited",
  schema: z.object({
    invocationId: EntityId,
    trait: z.enum(["InvocationIdentity", "TbInvocationPerforming", "TbInvocationHomebrewProse"]),
    path: z.array(z.string().min(1).max(60)),
    value: z.unknown(),
  }),
});

/* -------------------------------------------------------------------------
 * Catalog provenance — fork-on-customize, parallels SpellForked
 * ----------------------------------------------------------------------- */

export const InvocationForked = defineEvent({
  name: "@vtt/system-torchbearer/InvocationForked",
  schema: z.object({
    sourceInvocationId: EntityId,
    newInvocationId: EntityId,
  }),
});
