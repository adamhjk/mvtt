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

import {
  defineCommand,
  EntityId,
  fail,
  ok,
  z,
} from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { requireWrite } from "@vtt/permissions/shared";
import { Formula } from "@vtt/resolution/shared";
import {
  InvocationCreated,
  InvocationFieldEdited,
  InvocationPerformConsumeLogged,
  InvocationRemoved,
  RelicAcquired,
  RelicLost,
} from "./invocation-events.js";
import {
  InvocationIdentity,
  InvocationPerformConsumed,
  TbInvocationPerforming,
  TbInvocationRelics,
} from "./invocation-traits.js";

/* -------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------- */

function readInvocationIdentity(
  world: import("@vtt/substrate").World,
  invocationId: string,
): { name: string; circle: 1 | 2 | 3 | 4 | 5 } | null {
  const got = world.get(invocationId, [InvocationIdentity]) as
    | { InvocationIdentity: { name: string; circle: 1 | 2 | 3 | 4 | 5 } }
    | undefined;
  if (!got) return null;
  return {
    name: got.InvocationIdentity.name,
    circle: got.InvocationIdentity.circle,
  };
}

/* -------------------------------------------------------------------------
 * Catalog management — create / edit / remove
 * ----------------------------------------------------------------------- */

export const CreateBlankInvocation = defineCommand({
  name: "@vtt/system-torchbearer/CreateBlankInvocation",
  schema: z.object({
    name: z.string().min(1).max(120),
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") return fail("only a GM can create an invocation");
    return ok();
  },
  apply: ({ cmd, world }) => {
    const invocationId = world.allocateId();
    return [
      InvocationCreated({
        invocationId,
        name: cmd.name,
      }),
    ];
  },
});

export const RemoveInvocation = defineCommand({
  name: "@vtt/system-torchbearer/RemoveInvocation",
  schema: z.object({
    invocationId: EntityId,
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") return fail("only a GM can remove an invocation");
    if (!ctx.world.has(ctx.cmd.invocationId)) return fail("unknown invocation");
    return ok();
  },
  apply: ({ cmd }) => [InvocationRemoved({ invocationId: cmd.invocationId })],
});

export const EditInvocationField = defineCommand({
  name: "@vtt/system-torchbearer/EditInvocationField",
  schema: z.object({
    invocationId: EntityId,
    trait: z.enum([
      "InvocationIdentity",
      "TbInvocationPerforming",
      "TbInvocationHomebrewProse",
    ]),
    path: z.array(z.string().min(1).max(60)).default([]),
    value: z.unknown(),
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") return fail("only a GM can edit an invocation");
    if (!ctx.world.has(ctx.cmd.invocationId)) return fail("unknown invocation");
    return ok();
  },
  apply: ({ cmd }) => [
    InvocationFieldEdited({
      invocationId: cmd.invocationId,
      trait: cmd.trait,
      path: cmd.path,
      value: cmd.value,
    }),
  ],
});

/* -------------------------------------------------------------------------
 * Relic management
 * ----------------------------------------------------------------------- */

/**
 * Player or GM toggles "I have the relic for this invocation" on. Affects
 * casting time + immortal burden cost (DH p.99-100). The Invocations tab
 * surfaces this as a small ✓ Relic / ✗ Relic chip per invocation row.
 */
export const AcquireRelic = defineCommand({
  name: "@vtt/system-torchbearer/AcquireRelic",
  schema: z.object({
    characterId: EntityId,
    invocationId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`unknown character ${ctx.cmd.characterId}`);
    }
    if (!ctx.world.has(ctx.cmd.invocationId)) {
      return fail(`unknown invocation ${ctx.cmd.invocationId}`);
    }
    if (readInvocationIdentity(ctx.world, ctx.cmd.invocationId) === null) {
      return fail(`entity ${ctx.cmd.invocationId} is not an invocation`);
    }
    // Reject duplicate acquisitions — otherwise we'd spawn a second
    // inventory item for the same relic. The flag is the same one
    // the system maintains, so its presence means the linked item
    // already exists in TbCarries.
    const got = ctx.world.get(ctx.cmd.characterId, [TbInvocationRelics]) as
      | { TbInvocationRelics: { invocationIds: string[] } }
      | undefined;
    if (got?.TbInvocationRelics.invocationIds.includes(ctx.cmd.invocationId)) {
      return fail("relic already held for this invocation");
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [
    RelicAcquired({
      characterId: cmd.characterId,
      invocationId: cmd.invocationId,
    }),
  ],
});

export const LoseRelic = defineCommand({
  name: "@vtt/system-torchbearer/LoseRelic",
  schema: z.object({
    characterId: EntityId,
    invocationId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`unknown character ${ctx.cmd.characterId}`);
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [
    RelicLost({
      characterId: cmd.characterId,
      invocationId: cmd.invocationId,
    }),
  ],
});

/* -------------------------------------------------------------------------
 * Post-roll commit — ApplyImmortalBurden
 * ----------------------------------------------------------------------- */

/**
 * Post-roll commit fired by the InvocationPerformActions chip on a
 * resolved Ritualist invocation roll. Reads the perform context off the
 * roll's Formula trait (`spec.invocationPerform`), increments the
 * character's `Relics.burden`, and stamps `InvocationPerformConsumed`
 * on the roll so the button can only be clicked once.
 */
export const ApplyImmortalBurden = defineCommand({
  name: "@vtt/system-torchbearer/ApplyImmortalBurden",
  schema: z.object({
    rollId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.rollId)) return fail("unknown roll");
    const formula = ctx.world.get(ctx.cmd.rollId, [Formula]) as
      | { Formula: { meta?: unknown } }
      | undefined;
    if (!formula) return fail("roll has no Formula trait");
    const meta = formula.Formula.meta as
      | { spec?: { invocationPerform?: unknown } }
      | undefined;
    if (!meta?.spec?.invocationPerform) {
      return fail("roll is not an invocation perform");
    }
    const consumed = ctx.world.get(ctx.cmd.rollId, [InvocationPerformConsumed]);
    if (consumed) return fail("burden already applied for this roll");
    return ok();
  },
  apply: ({ cmd, world }) => {
    const formula = world.get(cmd.rollId, [Formula]) as
      | { Formula: { meta?: unknown } }
      | undefined;
    const meta = formula?.Formula.meta as
      | {
          spec?: {
            invocationPerform?: {
              characterId: string;
              invocationId: string;
              burdenAdded: number;
            };
          };
        }
      | undefined;
    const ip = meta?.spec?.invocationPerform;
    if (!ip) return [];
    return [
      InvocationPerformConsumeLogged({
        rollId: cmd.rollId,
        characterId: ip.characterId as never,
        invocationId: ip.invocationId as never,
        burdenAdded: ip.burdenAdded,
        consumedAt: Date.now(),
      }),
    ];
  },
});

void TbInvocationPerforming;
void TbInvocationRelics;
