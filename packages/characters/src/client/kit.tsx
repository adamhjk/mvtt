// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import {
  invokeRollable,
  previewRollable,
  type AnyRollableDef,
  type CommandInstance,
  type EventInstance,
  type TraitMeta,
  type TraitName,
} from "@vtt/substrate";
import {
  useClient,
  useTrait,
  useTraitPath,
} from "@vtt/substrate/client";
import { OwnedBy } from "@vtt/permissions/shared";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { OpenPendingRoll, SetField } from "../shared/commands.js";
import { Character } from "../shared/traits.js";
import { useMe } from "./use-me.js";

/* -------------------------------------------------------------------------
 * Shared types and gating
 * ----------------------------------------------------------------------- */

/**
 * Common props for every kit input that binds to a trait path on a
 * character. The kit dispatches `SetField` by default; pass `command`
 * + (optional) `payload` to use a system-specific command instead.
 */
export interface FieldBinding {
  readonly characterId: string;
  readonly trait: TraitMeta;
  readonly path: ReadonlyArray<string | number>;
  /**
   * If provided, the kit dispatches this command on commit instead of
   * the universal SetField. Use for fields whose write needs richer
   * validation than the trait's Zod schema (e.g., HP clamped against
   * MaxHp). The command's payload is built from `payloadFromValue`.
   */
  readonly command?: { (payload: unknown): CommandInstance; name: string };
  /**
   * Build the override command's payload from the new value. Receives
   * the new value, the binding, and the previous value — enough to
   * construct any per-field write semantics. Required when `command`
   * is set.
   */
  readonly payloadFromValue?: (args: {
    value: unknown;
    prev: unknown;
    characterId: string;
  }) => unknown;
  /**
   * "owner" — only the OwnedBy user (or a GM) may edit. Default.
   * "gm"    — only a GM may edit.
   * "any"   — any authenticated user may edit.
   */
  readonly requires?: "owner" | "gm" | "any";
}

/**
 * Returns a Solid accessor of "may the current user edit this field?"
 * Reads OwnedBy on the character + the current user's session role.
 */
function useCanEdit(
  characterId: string,
  requires: "owner" | "gm" | "any" = "owner",
): () => boolean {
  const me = useMe();
  const ownership = useTrait(characterId, OwnedBy);
  const character = useTrait(characterId, Character);
  return createMemo(() => {
    if (!character()) return false;
    const m = me();
    if (!m) return false;
    if (m.role === "gm") return true;
    if (requires === "gm") return false;
    if (requires === "any") return true;
    const o = ownership();
    return !!o && o.userId === m.userId;
  });
}

/**
 * Build the command instance to dispatch when an input commits. Uses
 * the binding's override `command` + `payloadFromValue` if both are
 * provided; otherwise falls back to the universal SetField.
 */
function buildWriteCommand(
  binding: FieldBinding,
  value: unknown,
  prev: unknown,
): CommandInstance {
  if (binding.command && binding.payloadFromValue) {
    return binding.command(
      binding.payloadFromValue({
        value,
        prev,
        characterId: binding.characterId,
      }),
    );
  }
  return SetField({
    characterId: binding.characterId,
    trait: binding.trait.name as unknown as string,
    path: binding.path as Array<string | number>,
    value,
  }) as CommandInstance;
}

/* -------------------------------------------------------------------------
 * Field-level styles (runtime-injected once)
 * ----------------------------------------------------------------------- */

const KIT_STYLE_ID = "vtt-characters-kit-styles";
const KIT_CSS = `
.vk-row { display: flex; flex-direction: row; align-items: center; gap: 0.5rem; min-width: 0; }
.vk-row__label {
  flex: 0 0 auto;
  min-width: 4.5rem;
  font-family: var(--font-display);
  font-size: 0.65rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-fg-subtle);
}
.vk-stack { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.vk-stack__label {
  font-family: var(--font-display);
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--color-fg-subtle);
}
.vk-section { display: flex; flex-direction: column; gap: 0.6rem; }
.vk-section__title {
  font-family: var(--font-display);
  font-size: 0.65rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--color-fg-subtle);
}
.vk-group { display: grid; gap: 0.6rem; }
.vk-group--row { grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
.vk-group--column { grid-template-columns: 1fr; }
.vk-group--cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.vk-group--cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.vk-group--cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.vk-group--cols-6 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.vk-group--cols-12 { grid-template-columns: repeat(12, minmax(0, 1fr)); }
@container sheet (max-width: 600px) {
  .vk-group--cols-6, .vk-group--cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .vk-group--cols-12 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

/* Inputs share base look; tweak per-kind on top. */
.vk-input {
  width: 100%;
  min-width: 0;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-fg);
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.vk-input:focus { border-color: var(--color-accent); box-shadow: 0 0 0 1px var(--color-accent); }
.vk-input:disabled { opacity: 0.6; cursor: not-allowed; }
.vk-input--number { text-align: center; font-variant-numeric: tabular-nums; font-family: var(--font-display); font-size: 1.05rem; padding: 0.35rem 0.4rem; }
.vk-input--textarea { min-height: 4rem; resize: vertical; font-family: var(--font-sans); }
.vk-value {
  display: inline-block;
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-size: 1rem;
  color: var(--color-fg);
  padding: 0.2rem 0.5rem;
  background: var(--color-surface-elevated);
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-muted);
}
.vk-value--placeholder { color: var(--color-fg-subtle); font-style: italic; }
.vk-check {
  appearance: none;
  -webkit-appearance: none;
  width: 1.1rem; height: 1.1rem;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  cursor: pointer;
  display: inline-block;
  position: relative;
  transition: background 120ms ease, border-color 120ms ease;
  vertical-align: middle;
}
.vk-check:checked {
  background: var(--color-accent);
  border-color: var(--color-accent);
}
.vk-check:checked::after {
  content: "✓";
  color: var(--color-accent-fg);
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: bold;
}

/* Dots — N circles, filled = ●, empty = ○. Click to set value to k. */
.vk-dots { display: inline-flex; flex-direction: row; align-items: center; gap: 0.2rem; cursor: pointer; user-select: none; }
.vk-dots--readonly { cursor: default; }
.vk-dot {
  width: 0.85rem; height: 0.85rem;
  border-radius: 50%;
  border: 1.5px solid var(--color-fg-muted);
  background: transparent;
  transition: background 120ms ease, border-color 120ms ease;
}
.vk-dot--filled { background: var(--color-fg); border-color: var(--color-fg); }
.vk-dots:not(.vk-dots--readonly) .vk-dot:hover { border-color: var(--color-accent); }

/* Track — a row of boxes you tick. Used for HP, willpower, stress. */
.vk-track { display: inline-flex; flex-direction: row; align-items: center; gap: 0.2rem; flex-wrap: wrap; cursor: pointer; user-select: none; }
.vk-track--readonly { cursor: default; }
.vk-trackbox {
  width: 0.95rem; height: 0.95rem;
  border-radius: 3px;
  border: 1.5px solid var(--color-fg-muted);
  background: transparent;
  font-size: 0.6rem; line-height: 1; color: var(--color-fg);
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 120ms ease, border-color 120ms ease;
}
.vk-trackbox--filled { background: var(--color-fg); border-color: var(--color-fg); color: var(--color-surface); }
.vk-track:not(.vk-track--readonly) .vk-trackbox:hover { border-color: var(--color-accent); }

/* Rollable labels — anything you can click to roll. */
.vk-rollable {
  cursor: pointer;
  border-bottom: 1px dashed transparent;
  transition: color 120ms ease, border-color 120ms ease;
}
.vk-rollable:hover {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
}
.vk-rollable:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 2px;
}
.vk-rollbutton {
  display: inline-flex; align-items: center; gap: 0.35rem;
  padding: 0.35rem 0.7rem;
  border-radius: var(--radius-control);
  background: var(--color-accent);
  color: var(--color-accent-fg);
  border: 0;
  cursor: pointer;
  font-family: var(--font-display);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  transition: background 120ms ease;
}
.vk-rollbutton:hover { background: var(--color-accent-hover, var(--color-accent)); }
.vk-rollbutton:disabled { opacity: 0.5; cursor: not-allowed; }

.vk-summary { display: inline-flex; flex-direction: column; gap: 0.1rem; min-width: 3.5rem; }
.vk-summary__label {
  font-family: var(--font-display);
  font-size: 0.55rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--color-fg-subtle);
}
.vk-summary__value {
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-size: 1.1rem;
  color: var(--color-fg);
}
`;

function injectKitStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(KIT_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = KIT_STYLE_ID;
  el.textContent = KIT_CSS;
  document.head.appendChild(el);
}

function useKitStyles(): void {
  onMount(injectKitStyles);
}

/* -------------------------------------------------------------------------
 * Layout primitives
 * ----------------------------------------------------------------------- */

export function SheetSection(props: {
  title?: string;
  children: JSX.Element;
}): JSX.Element {
  useKitStyles();
  return (
    <section class="vk-section">
      <Show when={props.title}>
        <h3 class="vk-section__title">{props.title}</h3>
      </Show>
      {props.children}
    </section>
  );
}

export function SheetGroup(props: {
  layout?: "row" | "column" | "grid";
  cols?: 2 | 3 | 4 | 6 | 12;
  children: JSX.Element;
}): JSX.Element {
  useKitStyles();
  const cls = createMemo(() => {
    const layout = props.layout ?? "column";
    const colClass =
      layout === "grid" && props.cols ? `vk-group--cols-${props.cols}` : "";
    const layoutClass = layout === "grid" ? "" : `vk-group--${layout}`;
    return `vk-group ${layoutClass} ${colClass}`.trim();
  });
  return <div class={cls()}>{props.children}</div>;
}

export function FieldRow(props: {
  label?: string;
  children: JSX.Element;
}): JSX.Element {
  useKitStyles();
  return (
    <div class="vk-row">
      <Show when={props.label}>
        <span class="vk-row__label">{props.label}</span>
      </Show>
      <div style={{ display: "flex", flex: 1, "min-width": 0, gap: "0.5rem", "align-items": "center" }}>
        {props.children}
      </div>
    </div>
  );
}

export function FieldStack(props: {
  label?: string;
  children: JSX.Element;
}): JSX.Element {
  useKitStyles();
  return (
    <div class="vk-stack">
      <Show when={props.label}>
        <span class="vk-stack__label">{props.label}</span>
      </Show>
      {props.children}
    </div>
  );
}

export function SummaryStat(props: {
  label: string;
  value: JSX.Element;
}): JSX.Element {
  useKitStyles();
  return (
    <div class="vk-summary">
      <span class="vk-summary__label">{props.label}</span>
      <span class="vk-summary__value">{props.value}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Read-only display
 * ----------------------------------------------------------------------- */

/**
 * Read-only display of a value at a trait path. Used for derived
 * stats (save bonuses, AC, passive perception) and for "always show
 * the formula" hints.
 */
export function ValueField(props: {
  characterId: string;
  trait: TraitMeta;
  path?: ReadonlyArray<string | number>;
  /** "signed" — render +N / -N. "raw" — as-is. Default: "raw". */
  format?: "raw" | "signed";
  /** What to show when the value is undefined. Default: "—". */
  placeholder?: string;
}): JSX.Element {
  useKitStyles();
  const value = useTraitPath(props.characterId, props.trait, props.path ?? []);
  const display = createMemo<string>(() => {
    const v = value();
    if (v === undefined || v === null) return props.placeholder ?? "—";
    if (props.format === "signed" && typeof v === "number") {
      return v >= 0 ? `+${v}` : `${v}`;
    }
    return String(v);
  });
  const isPlaceholder = createMemo(() => value() === undefined || value() === null);
  return (
    <span
      class={`vk-value ${isPlaceholder() ? "vk-value--placeholder" : ""}`}
    >
      {display()}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Bound inputs
 * ----------------------------------------------------------------------- */

/**
 * Single-line text input bound to a trait path. Commits on blur or
 * Enter; reverts on Escape. Re-syncs from the trait if it changes
 * elsewhere while the user isn't editing.
 */
export function TextField(props: FieldBinding & {
  placeholder?: string;
  maxLength?: number;
}): JSX.Element {
  useKitStyles();
  const client = useClient();
  const canEdit = useCanEdit(props.characterId, props.requires);
  const stored = useTraitPath(props.characterId, props.trait, props.path);
  const [local, setLocal] = createSignal<string>("");
  const [editing, setEditing] = createSignal(false);
  let lastDispatched: string | null = null;

  createEffect(() => {
    const next = (stored() ?? "") as string;
    if (editing()) return;
    if (lastDispatched !== null) {
      if (next === lastDispatched) lastDispatched = null;
      return;
    }
    setLocal(next);
  });

  const commit = () => {
    const next = local();
    const cur = (stored() ?? "") as string;
    if (next === cur) {
      setEditing(false);
      return;
    }
    lastDispatched = next;
    client.dispatch(buildWriteCommand(props, next, cur));
    setEditing(false);
  };

  return (
    <input
      type="text"
      class="vk-input"
      value={local()}
      disabled={!canEdit()}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      autocomplete="off"
      spellcheck={false}
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      onFocus={() => setEditing(true)}
      onInput={(e) => setLocal(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.currentTarget as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setLocal((stored() ?? "") as string);
          setEditing(false);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function TextAreaField(props: FieldBinding & {
  placeholder?: string;
  rows?: number;
}): JSX.Element {
  useKitStyles();
  const client = useClient();
  const canEdit = useCanEdit(props.characterId, props.requires);
  const stored = useTraitPath(props.characterId, props.trait, props.path);
  const [local, setLocal] = createSignal<string>("");
  const [editing, setEditing] = createSignal(false);
  let lastDispatched: string | null = null;

  createEffect(() => {
    const next = (stored() ?? "") as string;
    if (editing()) return;
    if (lastDispatched !== null) {
      if (next === lastDispatched) lastDispatched = null;
      return;
    }
    setLocal(next);
  });

  const commit = () => {
    const next = local();
    const cur = (stored() ?? "") as string;
    if (next === cur) {
      setEditing(false);
      return;
    }
    lastDispatched = next;
    client.dispatch(buildWriteCommand(props, next, cur));
    setEditing(false);
  };

  return (
    <textarea
      class="vk-input vk-input--textarea"
      value={local()}
      disabled={!canEdit()}
      placeholder={props.placeholder}
      rows={props.rows ?? 3}
      onFocus={() => setEditing(true)}
      onInput={(e) => setLocal(e.currentTarget.value)}
      onBlur={commit}
    />
  );
}

export function NumberField(props: FieldBinding & {
  min?: number;
  max?: number;
  step?: number;
}): JSX.Element {
  useKitStyles();
  const client = useClient();
  const canEdit = useCanEdit(props.characterId, props.requires);
  const stored = useTraitPath(props.characterId, props.trait, props.path);
  const [local, setLocal] = createSignal<string>("");
  const [editing, setEditing] = createSignal(false);
  let lastDispatched: number | null = null;

  createEffect(() => {
    const v = stored();
    if (editing()) return;
    const next = typeof v === "number" ? String(v) : "";
    if (lastDispatched !== null) {
      if (typeof v === "number" && v === lastDispatched) lastDispatched = null;
      return;
    }
    setLocal(next);
  });

  const commit = () => {
    const raw = local().trim();
    const cur = stored() as number | undefined;
    if (raw === "") {
      // Empty resets to current trait value (no write).
      setLocal(typeof cur === "number" ? String(cur) : "");
      setEditing(false);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setLocal(typeof cur === "number" ? String(cur) : "");
      setEditing(false);
      return;
    }
    let next = parsed;
    if (typeof props.min === "number") next = Math.max(next, props.min);
    if (typeof props.max === "number") next = Math.min(next, props.max);
    if (next === cur) {
      setLocal(String(next));
      setEditing(false);
      return;
    }
    lastDispatched = next;
    client.dispatch(buildWriteCommand(props, next, cur));
    setLocal(String(next));
    setEditing(false);
  };

  return (
    <input
      type="number"
      class="vk-input vk-input--number"
      value={local()}
      disabled={!canEdit()}
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      autocomplete="off"
      spellcheck={false}
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      onFocus={() => setEditing(true)}
      onInput={(e) => setLocal(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.currentTarget as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          const cur = stored() as number | undefined;
          setLocal(typeof cur === "number" ? String(cur) : "");
          setEditing(false);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function CheckField(props: FieldBinding): JSX.Element {
  useKitStyles();
  const client = useClient();
  const canEdit = useCanEdit(props.characterId, props.requires);
  const stored = useTraitPath(props.characterId, props.trait, props.path);
  return (
    <input
      type="checkbox"
      class="vk-check"
      checked={!!stored()}
      disabled={!canEdit()}
      onChange={(e) => {
        const next = e.currentTarget.checked;
        client.dispatch(buildWriteCommand(props, next, !!stored()));
      }}
    />
  );
}

export function SelectField(props: FieldBinding & {
  options: ReadonlyArray<{ value: string; label: string }>;
}): JSX.Element {
  useKitStyles();
  const client = useClient();
  const canEdit = useCanEdit(props.characterId, props.requires);
  const stored = useTraitPath(props.characterId, props.trait, props.path);
  return (
    <select
      class="vk-input"
      disabled={!canEdit()}
      value={(stored() ?? "") as string}
      onChange={(e) => {
        const next = e.currentTarget.value;
        client.dispatch(buildWriteCommand(props, next, stored()));
      }}
    >
      <For each={props.options}>
        {(o) => <option value={o.value}>{o.label}</option>}
      </For>
    </select>
  );
}

/* -------------------------------------------------------------------------
 * Dots and tracks
 * ----------------------------------------------------------------------- */

/**
 * Rated value 0..max rendered as N dots. Click a dot to set the rating
 * to that level. Click the currently-set dot to clear back to 0.
 *
 * Common uses: WoD attribute scores (●●●○○), proficiency rank, FATE
 * skill ladder positions.
 */
export function DotsField(props: FieldBinding & {
  max: number;
}): JSX.Element {
  useKitStyles();
  const client = useClient();
  const canEdit = useCanEdit(props.characterId, props.requires);
  const stored = useTraitPath(props.characterId, props.trait, props.path);
  const value = createMemo<number>(() => {
    const v = stored();
    return typeof v === "number" ? v : 0;
  });

  const setTo = (n: number) => {
    if (!canEdit()) return;
    const cur = value();
    const next = cur === n ? Math.max(0, n - 1) : n; // click filled to clear one
    if (next === cur) return;
    client.dispatch(buildWriteCommand(props, next, cur));
  };

  const dots = createMemo(() => {
    const out: number[] = [];
    for (let i = 1; i <= props.max; i++) out.push(i);
    return out;
  });

  return (
    <span
      class={`vk-dots ${canEdit() ? "" : "vk-dots--readonly"}`}
      role="group"
      aria-label={`rating ${value()} of ${props.max}`}
    >
      <For each={dots()}>
        {(n) => (
          <span
            class={`vk-dot ${n <= value() ? "vk-dot--filled" : ""}`}
            onClick={() => setTo(n)}
          />
        )}
      </For>
    </span>
  );
}

/**
 * Bounded counter rendered as N tickable boxes — health, willpower,
 * stress, ammo, hit dice. Stores a single number 0..max; clicking the
 * Kth box sets the count to K (or K-1 if already filled to that mark).
 *
 * For tracks with multiple glyph types (WoD humanity stained vs. lost,
 * D&D death saves success/fail), define a system-specific component
 * that wraps a `useTraitPath` and emits the right SetField. The kit
 * focuses on the universal "fill to N" pattern.
 */
export function TrackField(props: FieldBinding & {
  max: number;
}): JSX.Element {
  useKitStyles();
  const client = useClient();
  const canEdit = useCanEdit(props.characterId, props.requires);
  const stored = useTraitPath(props.characterId, props.trait, props.path);
  const value = createMemo<number>(() => {
    const v = stored();
    return typeof v === "number" ? v : 0;
  });

  const setTo = (n: number) => {
    if (!canEdit()) return;
    const cur = value();
    const next = cur === n ? n - 1 : n;
    if (next === cur) return;
    client.dispatch(buildWriteCommand(props, Math.max(0, next), cur));
  };

  const boxes = createMemo(() => {
    const out: number[] = [];
    for (let i = 1; i <= props.max; i++) out.push(i);
    return out;
  });

  return (
    <span
      class={`vk-track ${canEdit() ? "" : "vk-track--readonly"}`}
      role="group"
      aria-label={`${value()} of ${props.max}`}
    >
      <For each={boxes()}>
        {(n) => (
          <span
            class={`vk-trackbox ${n <= value() ? "vk-trackbox--filled" : ""}`}
            onClick={() => setTo(n)}
          />
        )}
      </For>
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Rollables — labels, wrappers, buttons
 * ----------------------------------------------------------------------- */

interface RollableTriggerProps {
  characterId: string;
  /** Either pass a registered rollable directly, or a name. */
  rollable: AnyRollableDef | string;
  /** Per-call options forwarded to the rollable's compute fn. */
  opts?: Record<string, unknown>;
  /** Augment opts with shift→advantage / alt→popover. Default: true. */
  modifierKeys?: boolean;
  /** Show a hover tooltip with the previewed notation. Default: true. */
  preview?: boolean;
  /** Optional override label for ARIA / hover hint. */
  ariaLabel?: string;
  /** Visible label / content. Required by `<Rollable>` and
   * `<RollableLabel>`; `<RollButton>` may use `label` instead. */
  children?: JSX.Element;
  /** CSS class on the outer span (in addition to vk-rollable). */
  class?: string;
}

function resolveRollable(
  client: ReturnType<typeof useClient>,
  ref: AnyRollableDef | string,
): AnyRollableDef | null {
  if (typeof ref !== "string") return ref;
  return client.registry.rollables.get(ref) ?? null;
}

function buildOpts(
  base: Record<string, unknown> | undefined,
  ev: MouseEvent | KeyboardEvent,
  enable: boolean,
): Record<string, unknown> {
  const out = { ...(base ?? {}) };
  if (enable && (ev as MouseEvent).shiftKey) out.advantage = true;
  if (enable && (ev as MouseEvent).altKey) out.disadvantage = true;
  return out;
}

/**
 * Wraps any element to make it a rollable trigger. Click → invoke
 * the rollable + dispatch its command. Shift-click → advantage.
 * Alt-click → disadvantage. Hover → preview tooltip via title attr.
 *
 * The rollable arg can be a registered RollableDef directly, or a
 * plugin-namespaced name string the substrate resolves at click time.
 */
export function Rollable(props: RollableTriggerProps): JSX.Element {
  useKitStyles();
  const client = useClient();

  const fire = (ev: MouseEvent | KeyboardEvent) => {
    const rollable = resolveRollable(client, props.rollable);
    if (!rollable) return;
    const opts = buildOpts(props.opts, ev, props.modifierKeys !== false);
    // Interactive rollables open a PendingRoll panel instead of
    // dispatching the roll directly. Other players can then add
    // contributions (Help, modifiers) before the initiator commits.
    if (rollable.interactive) {
      client.dispatch(
        OpenPendingRoll({
          initiatorCharacterId: props.characterId,
          rollableName: rollable.name,
          opts,
        }) as CommandInstance,
      );
      return;
    }
    const result = invokeRollable(rollable, client.world, props.characterId, opts);
    if (!result) return;
    client.dispatch(result.command);
  };

  // previewRollable reads the world directly; subscribe to each input
  // trait so the tooltip re-derives when the underlying values change.
  const setupRollable = resolveRollable(client, props.rollable);
  const inputAccessors = setupRollable
    ? setupRollable.inputs.map((t) => useTrait(props.characterId, t))
    : [];

  const tooltip = createMemo<string | undefined>(() => {
    for (const a of inputAccessors) a();
    if (props.preview === false) return props.ariaLabel;
    const rollable = resolveRollable(client, props.rollable);
    if (!rollable) return props.ariaLabel;
    try {
      const spec = previewRollable(
        rollable,
        client.world,
        props.characterId,
        props.opts,
      ) as { notation?: string; label?: string } | null;
      if (!spec) return props.ariaLabel;
      const label = spec.label ?? props.ariaLabel ?? rollable.name;
      return spec.notation ? `${label} — ${spec.notation}` : label;
    } catch {
      return props.ariaLabel;
    }
  });

  return (
    <span
      class={`vk-rollable ${props.class ?? ""}`}
      role="button"
      tabIndex={0}
      title={tooltip()}
      aria-label={props.ariaLabel}
      onClick={fire}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fire(e);
        }
      }}
    >
      {props.children}
    </span>
  );
}

/**
 * Convenience wrapper for the most common case: a label text that's
 * also a roll trigger. Displays the children as the label text and
 * makes the whole label clickable.
 */
export function RollableLabel(props: RollableTriggerProps): JSX.Element {
  return <Rollable {...props}>{props.children}</Rollable>;
}

/**
 * Standalone roll button — for actions not attached to a labeled
 * value (Initiative, "Roll a custom d100"). Uses the same rollable
 * dispatch pipeline; just rendered as a chunky button instead of
 * an inline label.
 */
export function RollButton(props: RollableTriggerProps & {
  label?: string;
}): JSX.Element {
  useKitStyles();
  const client = useClient();
  const fire = (ev: MouseEvent | KeyboardEvent) => {
    const rollable = resolveRollable(client, props.rollable);
    if (!rollable) return;
    const opts = buildOpts(props.opts, ev, props.modifierKeys !== false);
    if (rollable.interactive) {
      client.dispatch(
        OpenPendingRoll({
          initiatorCharacterId: props.characterId,
          rollableName: rollable.name,
          opts,
        }) as CommandInstance,
      );
      return;
    }
    const result = invokeRollable(rollable, client.world, props.characterId, opts);
    if (!result) return;
    client.dispatch(result.command);
  };
  return (
    <button
      type="button"
      class="vk-rollbutton"
      onClick={fire}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fire(e);
        }
      }}
    >
      {props.label ?? props.children}
    </button>
  );
}

/* -------------------------------------------------------------------------
 * Re-exports — convenient single-import surface for systems
 * ----------------------------------------------------------------------- */

export { useTraitPath } from "@vtt/substrate/client";

// Type re-exports so kit consumers don't need separate substrate imports.
export type { CommandInstance, EventInstance, TraitMeta, TraitName };
