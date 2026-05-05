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
 * Universal-mirror systems for the post-roll fate / persona spend
 * pipeline. Each spend event has its own system so the per-event
 * traits/writes lists remain crisp; they share the small ledger /
 * pool / dice helpers below.
 *
 * Side effects per spend kind:
 *   - **Persona dice**:  decrement persona, append N d6 rolls to
 *     `RollResult.dice`, recompute `RollResult.total`.
 *   - **Channel Nature**: decrement persona, append `nature.rating`
 *     d6 rolls. Outside-of-nature tax fires post-resolution via
 *     `AdvancementLoggedNatureTaxSystem` (it needs the final
 *     pass/fail to compute the margin).
 *   - **Luck**:           decrement fate, append the cascading reroll
 *     dice carried in the event.
 *   - **DU**:             decrement fate, replace the rerolled die
 *     in `RollResult.dice`. Wise's `fate` flag is bumped (DH p.78
 *     evolving wises: "spend fate").
 *   - **OC**:             decrement persona, replace every rerolled
 *     die in `RollResult.dice`. Wise's `persona` flag is bumped.
 *   - **Synergy**:        decrement helper's fate, append ledger.
 *     Helper's advancement marker fires from a downstream system
 *     when the roller logs a passed test.
 */

import { defineSystem, type EntityId, type World } from "@vtt/substrate";
import {
  Formula,
  RollResolved,
  RolledBy,
  RollResult,
} from "@vtt/resolution/shared";
import {
  AdvancementLogged,
  DeeperUnderstandingSpent,
  LuckSpent,
  OfCourseSpent,
  SynergyAdvancementLoggedEvent,
} from "../shared/events.js";
import {
  Pools,
  RawAbilities,
  RollSpends,
  SynergyAdvancementLogged as SynergyAdvancementLoggedTrait,
  Wises,
  type RollSpendEntry,
} from "../shared/traits.js";
import {
  countSuccesses,
  TbRollMetaSchema,
  type TbRollSpec,
} from "../shared/roll-spec.js";

/* -------------------------------------------------------------------------
 * Shared mutation helpers — pulled out of the per-event run() bodies.
 * ----------------------------------------------------------------------- */

interface Die {
  sides: number | "F";
  value: number;
}

function readDice(world: World, rollId: EntityId): Die[] {
  const r = world.get(rollId, [RollResult]) as
    | { RollResult: { dice: Die[] } }
    | undefined;
  return [...(r?.RollResult.dice ?? [])];
}

function readSpec(world: World, rollId: EntityId): TbRollSpec | null {
  const f = world.get(rollId, [Formula]) as
    | { Formula: { meta?: unknown } }
    | undefined;
  if (!f) return null;
  const parsed = TbRollMetaSchema.safeParse(f.Formula.meta);
  return parsed.success ? parsed.data.spec : null;
}

function readPools(
  world: World,
  characterId: EntityId,
): { fate: { current: number; totalSpent: number }; persona: { current: number; totalSpent: number } } | undefined {
  return (world.get(characterId, [Pools]) as
    | {
        Pools: {
          fate: { current: number; totalSpent: number };
          persona: { current: number; totalSpent: number };
        };
      }
    | undefined)?.Pools;
}

function writePools(
  world: World,
  characterId: EntityId,
  next: {
    fate: { current: number; totalSpent: number };
    persona: { current: number; totalSpent: number };
  },
): void {
  world.set(characterId, Pools, next);
}

function debit(
  world: World,
  characterId: EntityId,
  pool: "fate" | "persona",
  cost: number,
): void {
  const p = readPools(world, characterId);
  if (!p) return;
  if (pool === "fate") {
    writePools(world, characterId, {
      fate: {
        current: Math.max(0, p.fate.current - cost),
        totalSpent: p.fate.totalSpent + cost,
      },
      persona: p.persona,
    });
  } else {
    writePools(world, characterId, {
      fate: p.fate,
      persona: {
        current: Math.max(0, p.persona.current - cost),
        totalSpent: p.persona.totalSpent + cost,
      },
    });
  }
}

function appendSpend(
  world: World,
  rollId: EntityId,
  entry: RollSpendEntry,
): void {
  const cur = world.get(rollId, [RollSpends]) as
    | { RollSpends: { entries: RollSpendEntry[] } }
    | undefined;
  const entries = cur ? [...cur.RollSpends.entries, entry] : [entry];
  world.set(rollId, RollSpends, { entries });
}

/**
 * Recompute `RollResult.total` for a TB roll from the (possibly
 * mutated) dice array. The rolling subsystem builds notation as
 * `Nd6>=T+B` so total = countSuccesses(dice, T) + bonusSuccesses;
 * we mirror that math here when dice change.
 */
function recomputeTotal(
  world: World,
  rollId: EntityId,
  dice: Die[],
): void {
  const spec = readSpec(world, rollId);
  if (!spec) return;
  let successes = 0;
  for (const d of dice) {
    if (d.sides !== 6) continue;
    if (d.value >= spec.successTarget) successes += 1;
  }
  const total = successes + spec.bonusSuccesses;
  const cur = world.get(rollId, [RollResult]) as
    | { RollResult: { total: number; output: string; rolledAt: number } }
    | undefined;
  if (!cur) return;
  world.set(rollId, RollResult, {
    total,
    output: cur.RollResult.output,
    rolledAt: cur.RollResult.rolledAt,
    dice,
  });
}

function setDice(
  world: World,
  rollId: EntityId,
  dice: Die[],
): void {
  recomputeTotal(world, rollId, dice);
}

/* -------------------------------------------------------------------------
 * TbCommitSpendsSystem — applies the pre-roll persona / channel-nature
 * / synergy declarations carried on `Formula.meta.spec` once the Roll
 * entity has materialised. Decrements the spending pools, writes
 * RollSpends ledger entries.
 *
 * The dice contributions for these spends are already folded into the
 * pool inside `buildSpec` (so the `RollResolved` event already carries
 * them in `dice` / `total`). What's left is the *sheet bookkeeping*:
 * pool debits + audit trail. We defer those to here so:
 *
 *   - Cancelling a pending roll never strands a debit (no commit, no
 *     debit).
 *   - The chat-card audit trail (RollSpends) and the rolled dice both
 *     live on the Roll entity, queryable as one unit.
 *   - The post-pass synergy advancement fan-out (`SynergyAdvancementSystem`)
 *     and the outside-of-nature tax (`ChannelNatureTaxSystem`) read
 *     from a single canonical source (RollSpends.entries).
 *
 * `RollResolved` is the resolution package's universal event — by the
 * time this system runs, `RollRecordingSystem` (registered by the
 * resolution plugin, loaded earlier in dep order) has already spawned
 * Formula / RollResult / RolledBy on the Roll entity.
 * ----------------------------------------------------------------------- */

export const TbCommitSpendsSystem = defineSystem({
  name: "TbCommitSpends",
  on: RollResolved,
  reads: [Pools, Formula, RolledBy, RollSpends],
  writes: [Pools, RollSpends],
  run: ({ event, world }) => {
    const meta = event.meta as { system?: unknown } | undefined;
    if (typeof meta?.system !== "string") return [];
    if (meta.system !== "@vtt/system-torchbearer") return [];
    const parsed = TbRollMetaSchema.safeParse(event.meta);
    if (!parsed.success) return [];
    const spec = parsed.data.spec;
    if (!world.has(event.rollId)) return [];
    const rollerCharacterId = (event.speakingAsCharacterId ?? "") as EntityId;
    const persona = spec.personaDiceSpent ?? 0;
    const channel = spec.channelNature ?? null;
    const synergyHelpers = spec.synergyHelpers ?? [];
    if (
      persona === 0 &&
      channel === null &&
      synergyHelpers.length === 0
    ) {
      return [];
    }
    if (persona > 0 && rollerCharacterId && world.has(rollerCharacterId)) {
      debit(world, rollerCharacterId, "persona", persona);
      appendSpend(world, event.rollId, {
        kind: "persona-dice",
        pool: "persona",
        cost: persona as 1 | 2 | 3,
        rerolledIndices: [],
        appendedCount: persona,
        newSuccesses: 0,
        byUserId: event.rolledByUserId,
        byCharacterId: rollerCharacterId,
        loggedAt: event.rolledAt,
      });
    }
    if (channel !== null && rollerCharacterId && world.has(rollerCharacterId)) {
      debit(world, rollerCharacterId, "persona", 1);
      appendSpend(world, event.rollId, {
        kind: "channel-nature",
        pool: "persona",
        cost: 1,
        rerolledIndices: [],
        appendedCount: channel.dice,
        newSuccesses: 0,
        channelScope: channel.scope,
        byUserId: event.rolledByUserId,
        byCharacterId: rollerCharacterId,
        loggedAt: event.rolledAt,
      });
    }
    for (const helperId of synergyHelpers) {
      if (!world.has(helperId as EntityId)) continue;
      debit(world, helperId as EntityId, "fate", 1);
      appendSpend(world, event.rollId, {
        kind: "synergy",
        pool: "fate",
        cost: 1,
        rerolledIndices: [],
        appendedCount: 0,
        newSuccesses: 0,
        byUserId: event.rolledByUserId,
        byCharacterId: helperId as EntityId,
        loggedAt: event.rolledAt,
      });
    }
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Luck — cascading reroll of 6s. The event carries the full cascade
 * outcome; this system just appends and records.
 * ----------------------------------------------------------------------- */

export const LuckSpentSystem = defineSystem({
  name: "LuckSpent",
  on: LuckSpent,
  reads: [Pools, Formula, RollResult, RollSpends],
  writes: [Pools, RollResult, RollSpends],
  run: ({ event, world }) => {
    if (!world.has(event.rollId)) return [];
    if (!world.has(event.characterId)) return [];
    const dice = readDice(world, event.rollId);
    const startIdx = dice.length;
    for (const d of event.appendedDice) dice.push(d as Die);
    setDice(world, event.rollId, dice);
    debit(world, event.characterId, "fate", 1);
    appendSpend(world, event.rollId, {
      kind: "luck",
      pool: "fate",
      cost: 1,
      rerolledIndices: [...event.rerolledIndices],
      appendedCount: event.appendedDice.length,
      newSuccesses: countNewSuccesses(world, event.rollId, dice, startIdx),
      byUserId: event.byUserId,
      byCharacterId: event.characterId,
      loggedAt: event.loggedAt,
    });
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Deeper Understanding — replace one failed die at the indicated index.
 * Bumps the wise's `fate` flag (DH p.78 evolving wises).
 * ----------------------------------------------------------------------- */

export const DeeperUnderstandingSpentSystem = defineSystem({
  name: "DeeperUnderstandingSpent",
  on: DeeperUnderstandingSpent,
  reads: [Pools, Formula, RollResult, RollSpends, Wises],
  writes: [Pools, RollResult, RollSpends, Wises],
  run: ({ event, world }) => {
    if (!world.has(event.rollId)) return [];
    if (!world.has(event.characterId)) return [];
    const dice = readDice(world, event.rollId);
    if (event.rerolledIndex >= dice.length) return [];
    const before = dice[event.rerolledIndex]!;
    const spec = readSpec(world, event.rollId);
    const wasFail = spec ? before.value < spec.successTarget : false;
    const isPass = spec ? event.newValue >= spec.successTarget : false;
    dice[event.rerolledIndex] = { sides: 6, value: event.newValue };
    setDice(world, event.rollId, dice);
    debit(world, event.characterId, "fate", 1);
    bumpWise(world, event.characterId, event.wiseIndex, "fate");
    appendSpend(world, event.rollId, {
      kind: "deeper-understanding",
      pool: "fate",
      cost: 1,
      rerolledIndices: [event.rerolledIndex],
      appendedCount: 0,
      newSuccesses: wasFail && isPass ? 1 : 0,
      wiseIndex: event.wiseIndex,
      byUserId: event.byUserId,
      byCharacterId: event.characterId,
      loggedAt: event.loggedAt,
    });
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Of Course! — replace every rerolled failed die. Bumps the wise's
 * `persona` flag.
 * ----------------------------------------------------------------------- */

export const OfCourseSpentSystem = defineSystem({
  name: "OfCourseSpent",
  on: OfCourseSpent,
  reads: [Pools, Formula, RollResult, RollSpends, Wises],
  writes: [Pools, RollResult, RollSpends, Wises],
  run: ({ event, world }) => {
    if (!world.has(event.rollId)) return [];
    if (!world.has(event.characterId)) return [];
    const dice = readDice(world, event.rollId);
    const spec = readSpec(world, event.rollId);
    let newSuccesses = 0;
    for (let i = 0; i < event.rerolledIndices.length; i += 1) {
      const idx = event.rerolledIndices[i]!;
      const newValue = event.newValues[i]!;
      if (idx >= dice.length) continue;
      const before = dice[idx]!;
      if (spec) {
        const wasFail = before.value < spec.successTarget;
        const isPass = newValue >= spec.successTarget;
        if (wasFail && isPass) newSuccesses += 1;
      }
      dice[idx] = { sides: 6, value: newValue };
    }
    setDice(world, event.rollId, dice);
    debit(world, event.characterId, "persona", 1);
    bumpWise(world, event.characterId, event.wiseIndex, "persona");
    appendSpend(world, event.rollId, {
      kind: "of-course",
      pool: "persona",
      cost: 1,
      rerolledIndices: [...event.rerolledIndices],
      appendedCount: 0,
      newSuccesses,
      wiseIndex: event.wiseIndex,
      byUserId: event.byUserId,
      byCharacterId: event.characterId,
      loggedAt: event.loggedAt,
    });
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Internal helpers
 * ----------------------------------------------------------------------- */

function countNewSuccesses(
  world: World,
  rollId: EntityId,
  dice: Die[],
  startIdx: number,
): number {
  const spec = readSpec(world, rollId);
  if (!spec) return 0;
  let n = 0;
  for (let i = startIdx; i < dice.length; i += 1) {
    const d = dice[i]!;
    if (d.sides !== 6) continue;
    if (d.value >= spec.successTarget) n += 1;
  }
  return n;
}

/* -------------------------------------------------------------------------
 * Channel Nature outside-of-nature tax (DH p.67-68)
 *
 *   - Within Nature: no tax (handled by absence of system reaction).
 *   - Outside, pass:  nature.rating -1
 *   - Outside, fail:  nature.rating -= margin of failure
 *
 * Hooks AdvancementLogged because that's when the player commits the
 * roll's outcome on the chat card. For dispositionMode / un-logged
 * rolls the tax doesn't fire — those don't go through advancement, and
 * channeling there is uncommon enough that we'd add a separate
 * "Mark Outcome" path before pursuing it.
 * ----------------------------------------------------------------------- */

export const ChannelNatureTaxSystem = defineSystem({
  name: "ChannelNatureTax",
  on: AdvancementLogged,
  reads: [RollSpends, RollResult, Formula, RawAbilities],
  writes: [RawAbilities],
  run: ({ event, world }) => {
    if (!world.has(event.rollId)) return [];
    const spendsTrait = world.get(event.rollId, [RollSpends]) as
      | { RollSpends: { entries: ReadonlyArray<RollSpendEntry> } }
      | undefined;
    if (!spendsTrait) return [];
    const channel = spendsTrait.RollSpends.entries.find(
      (e) => e.kind === "channel-nature" && e.channelScope === "outside",
    );
    if (!channel) return [];
    const characterId = channel.byCharacterId as EntityId;
    if (!world.has(characterId)) return [];
    const ab = world.get(characterId, [RawAbilities]) as
      | {
          RawAbilities: {
            will: { rating: number; advancement: { pass: number; fail: number } };
            health: { rating: number; advancement: { pass: number; fail: number } };
            nature: {
              rating: number;
              maximum: number;
              advancement: { pass: number; fail: number };
              descriptors: string[];
            };
          };
        }
      | undefined;
    if (!ab) return [];
    let tax = 1;
    if (event.outcome === "fail") {
      const spec = readSpec(world, event.rollId);
      const dice = readDice(world, event.rollId);
      if (spec) {
        const successes =
          countSuccesses(dice, spec.successTarget) + spec.bonusSuccesses;
        const obstacle = spec.obstacle ?? 0;
        const margin = Math.max(1, obstacle - successes);
        tax = margin;
      }
    }
    const nextRating = Math.max(0, ab.RawAbilities.nature.rating - tax);
    if (nextRating === ab.RawAbilities.nature.rating) return [];
    world.set(characterId, RawAbilities, {
      ...ab.RawAbilities,
      nature: { ...ab.RawAbilities.nature, rating: nextRating },
    });
    return [];
  },
});

/* -------------------------------------------------------------------------
 * SynergyAdvancementLoggedSystem (DH p.87 / SG p.87)
 *
 *   "If the player rolling the dice passes the test, the helper marks
 *    a passed test for advancement for the skill or ability with
 *    which they helped, not necessarily the one being tested. If they
 *    fail, they mark a failed test."
 *
 * Listens to `SynergyAdvancementLoggedEvent` — emitted by the
 * `LogSynergyAdvancement` command when a helper's player clicks their
 * per-roll Log button on the chat card. Mirrors the `LogTraitUsage`
 * deferred-mutation pattern: the helper's character sheet only moves
 * when their player explicitly commits, so a redo / undo doesn't
 * strand state.
 *
 * Side effects:
 *   - Append the helper to the roll's `SynergyAdvancementLogged`
 *     marker so the chat card hides the button (one log per helper).
 *   - Emit a fresh `AdvancementLogged` for the helper carrying the
 *     resolved target. The standard `AdvancementLoggedSystem` then
 *     bumps the helper's pass/fail track.
 * ----------------------------------------------------------------------- */

export const SynergyAdvancementLoggedSystem = defineSystem({
  name: "SynergyAdvancementLogged",
  on: SynergyAdvancementLoggedEvent,
  reads: [SynergyAdvancementLoggedTrait],
  writes: [SynergyAdvancementLoggedTrait],
  run: ({ event, world }) => {
    if (!world.has(event.rollId)) return [];
    const cur = world.get(event.rollId, [SynergyAdvancementLoggedTrait]) as
      | {
          SynergyAdvancementLogged: {
            entries: ReadonlyArray<{
              helperCharacterId: string;
              target: { kind: string; id: string; label: string };
              outcome: "pass" | "fail";
              loggedAt: number;
            }>;
          };
        }
      | undefined;
    const prior = cur?.SynergyAdvancementLogged.entries ?? [];
    if (
      prior.some((e) => e.helperCharacterId === event.helperCharacterId)
    ) {
      // Defensive: the validator already rejects double-logs, but
      // mirror systems run on every node and a stale snapshot might
      // have missed the prior log. Idempotent.
      return [];
    }
    world.set(event.rollId, SynergyAdvancementLoggedTrait, {
      entries: [
        ...prior,
        {
          helperCharacterId: event.helperCharacterId,
          target: event.target,
          outcome: event.outcome,
          loggedAt: event.loggedAt,
        },
      ],
    });
    return [
      AdvancementLogged({
        rollId: event.rollId,
        characterId: event.helperCharacterId,
        target: event.target,
        outcome: event.outcome,
        loggedAt: event.loggedAt,
      }),
    ];
  },
});

function bumpWise(
  world: World,
  characterId: EntityId,
  wiseIndex: number,
  field: "fate" | "persona",
): void {
  const cur = world.get(characterId, [Wises]) as
    | {
        Wises: {
          entries: ReadonlyArray<{
            name: string;
            pass: boolean;
            fail: boolean;
            fate: boolean;
            persona: boolean;
          }>;
        };
      }
    | undefined;
  const entries = cur?.Wises.entries;
  if (!entries) return;
  if (wiseIndex >= entries.length) return;
  const next = entries.map((e, i) =>
    i === wiseIndex ? { ...e, [field]: true } : e,
  );
  world.set(characterId, Wises, { entries: next });
}
