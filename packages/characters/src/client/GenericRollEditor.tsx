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
  qualifiedName,
  type CommandInstance,
  type EntityId,
} from "@vtt/substrate";
import { useClient, useTrait } from "@vtt/substrate/client";
import { createMemo, For, Show, type JSX } from "solid-js";
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
import {
  ROLL_ATELIER_KIND,
  tagRollWithOrigin,
  type PendingRollEditor,
  type PendingRollEditorArgs,
} from "../shared/atelier.js";
import { useMe } from "./use-me.js";

/**
 * Generic fallback editor for non-TB pending rolls. Mirrors the structure
 * of the old `PendingRollPanel`'s body but lives in the Atelier shell —
 * headline + live preview chips + every matching legacy
 * `PendingRollContributor` fill + commit/cancel.
 *
 * Game systems that haven't migrated to the new `PendingRollEditorsSlot`
 * (e.g. `@vtt/system-simple`) still get a working surface; their
 * `PendingRollContributorsSlot` fills mount inside this generic editor.
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

function GenericRollEditorBody(props: { rollId: EntityId }): JSX.Element {
  const client = useClient();
  const me = useMe();
  const pr = useTrait(props.rollId, PendingRoll);
  const initiator = createMemo(() => {
    const v = pr();
    if (!v) return null;
    const got = client.world.get(v.initiatorCharacterId, [Character]) as
      | { Character: { name: string } }
      | undefined;
    return got?.Character ?? null;
  });

  const isInitiator = createMemo(
    () => !!me() && me()!.userId === pr()?.initiatorUserId,
  );
  const canCommit = createMemo(() => isInitiator() || me()?.role === "gm");

  const previewSpec = createMemo<Record<string, unknown> | null>(() => {
    const v = pr();
    if (!v) return null;
    const rollable = client.registry.rollables.get(v.rollableName);
    if (!rollable) return null;
    try {
      const raw = previewRollable(
        rollable,
        client.world,
        v.initiatorCharacterId,
        {
          ...(v.opts as Record<string, unknown>),
          contributions: v.contributions,
        },
      );
      return raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  });

  const sourceLabel = createMemo<string>(() => {
    const fromSpec = previewSpec()?.["source"];
    if (typeof fromSpec === "string" && fromSpec.length > 0) return fromSpec;
    const name = pr()?.rollableName;
    if (!name) return "?";
    return name.split("/").pop() ?? name;
  });
  const previewNotation = createMemo<string | null>(() => {
    const v = previewSpec()?.["notation"];
    return typeof v === "string" ? v : null;
  });
  const previewMods = createMemo<PreviewModifier[]>(() => {
    const m = previewSpec()?.["modifiers"];
    return Array.isArray(m) ? (m as PreviewModifier[]) : [];
  });

  const hasMatchingContribution = (modifierId: string | undefined): boolean => {
    if (!modifierId) return false;
    const contribs = pr()?.contributions as Contribution[] | undefined;
    if (!contribs) return false;
    return contribs.some((c) => {
      const inner = c.payload as { id?: unknown } | undefined;
      return inner?.id === modifierId;
    });
  };

  const commit = () => {
    const v = pr();
    if (!v) return;
    const rollable = client.registry.rollables.get(v.rollableName);
    if (!rollable) return;
    const result = invokeRollable(
      rollable,
      client.world,
      v.initiatorCharacterId,
      {
        ...(v.opts as Record<string, unknown>),
        contributions: v.contributions,
      },
    );
    if (result)
      client.dispatch(
        tagRollWithOrigin(result.command, props.rollId) as CommandInstance,
      );
    client.dispatch(
      CommitPendingRoll({ pendingRollId: props.rollId }) as CommandInstance,
    );
  };
  const cancel = () => {
    client.dispatch(
      CancelPendingRoll({ pendingRollId: props.rollId }) as CommandInstance,
    );
  };

  const contributors = createMemo<PendingRollContributor[]>(() => {
    const v = pr();
    if (!v) return [];
    const fills = client.registry.fillsForSlot(
      PendingRollContributorsSlot,
    ) as PendingRollContributor[];
    const matching = fills.filter(
      (f) =>
        !f.rollablePrefix || v.rollableName.startsWith(f.rollablePrefix),
    );
    return [...matching].sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return a.id.localeCompare(b.id);
    });
  });

  return (
    <Show when={pr()}>
      <article
        class="flex flex-col gap-3"
        data-testid="atelier-generic-editor"
      >
        <header class="flex items-baseline justify-between gap-2 border-b border-border-muted pb-2">
          <h3
            class="font-display text-sm tracking-tight text-fg"
            data-testid="pending-roll-headline"
          >
            <span>{initiator()?.name ?? "someone"}</span>
            <span class="text-fg-muted"> is rolling </span>
            <span>{sourceLabel()}</span>
          </h3>
          <Show when={previewNotation()}>
            <code class="font-mono text-xs text-accent">
              {previewNotation()}
            </code>
          </Show>
        </header>

        <Show when={previewMods().length > 0}>
          <ul
            class="flex flex-wrap gap-1 text-[0.7rem]"
            data-testid="pending-roll-modifiers"
          >
            <For each={previewMods()}>
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
                      onClick={() =>
                        client.dispatch(
                          RemoveContribution({
                            pendingRollId: props.rollId,
                            modifierId: m.id as string,
                          }) as CommandInstance,
                        )
                      }
                      class="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full border border-border text-[0.5rem] leading-none text-fg-subtle hover:border-danger hover:text-danger transition"
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
              <div class="rounded-(--radius-card) border border-border bg-surface p-3">
                {
                  c.render({
                    pendingRollId: props.rollId,
                    rollableName: pr()!.rollableName,
                    initiatorCharacterId: pr()!.initiatorCharacterId,
                    initiatorUserId: pr()!.initiatorUserId,
                    contribute: (contribution) => {
                      client.dispatch(
                        ContributeToPendingRoll({
                          pendingRollId: props.rollId,
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

        <Show when={canCommit()}>
          <footer class="flex items-center justify-end gap-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={cancel}
              class="rounded-(--radius-control) border border-border bg-surface px-3 py-1 text-xs text-fg-subtle hover:border-danger hover:text-danger transition"
              data-testid="atelier-generic-cancel"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={commit}
              class="rounded-(--radius-control) bg-accent px-4 py-1 text-xs font-medium text-accent-fg hover:bg-accent-hover transition"
              data-testid="atelier-generic-commit"
            >
              roll
            </button>
          </footer>
        </Show>
      </article>
    </Show>
  );
}

/**
 * Registered as a low-priority fill for `PendingRollEditorsSlot` so it
 * catches every pending roll a higher-priority TB-style editor doesn't
 * claim. Stays prefix-less; `rollablePrefix` is omitted so the resolver
 * picks it last.
 */
export const GenericPendingRollEditor: PendingRollEditor = {
  id: qualifiedName("@vtt/characters/generic-roll-editor") as PendingRollEditor["id"],
  priority: -1000,
  render: (args: PendingRollEditorArgs) =>
    GenericRollEditorBody({ rollId: args.rollId }) as JSX.Element,
};

/** Re-export the kind so the manifest can register it without an extra import dance. */
export { ROLL_ATELIER_KIND };
