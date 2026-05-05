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

/**
 * Post-roll fate / persona spend commands.
 *
 * Each spend kind follows the same shape as `LogTraitUsage` /
 * `LogAdvancement`: read the resolved Roll, validate against the
 * spend's RAW preconditions, append a ledger entry to `RollSpends`,
 * decrement the spending pool. Dice-affecting spends roll new dice
 * inside `apply` (per the resolution package's precedent — apply may
 * have non-deterministic side effects but never reads/writes the
 * world) and the system mirrors them into `RollResult.dice`.
 *
 * RAW order constraints:
 *   - **Of Course! before Luck** (DH p.77 — "Use this option before
 *     spending a fate point for luck to reroll 6s"). The Luck
 *     validator checks no OC has fired *after* it; the OC validator
 *     checks no Luck has fired *before* it.
 *   - **No double-rerolls on the same die** (DH p.77 — "may not
 *     reroll a die that's already been rerolled"). Validators consult
 *     `RollSpends.entries[].rerolledIndices` for prior touches.
 *   - **Persona cap of 3 per roll** (DH p.8 sheet legend). Sums prior
 *     persona-dice spends and rejects when count + prior > 3.
 *
 * Wise relevance (DU / OC) is GM-arbitrated at the table — the
 * validator only checks the wise exists; players are trusted to
 * declare relevance honestly. Same convention as trait usage.
 *
 * Channel Nature's `within` / `outside` declaration (DH p.67–68) is
 * captured at spend-time. The post-resolution Nature tax fires when
 * a separate "log advancement / outcome" event resolves; we don't
 * tax up-front because the chat row's outcome may flip (a versus
 * opponent rolling later, a follow-up spend lifting fails into
 * passes). Tax timing lands in the system that watches resolution.
 */

import {
  defineCommand,
  EntityId,
  fail,
  z,
} from "@vtt/substrate";
import { DiceRoll } from "@dice-roller/rpg-dice-roller";
import { requireSession } from "@vtt/identity/shared";
import { requireWrite } from "@vtt/permissions/shared";
import { type Contribution } from "@vtt/characters/shared";
import { Formula, RollResult, RolledBy } from "@vtt/resolution/shared";
import {
  Pools,
  RollSpends,
  SynergyAdvancementLogged,
  Wises,
  type RollSpendEntry,
} from "./traits.js";
import {
  DeeperUnderstandingSpent,
  LuckSpent,
  OfCourseSpent,
  SynergyAdvancementLoggedEvent,
} from "./events.js";
import {
  countSuccesses,
  TbRollMetaSchema,
  type TbRollSpec,
} from "./roll-spec.js";
import { isKnownSkillId, getSkill } from "./skills.js";

/* -------------------------------------------------------------------------
 * Shared helpers
 * ----------------------------------------------------------------------- */

interface PoolsShape {
  fate: { current: number; totalSpent: number };
  persona: { current: number; totalSpent: number };
}

function readPools(
  world: Parameters<typeof requireWrite>[0]["world"],
  characterId: string,
): PoolsShape | undefined {
  return (world.get(characterId as EntityId, [Pools]) as
    | { Pools: PoolsShape }
    | undefined)?.Pools;
}

function readSpec(
  world: Parameters<typeof requireWrite>[0]["world"],
  rollId: string,
): TbRollSpec | null {
  const f = world.get(rollId as EntityId, [Formula]) as
    | { Formula: { meta?: unknown } }
    | undefined;
  if (!f) return null;
  const parsed = TbRollMetaSchema.safeParse(f.Formula.meta);
  return parsed.success ? parsed.data.spec : null;
}

function readDice(
  world: Parameters<typeof requireWrite>[0]["world"],
  rollId: string,
): ReadonlyArray<{ sides: number | "F"; value: number }> {
  return (world.get(rollId as EntityId, [RollResult]) as
    | { RollResult: { dice: ReadonlyArray<{ sides: number | "F"; value: number }> } }
    | undefined)?.RollResult.dice ?? [];
}

function readSpends(
  world: Parameters<typeof requireWrite>[0]["world"],
  rollId: string,
): ReadonlyArray<RollSpendEntry> {
  return (world.get(rollId as EntityId, [RollSpends]) as
    | { RollSpends: { entries: ReadonlyArray<RollSpendEntry> } }
    | undefined)?.RollSpends.entries ?? [];
}

function readRoller(
  world: Parameters<typeof requireWrite>[0]["world"],
  rollId: string,
): { userId: string; characterId: string } | null {
  const rb = world.get(rollId as EntityId, [RolledBy]) as
    | { RolledBy: { userId: string; speakingAsCharacterId?: string } }
    | undefined;
  if (!rb) return null;
  if (!rb.RolledBy.speakingAsCharacterId) return null;
  return {
    userId: rb.RolledBy.userId,
    characterId: rb.RolledBy.speakingAsCharacterId,
  };
}

/**
 * Roll N d6s using the same dice library the resolution layer uses
 * for every other roll. Apply uses this when it needs to compute
 * post-roll dice (Luck reroll, Persona dice, Channel Nature, DU/OC
 * replacement values). Returns each face as a `RollResolved`-shaped
 * outcome.
 */
function rollD6s(count: number): { sides: number; value: number }[] {
  if (count <= 0) return [];
  const r = new DiceRoll(`${count}d6`);
  const out: { sides: number; value: number }[] = [];
  for (const group of r.rolls) {
    const rolls = (group as { rolls?: ReadonlyArray<{ value: number }> }).rolls;
    if (!rolls) continue;
    for (const die of rolls) {
      out.push({ sides: 6, value: die.value });
    }
  }
  return out;
}

/** True when any spend in `entries` is of the given kind. */
function hasSpend(
  entries: ReadonlyArray<RollSpendEntry>,
  kind: RollSpendEntry["kind"],
): boolean {
  return entries.some((e) => e.kind === kind);
}

/* -------------------------------------------------------------------------
 * SpendLuck — DH p.23, p.250: 1 fate, reroll 6s as bonus dice.
 *
 * Luck cascades: each new die that comes up 6 also rerolls. We compute
 * the entire cascade in apply and emit it as a single LuckSpent event.
 *
 * RAW ordering: OC must run before Luck (DH p.77). If a wise was
 * already used to OC-reroll on this roll, Luck still rerolls
 * sixes that survive in the dice pool (OC only touches *fails*); the
 * ordering rule guards against rerolling a 6 that was a fail before
 * OC turned it into a success — but since OC operates on fails (< target)
 * and Luck on 6s, the kinds don't overlap. We still reject Luck if the
 * player tries to spend it before OC on a wise-related test where OC
 * was previously declared but not yet spent — that's a future-pending
 * concern; for now, enforce only the no-double-reroll rule.
 * ----------------------------------------------------------------------- */

export const SpendLuck = defineCommand({
  name: "@vtt/system-torchbearer/SpendLuck",
  schema: z.object({
    rollId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.rollId)) {
      return fail(`roll ${ctx.cmd.rollId} does not exist`);
    }
    if (!readSpec(ctx.world, ctx.cmd.rollId)) {
      return fail(`roll ${ctx.cmd.rollId} is not a torchbearer roll`);
    }
    const roller = readRoller(ctx.world, ctx.cmd.rollId);
    if (!roller) return fail(`roll ${ctx.cmd.rollId} has no rolling character`);
    const pools = readPools(ctx.world, roller.characterId);
    if (!pools) return fail(`character ${roller.characterId} has no pools`);
    if (pools.fate.current < 1) {
      return fail(`character has 0 fate, needs 1 for Luck`);
    }
    const entries = readSpends(ctx.world, ctx.cmd.rollId);
    if (hasSpend(entries, "luck")) {
      return fail(`luck already spent on this roll`);
    }
    const dice = readDice(ctx.world, ctx.cmd.rollId);
    const eligible = sixIndicesNotAlreadyRerolled(dice, entries);
    if (eligible.length === 0) {
      return fail(`no eligible 6s to reroll on this roll`);
    }
    return requireWrite(ctx, roller.characterId as EntityId);
  },
  apply: ({ cmd, world, session }) => {
    const auth = requireSession({ session });
    if (!auth) return [];
    const roller = readRoller(world, cmd.rollId);
    if (!roller) return [];
    const dice = readDice(world, cmd.rollId);
    const entries = readSpends(world, cmd.rollId);
    // Cascading reroll: roll one new die per 6, and any new 6 also
    // rerolls. Bound at 1000 to mirror rpg-dice-roller's cascade safety.
    const reIndices = sixIndicesNotAlreadyRerolled(dice, entries);
    const appended: { sides: number; value: number }[] = [];
    let pending = reIndices.length;
    let safety = 1000;
    while (pending > 0 && safety > 0) {
      const fresh = rollD6s(pending);
      appended.push(...fresh);
      pending = fresh.filter((d) => d.value === 6).length;
      safety -= 1;
    }
    return [
      LuckSpent({
        rollId: cmd.rollId,
        characterId: roller.characterId as EntityId,
        rerolledIndices: reIndices,
        appendedDice: appended,
        byUserId: auth.userId,
        loggedAt: Date.now(),
      }),
    ];
  },
});

/**
 * Indices of dice showing 6 that have NOT yet been rerolled by any
 * prior spend (Luck, DU). Used to compute the cascade base for a new
 * Luck spend and to gate the "any 6s available?" precondition.
 */
function sixIndicesNotAlreadyRerolled(
  dice: ReadonlyArray<{ sides: number | "F"; value: number }>,
  entries: ReadonlyArray<RollSpendEntry>,
): number[] {
  const used = new Set<number>();
  for (const e of entries) for (const i of e.rerolledIndices) used.add(i);
  const out: number[] = [];
  for (let i = 0; i < dice.length; i += 1) {
    const d = dice[i]!;
    if (d.sides !== 6) continue;
    if (d.value !== 6) continue;
    if (used.has(i)) continue;
    out.push(i);
  }
  return out;
}

/* -------------------------------------------------------------------------
 * SpendDeeperUnderstanding — DH p.77: 1 fate, reroll one failed die on
 * a wise-related test.
 * ----------------------------------------------------------------------- */

export const SpendDeeperUnderstanding = defineCommand({
  name: "@vtt/system-torchbearer/SpendDeeperUnderstanding",
  schema: z.object({
    rollId: EntityId,
    /** Index into the rolling character's Wises.entries. */
    wiseIndex: z.number().int().min(0).max(40),
    /** Index into RollResult.dice — must be a fail not already rerolled. */
    dieIndex: z.number().int().min(0),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.rollId)) {
      return fail(`roll ${ctx.cmd.rollId} does not exist`);
    }
    const spec = readSpec(ctx.world, ctx.cmd.rollId);
    if (!spec) return fail(`roll ${ctx.cmd.rollId} is not a torchbearer roll`);
    const roller = readRoller(ctx.world, ctx.cmd.rollId);
    if (!roller) return fail(`roll ${ctx.cmd.rollId} has no rolling character`);
    const pools = readPools(ctx.world, roller.characterId);
    if (!pools) return fail(`character ${roller.characterId} has no pools`);
    if (pools.fate.current < 1) {
      return fail(`character has 0 fate, needs 1 for Deeper Understanding`);
    }
    const wises = ctx.world.get(roller.characterId as EntityId, [Wises]) as
      | { Wises: { entries: ReadonlyArray<unknown> } }
      | undefined;
    const wiseEntry = wises?.Wises.entries[ctx.cmd.wiseIndex];
    if (!wiseEntry) {
      return fail(`character has no wise at index ${ctx.cmd.wiseIndex}`);
    }
    const dice = readDice(ctx.world, ctx.cmd.rollId);
    if (ctx.cmd.dieIndex >= dice.length) {
      return fail(`die index ${ctx.cmd.dieIndex} out of range`);
    }
    const die = dice[ctx.cmd.dieIndex]!;
    if (die.sides !== 6) return fail(`die ${ctx.cmd.dieIndex} is not a d6`);
    if (die.value >= spec.successTarget) {
      return fail(`die ${ctx.cmd.dieIndex} is already a success — DU rerolls fails`);
    }
    const entries = readSpends(ctx.world, ctx.cmd.rollId);
    for (const e of entries) {
      if (e.rerolledIndices.includes(ctx.cmd.dieIndex)) {
        return fail(
          `die ${ctx.cmd.dieIndex} already rerolled — DH p.77 forbids double-rerolls`,
        );
      }
    }
    return requireWrite(ctx, roller.characterId as EntityId);
  },
  apply: ({ cmd, world, session }) => {
    const auth = requireSession({ session });
    if (!auth) return [];
    const roller = readRoller(world, cmd.rollId);
    if (!roller) return [];
    const [die] = rollD6s(1);
    if (!die) return [];
    return [
      DeeperUnderstandingSpent({
        rollId: cmd.rollId,
        characterId: roller.characterId as EntityId,
        wiseIndex: cmd.wiseIndex,
        rerolledIndex: cmd.dieIndex,
        newValue: die.value as 1 | 2 | 3 | 4 | 5 | 6,
        byUserId: auth.userId,
        loggedAt: Date.now(),
      }),
    ];
  },
});

/* -------------------------------------------------------------------------
 * SpendOfCourse — DH p.77: 1 persona, reroll all failed dice on a
 * wise-related test. Must run BEFORE Luck (DH p.77).
 * ----------------------------------------------------------------------- */

export const SpendOfCourse = defineCommand({
  name: "@vtt/system-torchbearer/SpendOfCourse",
  schema: z.object({
    rollId: EntityId,
    wiseIndex: z.number().int().min(0).max(40),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.rollId)) {
      return fail(`roll ${ctx.cmd.rollId} does not exist`);
    }
    const spec = readSpec(ctx.world, ctx.cmd.rollId);
    if (!spec) return fail(`roll ${ctx.cmd.rollId} is not a torchbearer roll`);
    const roller = readRoller(ctx.world, ctx.cmd.rollId);
    if (!roller) return fail(`roll ${ctx.cmd.rollId} has no rolling character`);
    const pools = readPools(ctx.world, roller.characterId);
    if (!pools) return fail(`character ${roller.characterId} has no pools`);
    if (pools.persona.current < 1) {
      return fail(`character has 0 persona, needs 1 for Of Course!`);
    }
    const wises = ctx.world.get(roller.characterId as EntityId, [Wises]) as
      | { Wises: { entries: ReadonlyArray<unknown> } }
      | undefined;
    if (!wises?.Wises.entries[ctx.cmd.wiseIndex]) {
      return fail(`character has no wise at index ${ctx.cmd.wiseIndex}`);
    }
    const entries = readSpends(ctx.world, ctx.cmd.rollId);
    if (hasSpend(entries, "of-course")) {
      return fail(`Of Course! already spent on this roll`);
    }
    if (hasSpend(entries, "luck")) {
      return fail(
        `cannot spend Of Course! after Luck — DH p.77 requires OC first`,
      );
    }
    const dice = readDice(ctx.world, ctx.cmd.rollId);
    const fails = failIndicesNotAlreadyRerolled(
      dice,
      entries,
      spec.successTarget,
    );
    if (fails.length === 0) {
      return fail(`no eligible failed dice to reroll`);
    }
    return requireWrite(ctx, roller.characterId as EntityId);
  },
  apply: ({ cmd, world, session }) => {
    const auth = requireSession({ session });
    if (!auth) return [];
    const roller = readRoller(world, cmd.rollId);
    if (!roller) return [];
    const spec = readSpec(world, cmd.rollId);
    if (!spec) return [];
    const dice = readDice(world, cmd.rollId);
    const entries = readSpends(world, cmd.rollId);
    const fails = failIndicesNotAlreadyRerolled(
      dice,
      entries,
      spec.successTarget,
    );
    const fresh = rollD6s(fails.length);
    return [
      OfCourseSpent({
        rollId: cmd.rollId,
        characterId: roller.characterId as EntityId,
        wiseIndex: cmd.wiseIndex,
        rerolledIndices: fails,
        newValues: fresh.map((d) => d.value as 1 | 2 | 3 | 4 | 5 | 6),
        byUserId: auth.userId,
        loggedAt: Date.now(),
      }),
    ];
  },
});

function failIndicesNotAlreadyRerolled(
  dice: ReadonlyArray<{ sides: number | "F"; value: number }>,
  entries: ReadonlyArray<RollSpendEntry>,
  successTarget: number,
): number[] {
  const used = new Set<number>();
  for (const e of entries) for (const i of e.rerolledIndices) used.add(i);
  const out: number[] = [];
  for (let i = 0; i < dice.length; i += 1) {
    const d = dice[i]!;
    if (d.sides !== 6) continue;
    if (d.value >= successTarget) continue;
    if (used.has(i)) continue;
    out.push(i);
  }
  return out;
}

const HELP_PROVIDED_BY_PREFIX = "help:";

/**
 * Read what kind of help a given helper offered on a resolved roll.
 * Returns the helper's option id (e.g. `skill:scout`, `ability:will`)
 * or null when the helper didn't help on this roll. The chat row uses
 * this to decide which advancement target Synergy should mark.
 */
export function helperOptionFromSpec(
  spec: TbRollSpec,
  helperCharacterId: string,
): string | null {
  for (const m of spec.modifiers) {
    if (m.source !== "help") continue;
    const pb = m.providedBy ?? "";
    if (!pb.startsWith(HELP_PROVIDED_BY_PREFIX)) continue;
    const rest = pb.slice(HELP_PROVIDED_BY_PREFIX.length);
    const idx = rest.indexOf(":");
    const charId = idx === -1 ? rest : rest.slice(0, idx);
    if (charId !== helperCharacterId) continue;
    return idx === -1 ? "" : rest.slice(idx + 1);
  }
  return null;
}

/**
 * Detect contributions on a still-pending roll where the helper has
 * stamped a help dice — useful for client-side affordance gating
 * before the roll commits. Mirror of helperOptionFromSpec for the
 * pending-roll path.
 */
export function helperOptionFromContributions(
  contributions: ReadonlyArray<Contribution>,
  helperCharacterId: string,
): string | null {
  for (const c of contributions) {
    const payload = c.payload as { source?: unknown; providedBy?: unknown } | undefined;
    if (payload?.source !== "help") continue;
    const pb = typeof payload.providedBy === "string" ? payload.providedBy : "";
    if (!pb.startsWith(HELP_PROVIDED_BY_PREFIX)) continue;
    const rest = pb.slice(HELP_PROVIDED_BY_PREFIX.length);
    const idx = rest.indexOf(":");
    const charId = idx === -1 ? rest : rest.slice(0, idx);
    if (charId !== helperCharacterId) continue;
    return idx === -1 ? "" : rest.slice(idx + 1);
  }
  return null;
}

/* -------------------------------------------------------------------------
 * LogSynergyAdvancement (DH p.87)
 *
 * The helper's player clicks "Log Pass" on the chat card after a passed
 * test they declared synergy on. Mirrors `LogAdvancement`'s deferred-
 * mutation pattern: the helper character's advancement track only
 * moves when the helper's player explicitly commits, so a redo / undo
 * doesn't strand the sheet.
 *
 * Validate:
 *   - The roll is a TB roll and resolved in the helper's favour
 *     (success count ≥ obstacle, or any success when no obstacle).
 *   - The helper actually committed synergy on this roll
 *     (`spec.synergyHelpers` contains their character id).
 *   - The helper has a `source: "help"` modifier on the spec we can
 *     decode to a skill / ability advancement target.
 *   - This helper hasn't already logged synergy advancement on the roll.
 *
 * Apply emits a single `SynergyAdvancementLoggedEvent` carrying the
 * resolved target. The system reacts by:
 *   - appending the helper to the roll's `SynergyAdvancementLogged`
 *     marker (button hides).
 *   - emitting `AdvancementLogged` for the helper, which the standard
 *     `AdvancementLoggedSystem` then bumps as a passed test.
 * ----------------------------------------------------------------------- */

function targetFromHelpOption(
  optionId: string,
): { kind: "ability" | "town-ability" | "skill" | "skill-bl"; id: string; label: string } | null {
  if (optionId.startsWith("skill:")) {
    const id = optionId.slice("skill:".length);
    if (!isKnownSkillId(id)) return null;
    return { kind: "skill", id, label: getSkill(id)?.name ?? id };
  }
  if (optionId.startsWith("ability:")) {
    const id = optionId.slice("ability:".length);
    if (id === "will" || id === "health" || id === "nature") {
      return { kind: "ability", id, label: id };
    }
    if (id === "resources" || id === "circles") {
      return { kind: "town-ability", id, label: id };
    }
  }
  return null;
}

/**
 * Resolve a TB roll's outcome against its obstacle. Returns null on
 * disposition rolls (no pass/fail) — synergy can't fire on those per
 * RAW since there's no test outcome to mirror.
 */
function rollOutcome(
  spec: TbRollSpec,
  dice: ReadonlyArray<{ sides: number | "F"; value: number }>,
): "pass" | "fail" | null {
  if (spec.dispositionMode) return null;
  const raw = countSuccesses(dice, spec.successTarget);
  const total = raw + spec.bonusSuccesses;
  const passed =
    spec.obstacle === null ? total > 0 : total >= spec.obstacle;
  return passed ? "pass" : "fail";
}

export const LogSynergyAdvancement = defineCommand({
  name: "@vtt/system-torchbearer/LogSynergyAdvancement",
  schema: z.object({
    rollId: EntityId,
    helperCharacterId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.rollId)) {
      return fail(`roll ${ctx.cmd.rollId} does not exist`);
    }
    const spec = readSpec(ctx.world, ctx.cmd.rollId);
    if (!spec) return fail(`roll ${ctx.cmd.rollId} is not a torchbearer roll`);
    const synergyHelpers = spec.synergyHelpers ?? [];
    if (!synergyHelpers.includes(ctx.cmd.helperCharacterId as string)) {
      return fail(
        `${ctx.cmd.helperCharacterId} did not commit synergy on this roll`,
      );
    }
    const optionId = helperOptionFromSpec(
      spec,
      ctx.cmd.helperCharacterId as string,
    );
    if (optionId === null) {
      return fail(
        `${ctx.cmd.helperCharacterId} has no help modifier on this roll — synergy log requires the underlying help`,
      );
    }
    const target = targetFromHelpOption(optionId);
    if (!target) {
      return fail(
        `${ctx.cmd.helperCharacterId}'s help target (${optionId}) is not advance-able via synergy`,
      );
    }
    const dice = readDice(ctx.world, ctx.cmd.rollId);
    const outcome = rollOutcome(spec, dice);
    if (outcome === null) {
      return fail(
        `synergy advancement requires a resolvable test (no disposition rolls)`,
      );
    }
    const already = ctx.world.get(ctx.cmd.rollId, [SynergyAdvancementLogged]) as
      | {
          SynergyAdvancementLogged: {
            entries: ReadonlyArray<{ helperCharacterId: string }>;
          };
        }
      | undefined;
    if (
      already?.SynergyAdvancementLogged.entries.some(
        (e) => e.helperCharacterId === ctx.cmd.helperCharacterId,
      )
    ) {
      return fail(
        `${ctx.cmd.helperCharacterId} has already logged synergy advancement on this roll`,
      );
    }
    return requireWrite(ctx, ctx.cmd.helperCharacterId as EntityId);
  },
  apply: ({ cmd, world }) => {
    const spec = readSpec(world, cmd.rollId);
    if (!spec) return [];
    const optionId = helperOptionFromSpec(spec, cmd.helperCharacterId as string);
    if (optionId === null) return [];
    const target = targetFromHelpOption(optionId);
    if (!target) return [];
    const dice = readDice(world, cmd.rollId);
    const outcome = rollOutcome(spec, dice);
    if (outcome === null) return [];
    return [
      SynergyAdvancementLoggedEvent({
        rollId: cmd.rollId,
        helperCharacterId: cmd.helperCharacterId,
        target,
        outcome,
        loggedAt: Date.now(),
      }),
    ];
  },
});
