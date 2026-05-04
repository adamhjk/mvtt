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
  invokeRollable,
  previewRollable,
  type CommandInstance,
} from "@vtt/substrate";
import { useClient, useQuery, useTrait } from "@vtt/substrate/client";
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import { Character } from "../shared/traits.js";
import {
  CancelPendingRoll,
  CommitPendingRoll,
  ContributeToPendingRoll,
  RemoveContribution,
} from "../shared/commands.js";
import { PendingRoll, type Contribution } from "../shared/pending.js";
import {
  PendingRollContributorsSlot,
  type PendingRollContributor,
} from "../shared/slot.js";
import { useMe } from "./use-me.js";

/**
 * Chat-rail widget that renders one panel per active PendingRoll
 * entity. Visible to everyone — the initiator sees Commit/Cancel; other
 * players see contribution affordances.
 *
 * Mounted as a fill into ChatRailWidgetsSlot from the characters
 * manifest. With no pending rolls active, renders nothing — the
 * widget just disappears from the rail until someone clicks an
 * interactive roll.
 */
export function PendingRollPanels(): JSX.Element {
  const rolls = useQuery([PendingRoll]);
  return (
    <Show when={rolls().length > 0}>
      <div class="flex flex-col gap-2">
        <For each={rolls()}>
          {(row) => <PendingRollPanel pendingRollId={row.id} />}
        </For>
      </div>
    </Show>
  );
}

function PendingRollPanel(props: { pendingRollId: string }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const pr = useTrait(props.pendingRollId, PendingRoll);
  // useTrait wants a static entity id; the initiator id only exists once
  // we have the PendingRoll trait. Resolve via the world directly inside
  // a memo so the panel re-renders when the initiator's name changes.
  const initiator = createMemo(() => {
    const value = pr();
    if (!value) return null;
    const got = client.world.get(value.initiatorCharacterId, [Character]) as
      | { Character: { name: string } }
      | undefined;
    return got?.Character ?? null;
  });

  const isInitiator = createMemo(
    () => !!me() && me()!.userId === pr()?.initiatorUserId,
  );
  const canCommit = createMemo(
    () => isInitiator() || me()?.role === "gm",
  );

  // Ambient-trait reactivity. A rollable's compute may read traits
  // from entities other than the rolling character — TB disposition,
  // for instance, scans every party-tagged character's Conditions to
  // compute team penalties. The rollable declares those traits in
  // its `ambientInputs`; we subscribe to the world filtered by
  // their names and bump a tick the previewSpec memo touches, so
  // the preview re-runs when any matching entity's trait changes.
  // Per-entity traits in `inputs` are already tracked by the kit's
  // entity subscription; this signal covers only the cross-entity
  // case, which is opt-in per rollable.
  const [ambientTick, setAmbientTick] = createSignal(0);
  let lastSubscribedRollableName: string | null = null;
  let unsubscribeAmbient: (() => void) | null = null;
  const ensureAmbientSubscription = (): void => {
    const value = pr();
    const targetName = value?.rollableName ?? null;
    if (targetName === lastSubscribedRollableName) return;
    if (unsubscribeAmbient) {
      unsubscribeAmbient();
      unsubscribeAmbient = null;
    }
    lastSubscribedRollableName = targetName;
    if (!targetName) return;
    const rollable = client.registry.rollables.get(targetName);
    if (!rollable) return;
    const ambient = rollable.ambientInputs;
    if (!ambient || ambient.length === 0) return;
    const watched = new Set(ambient.map((t) => t.name));
    unsubscribeAmbient = client.world.subscribe((_id, name) => {
      if (watched.has(name)) setAmbientTick((v) => v + 1);
    });
  };
  onCleanup(() => {
    if (unsubscribeAmbient) {
      unsubscribeAmbient();
      unsubscribeAmbient = null;
    }
  });

  // The current preview spec — the rollable's `compute` re-run with
  // the live contributions list folded in. Memoised so the notation,
  // source-label, and any future system-aware fields all derive from
  // a single read of the world.
  const previewSpec = createMemo<Record<string, unknown> | null>(() => {
    // Ensure the ambient-trait subscription matches the current
    // rollable, then touch the tick so this memo re-runs on
    // ambient writes. The dependency on `pr()` below handles
    // contribution changes; the tick handles cross-entity traits.
    ensureAmbientSubscription();
    ambientTick();
    const value = pr();
    if (!value) return null;
    const rollable = client.registry.rollables.get(value.rollableName);
    if (!rollable) return null;
    try {
      const spec = previewRollable(
        rollable,
        client.world,
        value.initiatorCharacterId,
        {
          ...(value.opts as Record<string, unknown>),
          contributions: value.contributions,
        },
      ) as Record<string, unknown> | null;
      return spec;
    } catch {
      return null;
    }
  });

  const previewNotation = createMemo<string | null>(() => {
    const v = previewSpec()?.notation;
    return typeof v === "string" ? v : null;
  });

  /**
   * Read shaped fields off the preview spec — `pool`, `obstacle`,
   * `baseObstacle`, `successTarget`, `heroic` — for the live
   * "this is what you'd actually roll" display under the headline.
   * Each accessor is null-safe; non-numeric / missing fields render
   * as undefined and the markup hides those rows.
   *
   * The panel is system-agnostic (lives in @vtt/characters), so
   * it can't import `TbRollSpec` directly. It just looks for these
   * conventional field names — TB's compute fills them; other
   * systems can opt in by emitting the same keys.
   */
  function specNum(k: string): number | null {
    const v = previewSpec()?.[k];
    return typeof v === "number" ? v : null;
  }
  function specBool(k: string): boolean {
    const v = previewSpec()?.[k];
    return v === true;
  }
  function specStr(k: string): string | null {
    const v = previewSpec()?.[k];
    return typeof v === "string" && v.length > 0 ? v : null;
  }

  /**
   * Modifier list from the live preview spec — auto-derived
   * (e.g. Fresh, Injured, skill-taxed) plus everything the player
   * has stacked via the panel. The shape follows the TB modifier
   * convention (`{kind, value, label, apply, source, ...}`); other
   * systems that follow the same convention render here for free.
   *
   * Rendering is inline (no TB-system import) so this works for
   * any rollable whose compute publishes a `modifiers` array.
   */
  interface PreviewModifier {
    id?: string;
    kind?: string;
    value?: number;
    label?: string;
    apply?: string;
    source?: string;
    providedBy?: string;
  }
  function specModifiers(): PreviewModifier[] {
    const m = previewSpec()?.modifiers;
    return Array.isArray(m) ? (m as PreviewModifier[]) : [];
  }
  function unitFor(kind: string | undefined): string {
    if (kind === "obstacle") return " Ob";
    if (kind === "dice") return "D";
    if (kind === "success") return "s";
    return "";
  }
  function formatPreviewModifier(m: PreviewModifier): string {
    const v = typeof m.value === "number" ? m.value : 0;
    const sign = v >= 0 ? "+" : "";
    const head = `${sign}${v}${unitFor(m.kind)}`;
    const lbl = m.label ?? "";
    if (m.apply === "on-success") return `${head} on success: ${lbl}`;
    if (m.apply === "on-fail") return `${head} on fail: ${lbl}`;
    return lbl ? `${head} ${lbl}` : head;
  }

  /**
   * Decide whether a modifier in the preview spec corresponds to a
   * removable contribution. We match by `payload.id`: a contribution
   * carrying the same modifier id is the source of this chip and
   * can be undone via RemoveContribution. Auto-modifiers (Fresh,
   * Injured, etc.) have no matching contribution because they're
   * computed each pass from character state — those chips render
   * without a × button.
   */
  function hasMatchingContribution(modifierId: string | undefined): boolean {
    if (!modifierId) return false;
    const contribs = pr()?.contributions as Contribution[] | undefined;
    if (!contribs) return false;
    return contribs.some((c) => {
      const inner = c.payload as { id?: unknown } | undefined;
      return inner?.id === modifierId;
    });
  }

  const removeModifier = (modifierId: string) => {
    client.dispatch(
      RemoveContribution({
        pendingRollId: props.pendingRollId,
        modifierId,
      }) as CommandInstance,
    );
  };

  /**
   * Short, human-readable label for what's being rolled — "Will",
   * "Fighter", "Resources". Pulls from `spec.source` (TB convention)
   * when the rollable's compute provides one; falls back to the
   * last segment of the rollable's qualified name so non-TB rollables
   * still render readably.
   */
  const sourceLabel = createMemo<string>(() => {
    const fromSpec = previewSpec()?.source;
    if (typeof fromSpec === "string" && fromSpec.length > 0) return fromSpec;
    const name = pr()?.rollableName;
    if (!name) return "?";
    return name.split("/").pop() ?? name;
  });

  const commit = () => {
    const value = pr();
    if (!value) return;
    const rollable = client.registry.rollables.get(value.rollableName);
    if (!rollable) return;
    // The committing client dispatches the rollable's command directly,
    // then the despawn. Server processes them serially per client; the
    // rollable flows through its normal apply path with no system-
    // dispatch detour.
    const result = invokeRollable(
      rollable,
      client.world,
      value.initiatorCharacterId,
      {
        ...(value.opts as Record<string, unknown>),
        contributions: value.contributions,
      },
    );
    if (result) client.dispatch(result.command);
    client.dispatch(
      CommitPendingRoll({ pendingRollId: props.pendingRollId }) as CommandInstance,
    );
  };

  const cancel = () => {
    client.dispatch(
      CancelPendingRoll({ pendingRollId: props.pendingRollId }) as CommandInstance,
    );
  };

  const contributors = createMemo<PendingRollContributor[]>(() => {
    const value = pr();
    if (!value) return [];
    const fills = client.registry.fillsForSlot(
      PendingRollContributorsSlot,
    ) as PendingRollContributor[];
    const matching = fills.filter(
      (f) =>
        !f.rollablePrefix ||
        value.rollableName.startsWith(f.rollablePrefix),
    );
    return [...matching].sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return a.id.localeCompare(b.id);
    });
  });

  return (
    <Show when={pr() && initiator()}>
      <article
        class="flex flex-col gap-2 rounded-(--radius-card) border border-accent/40 bg-surface-elevated p-3"
        data-testid="pending-roll-panel"
      >
        <header class="flex items-baseline justify-between gap-2">
          <h3 class="font-display text-[0.65rem] uppercase tracking-[0.16em] text-fg-muted">
            Pending roll
          </h3>
          <Show when={previewNotation()}>
            <code class="font-mono text-xs text-accent">{previewNotation()}</code>
          </Show>
        </header>
        <p class="text-xs text-fg" data-testid="pending-roll-headline">
          <span class="text-fg">{initiator()?.name ?? "someone"}</span>
          <span class="text-fg-muted"> is rolling </span>
          <span class="text-fg">{sourceLabel()}</span>
        </p>

        {/* Live formula breakdown: dice pool, success target, and
            resolved obstacle. Each line is shown only when the
            preview spec actually carries that field, so non-TB
            rollables render whatever they happen to provide
            without forcing a shape. */}
        <Show when={specNum("pool") !== null}>
          <p
            class="text-[0.7rem] text-fg-subtle font-mono"
            data-testid="pending-roll-formula"
          >
            <span class="text-fg-muted">pool: </span>
            <span class="text-fg">{specNum("pool")}d6</span>
            <Show when={specNum("successTarget") !== null}>
              <span class="text-fg-subtle"> ≥ {specNum("successTarget")}</span>
            </Show>
            <Show when={specBool("heroic")}>
              <span
                class="ml-1 rounded-(--radius-control) bg-accent px-1 text-[0.55rem] uppercase tracking-[0.12em] text-accent-fg"
                data-testid="pending-roll-heroic-badge"
              >
                heroic
              </span>
            </Show>
          </p>
        </Show>

        <Show when={specNum("obstacle") !== null}>
          <p
            class="text-[0.7rem] text-fg-subtle font-mono"
            data-testid="pending-roll-obstacle"
          >
            <span class="text-fg-muted">obstacle: </span>
            <span class="text-fg">Ob {specNum("obstacle")}</span>
            <Show
              when={
                specNum("baseObstacle") !== null &&
                specNum("baseObstacle") !== specNum("obstacle")
              }
            >
              <span class="text-fg-subtle">
                {" "}(base {specNum("baseObstacle")})
              </span>
            </Show>
          </p>
        </Show>

        <Show when={specStr("versusTestId") !== null}>
          <p
            class="text-[0.7rem] text-fg-subtle font-mono"
            data-testid="pending-roll-versus"
          >
            <span class="text-fg-muted">versus test paired —{" "}</span>
            <span class="text-accent">opponent's successes are the obstacle</span>
          </p>
        </Show>

        {/* Live modifier list, sourced from the rollable's preview
            spec. This is the single source of truth: auto-derived
            modifiers (Fresh, Injured, skill-taxed, etc.) AND the
            panel-stacked contributions both flow through the
            rollable's compute into `spec.modifiers`. Rendering them
            from the spec means the player sees every die-bumping
            effect, not just the ones they typed in.
            "Settings"-style contributions (heroic toggle, base
            obstacle, versus pairing) are still suppressed — they're
            spec fields, not modifiers. */}
        <Show when={specModifiers().length > 0}>
          <ul
            class="flex flex-wrap gap-1 text-[0.7rem]"
            data-testid="pending-roll-modifiers"
          >
            <For each={specModifiers()}>
              {(m) => (
                <li
                  class="inline-flex items-center gap-1 rounded-(--radius-control) bg-surface px-2 py-0.5"
                  classList={{
                    "text-accent":
                      typeof m.value === "number" && m.value > 0,
                    "text-danger":
                      typeof m.value === "number" && m.value < 0,
                    "text-fg-muted":
                      !(typeof m.value === "number") || m.value === 0,
                  }}
                  title={m.providedBy ?? m.label ?? ""}
                >
                  <span>{formatPreviewModifier(m)}</span>
                  <Show when={hasMatchingContribution(m.id)}>
                    <button
                      type="button"
                      onClick={() => removeModifier(m.id as string)}
                      class="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full border border-border text-[0.5rem] leading-none text-fg-subtle hover:border-danger hover:text-danger transition"
                      title="Remove this modifier"
                      aria-label={`Remove modifier ${m.label ?? m.id}`}
                      data-testid={`pending-roll-modifier-remove-${m.id}`}
                    >
                      ×
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <For each={contributors()}>
          {(c) => {
            const m = me();
            if (!m) return null;
            return (
              <div class="border-t border-border-muted pt-2">
                {
                  c.render({
                    pendingRollId: props.pendingRollId,
                    rollableName: pr()!.rollableName,
                    initiatorCharacterId: pr()!.initiatorCharacterId,
                    initiatorUserId: pr()!.initiatorUserId,
                    contribute: (contribution) => {
                      const handle = client.dispatch(
                        ContributeToPendingRoll({
                          pendingRollId: props.pendingRollId,
                          contribution,
                        }) as CommandInstance,
                      );
                      void handle.ack.then((ack) => {
                        if (!ack.ok) {
                          // eslint-disable-next-line no-console
                          console.error(
                            "ContributeToPendingRoll rejected:",
                            ack.reason,
                            { contribution },
                          );
                        }
                      });
                    },
                  }) as JSX.Element
                }
              </div>
            );
          }}
        </For>

        <Show when={canCommit()}>
          <div class="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={cancel}
              class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-xs text-fg-subtle hover:border-danger hover:text-danger transition"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={commit}
              class="rounded-(--radius-control) bg-accent px-3 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover transition"
            >
              roll
            </button>
          </div>
        </Show>
      </article>
    </Show>
  );
}
