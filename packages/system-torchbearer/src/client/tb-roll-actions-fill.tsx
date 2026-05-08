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

import { qualifiedName, type CommandInstance, type EntityId } from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import {
  Formula,
  RolledBy,
  RollResult,
  type RollActionsArgs,
  type RollActionsContributor,
} from "@vtt/resolution/shared";
import { kit } from "@vtt/characters/client";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import {
  AdvancementLoggedTrait,
  countSuccesses,
  LogAdvancement,
  LogSynergyAdvancement,
  LogTraitUsage,
  Pools,
  RawAbilities,
  RollSpends,
  resolveSuccessCount,
  Skills,
  SpendDeeperUnderstanding,
  SpendLuck,
  SpendOfCourse,
  SynergyAdvancementLoggedTrait,
  TbMonster,
  TbRollMetaSchema,
  TownAbilities,
  TraitUsageLoggedTrait,
  traitUsageFromSpec,
  Wises,
  type RollSpendEntry,
  type TbRollSpec,
} from "../shared/index.js";
import { Character } from "@vtt/characters/shared";
import { canWrite, Permissions } from "@vtt/permissions/shared";
import { SpellCastActions } from "./spell-cast-actions.js";
import { InvocationPerformActions } from "./invocation-perform-actions.js";

/**
 * Post-roll action panel for a TB roll's chat card.
 *
 * Carved out of `TbRollRow` so the substrate's `RollActionsSlot`
 * stacks system-specific buttons cleanly. The row keeps headline /
 * dice / result rendering; this fill owns the buttons + the small
 * confirmation footers that replace them after a click.
 *
 * Buttons surfaced today:
 *   - Log Beneficial Use / Log Check (+1 or +2) — trait usage on the
 *     pending roll's structured `providedBy` (DH p.79–80).
 *   - Log Pass / Log Fail / Log Test (BL) — advancement entry
 *     (DH p.74–75, p.108).
 *
 * Future fate/persona spends (Luck, DU, OC, Persona dice, Channel
 * Nature, Synergy) land here as additional sections without touching
 * the row layout.
 */

const ADVANCE_ABILITY_IDS = new Set(["will", "health", "nature"]);
const ADVANCE_TOWN_ABILITY_IDS = new Set(["resources", "circles"]);

function specIsAdvanceable(spec: TbRollSpec): boolean {
  if (spec.dispositionMode) return false;
  if (!spec.sourceId) return false;
  if (spec.kind === "ability") return ADVANCE_ABILITY_IDS.has(spec.sourceId);
  if (spec.kind === "town-ability")
    return ADVANCE_TOWN_ABILITY_IDS.has(spec.sourceId);
  if (spec.kind === "skill" || spec.kind === "skill-bl") return true;
  return false;
}

/**
 * DH p.108 advancement thresholds: rating R needs R passes and R-1
 * fails (clamped at 1/0 for rating ≤ 1). Mirror of the server-side
 * helper in commands.ts; duplicated client-side so the chat row's
 * gate logic doesn't need a server round-trip.
 */
function computeAdvancementThreshold(rating: number): {
  passNeeded: number;
  failNeeded: number;
} {
  if (rating <= 1) return { passNeeded: 1, failNeeded: 0 };
  return { passNeeded: rating, failNeeded: rating - 1 };
}

interface RatedEntryShape {
  rating: number;
  advancement: { pass: number; fail: number };
}

/**
 * Pull the rolling character's advancement entry for a given spec
 * (`ability` / `town-ability` / `skill`). Returns null when the
 * trait isn't present or the source id isn't one this kind handles
 * (e.g. nature on a `town-ability` spec).
 */
function readAdvancementEntry(
  spec: TbRollSpec,
  abilities: { will: RatedEntryShape; health: RatedEntryShape; nature: RatedEntryShape & { maximum: number; descriptors: string[] } } | undefined,
  townAbilities: { resources: RatedEntryShape; circles: RatedEntryShape } | undefined,
  skills: { entries: Record<string, RatedEntryShape & { taxed: boolean; learningTests: number }> } | undefined,
): RatedEntryShape | null {
  if (!spec.sourceId) return null;
  if (spec.kind === "ability") {
    if (!abilities) return null;
    const id = spec.sourceId as "will" | "health" | "nature";
    return abilities[id] ?? null;
  }
  if (spec.kind === "town-ability") {
    if (!townAbilities) return null;
    const id = spec.sourceId as "resources" | "circles";
    return townAbilities[id] ?? null;
  }
  if (spec.kind === "skill") {
    if (!skills) return null;
    return skills.entries[spec.sourceId] ?? null;
  }
  return null;
}

function TbRollActionsPanel(props: { rollId: EntityId }): JSX.Element {
  const client = useClient();
  const formula = useTrait(props.rollId, Formula);
  const result = useTrait(props.rollId, RollResult);
  const advancementLogged = useTrait(props.rollId, AdvancementLoggedTrait);
  const traitUsageLogged = useTrait(props.rollId, TraitUsageLoggedTrait);

  const spec = createMemo<TbRollSpec | null>(() => {
    const meta = formula()?.meta;
    if (!meta) return null;
    const parsed = TbRollMetaSchema.safeParse(meta);
    return parsed.success ? parsed.data.spec : null;
  });

  const dice = createMemo<ReadonlyArray<{ sides: number | "F"; value: number }>>(
    () => result()?.dice ?? [],
  );

  // Rolling user / character — read early since both the advancement-
  // gate logic and the post-roll spend section need it.
  const rolledBy = useTrait(props.rollId, RolledBy);
  // Current user — needed by the synergy log section (gates per-helper
  // buttons by canWrite). Declared early for the same reason rolledBy
  // is.
  const me = kit.useMe();

  const summary = createMemo(() => {
    const s = spec();
    if (!s) return null;
    return resolveSuccessCount(s, dice());
  });

  // For versus rolls, advancement gating depends on the opponent's
  // total. We pull every Roll entity to discover the pair (mirror of
  // what the row does for its own verdict display).
  const allRolls = useQuery([Formula, RollResult]);

  const versusVerdict = createMemo<
    { state: "won" | "lost" | "tied"; margin: number } | null
  >(() => {
    const s = spec();
    if (!s?.versusTestId) return null;
    let oppTotal: number | null = null;
    for (const row of allRolls()) {
      if (row.id === props.rollId) continue;
      const f = row.values.Formula as { meta?: unknown } | undefined;
      const parsed = TbRollMetaSchema.safeParse(f?.meta);
      if (!parsed.success) continue;
      if (parsed.data.spec.versusTestId !== s.versusTestId) continue;
      oppTotal = (row.values.RollResult as { total: number }).total;
      break;
    }
    if (oppTotal === null) return null;
    const myTotal = countSuccesses(dice(), s.successTarget) + s.bonusSuccesses;
    if (myTotal > oppTotal) return { state: "won", margin: myTotal - oppTotal };
    if (myTotal < oppTotal) return { state: "lost", margin: oppTotal - myTotal };
    return { state: "tied", margin: 0 };
  });

  const advancementOutcome = createMemo<"pass" | "fail" | null>(() => {
    const s = spec();
    const sum = summary();
    if (!s || !sum) return null;
    if (s.dispositionMode) return null;
    if (s.versusTestId) {
      const v = versusVerdict();
      if (!v) return null;
      if (v.state === "tied") return null;
      return v.state === "won" ? "pass" : "fail";
    }
    return sum.passed ? "pass" : "fail";
  });

  const isBeginnersLuck = createMemo<boolean>(
    () => spec()?.kind === "skill-bl",
  );

  /**
   * The rolling character — needed to read the live advancement track
   * so we can hide the Log button when its column is already at
   * threshold (per DH p.108: rating R needs R passes / R-1 fails).
   * Logging beyond the threshold is a no-op; the button might as well
   * disappear.
   */
  const charAbilities = useTrait(
    (rolledBy()?.speakingAsCharacterId as EntityId | undefined) ??
      ("" as EntityId),
    RawAbilities,
  );
  const charTownAbilities = useTrait(
    (rolledBy()?.speakingAsCharacterId as EntityId | undefined) ??
      ("" as EntityId),
    TownAbilities,
  );
  const charSkills = useTrait(
    (rolledBy()?.speakingAsCharacterId as EntityId | undefined) ??
      ("" as EntityId),
    Skills,
  );

  /**
   * Roller is a monster ⇒ none of the PC-only post-roll affordances
   * apply: monsters don't advance abilities/skills, log trait usage,
   * spend Fate / Persona / DU / OC, or earn synergy. SG p.171-177
   * describes their resolution path entirely in Nature terms — no
   * pass/fail bookkeeping. The chat row collapses to just the dice
   * + verdict for monster rolls.
   */
  const charMonster = useTrait(
    (rolledBy()?.speakingAsCharacterId as EntityId | undefined) ??
      ("" as EntityId),
    TbMonster,
  );
  const rollerIsMonster = createMemo(() => charMonster() !== undefined);

  /**
   * `true` when the column the resolved outcome would log into is
   * already at threshold for the source's current rating. Hides the
   * matching button so the player doesn't waste a click.
   *
   * For BL rolls, "track full" means `learningTests >= maxNature`
   * (DH p.75) — at that point Learn Skill replaces Log Test.
   */
  const advancementColumnFull = createMemo<boolean>(() => {
    const s = spec();
    const outcome = advancementOutcome();
    if (!s || !s.sourceId) return false;
    if (s.kind === "skill-bl") {
      const sk = charSkills();
      const ab = charAbilities();
      if (!sk || !ab) return false;
      const entry = sk.entries[s.sourceId];
      if (!entry) return false;
      const learningCap = Math.max(
        ab.nature.maximum ?? 0,
        ab.nature.rating ?? 0,
      );
      if (learningCap <= 0) return false;
      return entry.learningTests >= learningCap;
    }
    if (!outcome) return false;
    const entry = readAdvancementEntry(s, charAbilities(), charTownAbilities(), charSkills());
    if (!entry) return false;
    const need = computeAdvancementThreshold(entry.rating);
    if (outcome === "pass") return entry.advancement.pass >= need.passNeeded;
    return entry.advancement.fail >= need.failNeeded;
  });

  const showLogAdvancement = createMemo<boolean>(() => {
    const s = spec();
    if (!s) return false;
    if (rollerIsMonster()) return false;
    if (advancementLogged()) return false;
    if (!specIsAdvanceable(s)) return false;
    if (advancementColumnFull()) return false;
    if (s.kind === "skill-bl") return true;
    return advancementOutcome() !== null;
  });

  const logAdvancement = (outcome: "pass" | "fail"): void => {
    client.dispatch(
      LogAdvancement({
        rollId: props.rollId,
        outcome,
      }) as CommandInstance,
    );
  };

  const traitUsage = createMemo<ReturnType<typeof traitUsageFromSpec> | null>(
    () => {
      const s = spec();
      return s ? traitUsageFromSpec(s) : null;
    },
  );

  const showLogTraitUsage = createMemo<boolean>(() => {
    if (rollerIsMonster()) return false;
    if (!traitUsage()) return false;
    if (traitUsageLogged()) return false;
    return true;
  });

  const traitUsageButtonLabel = createMemo<string>(() => {
    const u = traitUsage();
    if (!u) return "";
    if (u.direction === "for") return "Log Beneficial Use";
    if (u.severity === "minus-1d") return "Log Check (+1)";
    return "Log Checks (+2)";
  });

  const traitUsageButtonTitle = createMemo<string>(() => {
    const u = traitUsage();
    if (!u) return "";
    if (u.direction === "for") {
      return "Mark a beneficial use of this trait on the character sheet (DH p.79)";
    }
    if (u.severity === "minus-1d") {
      return "Earn 1 check for using the trait against yourself (DH p.80)";
    }
    return "Earn 2 checks for adding +2D to your opponent (DH p.80)";
  });

  const logTraitUsage = (): void => {
    client.dispatch(
      LogTraitUsage({
        rollId: props.rollId as Parameters<typeof LogTraitUsage>[0]["rollId"],
      }) as CommandInstance,
    );
  };

  /* ---- Synergy advancement (SG p.87) ----------------------------------
   *
   * Per SG p.87 the helper marks the *same outcome* as the roller —
   * pass or fail. We surface a per-helper button on the chat card,
   * visible only to players who can write to that helper. The helper's
   * sheet only moves when their own player clicks (mirrors the trait /
   * advancement deferred-mutation principle). */

  const synergyLoggedTrait = useTrait(
    props.rollId,
    SynergyAdvancementLoggedTrait,
  );
  const allCharacters = useQuery([Character, Permissions]);

  interface SynergyLogRow {
    helperCharacterId: EntityId;
    name: string;
    outcome: "pass" | "fail";
    alreadyLogged: boolean;
  }

  const synergyLogRows = createMemo<SynergyLogRow[]>(() => {
    const m = me();
    const s = spec();
    const outcome = advancementOutcome();
    if (!m || !s || !outcome) return [];
    if (rollerIsMonster()) return [];
    const declared = s.synergyHelpers ?? [];
    if (declared.length === 0) return [];
    const loggedSet = new Set(
      (synergyLoggedTrait()?.entries ?? []).map((e) => e.helperCharacterId),
    );
    const out: SynergyLogRow[] = [];
    for (const helperId of declared) {
      const row = allCharacters().find((r) => r.id === helperId);
      if (!row) continue;
      const perm = row.values.Permissions as
        | Parameters<typeof canWrite>[1]
        | undefined;
      if (!canWrite(m, perm)) continue;
      const name =
        (row.values.Character as { name?: string } | undefined)?.name ??
        "(helper)";
      out.push({
        helperCharacterId: helperId as EntityId,
        name,
        outcome,
        alreadyLogged: loggedSet.has(helperId),
      });
    }
    return out;
  });

  const logSynergy = (helperCharacterId: EntityId): void => {
    client.dispatch(
      LogSynergyAdvancement({
        rollId: props.rollId as Parameters<
          typeof LogSynergyAdvancement
        >[0]["rollId"],
        helperCharacterId,
      }) as CommandInstance,
    );
  };

  /* ---- Fate / persona spends (DH p.23, p.67, p.77) ---- */

  const spends = useTrait(props.rollId, RollSpends);

  /**
   * The character whose pool gets spent on roller-only buttons (Luck,
   * DU, OC, Persona dice, Channel Nature). Reads from the Roll's
   * RolledBy trait — this is the speaking-as character, not the
   * rolling user's primary character.
   */
  const rollerCharacterId = createMemo<EntityId | null>(() => {
    const rb = rolledBy();
    return (rb?.speakingAsCharacterId as EntityId | undefined) ?? null;
  });

  /**
   * Pools snapshot for the rolling character — drives the
   * fate / persona ≥ 1 enabling for spend buttons.
   */
  const rollerPools = useTrait(rollerCharacterId() ?? ("" as EntityId), Pools);

  /** Wises trait of the rolling character — drives the DU/OC pickers. */
  const rollerWises = useTrait(rollerCharacterId() ?? ("" as EntityId), Wises);

  /** Is the current user the same one who rolled? Roller-only buttons. */
  const iAmTheRoller = createMemo<boolean>(() => {
    const m = me();
    const rb = rolledBy();
    return !!m && !!rb && m.userId === rb.userId;
  });

  const spendsArr = createMemo<ReadonlyArray<RollSpendEntry>>(
    () => spends()?.entries ?? [],
  );

  const hasSpend = (kind: RollSpendEntry["kind"]): boolean =>
    spendsArr().some((e) => e.kind === kind);

  const fateAvail = createMemo<number>(() => rollerPools()?.fate.current ?? 0);
  const personaAvail = createMemo<number>(
    () => rollerPools()?.persona.current ?? 0,
  );

  /** Are there 6s eligible for Luck (not already rerolled by any spend)? */
  const hasUnrerolledSix = createMemo<boolean>(() => {
    const used = new Set<number>();
    for (const e of spendsArr()) for (const i of e.rerolledIndices) used.add(i);
    const ds = dice();
    for (let i = 0; i < ds.length; i += 1) {
      const d = ds[i]!;
      if (d.sides === 6 && d.value === 6 && !used.has(i)) return true;
    }
    return false;
  });

  /** Are there fails eligible for DU/OC (not already rerolled)? */
  const failsEligible = createMemo<number[]>(() => {
    const s = spec();
    if (!s) return [];
    const used = new Set<number>();
    for (const e of spendsArr()) for (const i of e.rerolledIndices) used.add(i);
    const ds = dice();
    const out: number[] = [];
    for (let i = 0; i < ds.length; i += 1) {
      const d = ds[i]!;
      if (d.sides !== 6) continue;
      if (d.value >= s.successTarget) continue;
      if (used.has(i)) continue;
      out.push(i);
    }
    return out;
  });

  /**
   * The post-roll spend section is roller-only and hidden on
   * disposition rolls (no advancement, no fate spends in the conflict
   * procedure per DH p.254). Pre-roll spends (Persona dice / Channel
   * Nature / Synergy) live in the pending-roll panel; only Luck / DU /
   * OC are post-roll and surface here.
   */
  const showSpends = createMemo<boolean>(() => {
    const s = spec();
    if (!s) return false;
    if (s.dispositionMode) return false;
    if (rollerIsMonster()) return false;
    return iAmTheRoller();
  });

  /* Roller-only post-roll spend handlers (DH p.23 Luck, p.77 DU / OC). */
  const spendLuck = (): void => {
    client.dispatch(
      SpendLuck({
        rollId: props.rollId as Parameters<typeof SpendLuck>[0]["rollId"],
      }) as CommandInstance,
    );
  };

  const [duWiseIndex, setDuWiseIndex] = createSignal<number>(0);
  const [duDieIndex, setDuDieIndex] = createSignal<number>(-1);
  const spendDU = (): void => {
    if (duDieIndex() < 0) return;
    client.dispatch(
      SpendDeeperUnderstanding({
        rollId: props.rollId as Parameters<
          typeof SpendDeeperUnderstanding
        >[0]["rollId"],
        wiseIndex: duWiseIndex(),
        dieIndex: duDieIndex(),
      }) as CommandInstance,
    );
  };

  const [ocWiseIndex, setOcWiseIndex] = createSignal<number>(0);
  const spendOC = (): void => {
    client.dispatch(
      SpendOfCourse({
        rollId: props.rollId as Parameters<
          typeof SpendOfCourse
        >[0]["rollId"],
        wiseIndex: ocWiseIndex(),
      }) as CommandInstance,
    );
  };

  return (
    <>
      <SpellCastActions rollId={props.rollId} />
      <InvocationPerformActions rollId={props.rollId} />
      <Show when={showLogAdvancement() || showLogTraitUsage()}>
        <div
          class="flex flex-wrap items-center justify-end gap-1.5"
          data-testid="tb-roll-row-actions"
        >
          <Show when={showLogTraitUsage()}>
            <button
              type="button"
              class="rounded-(--radius-control) border border-border bg-surface px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-fg-muted transition hover:border-accent hover:text-fg"
              data-testid="tb-roll-row-log-trait-usage"
              title={traitUsageButtonTitle()}
              onClick={logTraitUsage}
            >
              {traitUsageButtonLabel()}
            </button>
          </Show>
          <Show when={showLogAdvancement()}>
            {(_) => {
              const bl = isBeginnersLuck();
              const outcome = bl
                ? ("pass" as const)
                : (advancementOutcome() as "pass" | "fail");
              return (
                <button
                  type="button"
                  class="rounded-(--radius-control) border border-accent bg-transparent px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-accent transition hover:bg-accent hover:text-accent-fg"
                  classList={{
                    "border-danger text-danger hover:bg-danger hover:text-white":
                      !bl && outcome === "fail",
                  }}
                  data-testid="tb-roll-row-log-advancement"
                  data-outcome={bl ? "test" : outcome}
                  title={
                    bl
                      ? "Mark a Beginner's Luck learning test on this skill (DH p.75)"
                      : outcome === "pass"
                        ? "Mark a passed advancement test on the rolled trait"
                        : "Mark a failed advancement test on the rolled trait"
                  }
                  onClick={() => logAdvancement(outcome)}
                >
                  {bl ? "Log Test" : `Log ${outcome === "pass" ? "Pass" : "Fail"}`}
                </button>
              );
            }}
          </Show>
        </div>
      </Show>

      {/* Synergy advancement — one button per helper this user owns,
          mirroring the roller's outcome (pass/fail) per SG p.87. */}
      <Show when={synergyLogRows().length > 0}>
        <div
          class="flex flex-wrap items-center justify-end gap-1.5"
          data-testid="tb-roll-row-synergy-log"
        >
          <For each={synergyLogRows()}>
            {(row) => (
              <Show when={!row.alreadyLogged}>
                <button
                  type="button"
                  class="rounded-(--radius-control) border bg-transparent px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] transition"
                  classList={{
                    "border-accent text-accent hover:bg-accent hover:text-accent-fg":
                      row.outcome === "pass",
                    "border-danger text-danger hover:bg-danger hover:text-white":
                      row.outcome === "fail",
                  }}
                  onClick={() => logSynergy(row.helperCharacterId)}
                  title={`Mark a ${row.outcome === "pass" ? "passed" : "failed"} advancement test for ${row.name} via synergy (SG p.87)`}
                  data-testid={`tb-roll-row-synergy-log-${row.helperCharacterId}`}
                  data-outcome={row.outcome}
                >
                  {row.name} log {row.outcome === "pass" ? "Pass" : "Fail"}
                </button>
              </Show>
            )}
          </For>
        </div>
      </Show>

      <Show when={showSpends()}>
        <div
          class="flex flex-col gap-1.5"
          data-testid="tb-roll-row-spends"
        >
          <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
            Fate / Persona spends
          </span>
          <div class="flex flex-wrap items-center gap-1">
            {/* Luck — fate to reroll 6s. */}
            <button
              type="button"
              class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.65rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={
                fateAvail() < 1 || hasSpend("luck") || !hasUnrerolledSix()
              }
              onClick={spendLuck}
              title={
                fateAvail() < 1
                  ? "no fate to spend"
                  : hasSpend("luck")
                    ? "luck already spent"
                    : !hasUnrerolledSix()
                      ? "no unrerolled 6s to reroll"
                      : "Spend 1 fate to reroll 6s (DH p.23)"
              }
              data-testid="tb-roll-row-spend-luck"
            >
              luck (reroll 6s)
            </button>

            {/* Deeper Understanding — fate, single failed-die reroll, wise-related. */}
            <Show when={(rollerWises()?.entries.length ?? 0) > 0}>
              <span
                class="inline-flex items-center gap-1 rounded-(--radius-control) border border-dashed border-border bg-surface-elevated px-2 py-0.5 text-[0.65rem] text-fg-muted"
                data-testid="tb-roll-row-spend-du-group"
              >
                <select
                  value={duWiseIndex()}
                  onChange={(e) =>
                    setDuWiseIndex(parseInt(e.currentTarget.value, 10))
                  }
                  class="bg-transparent text-fg outline-none"
                  aria-label="DU wise"
                  data-testid="tb-roll-row-spend-du-wise"
                >
                  <For each={rollerWises()?.entries ?? []}>
                    {(w, i) => (
                      <option value={i()}>
                        {w.name || `wise ${i() + 1}`}
                      </option>
                    )}
                  </For>
                </select>
                <select
                  value={duDieIndex()}
                  onChange={(e) =>
                    setDuDieIndex(parseInt(e.currentTarget.value, 10))
                  }
                  class="bg-transparent text-fg outline-none"
                  aria-label="DU die"
                  data-testid="tb-roll-row-spend-du-die"
                >
                  <option value={-1}>
                    pick a fail…
                  </option>
                  <For each={failsEligible()}>
                    {(idx) => (
                      <option value={idx}>
                        die {idx + 1} ({dice()[idx]?.value ?? "?"})
                      </option>
                    )}
                  </For>
                </select>
                <button
                  type="button"
                  class="hover:text-fg transition disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={
                    fateAvail() < 1 ||
                    duDieIndex() < 0 ||
                    failsEligible().length === 0
                  }
                  onClick={spendDU}
                  title="Spend 1 fate to reroll one failed die on a wise-related test (DH p.77)"
                  data-testid="tb-roll-row-spend-du"
                >
                  deeper understanding
                </button>
              </span>
            </Show>

            {/* Of Course! — persona, all failed dice reroll, wise-related, before Luck. */}
            <Show when={(rollerWises()?.entries.length ?? 0) > 0}>
              <span
                class="inline-flex items-center gap-1 rounded-(--radius-control) border border-dashed border-border bg-surface-elevated px-2 py-0.5 text-[0.65rem] text-fg-muted"
                data-testid="tb-roll-row-spend-oc-group"
              >
                <select
                  value={ocWiseIndex()}
                  onChange={(e) =>
                    setOcWiseIndex(parseInt(e.currentTarget.value, 10))
                  }
                  class="bg-transparent text-fg outline-none"
                  aria-label="OC wise"
                  data-testid="tb-roll-row-spend-oc-wise"
                >
                  <For each={rollerWises()?.entries ?? []}>
                    {(w, i) => (
                      <option value={i()}>
                        {w.name || `wise ${i() + 1}`}
                      </option>
                    )}
                  </For>
                </select>
                <button
                  type="button"
                  class="hover:text-fg transition disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={
                    personaAvail() < 1 ||
                    hasSpend("of-course") ||
                    hasSpend("luck") ||
                    failsEligible().length === 0
                  }
                  onClick={spendOC}
                  title={
                    hasSpend("luck")
                      ? "Of Course! must run before Luck (DH p.77)"
                      : hasSpend("of-course")
                        ? "Of Course! already spent"
                        : "Spend 1 persona to reroll all failed dice on a wise-related test (DH p.77)"
                  }
                  data-testid="tb-roll-row-spend-oc"
                >
                  of course!
                </button>
              </span>
            </Show>
          </div>

          {/* Running ledger of spends. Each entry shows kind, cost, and
              the chat-card delta. */}
          <Show when={spendsArr().length > 0}>
            <ul
              class="flex flex-col gap-0.5"
              data-testid="tb-roll-row-spend-ledger"
            >
              <For each={spendsArr()}>
                {(e) => (
                  <li class="text-[0.65rem] text-fg-subtle">
                    ✓ {spendLabel(e)}
                    <Show when={e.appendedCount > 0}>
                      <span class="text-fg-muted"> · +{e.appendedCount}D</span>
                    </Show>
                    <Show when={e.rerolledIndices.length > 0}>
                      <span class="text-fg-muted">
                        {" "}· rerolled {e.rerolledIndices.length}
                      </span>
                    </Show>
                    <Show when={e.newSuccesses > 0}>
                      <span class="text-fg-muted">
                        {" "}(+{e.newSuccesses} success)
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </Show>

      <Show when={traitUsageLogged()}>
        {(_) => {
          const t = traitUsageLogged() as {
            traitNameAtLog: string;
            direction: "for" | "against";
            severity?: "minus-1d" | "plus-2d-opp";
          };
          const summary =
            t.direction === "for"
              ? `Beneficial use of ${t.traitNameAtLog} marked`
              : t.severity === "plus-2d-opp"
                ? `+2 checks earned (${t.traitNameAtLog})`
                : `+1 check earned (${t.traitNameAtLog})`;
          return (
            <p
              class="text-[0.65rem] text-fg-subtle text-right"
              data-testid="tb-roll-row-trait-usage-confirmation"
            >
              ✓ {summary}
            </p>
          );
        }}
      </Show>

      <Show when={advancementLogged()}>
        {(_) => {
          const a = advancementLogged() as {
            outcome: "pass" | "fail";
            target: { kind: string; label: string };
          };
          const bl = a.target.kind === "skill-bl";
          return (
            <p
              class="text-[0.65rem] text-fg-subtle text-right"
              data-testid="tb-roll-row-advancement-confirmation"
            >
              {bl
                ? `✓ Learning test logged for ${a.target.label}`
                : `✓ ${a.outcome === "pass" ? "Pass" : "Fail"} logged for ${a.target.label}`}
            </p>
          );
        }}
      </Show>

      {/* Synergy log confirmations — one footer per helper that has
          already logged. Visible to everyone so the table can see who
          banked their synergy advancement. */}
      <Show when={(synergyLoggedTrait()?.entries.length ?? 0) > 0}>
        <For each={synergyLoggedTrait()?.entries ?? []}>
          {(e) => {
            const character = allCharacters().find(
              (r) => r.id === e.helperCharacterId,
            );
            const name =
              (character?.values.Character as { name?: string } | undefined)
                ?.name ?? e.helperCharacterId;
            return (
              <p
                class="text-[0.65rem] text-fg-subtle text-right"
                data-testid={`tb-roll-row-synergy-confirmation-${e.helperCharacterId}`}
              >
                ✓ {name}: {e.outcome === "pass" ? "Pass" : "Fail"} logged for{" "}
                {e.target.label} (synergy)
              </p>
            );
          }}
        </For>
      </Show>
    </>
  );
}

function spendLabel(e: RollSpendEntry): string {
  switch (e.kind) {
    case "luck":
      return "Luck (1 fate)";
    case "deeper-understanding":
      return "Deeper Understanding (1 fate)";
    case "of-course":
      return "Of Course! (1 persona)";
    case "persona-dice":
      return `+${e.cost}D Persona`;
    case "channel-nature":
      return e.channelScope === "outside"
        ? "Channel Nature (outside — taxed)"
        : "Channel Nature";
    case "synergy":
      return "Synergy (1 fate)";
    default:
      return "spend";
  }
}

export const TbRollActionsFill: RollActionsContributor = {
  id: qualifiedName("@vtt/system-torchbearer/roll-actions") as RollActionsContributor["id"],
  priority: 100,
  rollablePrefix: "@vtt/system-torchbearer",
  render: (args: RollActionsArgs) => TbRollActionsPanel({ rollId: args.rollId }),
};
