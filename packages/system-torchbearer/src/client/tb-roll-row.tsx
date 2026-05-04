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

import type { CommandInstance } from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import { Formula, RollResult, RolledBy } from "@vtt/resolution/shared";
import { createMemo, For, Show, type JSX } from "solid-js";
import {
  AdvancementLoggedTrait,
  countSuccesses,
  formatModifier,
  LogAdvancement,
  LogTraitUsage,
  resolveSuccessCount,
  TbRollMetaSchema,
  TraitUsageLoggedTrait,
  traitUsageFromSpec,
  type TbRollSpec,
} from "../shared/index.js";

interface TbRollRowProps {
  entityId: string;
}

/**
 * TB-flavoured chat row. Reads the spawned Roll entity's
 * `Formula.meta`, decodes a `TbRollSpec`, and surfaces the full
 * audit trail of a TB roll:
 *
 *   - Headline: speakerName — Source [vs Ob N] [heroic]
 *   - Subtitle: notation, pool size, success target
 *   - Output:   the rpg-dice-roller pretty string (per-die marks)
 *   - Dice:     each face with successes (≥target) highlighted
 *   - Result:   `final vs Ob N — succeeded by M` (or fell-short)
 *   - Break:    `raw +always +conditional = final successes`
 *   - Mods:     chip per modifier with apply mode + provenance
 *
 * The resolution package's chat-timeline contributor filters out
 * Roll entities with `Formula.meta.system` set, so this row is the
 * only one that surfaces a TB roll.
 */
const ADVANCE_ABILITY_IDS = new Set(["will", "health", "nature"]);
const ADVANCE_TOWN_ABILITY_IDS = new Set(["resources", "circles"]);

/**
 * Mirror of the server-side `targetFromSpec` — same advance-ability
 * decision, used here only to gate the button. The server still
 * validates independently.
 */
function specIsAdvanceable(spec: TbRollSpec): boolean {
  if (spec.dispositionMode) return false;
  if (!spec.sourceId) return false;
  if (spec.kind === "ability") return ADVANCE_ABILITY_IDS.has(spec.sourceId);
  if (spec.kind === "town-ability")
    return ADVANCE_TOWN_ABILITY_IDS.has(spec.sourceId);
  if (spec.kind === "skill" || spec.kind === "skill-bl") return true;
  return false;
}

export function TbRollRow(props: TbRollRowProps): JSX.Element {
  const client = useClient();
  const formula = useTrait(props.entityId, Formula);
  const result = useTrait(props.entityId, RollResult);
  const rolledBy = useTrait(props.entityId, RolledBy);
  const advancementLogged = useTrait(props.entityId, AdvancementLoggedTrait);
  const traitUsageLogged = useTrait(props.entityId, TraitUsageLoggedTrait);

  const spec = createMemo<TbRollSpec | null>(() => {
    const meta = formula()?.meta;
    if (!meta) return null;
    const parsed = TbRollMetaSchema.safeParse(meta);
    return parsed.success ? parsed.data.spec : null;
  });

  const dice = createMemo<ReadonlyArray<{ sides: number | "F"; value: number }>>(
    () => result()?.dice ?? [],
  );

  const summary = createMemo(() => {
    const s = spec();
    if (!s) return null;
    return resolveSuccessCount(s, dice());
  });

  // All resolved Roll entities — used to discover the opponent's
  // Roll when this row is part of a versus test. Reactive: the
  // opponent's row appearing later flips this row from "awaiting"
  // to a full versus verdict without any further plumbing.
  const allRolls = useQuery([Formula, RollResult, RolledBy]);

  /**
   * Locate the opponent Roll for a versus test by matching
   * `versusTestId` across spawned Roll entities. `null` until the
   * opponent commits — chat row shows "awaiting opponent" in the
   * meantime.
   */
  const versusOpponent = createMemo<{
    rollId: string;
    spec: TbRollSpec;
    total: number;
    rolledByName: string;
  } | null>(() => {
    const myKey = spec()?.versusTestId;
    if (!myKey) return null;
    for (const row of allRolls()) {
      if (row.id === props.entityId) continue;
      const f = row.values.Formula as { meta?: unknown } | undefined;
      const parsed = TbRollMetaSchema.safeParse(f?.meta);
      if (!parsed.success) continue;
      if (parsed.data.spec.versusTestId !== myKey) continue;
      return {
        rollId: row.id,
        spec: parsed.data.spec,
        total: (row.values.RollResult as { total: number }).total,
        rolledByName: (row.values.RolledBy as { displayName: string })
          .displayName,
      };
    }
    return null;
  });

  /**
   * Versus verdict — using opponent's `RollResult.total` (raw +
   * always-applied bonus successes) as our effective obstacle.
   * Conditional `on-success` / `on-fail` modifiers don't enter the
   * comparison (they're post-pass cosmetic and would be circular in
   * a mutual-obstacle resolution).
   *
   * Tie semantics follow DH p.250 — ties are GM-resolved (L3 trait,
   * Might/Precedence, etc.); the chat row just flags `tied` and
   * leaves the call to the table.
   */
  const versusVerdict = createMemo<
    { state: "won" | "lost" | "tied"; margin: number } | null
  >(() => {
    const opp = versusOpponent();
    const s = summary();
    if (!opp || !s) return null;
    // Use raw + always (= RollResult.total in our notation) for both
    // sides. Recompute mine from spec to match opponent's basis.
    const myComparable = countSuccesses(dice(), spec()!.successTarget) +
      spec()!.bonusSuccesses;
    if (myComparable > opp.total) {
      return { state: "won", margin: myComparable - opp.total };
    }
    if (myComparable < opp.total) {
      return { state: "lost", margin: opp.total - myComparable };
    }
    return { state: "tied", margin: 0 };
  });

  /**
   * Disposition value (DH p.254): base rating + rolled successes -
   * per-team penalties. Team penalties are already folded into
   * `spec.bonusSuccesses` as -1s modifiers, so summing
   * `baseDice + rawSuccesses + always` gives the same result.
   * Conditional `on-success`/`on-fail` modifiers don't apply to
   * disposition (no pass/fail to gate them on); we exclude them
   * from the disposition count even though `summary.final` would
   * fold them in.
   *
   * Floored at 1 per SG p.47 — "Minimum starting disposition is 1".
   * Returns null when this isn't a disposition roll.
   */
  const dispositionValue = createMemo<number | null>(() => {
    const s = spec();
    const sum = summary();
    if (!s?.dispositionMode || !sum) return null;
    return Math.max(1, s.baseDice + sum.rawSuccesses + sum.always);
  });

  /**
   * Resolved outcome for the post-roll "Log Advancement" button.
   * Maps the chat row's pass/fail (or versus won/lost) into a single
   * `"pass" | "fail"` decision the player can commit. Returns null
   * when the row hasn't enough state to decide — versus tests
   * awaiting an opponent, ties (GM-resolved per DH p.250), or
   * dispositionMode rolls (no advancement under TB rules).
   *
   * For Beginner's Luck rolls (`spec.kind === "skill-bl"`) outcome
   * doesn't matter to the rule (DH p.75), but we still expose
   * pass/fail here so the chat row's color treatment matches the
   * resolution. The dispatched LogAdvancement command always sends
   * the outcome — the system ignores it for BL.
   */
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

  const showLogAdvancement = createMemo<boolean>(() => {
    const s = spec();
    if (!s) return false;
    if (advancementLogged()) return false;
    if (!specIsAdvanceable(s)) return false;
    // BL rolls log a single "test" regardless of outcome (DH p.75
    // — pass/fail doesn't matter for learning), so the button is
    // available even on a tie or before a versus opponent rolls.
    if (s.kind === "skill-bl") return true;
    return advancementOutcome() !== null;
  });

  const logAdvancement = (outcome: "pass" | "fail"): void => {
    client.dispatch(
      LogAdvancement({
        rollId: props.entityId,
        outcome,
      }) as CommandInstance,
    );
  };

  /**
   * Trait-usage log button visibility & wording. Mirrors the
   * advancement button's deferred-log pattern: a trait modifier with
   * a structured `providedBy` left a usage breadcrumb in the spec at
   * commit time; this button lets the player apply the corresponding
   * sheet mutation (consume a beneficial use, or earn checks) only
   * when they're sure they want to keep the result.
   */
  const traitUsage = createMemo<ReturnType<typeof traitUsageFromSpec> | null>(
    () => {
      const s = spec();
      return s ? traitUsageFromSpec(s) : null;
    },
  );

  const showLogTraitUsage = createMemo<boolean>(() => {
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
        rollId: props.entityId as Parameters<
          typeof LogTraitUsage
        >[0]["rollId"],
      }) as CommandInstance,
    );
  };

  return (
    <Show when={formula() && result() && rolledBy() && spec()}>
      <article
        class="rounded-(--radius-card) border border-border-muted bg-surface-elevated p-3"
        data-tb-roll-row="true"
        data-testid="tb-roll-row"
      >
        <header class="flex items-baseline justify-between gap-2">
          <div class="flex flex-col min-w-0">
            <span class="text-xs text-fg-muted">
              <span class="text-fg">{rolledBy()!.displayName}</span>{" "}
              <span class="text-fg-subtle">rolled</span>{" "}
              <span class="text-fg">{spec()!.source}</span>
              <Show when={spec()!.obstacle !== null}>
                <span class="text-fg-subtle"> vs Ob {spec()!.obstacle}</span>
                <Show
                  when={
                    spec()!.baseObstacle !== null &&
                    spec()!.baseObstacle !== spec()!.obstacle
                  }
                >
                  <span
                    class="text-fg-subtle"
                    data-testid="tb-roll-row-obstacle-shift"
                    title={`Base Ob ${spec()!.baseObstacle} shifted by ${(spec()!.obstacle as number) - (spec()!.baseObstacle as number)}`}
                  >
                    {" "}(base {spec()!.baseObstacle})
                  </span>
                </Show>
              </Show>
              <Show when={spec()!.heroic}>
                <span
                  class="ml-1 rounded-(--radius-control) bg-accent px-1 text-[0.55rem] uppercase tracking-[0.12em] text-accent-fg"
                  data-testid="tb-roll-row-heroic-badge"
                  title="Heroic — every die showing 3+ counts as a success"
                >
                  heroic
                </span>
              </Show>
              <Show when={spec()!.versusTestId}>
                <span
                  class="ml-1 rounded-(--radius-control) border border-accent px-1 text-[0.55rem] uppercase tracking-[0.12em] text-accent"
                  data-testid="tb-roll-row-versus-badge"
                  title="Versus test — opponent's successes are the obstacle"
                >
                  versus
                </span>
              </Show>
              <Show when={spec()!.dispositionMode}>
                <span
                  class="ml-1 rounded-(--radius-control) bg-accent px-1 text-[0.55rem] uppercase tracking-[0.12em] text-accent-fg"
                  data-testid="tb-roll-row-disposition-badge"
                  title="Disposition roll — result is the team's hit-point pool (DH p.254)."
                >
                  disposition
                </span>
              </Show>
            </span>
            <span class="font-mono text-[10px] text-fg-subtle">
              {formula()!.notation}
              <Show when={spec()!.pool > 0}>
                {" "}
                ({spec()!.pool}d6 ≥ {spec()!.successTarget})
              </Show>
            </span>
          </div>
          <Show when={summary()}>
            {(sum) => (
              <Show
                when={spec()!.dispositionMode}
                fallback={
                  <div class="flex flex-col items-end">
                    <strong
                      class="font-mono text-base"
                      classList={{
                        "text-accent": sum().passed,
                        "text-danger": !sum().passed,
                      }}
                      data-testid="tb-roll-row-success-count"
                    >
                      {sum().final}
                    </strong>
                    <span class="text-[10px] uppercase tracking-[0.12em] text-fg-subtle">
                      {sum().passed ? "passed" : "failed"}
                    </span>
                  </div>
                }
              >
                <div class="flex flex-col items-end">
                  <strong
                    class="font-mono text-base text-accent"
                    data-testid="tb-roll-row-disposition-value"
                  >
                    {dispositionValue() ?? 0}
                  </strong>
                  <span class="text-[10px] uppercase tracking-[0.12em] text-fg-subtle">
                    disposition
                  </span>
                </div>
              </Show>
            )}
          </Show>
        </header>

        {/* rpg-dice-roller's pretty output — the literal mathematical
            audit trail. Truncated visually but available on hover. */}
        <Show when={result()!.output}>
          <p
            class="mt-2 truncate font-mono text-[10px] text-fg-subtle"
            title={result()!.output}
            data-testid="tb-roll-row-output"
          >
            {result()!.output}
          </p>
        </Show>

        <Show when={dice().length > 0 && spec()!.pool > 0}>
          <ul class="mt-2 flex flex-wrap gap-1" data-testid="tb-roll-row-dice">
            <For each={dice()}>
              {(d) => {
                const target = spec()!.successTarget;
                const isSuccess = d.sides === 6 && d.value >= target;
                return (
                  <li
                    class="inline-flex h-6 w-6 items-center justify-center rounded-(--radius-control) font-mono text-[0.7rem]"
                    classList={{
                      "border border-accent text-accent": isSuccess,
                      "border border-border text-fg-muted": !isSuccess,
                    }}
                    title={isSuccess ? "success" : "miss"}
                  >
                    {d.value}
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>

        <Show when={spec()!.pool === 0}>
          <p class="mt-2 text-[0.7rem] text-danger">
            Pool reduced to zero — auto-fail.
          </p>
        </Show>

        {/* Breakdown line: raw dice successes, always-applied bonus,
            conditional bonus folded in. Always rendered when there's
            a non-zero contribution beyond raw dice, so the math is
            never opaque. */}
        <Show
          when={
            summary() &&
            (summary()!.always !== 0 || summary()!.conditional !== 0)
          }
        >
          {(_) => {
            const s = summary()!;
            return (
              <p
                class="mt-1 text-[0.7rem] text-fg-subtle"
                data-testid="tb-roll-row-success-breakdown"
              >
                {s.rawSuccesses}
                {s.always !== 0 ? ` ${s.always >= 0 ? "+" : ""}${s.always}` : ""}
                {s.conditional !== 0
                  ? ` ${s.conditional >= 0 ? "+" : ""}${s.conditional} (conditional)`
                  : ""}
                {" = "}
                {s.final} successes
              </p>
            );
          }}
        </Show>

        <Show when={spec()!.modifiers.length > 0}>
          <ul
            class="mt-2 flex flex-wrap gap-1 text-[0.65rem] text-fg-muted"
            data-testid="tb-roll-row-modifiers"
          >
            <For each={spec()!.modifiers}>
              {(m) => (
                <li
                  class="rounded-(--radius-control) bg-surface px-2 py-0.5"
                  classList={{
                    "text-accent": m.value > 0,
                    "text-danger": m.value < 0,
                  }}
                  title={m.providedBy ?? m.label}
                >
                  {formatModifier(m)}
                </li>
              )}
            </For>
          </ul>
        </Show>

        {/* Post-roll actions strip. Sits above the summary line so
            future buttons (mark wise, spend fate, etc.) can stack
            here without disturbing the resolution line. The button
            shown depends on the resolved outcome:
              - "Log Pass" / "Log Fail" for normal advancement rolls.
              - "Log Test" for Beginner's Luck rolls (DH p.75: pass /
                fail doesn't matter — only the count of attempts).
            Hidden once the AdvancementLogged trait is attached so
            the same roll can't double-advance, and replaced by a
            small confirmation footer instead. */}
        <Show when={showLogAdvancement() || showLogTraitUsage()}>
          <div
            class="mt-3 flex flex-wrap items-center justify-end gap-1.5"
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
                      "border-danger text-danger hover:bg-danger hover:text-bg":
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
                class="mt-2 text-[0.65rem] text-fg-subtle text-right"
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
                class="mt-2 text-[0.65rem] text-fg-subtle text-right"
                data-testid="tb-roll-row-advancement-confirmation"
              >
                {bl
                  ? `✓ Learning test logged for ${a.target.label}`
                  : `✓ ${a.outcome === "pass" ? "Pass" : "Fail"} logged for ${a.target.label}`}
              </p>
            );
          }}
        </Show>

        {/* Disposition resolution — replaces the standard pass/fail
            line entirely. Shows the disposition formula breakdown:
            base + rolled successes (with always-applied bonuses,
            which include team penalties) → disposition value, with
            the SG p.47 minimum-1 floor noted when it kicks in. */}
        <Show when={spec()!.dispositionMode && dispositionValue() !== null}>
          {(_) => {
            const s = spec()!;
            const sum = summary()!;
            const v = dispositionValue() as number;
            const preFloor = s.baseDice + sum.rawSuccesses + sum.always;
            return (
              <p
                class="mt-3 border-t border-border-muted pt-2 text-[0.75rem] text-accent"
                data-testid="tb-roll-row-disposition-breakdown"
              >
                <span class="text-fg-subtle">disposition:{" "}</span>
                <strong class="font-mono">{s.baseDice}</strong>
                <span class="text-fg-subtle"> base + </span>
                <strong class="font-mono">{sum.rawSuccesses}</strong>
                <span class="text-fg-subtle"> successes</span>
                <Show when={sum.always !== 0}>
                  <span class="text-fg-subtle">{" "}{sum.always >= 0 ? "+ " : "- "}</span>
                  <strong class="font-mono">{Math.abs(sum.always)}</strong>
                  <span class="text-fg-subtle"> bonuses</span>
                </Show>
                <span class="text-fg-subtle"> = </span>
                <strong class="font-mono">{v}</strong>
                <Show when={preFloor < 1}>
                  <span class="text-fg-subtle">{" "}(floored at 1, SG p.47)</span>
                </Show>
              </p>
            );
          }}
        </Show>

        {/* Versus verdict — when the spec carries a versusTestId
            we dispatch on opponent presence:
              - opponent rolled → won/lost/tied with a margin
              - opponent hasn't rolled yet → "awaiting" placeholder
            Takes precedence over the plain Ob resolution; in a
            versus test the opponent's success count IS the obstacle.
            Suppressed in disposition mode (incompatible). */}
        <Show when={spec()!.versusTestId && !spec()!.dispositionMode}>
          <Show
            when={versusOpponent() && versusVerdict()}
            fallback={
              <p
                class="mt-3 border-t border-border-muted pt-2 text-[0.75rem] text-fg-subtle"
                data-testid="tb-roll-row-versus-awaiting"
              >
                Versus test — awaiting opponent's roll.
              </p>
            }
          >
            {(_) => {
              const verdict = versusVerdict()!;
              const opp = versusOpponent()!;
              const myComparable =
                countSuccesses(dice(), spec()!.successTarget) +
                spec()!.bonusSuccesses;
              return (
                <p
                  class="mt-3 border-t border-border-muted pt-2 text-[0.75rem]"
                  classList={{
                    "text-accent": verdict.state === "won",
                    "text-danger": verdict.state === "lost",
                    "text-fg-muted": verdict.state === "tied",
                  }}
                  data-testid="tb-roll-row-versus-resolution"
                >
                  <strong class="font-mono">{myComparable}</strong>
                  <span class="text-fg-subtle"> vs </span>
                  <strong class="font-mono">{opp.total}</strong>
                  <span class="text-fg-subtle"> ({opp.rolledByName})</span>
                  {" — "}
                  {verdict.state === "won" && (
                    <>
                      won ·{" "}
                      <span data-testid="tb-roll-row-versus-margin">
                        margin of success: <strong class="font-mono">{verdict.margin}</strong>
                      </span>
                    </>
                  )}
                  {verdict.state === "lost" && (
                    <>
                      lost ·{" "}
                      <span data-testid="tb-roll-row-versus-margin">
                        margin of failure: <strong class="font-mono">{verdict.margin}</strong>
                      </span>
                    </>
                  )}
                  {verdict.state === "tied" && (
                    <>
                      tied ·{" "}
                      <span data-testid="tb-roll-row-versus-margin" class="text-fg-subtle">
                        GM resolves (DH p.250)
                      </span>
                    </>
                  )}
                </p>
              );
            }}
          </Show>
        </Show>

        {/* Standard pass/fail-vs-obstacle resolution line. Hidden
            when no obstacle is declared OR when this is a versus
            test (the versus block above handles its own margin) OR
            when this is a disposition roll. */}
        <Show
          when={
            summary() &&
            spec()!.obstacle !== null &&
            !spec()!.versusTestId &&
            !spec()!.dispositionMode
          }
        >
          {(_) => {
            const s = summary()!;
            const ob = spec()!.obstacle as number;
            const marginOfSuccess = s.final - ob;
            const marginOfFailure = ob - s.final;
            return (
              <p
                class="mt-3 border-t border-border-muted pt-2 text-[0.75rem]"
                classList={{
                  "text-accent": s.passed,
                  "text-danger": !s.passed,
                }}
                data-testid="tb-roll-row-resolution"
              >
                <strong class="font-mono">{s.final}</strong>
                <span class="text-fg-subtle"> vs </span>
                <strong class="font-mono">Ob {ob}</strong>
                {" — "}
                {s.passed ? (
                  <>
                    succeeded ·{" "}
                    <span data-testid="tb-roll-row-margin-of-success">
                      margin of success: <strong class="font-mono">{marginOfSuccess}</strong>
                    </span>
                  </>
                ) : (
                  <>
                    failed ·{" "}
                    <span data-testid="tb-roll-row-margin-of-failure">
                      margin of failure: <strong class="font-mono">{marginOfFailure}</strong>
                    </span>
                  </>
                )}
              </p>
            );
          }}
        </Show>
      </article>
    </Show>
  );
}
