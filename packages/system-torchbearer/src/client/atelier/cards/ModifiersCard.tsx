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

import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import type { Contribution } from "@vtt/characters/shared";
import type { AtelierState } from "../use-atelier.js";
import type {
  TbRollModifier,
  TbRollModifierApply,
  TbRollModifierKind,
} from "../../../shared/index.js";

interface PreviewModifier {
  id?: string;
  kind?: string;
  value?: number;
  label?: string;
  apply?: string;
  source?: string;
  providedBy?: string;
}

type Mode = "independent" | "versus" | "disposition";

interface QuickButton {
  shortLabel: string;
  title: string;
  mod: Omit<TbRollModifier, "id" | "source">;
}

const BASE_QUICKS: ReadonlyArray<QuickButton> = [
  {
    shortLabel: "+1D",
    title: "Add 1 die",
    mod: { kind: "dice", value: 1, label: "+1D", apply: "always" },
  },
  {
    shortLabel: "−1D",
    title: "Subtract 1 die",
    mod: { kind: "dice", value: -1, label: "−1D", apply: "always" },
  },
  {
    shortLabel: "+1s",
    title: "Add 1 success",
    mod: { kind: "success", value: 1, label: "+1s", apply: "always" },
  },
  {
    shortLabel: "−1s",
    title: "Subtract 1 success",
    mod: { kind: "success", value: -1, label: "−1s", apply: "always" },
  },
  {
    shortLabel: "+1s on succ.",
    title: "+1s applied only on success",
    mod: { kind: "success", value: 1, label: "bonus on success", apply: "on-success" },
  },
  {
    shortLabel: "+1s on fail",
    title: "+1s applied only on failure",
    mod: { kind: "success", value: 1, label: "bonus on fail", apply: "on-fail" },
  },
];

const OBSTACLE_QUICKS: ReadonlyArray<QuickButton> = [
  {
    shortLabel: "+1 Ob",
    title: "Raise the obstacle by 1",
    mod: { kind: "obstacle", value: 1, label: "+1 Ob", apply: "always" },
  },
  {
    shortLabel: "−1 Ob",
    title: "Lower the obstacle by 1",
    mod: { kind: "obstacle", value: -1, label: "−1 Ob", apply: "always" },
  },
];

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
 * Live modifier chip list + quick-mod ± buttons + suggested context
 * chips + labelled-modifier subform. Reads chips off the preview spec so
 * auto-derived mods (Fresh, Injured, taxed) AND manually-added mods both
 * appear; chips whose id matches a contribution payload get a × remove
 * button.
 *
 * Quick-button strip is mode-aware: ±Ob hidden in versus/disposition
 * (there's no obstacle in those modes).
 */
export function ModifiersCard(props: { atelier: AtelierState; mode: Mode }): JSX.Element {
  const mods = createMemo<PreviewModifier[]>(() => {
    const m = props.atelier.previewedSpec()?.["modifiers"];
    return Array.isArray(m) ? (m as PreviewModifier[]) : [];
  });

  const hasMatchingContribution = (modifierId: string | undefined): boolean => {
    if (!modifierId) return false;
    const contribs = props.atelier.pr()?.contributions as Contribution[] | undefined;
    if (!contribs) return false;
    return contribs.some((c) => {
      const inner = c.payload as { id?: unknown } | undefined;
      return inner?.id === modifierId;
    });
  };

  /* Labelled-modifier subform */
  const [showForm, setShowForm] = createSignal(false);
  const [kind, setKind] = createSignal<TbRollModifierKind>("dice");
  const [value, setValue] = createSignal("1");
  const [apply, setApply] = createSignal<TbRollModifierApply>("always");
  const [label, setLabel] = createSignal("");

  const submit = () => {
    const v = Number(value());
    if (!Number.isFinite(v) || !Number.isInteger(v) || v === 0) return;
    const lbl = label().trim();
    if (lbl.length === 0) return;
    props.atelier.offerLabelledMod({
      kind: kind(),
      value: v,
      apply: apply(),
      label: lbl,
    });
    setValue("1");
    setLabel("");
  };

  return (
    <section
      class="flex flex-col gap-2 rounded-(--radius-card) border border-border bg-surface p-3"
      data-testid="atelier-modifiers-card"
    >
      <span class="font-display text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
        Modifiers
      </span>
      <Show when={mods().length > 0}>
        <ul class="flex flex-wrap gap-1 text-[0.7rem]" data-testid="atelier-modifier-list">
          <For each={mods()}>
            {(m) => (
              <li
                class="inline-flex items-center gap-1 rounded-(--radius-control) bg-surface-elevated px-2 py-0.5"
                classList={{
                  "text-accent": (m.value ?? 0) > 0,
                  "text-danger": (m.value ?? 0) < 0,
                  "text-fg-muted": !((m.value ?? 0) !== 0),
                }}
                title={m.providedBy ?? m.label ?? ""}
              >
                <span>{formatPreviewModifier(m)}</span>
                <Show when={hasMatchingContribution(m.id)}>
                  <button
                    type="button"
                    onClick={() => props.atelier.removeContribution(m.id as string)}
                    class="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full border border-border text-[0.5rem] leading-none text-fg-subtle hover:border-danger hover:text-danger transition"
                    aria-label={`Remove modifier ${m.label ?? m.id}`}
                    data-testid={`atelier-modifier-remove-${m.id}`}
                  >
                    ×
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <div class="flex flex-wrap gap-1 border-t border-border-muted pt-2">
        <For each={BASE_QUICKS}>
          {(b) => (
            <button
              type="button"
              class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.7rem] text-fg-muted hover:border-accent hover:text-fg transition"
              onClick={() => props.atelier.offerQuickMod(b.mod)}
              title={b.title}
              data-testid={`atelier-quick-${b.shortLabel}`}
            >
              {b.shortLabel}
            </button>
          )}
        </For>
        <Show when={props.mode === "independent"}>
          <For each={OBSTACLE_QUICKS}>
            {(b) => (
              <button
                type="button"
                class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.7rem] text-fg-muted hover:border-accent hover:text-fg transition"
                onClick={() => props.atelier.offerQuickMod(b.mod)}
                title={b.title}
                data-testid={`atelier-quick-${b.shortLabel}`}
              >
                {b.shortLabel}
              </button>
            )}
          </For>
        </Show>
        <For each={props.atelier.suggestedQuickButtons()}>
          {(sq) => (
            <button
              type="button"
              class="rounded-(--radius-control) border border-dashed border-accent/60 bg-surface-elevated px-2 py-0.5 text-[0.7rem] text-fg-muted hover:border-accent hover:text-fg transition"
              onClick={() => props.atelier.applySuggested(sq)}
              title={sq.note}
              data-testid={`atelier-suggested-${sq.id}`}
            >
              {sq.buttonLabel}
            </button>
          )}
        </For>
        <button
          type="button"
          class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.7rem] text-fg-muted hover:border-accent hover:text-fg transition"
          onClick={() => setShowForm((v) => !v)}
          data-testid="atelier-modifier-add-toggle"
        >
          ⊕ label
        </button>
      </div>

      <Show when={showForm()}>
        <div class="flex flex-wrap items-center gap-1 border-t border-border-muted pt-2">
          <select
            value={kind()}
            onChange={(e) => setKind(e.currentTarget.value as TbRollModifierKind)}
            class="rounded-(--radius-control) border border-border bg-surface-elevated px-1 py-0.5 text-[0.65rem] text-fg outline-none focus:border-accent"
            aria-label="modifier kind"
            data-testid="atelier-labelled-kind"
          >
            <option value="dice">±D</option>
            <option value="success">±s</option>
            <Show when={props.mode === "independent"}>
              <option value="obstacle">±Ob</option>
            </Show>
          </select>
          <input
            type="number"
            value={value()}
            onInput={(e) => setValue(e.currentTarget.value)}
            class="w-16 rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-[0.7rem] text-fg outline-none focus:border-accent text-center"
            aria-label="modifier value"
            data-testid="atelier-labelled-value"
          />
          <select
            value={apply()}
            onChange={(e) => setApply(e.currentTarget.value as TbRollModifierApply)}
            class="rounded-(--radius-control) border border-border bg-surface-elevated px-1 py-0.5 text-[0.65rem] text-fg outline-none focus:border-accent"
            aria-label="apply mode"
            data-testid="atelier-labelled-apply"
          >
            <option value="always">always</option>
            <option value="on-success">on success</option>
            <option value="on-fail">on fail</option>
          </select>
          <input
            type="text"
            value={label()}
            onInput={(e) => setLabel(e.currentTarget.value)}
            placeholder="reason"
            class="flex-1 min-w-[6rem] rounded-(--radius-control) border border-border bg-surface px-2 py-0.5 text-[0.7rem] text-fg outline-none focus:border-accent"
            aria-label="modifier label"
            data-testid="atelier-labelled-label"
          />
          <button
            type="button"
            onClick={submit}
            disabled={label().trim().length === 0}
            class="rounded-(--radius-control) border border-border bg-surface-elevated px-2 py-0.5 text-[0.7rem] text-fg-muted hover:border-accent hover:text-fg transition disabled:opacity-50"
            data-testid="atelier-labelled-submit"
          >
            add
          </button>
        </div>
      </Show>
      <Show when={props.mode !== "independent"}>
        <p class="text-[0.6rem] text-fg-subtle italic">
          {props.mode === "versus"
            ? "no obstacle modifiers in versus tests"
            : "no obstacle in disposition rolls"}
        </p>
      </Show>
    </section>
  );
}
