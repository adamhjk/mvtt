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

import { useQuery, useTrait } from "@vtt/substrate/client";
import { Formula, RollResult, RolledBy } from "@vtt/resolution/shared";
import { RollActionsRegion } from "@vtt/resolution/client";
import { createMemo, For, Show, type JSX } from "solid-js";
import {
  countSuccesses,
  formatModifier,
  resolveSuccessCount,
  TbRollMetaSchema,
  type TbRollSpec,
} from "../shared/index.js";

import { type EntityId } from "@vtt/substrate";

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
export function TbRollRow(props: TbRollRowProps): JSX.Element {
  const formula = useTrait(props.entityId, Formula);
  const result = useTrait(props.entityId, RollResult);
  const rolledBy = useTrait(props.entityId, RolledBy);

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
        rolledByName: (row.values.RolledBy as { displayName: string }).displayName,
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
  /**
   * Comparable success count for versus resolution: raw + always-applied
   * bonus (= RollResult.total basis on both sides). Conditional
   * on-success/on-fail modifiers are excluded — they're gated on a
   * pass/fail that doesn't exist until the opponent rolls.
   */
  const myComparable = createMemo<number | null>(() => {
    const s = spec();
    if (!s) return null;
    return countSuccesses(dice(), s.successTarget) + s.bonusSuccesses;
  });

  const versusVerdict = createMemo<{ state: "won" | "lost" | "tied"; margin: number } | null>(
    () => {
      const opp = versusOpponent();
      const mine = myComparable();
      if (!opp || mine === null) return null;
      if (mine > opp.total) {
        return { state: "won", margin: mine - opp.total };
      }
      if (mine < opp.total) {
        return { state: "lost", margin: opp.total - mine };
      }
      return { state: "tied", margin: 0 };
    },
  );

  const isVersus = createMemo<boolean>(() => !!spec()?.versusTestId && !spec()?.dispositionMode);

  /**
   * Disposition value (SG p.63-64 / LM p.106 / DH p.254):
   *     final dispo = additive base + rolled successes − per-team
   *                   penalties (floored at 1 per SG p.47).
   *
   * The additive base is the captain's **Will** or **Health** rating,
   * picked per conflict type — distinct from the dice pool, which is
   * the skill rating. `spec.dispoBase` carries that ability rating
   * when the panel's "switch to disposition" toggle has resolved a
   * Will/Health choice. If absent (legacy contributions or unspecified),
   * we fall back to `spec.baseDice` — correct for Will-check /
   * Health-check rollables but wrong for skill rolls (the panel's
   * dispo toggle now requires Will/Health to be picked).
   *
   * Team penalties (Hungry & Thirsty, Exhausted) are folded into
   * `summary.always` as -1s modifiers; conditional on-pass/on-fail
   * modifiers don't apply (no pass/fail to gate them on).
   */
  const dispositionValue = createMemo<number | null>(() => {
    const s = spec();
    const sum = summary();
    if (!s?.dispositionMode || !sum) return null;
    const base = s.dispoBase ?? s.baseDice;
    return Math.max(1, base + sum.rawSuccesses + sum.always);
  });

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
              <Show when={spec()!.spellCast?.spellName}>
                {(name) => (
                  <>
                    <span class="text-fg-subtle"> for </span>
                    <span class="text-fg">{name()}</span>
                  </>
                )}
              </Show>
              <Show when={spec()!.obstacle !== null}>
                <span class="text-fg-subtle"> vs Ob {spec()!.obstacle}</span>
                <Show
                  when={spec()!.baseObstacle !== null && spec()!.baseObstacle !== spec()!.obstacle}
                >
                  <span
                    class="text-fg-subtle"
                    data-testid="tb-roll-row-obstacle-shift"
                    title={`Base Ob ${spec()!.baseObstacle} shifted by ${(spec()!.obstacle as number) - (spec()!.baseObstacle as number)}`}
                  >
                    {" "}
                    (base {spec()!.baseObstacle})
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
                  <Show
                    when={isVersus()}
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
                    {/* Versus header: no pass/fail until the opponent's
                        roll is in — just the comparable success count.
                        Once both rolls exist the verdict takes over. */}
                    <div class="flex flex-col items-end">
                      <strong
                        class="font-mono text-base"
                        classList={{
                          "text-fg": versusVerdict() === null,
                          "text-accent": versusVerdict()?.state === "won",
                          "text-danger": versusVerdict()?.state === "lost",
                          "text-fg-muted": versusVerdict()?.state === "tied",
                        }}
                        data-testid="tb-roll-row-success-count"
                      >
                        {myComparable() ?? sum().final}
                      </strong>
                      <span
                        class="text-[10px] uppercase tracking-[0.12em] text-fg-subtle"
                        data-testid="tb-roll-row-versus-header-state"
                      >
                        {versusVerdict()?.state ?? "successes"}
                      </span>
                    </div>
                  </Show>
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
          <p class="mt-2 text-[0.7rem] text-danger">Pool reduced to zero — auto-fail.</p>
        </Show>

        {/* Breakdown line: raw dice successes, always-applied bonus,
            conditional bonus folded in. Always rendered when there's
            a non-zero contribution beyond raw dice, so the math is
            never opaque. */}
        <Show when={summary() && (summary()!.always !== 0 || summary()!.conditional !== 0)}>
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

        {/* Post-roll actions: log buttons, fate/persona spends, plus
            anything other plugins drop into RollActionsSlot. The fill
            stack stays at the bottom of the row so the dice/result
            line above is undisturbed. */}
        <div class="mt-3">
          <RollActionsRegion rollId={props.entityId as EntityId} />
        </div>

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
                <span class="text-fg-subtle">disposition: </span>
                <strong class="font-mono">{s.baseDice}</strong>
                <span class="text-fg-subtle"> base + </span>
                <strong class="font-mono">{sum.rawSuccesses}</strong>
                <span class="text-fg-subtle"> successes</span>
                <Show when={sum.always !== 0}>
                  <span class="text-fg-subtle"> {sum.always >= 0 ? "+ " : "- "}</span>
                  <strong class="font-mono">{Math.abs(sum.always)}</strong>
                  <span class="text-fg-subtle"> bonuses</span>
                </Show>
                <span class="text-fg-subtle"> = </span>
                <strong class="font-mono">{v}</strong>
                <Show when={preFloor < 1}>
                  <span class="text-fg-subtle"> (floored at 1, SG p.47)</span>
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
                  <strong class="font-mono">{myComparable()}</strong>
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
