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
  Show,
  type JSX,
} from "solid-js";
import { Character } from "../shared/traits.js";
import {
  CancelPendingRoll,
  CommitPendingRoll,
  ContributeToPendingRoll,
} from "../shared/commands.js";
import {
  PendingRoll,
  type Contribution,
  type PendingRollValue,
} from "../shared/pending.js";
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

  const [modifier, setModifier] = createSignal("");
  const [modifierLabel, setModifierLabel] = createSignal("");

  const isInitiator = createMemo(
    () => !!me() && me()!.userId === pr()?.initiatorUserId,
  );
  const canCommit = createMemo(
    () => isInitiator() || me()?.role === "gm",
  );

  // Live preview of the dice notation including all current contributions.
  const previewNotation = createMemo<string | null>(() => {
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
      ) as { notation?: string } | null;
      return spec?.notation ?? null;
    } catch {
      return null;
    }
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

  const addModifier = () => {
    const m = me();
    if (!m) return;
    const raw = modifier().trim();
    if (raw.length === 0) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const label =
      modifierLabel().trim() ||
      `${m.userId}: ${value >= 0 ? "+" : ""}${value}`;
    client.dispatch(
      ContributeToPendingRoll({
        pendingRollId: props.pendingRollId,
        contribution: {
          kind: "modifier",
          label,
          fromUserId: m.userId,
          payload: { value },
        },
      }) as CommandInstance,
    );
    setModifier("");
    setModifierLabel("");
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
        <p class="text-xs text-fg">
          <span class="text-fg-muted">{initiator()?.name ?? "someone"}</span> is rolling
          via <code class="font-mono text-fg-subtle">{pr()!.rollableName.split("/").pop()}</code>
        </p>

        <Show when={(pr()!.contributions as Contribution[]).length > 0}>
          <ul class="flex flex-col gap-1 text-[0.7rem]">
            <For each={pr()!.contributions as Contribution[]}>
              {(c) => (
                <li class="flex items-center justify-between rounded-(--radius-control) bg-surface px-2 py-1 text-fg-muted">
                  <span>{c.label}</span>
                  <span class="font-mono text-[0.6rem] text-fg-subtle">{c.kind}</span>
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
                      client.dispatch(
                        ContributeToPendingRoll({
                          pendingRollId: props.pendingRollId,
                          contribution,
                        }) as CommandInstance,
                      );
                    },
                  }) as JSX.Element
                }
              </div>
            );
          }}
        </For>

        <Show when={me()}>
          <div class="flex flex-col gap-1 border-t border-border-muted pt-2">
            <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
              Add modifier
            </span>
            <div class="flex gap-1">
              <input
                type="text"
                value={modifierLabel()}
                onInput={(e) => setModifierLabel(e.currentTarget.value)}
                placeholder="reason (optional)"
                class="flex-1 min-w-0 rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-accent"
              />
              <input
                type="number"
                value={modifier()}
                onInput={(e) => setModifier(e.currentTarget.value)}
                placeholder="±N"
                class="w-16 rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-accent text-center"
              />
              <button
                type="button"
                onClick={addModifier}
                disabled={modifier().trim().length === 0}
                class="rounded-(--radius-control) border border-border bg-surface px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-50"
              >
                add
              </button>
            </div>
          </div>
        </Show>

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
