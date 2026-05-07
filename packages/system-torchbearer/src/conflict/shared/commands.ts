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
  withVisibility,
  z,
  type World,
} from "@vtt/substrate";
import {
  actors,
  everyone,
  ofRole,
  Permissions,
  requireRole,
} from "@vtt/permissions/shared";
import { requireSession } from "@vtt/identity/shared";
import { ConflictActionEnum } from "./actions.js";
import { ConflictTypeEnum } from "./conflict-types.js";
import { ConflictSideEnum, type ConflictSide } from "./sides.js";
import { Character } from "@vtt/characters/shared";
import { Conditions } from "../../shared/traits.js";
import { TB_CONFLICT_TYPES } from "./conflict-types.js";
import {
  TbConflict,
  TbConflictParticipant,
  TbConflictScript,
} from "./traits.js";
import {
  CaptainElected,
  CompromiseApplied,
  ConflictDeclared,
  ConflictEnded,
  ConflictWeaponChosen,
  DispositionRolled,
  HpAssigned,
  ParticipantHpSet,
  RoundAdvanced,
  ScriptLocked,
  ScriptUnlocked,
  ScriptSlotCleared,
  ScriptSlotSet,
  SlotRevealed,
  TeamDispositionSet,
} from "./events.js";

/**
 * Look up a conflict's TbConflict trait, returning a typed view.
 */
function getConflict(
  world: World,
  conflictId: EntityId,
):
  | (z.infer<typeof TbConflict.schema> & { id: EntityId })
  | null {
  const got = world.get(conflictId, [TbConflict]) as
    | { TbConflict: z.infer<typeof TbConflict.schema> }
    | undefined;
  if (!got) return null;
  return { ...got.TbConflict, id: conflictId };
}

/**
 * Resolve a side's script entity id from the conflict sentinel —
 * stored as a `Permissions` companion entity by `DeclareConflict`.
 * The script entity carries the secret slots; we look it up by
 * traversing every TbConflictScript whose `conflictId` matches.
 */
function findScriptEntityId(
  world: World,
  conflictId: EntityId,
  side: ConflictSide,
): EntityId | null {
  for (const row of world.query([TbConflictScript])) {
    const v = row.values.TbConflictScript as z.infer<
      typeof TbConflictScript.schema
    >;
    if (v.conflictId === conflictId && v.side === side) {
      return row.id;
    }
  }
  return null;
}

/**
 * Find the captain's userId. The captain is a Character entity; the
 * Character has Permissions whose write list includes the captain's
 * userId. We also accept GM-as-enemy-captain.
 */
function findCharacterOwners(
  world: World,
  characterId: EntityId,
): ReadonlyArray<string> {
  const got = world.get(characterId, [Permissions]) as
    | { Permissions: { read: { kind: string; userIds?: string[] }; write: { kind: string; userIds?: string[] } } }
    | undefined;
  if (!got) return [];
  return got.Permissions.write.userIds ?? [];
}

function isPartySide(side: ConflictSide): boolean {
  return side === "party";
}

/**
 * Side-scoping helper: build the visibility for a side-private event.
 * Party side: actors([partyUserIds]). Enemy side: actors([gmUserId]).
 *
 * GMs ALSO bypass via role. We additionally include the GM userId in
 * the actors list so the underlying broadcast filter doesn't have to
 * traverse a separate role check — keeps the substrate's event-time
 * code path single-pass.
 */
function sideVisibility(
  world: World,
  conflictId: EntityId,
  side: ConflictSide,
): { kind: "users"; userIds: string[] } {
  const conf = getConflict(world, conflictId);
  if (!conf) return { kind: "users", userIds: [] };
  if (side === "enemy") {
    return { kind: "users", userIds: [conf.gmUserId] };
  }
  // Heroes: union of all party participant character owners + GM.
  const userIds = new Set<string>([conf.gmUserId]);
  for (const row of world.query([TbConflictParticipant])) {
    const p = row.values.TbConflictParticipant as z.infer<
      typeof TbConflictParticipant.schema
    >;
    if (p.conflictId !== conflictId || p.side !== "party") continue;
    for (const uid of findCharacterOwners(world, p.characterId)) {
      userIds.add(uid);
    }
  }
  return { kind: "users", userIds: [...userIds] };
}

const ParticipantInputSchema = z.object({
  characterId: EntityId,
});

/* -------------------------------------------------------------------------
 * Lifecycle
 * ----------------------------------------------------------------------- */

export const DeclareConflict = defineCommand({
  name: "@vtt/system-torchbearer/DeclareConflict",
  schema: z.object({
    type: ConflictTypeEnum,
    locationLabel: z.string().max(120).default(""),
    captainCharacterId: EntityId,
    partyParticipants: z.array(ParticipantInputSchema).min(1),
    enemyParticipants: z.array(ParticipantInputSchema).min(1),
  }),
  validate: (ctx) => {
    const r = requireRole(ctx, "gm");
    if (!r.ok) return r;
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.captainCharacterId)) {
      return fail("captain character does not exist");
    }
    return ok();
  },
  apply: (ctx) => {
    const session = requireSession(ctx);
    if (!session) throw new Error("validate did not catch missing session");
    const conflictId = ctx.world.allocateId();
    const partyScriptEntityId = ctx.world.allocateId();
    const enemyScriptEntityId = ctx.world.allocateId();
    // Pre-allocate participant + armor-state ids server-side and
    // embed them in the event payload. Universal-mirror systems on
    // every side use spawnAt against these ids — never world.spawn,
    // which would auto-allocate a different id on each side and
    // silently collide with the next server-allocated participant
    // (CLAUDE.md "Entity ids are server-authoritative").
    const partyParticipants = ctx.cmd.partyParticipants.map((p) => ({
      participantEntityId: ctx.world.allocateId(),
      characterId: p.characterId,
      armorStateEntityId: ctx.world.allocateId(),
    }));
    const enemyParticipants = ctx.cmd.enemyParticipants.map((p) => ({
      participantEntityId: ctx.world.allocateId(),
      characterId: p.characterId,
      armorStateEntityId: ctx.world.allocateId(),
    }));
    const partyUserIds = new Set<string>();
    for (const p of partyParticipants) {
      for (const uid of findCharacterOwners(ctx.world, p.characterId)) {
        partyUserIds.add(uid);
      }
    }
    return [
      ConflictDeclared({
        conflictId,
        partyScriptEntityId,
        enemyScriptEntityId,
        type: ctx.cmd.type,
        locationLabel: ctx.cmd.locationLabel,
        captainCharacterId: ctx.cmd.captainCharacterId,
        gmUserId: session.userId,
        partyUserIds: [...partyUserIds],
        partyParticipants,
        enemyParticipants,
      }),
    ];
  },
});

export const ElectCaptain = defineCommand({
  name: "@vtt/system-torchbearer/ElectCaptain",
  schema: z.object({
    conflictId: EntityId,
    captainCharacterId: EntityId,
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    if (conf.endedAt !== null) return fail("conflict ended");
    // Either GM or someone on the party side may re-elect.
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role === "gm") return ok();
    const visForHeroes = sideVisibility(ctx.world, ctx.cmd.conflictId, "party");
    if (!visForHeroes.userIds.includes(session.userId)) {
      return fail("only party side may elect captain");
    }
    // The new captain must be a party participant.
    let isHero = false;
    for (const row of ctx.world.query([TbConflictParticipant])) {
      const p = row.values.TbConflictParticipant as z.infer<
        typeof TbConflictParticipant.schema
      >;
      if (p.conflictId === ctx.cmd.conflictId && p.characterId === ctx.cmd.captainCharacterId && p.side === "party") {
        if (p.knockedOut) return fail("knocked-out characters cannot captain");
        isHero = true;
        break;
      }
    }
    if (!isHero) return fail("captain must be a party participant");
    return ok();
  },
  apply: (ctx) => [
    CaptainElected({
      conflictId: ctx.cmd.conflictId,
      captainCharacterId: ctx.cmd.captainCharacterId,
    }),
  ],
});

/* -------------------------------------------------------------------------
 * Disposition + HP
 * ----------------------------------------------------------------------- */

export const RollDisposition = defineCommand({
  name: "@vtt/system-torchbearer/RollDisposition",
  schema: z.object({
    conflictId: EntityId,
    side: ConflictSideEnum,
    skillId: z.string(),
    poolBefore: z.number().int().min(0).max(20),
    addToBase: z.number().int().min(0).max(20),
    diceRoll: z.array(z.number().int().min(1).max(6)).max(20),
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    return ok();
  },
  apply: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) throw new Error("validate let through missing conflict");
    const successes = ctx.cmd.diceRoll.filter((d) => d >= 4).length;
    // Apply per-team condition penalties + per-captain factors per
    // SG p.63-64. Penalties stack but the team-wide ones apply once
    // regardless of how many participants have the condition.
    const conditionEffect = computeDispoConditionEffect(
      ctx.world,
      ctx.cmd.conflictId,
      ctx.cmd.side,
    );
    const successesAfter = Math.max(0, successes - conditionEffect.dicePenalty);
    let finalDispo =
      ctx.cmd.addToBase + successesAfter - conditionEffect.successPenalty;
    finalDispo = Math.max(1, finalDispo);
    const notes = conditionEffect.notes;
    return [
      DispositionRolled({
        conflictId: ctx.cmd.conflictId,
        side: ctx.cmd.side,
        skillId: ctx.cmd.skillId,
        poolBefore: ctx.cmd.poolBefore,
        diceRoll: ctx.cmd.diceRoll,
        successes,
        addToBase: ctx.cmd.addToBase,
        finalDispo,
        notes,
      }),
    ];
  },
});

/**
 * Apply SG p.63-64 disposition modifiers:
 *   - Hungry & Thirsty: −1s, once per side regardless of how many.
 *   - Exhausted: −1s, once per side, stacks with H&T.
 *   - Injured: −1D dispo roll (per character).
 *   - Sick: −1D (stacks with Injured: −2D total).
 *
 * The captain-only factors (Backpack −1s for kill/cap/driveOff,
 * Dim light −1s) live on the captain's character and read here too.
 */
function computeDispoConditionEffect(
  world: import("@vtt/substrate").World,
  conflictId: EntityId,
  side: import("./sides.js").ConflictSide,
): { dicePenalty: number; successPenalty: number; notes: string[] } {
  const conf = getConflict(world, conflictId);
  if (!conf) return { dicePenalty: 0, successPenalty: 0, notes: [] };
  const typeDef = TB_CONFLICT_TYPES[conf.type];
  let teamHungryThirsty = false;
  let teamExhausted = false;
  let dicePenalty = 0;
  const notes: string[] = [];
  for (const row of world.query([TbConflictParticipant])) {
    const p = row.values.TbConflictParticipant as z.infer<
      typeof TbConflictParticipant.schema
    >;
    if (p.conflictId !== conflictId || p.side !== side) continue;
    const got = world.get(p.characterId, [Conditions]);
    if (!got) continue;
    const c = (got as { Conditions: Record<string, boolean> }).Conditions;
    if (c.hungryThirsty) teamHungryThirsty = true;
    if (c.exhausted) teamExhausted = true;
    const charName = (() => {
      const ch = world.get(p.characterId, [Character]) as
        | { Character: { name: string } }
        | undefined;
      return ch?.Character.name ?? "(participant)";
    })();
    if (c.injured) {
      dicePenalty += 1;
      notes.push(`${charName}: injured −1D`);
    }
    if (c.sick) {
      dicePenalty += 1;
      notes.push(`${charName}: sick −1D`);
    }
  }
  let successPenalty = 0;
  if (teamHungryThirsty) {
    successPenalty += 1;
    notes.push("hungry & thirsty −1s");
  }
  if (teamExhausted) {
    successPenalty += 1;
    notes.push("exhausted −1s");
  }
  // Backpack penalty applies only to physical conflicts with the
  // captain wearing one. We don't have a structured "is wearing
  // backpack" check yet — leave a rules note pointing to the
  // factor instead.
  void typeDef;
  return { dicePenalty, successPenalty, notes };
}

/**
 * Direct-edit dispo: GM types in the current/max boxes. Replaces the
 * roll-and-allocate flow for live play; use RollDisposition only if
 * you want the engine to count successes for you.
 */
export const SetTeamDisposition = defineCommand({
  name: "@vtt/system-torchbearer/SetTeamDisposition",
  schema: z.object({
    conflictId: EntityId,
    side: ConflictSideEnum,
    current: z.number().int().min(0).max(99),
    max: z.number().int().min(0).max(99),
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    const r = requireRole(ctx, "gm");
    if (!r.ok) return r;
    if (ctx.cmd.current > ctx.cmd.max) {
      return fail("current dispo cannot exceed max");
    }
    return ok();
  },
  apply: (ctx) => [
    TeamDispositionSet({
      conflictId: ctx.cmd.conflictId,
      side: ctx.cmd.side,
      current: ctx.cmd.current,
      max: ctx.cmd.max,
    }),
  ],
});

/**
 * Direct-edit HP for one participant. Live-play replacement for
 * AssignHp's batch-allocate.
 */
export const SetParticipantHp = defineCommand({
  name: "@vtt/system-torchbearer/SetParticipantHp",
  schema: z.object({
    conflictId: EntityId,
    participantEntityId: EntityId,
    hp: z.number().int().min(0).max(99),
    hpMax: z.number().int().min(0).max(99),
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    const r = requireRole(ctx, "gm");
    if (!r.ok) return r;
    if (ctx.cmd.hp > ctx.cmd.hpMax) {
      return fail("hp cannot exceed hpMax");
    }
    if (!ctx.world.has(ctx.cmd.participantEntityId)) {
      return fail("participant not found");
    }
    return ok();
  },
  apply: (ctx) => [
    ParticipantHpSet({
      conflictId: ctx.cmd.conflictId,
      participantEntityId: ctx.cmd.participantEntityId,
      hp: ctx.cmd.hp,
      hpMax: ctx.cmd.hpMax,
    }),
  ],
});

export const AssignHp = defineCommand({
  name: "@vtt/system-torchbearer/ConflictAssignHp",
  schema: z.object({
    conflictId: EntityId,
    side: ConflictSideEnum,
    allocations: z.array(
      z.object({
        participantEntityId: EntityId,
        hp: z.number().int().min(0),
      }),
    ),
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    const expected =
      ctx.cmd.side === "party" ? conf.dispoParty.max : conf.dispoEnemy.max;
    const sum = ctx.cmd.allocations.reduce((s, a) => s + a.hp, 0);
    if (sum !== expected) {
      return fail(`hp allocations must sum to ${expected}, got ${sum}`);
    }
    return ok();
  },
  apply: (ctx) => [
    HpAssigned({
      conflictId: ctx.cmd.conflictId,
      side: ctx.cmd.side,
      allocations: ctx.cmd.allocations,
    }),
  ],
});

/* -------------------------------------------------------------------------
 * Weapons
 * ----------------------------------------------------------------------- */

export const ChooseWeapon = defineCommand({
  name: "@vtt/system-torchbearer/ConflictChooseWeapon",
  schema: z.object({
    conflictId: EntityId,
    characterId: EntityId,
    weaponItemId: EntityId.nullable(),
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    return ok();
  },
  apply: (ctx) => [
    ConflictWeaponChosen({
      conflictId: ctx.cmd.conflictId,
      characterId: ctx.cmd.characterId,
      weaponItemId: ctx.cmd.weaponItemId,
    }),
  ],
});

/* -------------------------------------------------------------------------
 * Script
 * ----------------------------------------------------------------------- */

export const SetScriptSlot = defineCommand({
  name: "@vtt/system-torchbearer/SetConflictScriptSlot",
  schema: z.object({
    conflictId: EntityId,
    side: ConflictSideEnum,
    slotIndex: z.number().int().min(0).max(2),
    action: ConflictActionEnum,
    performerCharacterId: EntityId,
    weaponItemId: EntityId.nullable(),
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    // Party side: actor must be a party userId. Enemy side: GM only.
    if (ctx.cmd.side === "enemy") {
      if (session.role !== "gm") return fail("only GM may script enemy side");
    } else {
      if (session.role !== "gm") {
        const vis = sideVisibility(ctx.world, ctx.cmd.conflictId, "party");
        if (!vis.userIds.includes(session.userId)) {
          return fail("only party side may script party side");
        }
      }
    }
    const scriptEntityId = findScriptEntityId(ctx.world, ctx.cmd.conflictId, ctx.cmd.side);
    if (!scriptEntityId) return fail("script entity missing");
    const got = ctx.world.get(scriptEntityId, [TbConflictScript]);
    if (!got) return fail("script entity missing trait");
    const script = (got as { TbConflictScript: z.infer<typeof TbConflictScript.schema> }).TbConflictScript;
    if (script.locked) return fail("script already locked");
    // Performer must be on the same side and not knocked out.
    let performerOnSide = false;
    for (const row of ctx.world.query([TbConflictParticipant])) {
      const p = row.values.TbConflictParticipant as z.infer<typeof TbConflictParticipant.schema>;
      if (p.conflictId === ctx.cmd.conflictId && p.characterId === ctx.cmd.performerCharacterId) {
        if (p.side !== ctx.cmd.side) return fail("performer must be on the scripted side");
        if (p.knockedOut) return fail("performer is knocked out");
        performerOnSide = true;
        break;
      }
    }
    if (!performerOnSide) return fail("performer is not a conflict participant");
    return ok();
  },
  apply: (ctx) => {
    const scriptEntityId = findScriptEntityId(ctx.world, ctx.cmd.conflictId, ctx.cmd.side);
    if (!scriptEntityId) throw new Error("validate let through missing script entity");
    return [
      withVisibility(
        ScriptSlotSet({
          conflictId: ctx.cmd.conflictId,
          scriptEntityId,
          side: ctx.cmd.side,
          slotIndex: ctx.cmd.slotIndex,
          action: ctx.cmd.action,
          performerCharacterId: ctx.cmd.performerCharacterId,
          weaponItemId: ctx.cmd.weaponItemId,
        }),
        sideVisibility(ctx.world, ctx.cmd.conflictId, ctx.cmd.side),
      ),
    ];
  },
});

export const ClearScriptSlot = defineCommand({
  name: "@vtt/system-torchbearer/ClearConflictScriptSlot",
  schema: z.object({
    conflictId: EntityId,
    side: ConflictSideEnum,
    slotIndex: z.number().int().min(0).max(2),
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (ctx.cmd.side === "enemy" && session.role !== "gm") {
      return fail("only GM may modify enemy script");
    }
    if (ctx.cmd.side === "party" && session.role !== "gm") {
      const vis = sideVisibility(ctx.world, ctx.cmd.conflictId, "party");
      if (!vis.userIds.includes(session.userId)) {
        return fail("only party side may modify party script");
      }
    }
    const scriptEntityId = findScriptEntityId(ctx.world, ctx.cmd.conflictId, ctx.cmd.side);
    if (!scriptEntityId) return fail("script entity missing");
    return ok();
  },
  apply: (ctx) => {
    const scriptEntityId = findScriptEntityId(ctx.world, ctx.cmd.conflictId, ctx.cmd.side);
    if (!scriptEntityId) throw new Error("validate let through missing script entity");
    return [
      withVisibility(
        ScriptSlotCleared({
          conflictId: ctx.cmd.conflictId,
          scriptEntityId,
          side: ctx.cmd.side,
          slotIndex: ctx.cmd.slotIndex,
        }),
        sideVisibility(ctx.world, ctx.cmd.conflictId, ctx.cmd.side),
      ),
    ];
  },
});

export const UnlockScript = defineCommand({
  name: "@vtt/system-torchbearer/UnlockConflictScript",
  schema: z.object({
    conflictId: EntityId,
    side: ConflictSideEnum,
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (ctx.cmd.side === "enemy" && session.role !== "gm") {
      return fail("only GM may unlock enemy script");
    }
    if (ctx.cmd.side === "party" && session.role !== "gm") {
      const vis = sideVisibility(ctx.world, ctx.cmd.conflictId, "party");
      if (!vis.userIds.includes(session.userId)) {
        return fail("only party side may unlock party script");
      }
    }
    const scriptEntityId = findScriptEntityId(ctx.world, ctx.cmd.conflictId, ctx.cmd.side);
    if (!scriptEntityId) return fail("script entity missing");
    const got = ctx.world.get(scriptEntityId, [TbConflictScript]);
    if (!got) return fail("script entity missing trait");
    const script = (got as { TbConflictScript: z.infer<typeof TbConflictScript.schema> }).TbConflictScript;
    if (!script.locked) return fail("script not locked");
    return ok();
  },
  apply: (ctx) => {
    const scriptEntityId = findScriptEntityId(ctx.world, ctx.cmd.conflictId, ctx.cmd.side);
    if (!scriptEntityId) throw new Error("validate let through missing script entity");
    return [
      ScriptUnlocked({
        conflictId: ctx.cmd.conflictId,
        scriptEntityId,
        side: ctx.cmd.side,
      }),
    ];
  },
});

export const LockScript = defineCommand({
  name: "@vtt/system-torchbearer/LockConflictScript",
  schema: z.object({
    conflictId: EntityId,
    side: ConflictSideEnum,
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (ctx.cmd.side === "enemy" && session.role !== "gm") {
      return fail("only GM may lock enemy script");
    }
    if (ctx.cmd.side === "party" && session.role !== "gm") {
      const vis = sideVisibility(ctx.world, ctx.cmd.conflictId, "party");
      if (!vis.userIds.includes(session.userId)) {
        return fail("only party side may lock party script");
      }
    }
    const scriptEntityId = findScriptEntityId(ctx.world, ctx.cmd.conflictId, ctx.cmd.side);
    if (!scriptEntityId) return fail("script entity missing");
    const got = ctx.world.get(scriptEntityId, [TbConflictScript]);
    if (!got) return fail("script entity missing trait");
    const script = (got as { TbConflictScript: z.infer<typeof TbConflictScript.schema> }).TbConflictScript;
    if (script.locked) return fail("script already locked");
    for (const slot of script.slots) {
      if (slot.status === "empty") return fail("all three slots must be filled before lock");
    }
    return ok();
  },
  apply: (ctx) => {
    const scriptEntityId = findScriptEntityId(ctx.world, ctx.cmd.conflictId, ctx.cmd.side);
    if (!scriptEntityId) throw new Error("validate let through missing script entity");
    return [
      ScriptLocked({
        conflictId: ctx.cmd.conflictId,
        scriptEntityId,
        side: ctx.cmd.side,
      }),
    ];
  },
});

/* -------------------------------------------------------------------------
 * Reveal — GM-only verb that flips a single slot from filled to revealed.
 * ----------------------------------------------------------------------- */

export const RevealNextSlot = defineCommand({
  name: "@vtt/system-torchbearer/RevealNextSlot",
  schema: z.object({
    conflictId: EntityId,
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    const r = requireRole(ctx, "gm");
    if (!r.ok) return r;
    if (conf.revealIndex >= 3) return fail("all three slots already revealed");
    return ok();
  },
  apply: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) throw new Error("validate let through missing conflict");
    const partyScriptEntityId = findScriptEntityId(ctx.world, ctx.cmd.conflictId, "party");
    const enemyScriptEntityId = findScriptEntityId(ctx.world, ctx.cmd.conflictId, "enemy");
    if (!partyScriptEntityId || !enemyScriptEntityId) {
      throw new Error("script entities missing");
    }
    const partyScript = (
      ctx.world.get(partyScriptEntityId, [TbConflictScript]) as
        | { TbConflictScript: z.infer<typeof TbConflictScript.schema> }
        | undefined
    )?.TbConflictScript;
    const enemyScript = (
      ctx.world.get(enemyScriptEntityId, [TbConflictScript]) as
        | { TbConflictScript: z.infer<typeof TbConflictScript.schema> }
        | undefined
    )?.TbConflictScript;
    if (!partyScript || !enemyScript) throw new Error("scripts missing");
    const idx = conf.revealIndex;
    const partySlot = partyScript.slots[idx];
    const enemySlot = enemyScript.slots[idx];
    if (
      !partySlot ||
      !enemySlot ||
      partySlot.status === "empty" ||
      enemySlot.status === "empty"
    ) {
      throw new Error("both slots must be filled before reveal");
    }
    return [
      SlotRevealed({
        conflictId: ctx.cmd.conflictId,
        slotIndex: idx,
        partyScriptEntityId,
        enemyScriptEntityId,
        partySlot: {
          action: partySlot.action,
          performerCharacterId: partySlot.performerCharacterId,
          weaponItemId: partySlot.weaponItemId,
        },
        enemySlot: {
          action: enemySlot.action,
          performerCharacterId: enemySlot.performerCharacterId,
          weaponItemId: enemySlot.weaponItemId,
        },
      }),
    ];
  },
});

/* -------------------------------------------------------------------------
 * Round advance — GM-only. Clears both scripts and bumps the round.
 * ----------------------------------------------------------------------- */

export const AdvanceRound = defineCommand({
  name: "@vtt/system-torchbearer/AdvanceConflictRound",
  schema: z.object({
    conflictId: EntityId,
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    const r = requireRole(ctx, "gm");
    if (!r.ok) return r;
    return ok();
  },
  apply: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) throw new Error("validate let through missing conflict");
    return [
      RoundAdvanced({
        conflictId: ctx.cmd.conflictId,
        round: conf.round + 1,
      }),
    ];
  },
});

/* -------------------------------------------------------------------------
 * End / compromise
 * ----------------------------------------------------------------------- */

export const ApplyCompromise = defineCommand({
  name: "@vtt/system-torchbearer/ApplyConflictCompromise",
  schema: z.object({
    conflictId: EntityId,
    description: z.string().max(2000),
    conditions: z.array(
      z.object({
        characterId: EntityId,
        conditionId: z.enum([
          "hungryThirsty",
          "angry",
          "afraid",
          "exhausted",
          "injured",
          "sick",
          "dead",
        ]),
      }),
    ).default([]),
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    const r = requireRole(ctx, "gm");
    if (!r.ok) return r;
    return ok();
  },
  apply: (ctx) => [
    CompromiseApplied({
      conflictId: ctx.cmd.conflictId,
      description: ctx.cmd.description,
      conditions: ctx.cmd.conditions,
    }),
  ],
});

export const EndConflict = defineCommand({
  name: "@vtt/system-torchbearer/EndConflict",
  schema: z.object({
    conflictId: EntityId,
  }),
  validate: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) return fail("conflict not found");
    const r = requireRole(ctx, "gm");
    if (!r.ok) return r;
    return ok();
  },
  apply: (ctx) => {
    const conf = getConflict(ctx.world, ctx.cmd.conflictId);
    if (!conf) throw new Error("validate let through missing conflict");
    const winner = conf.winner ?? "tied";
    return [
      ConflictEnded({
        conflictId: ctx.cmd.conflictId,
        winner,
        suggestedCompromiseLevel: null,
        endedAt: Date.now(),
      }),
    ];
  },
});

void everyone;
void actors;

export const ALL_CONFLICT_COMMANDS = [
  DeclareConflict,
  ElectCaptain,
  RollDisposition,
  AssignHp,
  SetTeamDisposition,
  SetParticipantHp,
  ChooseWeapon,
  SetScriptSlot,
  ClearScriptSlot,
  LockScript,
  UnlockScript,
  RevealNextSlot,
  AdvanceRound,
  ApplyCompromise,
  EndConflict,
] as const;
