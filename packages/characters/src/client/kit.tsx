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
  type AnyRollableDef,
  type CommandInstance,
  type EventInstance,
  type TraitMeta,
  type TraitName,
} from "@vtt/substrate";
import { useClient, useTrait, useTraitPath } from "@vtt/substrate/client";
import { canWrite, Permissions } from "@vtt/permissions/shared";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
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
   * "owner" — only users in `Permissions.write` (or a GM) may edit. Default.
   * "gm"    — only a GM may edit.
   * "any"   — any authenticated user may edit.
   */
  readonly requires?: "owner" | "gm" | "any";
}

/**
 * Returns a Solid accessor of "may the current user edit this field?"
 * "owner" mode delegates to `canWrite(me, Permissions)` — the universal
 * write check (GMs always pass, otherwise the user must satisfy the
 * Permissions.write Visibility on the character entity). Reactive on
 * the Permissions trait so flipping write access re-enables every
 * bound input live.
 */
export function useCanEdit(
  characterId: string,
  requires: "owner" | "gm" | "any" = "owner",
): () => boolean {
  const me = useMe();
  const permissions = useTrait(characterId, Permissions);
  const character = useTrait(characterId, Character);
  return createMemo(() => {
    if (!character()) return false;
    const m = me();
    if (!m) return false;
    if (m.role === "gm") return true;
    if (requires === "gm") return false;
    if (requires === "any") return true;
    return canWrite(m, permissions() as Parameters<typeof canWrite>[1]);
  });
}

/**
 * Build the command instance to dispatch when an input commits. Uses
 * the binding's override `command` + `payloadFromValue` if both are
 * provided; otherwise falls back to the universal SetField.
 */
function buildWriteCommand(binding: FieldBinding, value: unknown, prev: unknown): CommandInstance {
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
.vk-row { display: flex; flex-direction: row; align-items: center; gap: 0.6rem; min-width: 0; }
.vk-row__label {
  flex: 0 0 auto;
  min-width: 5.5rem;
  font-family: var(--font-display);
  font-size: 0.85rem;
  letter-spacing: 0.04em;
  color: var(--color-fg);
}
.vk-stack { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
.vk-stack__label {
  font-family: var(--font-display);
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  color: var(--color-fg-muted);
}
.vk-section { display: flex; flex-direction: column; gap: 0.7rem; }
.vk-section__title {
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-fg);
  margin: 0;
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
  .vk-group--cols-2, .vk-group--cols-3 { grid-template-columns: 1fr; }
  .vk-group--cols-6, .vk-group--cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .vk-group--cols-12 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

/* Inputs share base look; tweak per-kind on top. The elevated surface
   tone (rather than the page's base surface) gives each input a
   visible "box" against the rail/tab body even before the user
   focuses it — the border alone wasn't enough contrast in dark mode. */
.vk-input {
  width: 100%;
  min-width: 0;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: var(--color-surface-elevated);
  color: var(--color-fg);
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
}
.vk-input:hover:not(:disabled):not(:focus) {
  border-color: var(--color-fg-muted);
}
.vk-input:focus { border-color: var(--color-accent); box-shadow: 0 0 0 1px var(--color-accent); }
.vk-input:disabled { opacity: 0.6; cursor: not-allowed; }
.vk-input--number {
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-display);
  font-size: 1.05rem;
  padding: 0.35rem 0.4rem;
  width: auto;
  min-width: 2.5rem;
  max-width: 4.5rem;
  flex: 0 0 auto;
}
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
/* Placeholder text rendered in place of a dots track (e.g. "all"). */
.vk-dots__placeholder {
  font-family: var(--font-display);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-fg-muted);
}

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

.vk-summary { display: inline-flex; flex-direction: column; gap: 0.15rem; min-width: 3.5rem; }
.vk-summary__label {
  font-family: var(--font-display);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  color: var(--color-fg-muted);
}
.vk-summary__value {
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-size: 1.15rem;
  color: var(--color-fg);
}

/* Tabs — generic tabbed container reusable across plugins. */
.vk-tabs {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.vk-tabs__bar {
  flex: 0 0 auto;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: thin;
  border-bottom: 1px solid var(--color-border-muted);
  background: var(--color-surface-elevated);
}
.vk-tabs__button {
  flex: 0 0 auto;
  padding: 0.6rem 1.1rem;
  font-family: var(--font-display);
  font-size: 0.9rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--color-fg-muted);
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}
.vk-tabs__button:hover { color: var(--color-fg); background: var(--color-surface); }
.vk-tabs__button[aria-selected="true"] {
  color: var(--color-fg);
  font-weight: 600;
  border-bottom-color: var(--color-accent);
}
.vk-tabs__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
}

/* Pass/Fail advancement bubbles — vertically-stacked dot tracks. */
.vk-advance {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  flex: 0 0 auto;
}
.vk-advance__stack {
  display: inline-flex;
  flex-direction: column;
  gap: 0.15rem;
}
.vk-advance__row {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 1rem;
}
.vk-advance__legend {
  font-family: var(--font-display);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-fg-muted);
  width: 0.7rem;
  text-align: center;
}
.vk-advance__empty {
  font-size: 0.75rem;
  color: var(--color-fg-subtle);
  font-style: italic;
}
/* Improve arrow — only shown when both tracks are full and the caller
   provided an onImprove handler. Uses the accent color so it reads as
   a call to action; ↑ glyph reinforces "level up". */
.vk-advance__improve {
  appearance: none;
  border: 1px solid var(--color-accent);
  background: transparent;
  color: var(--color-accent);
  border-radius: var(--radius-control);
  width: 1.6rem;
  height: 1.6rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 0.95rem;
  line-height: 1;
  transition: background 120ms ease, color 120ms ease;
}
.vk-advance__improve:hover {
  background: var(--color-accent);
  color: var(--color-accent-fg);
}
.vk-advance__improve:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* Labeled boolean ladder — N named checkboxes laid out in a row. */
.vk-ladder {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.vk-ladder__item {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  border: 1px solid var(--color-border-muted);
  background: var(--color-surface-elevated);
  font-size: 0.85rem;
  color: var(--color-fg);
  cursor: pointer;
  user-select: none;
}
.vk-ladder__item[data-tone="danger"] {
  border-color: rgba(239, 68, 68, 0.4);
}
.vk-ladder__item[data-tone="danger"]:has(.vk-check:checked) {
  background: rgba(239, 68, 68, 0.15);
  color: rgb(239, 68, 68);
}

/* Entry list — a row of pill-shaped tags bound to a string[] trait
   path, with an inline input for adding new entries. Shares the
   pill aesthetic with vk-ladder__item. */
.vk-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  flex: 1 1 auto;
  min-width: 0;
}
.vk-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.18rem 0.5rem 0.18rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--color-border-muted);
  background: var(--color-surface-elevated);
  font-family: var(--font-display);
  font-size: 0.8rem;
  letter-spacing: 0.02em;
  color: var(--color-fg);
  transition: border-color 120ms ease, background 120ms ease;
}
.vk-tag[data-readonly="true"] { padding-right: 0.7rem; }
.vk-tags[data-edit="true"] .vk-tag:hover {
  border-color: var(--color-fg-muted);
}
.vk-tag__text { white-space: nowrap; }
.vk-tag__remove {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--color-fg-muted);
  font-size: 1rem;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.55;
  transition: opacity 120ms ease, color 120ms ease, background 120ms ease;
}
.vk-tag:hover .vk-tag__remove,
.vk-tag__remove:focus-visible {
  opacity: 1;
}
.vk-tag__remove:hover {
  color: var(--color-accent);
  background: rgba(127, 127, 127, 0.12);
}
.vk-tag__remove:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
.vk-tags__input {
  flex: 1 1 8rem;
  min-width: 6rem;
  border: 0;
  background: transparent;
  color: var(--color-fg);
  font-family: var(--font-display);
  font-size: 0.85rem;
  letter-spacing: 0.02em;
  padding: 0.18rem 0.4rem;
  outline: none;
}
.vk-tags__input::placeholder {
  color: var(--color-fg-subtle);
  font-style: italic;
}
.vk-tags__empty {
  color: var(--color-fg-subtle);
  font-style: italic;
  font-size: 0.85rem;
}

/* EntryRowsField — a structured-row table bound to an array of objects.
   Header + N body rows + add-row footer. Each row is its own grid so
   :hover works at the row level; columns line up across rows because
   every row uses the same grid-template-columns. */
.vk-rows {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
  border: 1px solid var(--color-border-muted);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  overflow: hidden;
}
.vk-rows__header {
  display: grid;
  align-items: end;
  gap: 0 0.6rem;
  padding: 0.45rem 0.7rem 0.35rem;
  border-bottom: 1px solid var(--color-border-muted);
  background: var(--color-surface-elevated);
}
.vk-rows__head {
  font-family: var(--font-display);
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-fg-muted);
}
.vk-rows__head[data-align="right"] { text-align: right; }
.vk-rows__head[data-align="center"] { text-align: center; }
.vk-rows__row {
  display: grid;
  align-items: center;
  gap: 0 0.6rem;
  padding: 0.3rem 0.7rem;
  border-bottom: 1px solid var(--color-border-muted);
  transition: background 120ms ease;
}
.vk-rows__row:last-of-type { border-bottom: 0; }
.vk-rows__row:hover { background: var(--color-surface-elevated); }
.vk-rows__cell { min-width: 0; }
.vk-rows__cell[data-align="right"] { text-align: right; }
.vk-rows__cell[data-align="center"] { text-align: center; }
/* Cells flatten the kit input border so the row reads as a unit;
   focus still surfaces with the standard outline. */
.vk-rows__cell .vk-input {
  border-color: transparent;
  background: transparent;
  padding: 0.25rem 0.4rem;
  font-size: 0.85rem;
}
.vk-rows__cell .vk-input:hover:not(:disabled):not(:focus) {
  border-color: var(--color-border-muted);
}
.vk-rows__cell .vk-input:focus {
  background: var(--color-surface);
  border-color: var(--color-accent);
}
.vk-rows__remove {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--color-fg-muted);
  font-size: 1rem;
  line-height: 1;
  padding: 0;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 999px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  justify-self: end;
  transition: opacity 120ms ease, color 120ms ease, background 120ms ease;
}
.vk-rows__row:hover .vk-rows__remove,
.vk-rows__remove:focus-visible {
  opacity: 0.7;
}
.vk-rows__remove:hover {
  opacity: 1;
  color: var(--color-accent);
  background: rgba(127, 127, 127, 0.12);
}
.vk-rows__remove:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}
.vk-rows__addrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.7rem;
  border-top: 1px solid var(--color-border-muted);
  background: var(--color-surface-elevated);
}
.vk-rows__addrow::before {
  content: "+";
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 999px;
  border: 1px dashed var(--color-accent);
  color: var(--color-accent);
  font-family: var(--font-display);
  font-size: 0.85rem;
  line-height: 1;
  flex: 0 0 auto;
}
.vk-rows__add-input {
  flex: 1 1 auto;
  border: 0;
  background: transparent;
  color: var(--color-fg);
  font-family: var(--font-display);
  font-size: 0.85rem;
  letter-spacing: 0.02em;
  padding: 0.18rem 0;
  outline: none;
}
.vk-rows__add-input::placeholder {
  color: var(--color-fg-subtle);
  font-style: italic;
}
.vk-rows__empty {
  padding: 0.7rem 0.8rem;
  font-size: 0.85rem;
  color: var(--color-fg-subtle);
  font-style: italic;
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

export function SheetSection(props: { title?: string; children: JSX.Element }): JSX.Element {
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
    const colClass = layout === "grid" && props.cols ? `vk-group--cols-${props.cols}` : "";
    const layoutClass = layout === "grid" ? "" : `vk-group--${layout}`;
    return `vk-group ${layoutClass} ${colClass}`.trim();
  });
  return <div class={cls()}>{props.children}</div>;
}

export function FieldRow(props: { label?: string; children: JSX.Element }): JSX.Element {
  useKitStyles();
  return (
    <div class="vk-row">
      <Show when={props.label}>
        <span class="vk-row__label">{props.label}</span>
      </Show>
      <div
        style={{ display: "flex", flex: 1, "min-width": 0, gap: "0.5rem", "align-items": "center" }}
      >
        {props.children}
      </div>
    </div>
  );
}

export function FieldStack(props: { label?: string; children: JSX.Element }): JSX.Element {
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

export function SummaryStat(props: { label: string; value: JSX.Element }): JSX.Element {
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
    <span class={`vk-value ${isPlaceholder() ? "vk-value--placeholder" : ""}`}>{display()}</span>
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
export function TextField(
  props: FieldBinding & {
    placeholder?: string;
    maxLength?: number;
  },
): JSX.Element {
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
  // Browsers (notably Firefox/WebKit) don't reliably fire `blur` when a
  // focused element is removed from the DOM — e.g., switching sub-tabs
  // while still editing. Treat unmount as a commit trigger so the typed
  // value isn't silently dropped.
  onCleanup(() => {
    if (editing()) commit();
  });

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

export function TextAreaField(
  props: FieldBinding & {
    placeholder?: string;
    rows?: number;
  },
): JSX.Element {
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
  onCleanup(() => {
    if (editing()) commit();
  });

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

export function NumberField(
  props: FieldBinding & {
    min?: number;
    max?: number;
    step?: number;
  },
): JSX.Element {
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
  onCleanup(() => {
    if (editing()) commit();
  });

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

export function SelectField(
  props: FieldBinding & {
    options: ReadonlyArray<{ value: string; label: string }>;
  },
): JSX.Element {
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
      <For each={props.options}>{(o) => <option value={o.value}>{o.label}</option>}</For>
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
export function DotsField(
  props: FieldBinding & {
    max: number;
  },
): JSX.Element {
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
          <span class={`vk-dot ${n <= value() ? "vk-dot--filled" : ""}`} onClick={() => setTo(n)} />
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
export function TrackField(
  props: FieldBinding & {
    max: number;
  },
): JSX.Element {
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
  const out = { ...base };
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
      const spec = previewRollable(rollable, client.world, props.characterId, props.opts) as {
        notation?: string;
        label?: string;
      } | null;
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
export function RollButton(
  props: RollableTriggerProps & {
    label?: string;
  },
): JSX.Element {
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
 * Tabs — reusable tabbed container
 * ----------------------------------------------------------------------- */

/**
 * One tab the `<Tabs>` primitive renders. The render fn returns the
 * body shown when this tab is active. Higher `priority` sorts toward
 * the leftmost tab; ties broken alphabetically by label so the order
 * is stable when plugins fill a tabs slot.
 */
export interface TabSpec {
  readonly id: string;
  readonly label: string;
  readonly priority?: number;
  readonly render: () => JSX.Element;
}

/**
 * Generic tabbed container. The active tab id defaults to local state
 * (resets on remount), but callers can pass `activeId` + `onSelectTab`
 * to drive selection from outside — `SheetShell` uses this to persist
 * the selection through `createOptimisticTrait` on the per-tab sentinel
 * so navigating away and back keeps the user's place.
 *
 * The body uses `<Show keyed>` so the rendered children re-mount when
 * the active tab changes. Without `keyed`, Solid only mounts the inner
 * children once at first-truthy and never re-runs the render fn —
 * clicking a tab updates `active()` but the body stays on tab 1.
 *
 * Reusable from any plugin: tab IDs are opaque strings, render fns
 * are unconstrained.
 */
export function Tabs(props: {
  tabs: ReadonlyArray<TabSpec>;
  ariaLabel?: string;
  /** Shown when the tabs list is empty. Defaults to nothing. */
  emptyState?: JSX.Element;
  /**
   * Controlled-mode active tab id. When set together with `onSelectTab`,
   * the primitive defers selection to the caller and never reads from
   * its internal signal. Either both are set or both are omitted.
   */
  activeId?: string | null;
  onSelectTab?: (id: string) => void;
}): JSX.Element {
  useKitStyles();

  const sorted = createMemo<TabSpec[]>(() => {
    const list = [...props.tabs];
    list.sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return a.label.localeCompare(b.label);
    });
    return list;
  });

  const [localId, setLocalId] = createSignal<string | null>(null);
  const isControlled = () => props.onSelectTab !== undefined;
  const wantedId = () => (isControlled() ? (props.activeId ?? null) : localId());
  let barEl: HTMLDivElement | undefined;
  // When the bar is rendered as `position: sticky` (the SheetShell column
  // mode pins it under the identity header), the user is often scrolled
  // deep into the previous tab when they pick a new one — without a
  // scroll, the new tab's content appears mid-page at whatever the prior
  // scroll offset was. Reset to the bar's sticky-pinned position so the
  // new tab is read from the top. `scroll-margin-top` on the bar (set by
  // SheetShell) accounts for the identity bar's height. When the bar is
  // `static` (kit's default for non-shell consumers, plus the desktop
  // override inside the shell), this is a no-op.
  const select = (id: string) => {
    if (isControlled()) props.onSelectTab?.(id);
    else setLocalId(id);
    if (!barEl || typeof window === "undefined") return;
    if (window.getComputedStyle(barEl).position !== "sticky") return;
    barEl.scrollIntoView({ block: "start" });
  };
  const active = createMemo<TabSpec | null>(() => {
    const list = sorted();
    if (list.length === 0) return null;
    const wanted = wantedId();
    const found = wanted ? list.find((t) => t.id === wanted) : null;
    return found ?? list[0]!;
  });

  return (
    <div class="vk-tabs">
      <Show when={sorted().length > 0} fallback={props.emptyState ?? null}>
        <div ref={barEl} class="vk-tabs__bar" role="tablist" aria-label={props.ariaLabel}>
          <For each={sorted()}>
            {(tab) => (
              <button
                type="button"
                class="vk-tabs__button"
                role="tab"
                aria-selected={active()?.id === tab.id}
                onClick={() => select(tab.id)}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>
        <div class="vk-tabs__body" role="tabpanel">
          <Show when={active()} keyed>
            {(tab) => tab.render()}
          </Show>
        </div>
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * AdvancementTrack — stacked Pass / Fail bubbles, derived from rating
 * ----------------------------------------------------------------------- */

/**
 * How many passed and failed tests are needed to advance an ability or
 * skill from `rating` to `rating + 1`.
 *
 * Torchbearer Dungeoneer's Handbook p.108:
 *   "An ability or skill advances when you pass a number of tests
 *    equal to its current rating and fail a number of tests equal to
 *    one less than its rating."
 *
 * Special case (p.108 "Advancing Rating 1"): rating 1 only requires
 * one passed test; no failed test needed. Same shape works for the
 * "advance from 0 to 1" case for Resources / Circles (DH p.108).
 *
 * Pure helper — Burning Wheel and other BWHQ games share the formula.
 */
export function computeAdvancement(rating: number): {
  passNeeded: number;
  failNeeded: number;
} {
  if (rating <= 1) return { passNeeded: 1, failNeeded: 0 };
  return { passNeeded: rating, failNeeded: rating - 1 };
}

/**
 * Two stacked dot tracks (Pass over Fail) showing progress toward the
 * next advancement. The number of bubbles in each row is derived from
 * `rating` via `computeAdvancement` — bumping the rating live updates
 * the track length.
 *
 * Each row is a `DotsField` bound to its own path on `trait`; clicking
 * a bubble sets the count to that level (DotsField's standard
 * "click filled = clear one" behavior). When the formula yields zero
 * failed tests (rating ≤ 1), the F row shows an em-dash placeholder so
 * the layout stays balanced with neighboring rows that do have an F
 * track.
 */
export function AdvancementTrack(props: {
  characterId: string;
  trait: TraitMeta;
  passPath: ReadonlyArray<string | number>;
  failPath: ReadonlyArray<string | number>;
  /** Current rating — used to derive how many bubbles to show. */
  rating: number;
  requires?: "owner" | "gm" | "any";
  /**
   * Optional callback fired when the user clicks the "improve" arrow.
   * The arrow is only rendered when both tracks are full **and** an
   * `onImprove` is provided — kept opt-in so non-improvable rows
   * (placeholder advancement, GM npcs, etc.) don't get a stray button.
   * The kit doesn't pick a command; the caller dispatches whatever
   * command its game system uses for advancement.
   */
  onImprove?: () => void;
  /** Tooltip / aria-label for the improve arrow. */
  improveLabel?: string;
}): JSX.Element {
  useKitStyles();
  const need = createMemo(() => computeAdvancement(props.rating));
  const passValue = useTraitPath(props.characterId, props.trait, props.passPath);
  const failValue = useTraitPath(props.characterId, props.trait, props.failPath);
  const canEdit = useCanEdit(props.characterId, props.requires);
  const isFull = createMemo<boolean>(() => {
    const p = passValue();
    const f = failValue();
    const need0 = need();
    const passOk = typeof p === "number" ? p >= need0.passNeeded : need0.passNeeded === 0;
    const failOk = typeof f === "number" ? f >= need0.failNeeded : need0.failNeeded === 0;
    return passOk && failOk;
  });
  return (
    <div class="vk-advance" aria-label="advancement track">
      <div class="vk-advance__stack">
        <div class="vk-advance__row">
          <span class="vk-advance__legend" aria-hidden="true">
            P
          </span>
          <DotsField
            characterId={props.characterId}
            trait={props.trait}
            path={props.passPath}
            max={need().passNeeded}
            requires={props.requires}
          />
        </div>
        <Show
          when={need().failNeeded > 0}
          fallback={
            <div class="vk-advance__row">
              <span class="vk-advance__legend" aria-hidden="true">
                F
              </span>
              <span class="vk-advance__empty">—</span>
            </div>
          }
        >
          <div class="vk-advance__row">
            <span class="vk-advance__legend" aria-hidden="true">
              F
            </span>
            <DotsField
              characterId={props.characterId}
              trait={props.trait}
              path={props.failPath}
              max={need().failNeeded}
              requires={props.requires}
            />
          </div>
        </Show>
      </div>
      <Show when={props.onImprove && isFull() && canEdit()}>
        <button
          type="button"
          class="vk-advance__improve"
          title={props.improveLabel ?? "Improve"}
          aria-label={props.improveLabel ?? "Improve"}
          onClick={() => props.onImprove?.()}
        >
          ↑
        </button>
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * LabeledLadder — N named checkboxes in a row, bound to a record trait
 * ----------------------------------------------------------------------- */

export interface LadderItem {
  /** Stable key — used as the trait path segment by default. */
  readonly id: string;
  readonly label: string;
  /** Optional tooltip shown on hover. */
  readonly hint?: string;
  /** Visual tone — danger reddens the chip when checked. */
  readonly tone?: "default" | "danger";
}

/**
 * A row of N labeled checkboxes bound to a record-shaped trait. Each
 * item toggles an independent boolean field at `pathFor(item)` (default
 * `[item.id]`). For mutually-exclusive ladders (e.g. WoD humanity), a
 * future variant or a system-side validator can enforce the exclusion;
 * this primitive trusts the items are independent booleans.
 *
 * Common uses: Torchbearer conditions (Fresh / H&T / Angry / …),
 * BitD harm tracks, Mausritter conditions, Mothership stress markers.
 */
export function LabeledLadder(props: {
  characterId: string;
  trait: TraitMeta;
  items: ReadonlyArray<LadderItem>;
  pathFor?: (item: LadderItem) => ReadonlyArray<string | number>;
  requires?: "owner" | "gm" | "any";
  ariaLabel?: string;
}): JSX.Element {
  useKitStyles();
  return (
    <div class="vk-ladder" role="group" aria-label={props.ariaLabel}>
      <For each={props.items}>
        {(item) => (
          <label class="vk-ladder__item" data-tone={item.tone ?? "default"} title={item.hint}>
            <CheckField
              characterId={props.characterId}
              trait={props.trait}
              path={props.pathFor?.(item) ?? [item.id]}
              requires={props.requires}
            />
            <span>{item.label}</span>
          </label>
        )}
      </For>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * EntryListField — pill / tag editor bound to a string[] trait path
 * ----------------------------------------------------------------------- */

/**
 * Pill-shaped tag editor bound to a `string[]` value at the given
 * `path` on the trait. Each existing entry renders as a removable
 * pill; an inline input adds new entries.
 *
 * Editing affordances:
 * - **Enter** or **,** commits the current input value as a new entry.
 * - **Backspace** on an empty input removes the last existing entry.
 * - **Blur** with non-empty input commits.
 * - Empty / whitespace-only inputs are ignored.
 * - Duplicates (case-sensitive, post-trim) are rejected silently
 *   unless `allowDuplicates` is `true`.
 *
 * Permission gating: when `useCanEdit` returns false the input is
 * hidden and remove buttons are not rendered. With no entries and no
 * edit permission, an em-dash placeholder shows.
 *
 * The component dispatches `SetField` with the new array by default;
 * set `command` + `payloadFromValue` on the binding to use a custom
 * command (e.g. an AddTag/RemoveTag pair that emits richer events).
 * The override callback receives the **new** array as `value` and
 * the **previous** array as `prev`.
 */
export function EntryListField(
  props: FieldBinding & {
    /** Placeholder shown when there are existing entries. Default: "+ add". */
    placeholder?: string;
    /** Placeholder shown when there are no entries yet. Default: "add…". */
    emptyPlaceholder?: string;
    /** Max length per entry (chars). Default: 40. */
    maxEntryLength?: number;
    /** Allow duplicate entries (case-sensitive, post-trim). Default: false. */
    allowDuplicates?: boolean;
  },
): JSX.Element {
  useKitStyles();
  const stored = useTraitPath(props.characterId, props.trait, props.path);
  const canEdit = useCanEdit(props.characterId, props.requires);
  const client = useClient();
  const [draft, setDraft] = createSignal("");

  const maxLen = () => props.maxEntryLength ?? 40;
  const allowDup = () => props.allowDuplicates ?? false;

  const entries = createMemo<readonly string[]>(() => {
    const v = stored();
    if (!Array.isArray(v)) return [];
    return v.filter((s): s is string => typeof s === "string");
  });

  const writeNext = (next: readonly string[]): void => {
    const prev = entries();
    client.dispatch(buildWriteCommand(props, next, prev));
  };

  const addEntry = (raw: string): void => {
    const trimmed = raw.trim();
    setDraft("");
    if (!trimmed) return;
    if (trimmed.length > maxLen()) return;
    const cur = entries();
    if (!allowDup() && cur.includes(trimmed)) return;
    writeNext([...cur, trimmed]);
  };

  const removeAt = (i: number): void => {
    const cur = entries();
    if (i < 0 || i >= cur.length) return;
    writeNext([...cur.slice(0, i), ...cur.slice(i + 1)]);
  };

  return (
    <div class="vk-tags" data-edit={canEdit() ? "true" : "false"} role="list">
      <For each={entries()}>
        {(d, i) => (
          <span class="vk-tag" data-readonly={canEdit() ? "false" : "true"} role="listitem">
            <span class="vk-tag__text">{d}</span>
            <Show when={canEdit()}>
              <button
                type="button"
                class="vk-tag__remove"
                aria-label={`remove ${d}`}
                onClick={() => removeAt(i())}
              >
                ×
              </button>
            </Show>
          </span>
        )}
      </For>
      <Show
        when={canEdit()}
        fallback={
          <Show when={entries().length === 0}>
            <span class="vk-tags__empty">—</span>
          </Show>
        }
      >
        <input
          type="text"
          class="vk-tags__input"
          placeholder={
            entries().length === 0
              ? (props.emptyPlaceholder ?? props.placeholder ?? "add…")
              : (props.placeholder ?? "+ add")
          }
          value={draft()}
          maxLength={maxLen()}
          autocomplete="off"
          spellcheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addEntry(draft());
            } else if (e.key === "Backspace" && draft() === "") {
              const cur = entries();
              if (cur.length > 0) {
                e.preventDefault();
                removeAt(cur.length - 1);
              }
            }
          }}
          onBlur={() => {
            if (draft().trim() !== "") addEntry(draft());
          }}
        />
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * EntryRowsField — structured-row editor bound to an array-of-objects
 * ----------------------------------------------------------------------- */

interface EntryColumnBase<TEntry> {
  /** Property name on each entry. Must exist on TEntry. */
  readonly key: keyof TEntry & string;
  /** Header label. */
  readonly label: string;
  /** CSS grid column size token. Default `"1fr"`. */
  readonly width?: string;
  /** Visual cell alignment. Default `"left"`. */
  readonly align?: "left" | "right" | "center";
}

export interface EntryColumnText<TEntry> extends EntryColumnBase<TEntry> {
  readonly type: "text";
  readonly placeholder?: string;
  readonly maxLength?: number;
  /**
   * Render the cell as a soft-wrapping textarea instead of a single
   * line input. Used for long-form fields (rule bodies, descriptions)
   * where line-clipping in a row is the wrong default.
   */
  readonly multiline?: boolean;
}

export interface EntryColumnNumber<TEntry> extends EntryColumnBase<TEntry> {
  readonly type: "number";
  readonly min?: number;
  readonly max?: number;
}

export interface EntryColumnCheck<TEntry> extends EntryColumnBase<TEntry> {
  readonly type: "check";
}

export interface EntryColumnDots<TEntry> extends EntryColumnBase<TEntry> {
  readonly type: "dots";
  /**
   * How many dot slots to render. Either a fixed count or a function
   * of the entry — useful when the cap depends on a sibling field
   * (e.g. dots scaled by a `level` property).
   */
  readonly max: number | ((entry: TEntry) => number);
  /**
   * Optional per-entry text override. When returned (non-null),
   * the cell renders that text in place of the dots track — useful
   * for states where the dot-count concept doesn't apply (e.g.
   * "all" / "—" / "n/a").
   */
  readonly placeholder?: (entry: TEntry) => string | null;
}

export type EntryColumn<TEntry> =
  | EntryColumnText<TEntry>
  | EntryColumnNumber<TEntry>
  | EntryColumnCheck<TEntry>
  | EntryColumnDots<TEntry>;

/**
 * Editable structured-row table bound to a `TEntry[]` value at the
 * given `path` on the trait. Columns are described declaratively;
 * each row's cells are rendered by the kit using the column descriptor's
 * `type` (`text` | `number` | `check`).
 *
 * Add row UX: a single "+ add…" input lives at the bottom. Pressing
 * Enter (or blurring with non-empty text) calls `seedEntry(primary)`
 * to build a new entry, appends it to the array, and dispatches.
 *
 * Edits commit on Enter or blur (matching kit.TextField / NumberField).
 * Each commit dispatches `SetField` with the **full new array** —
 * unchanged entries keep their object identity so Solid's `<For>` only
 * unmounts the changed row, preserving focus on neighbouring inputs.
 *
 * Removing a row dispatches `SetField` with that entry filtered out.
 *
 * Permission gating: when `useCanEdit` returns false, the × buttons,
 * the add-row footer, and the input controls become read-only (the
 * cells render kit fields whose own `canEdit` propagates from the
 * shared `requires` prop).
 */
export function EntryRowsField<TEntry extends Record<string, unknown>>(
  props: FieldBinding & {
    readonly columns: ReadonlyArray<EntryColumn<TEntry>>;
    /** Build a new entry from the primary text the user typed. */
    readonly seedEntry: (primary: string) => TEntry;
    /** Placeholder for the add-row input. Default `"add new…"`. */
    readonly addPlaceholder?: string;
    /** Empty-state hint when there are no entries. Default `"no entries yet"`. */
    readonly emptyHint?: string;
  },
): JSX.Element {
  useKitStyles();
  const stored = useTraitPath(props.characterId, props.trait, props.path);
  const canEdit = useCanEdit(props.characterId, props.requires);
  const client = useClient();
  const [draft, setDraft] = createSignal("");

  const entries = createMemo<readonly TEntry[]>(() => {
    const v = stored();
    return Array.isArray(v) ? (v as TEntry[]) : [];
  });

  const colTemplate = createMemo<string>(() => {
    const cols = props.columns.map((c) => c.width ?? "1fr").join(" ");
    return canEdit() ? `${cols} 1.4rem` : cols;
  });

  const writeNext = (next: readonly TEntry[]): void => {
    client.dispatch(buildWriteCommand(props, next, entries()));
  };

  const updateAt = (i: number, key: keyof TEntry & string, value: unknown): void => {
    const cur = entries();
    if (i < 0 || i >= cur.length) return;
    const entry = cur[i] as TEntry;
    if ((entry as Record<string, unknown>)[key] === value) return;
    const next = cur.map(
      (e, idx): TEntry => (idx === i ? ({ ...entry, [key]: value } as TEntry) : (e as TEntry)),
    );
    writeNext(next);
  };

  const removeAt = (i: number): void => {
    const cur = entries();
    if (i < 0 || i >= cur.length) return;
    writeNext(cur.filter((_, idx) => idx !== i));
  };

  const addRow = (primary: string): void => {
    const trimmed = primary.trim();
    setDraft("");
    if (!trimmed) return;
    writeNext([...entries(), props.seedEntry(trimmed)]);
  };

  return (
    <div class="vk-rows" role="table" aria-label="entry list">
      <div class="vk-rows__header" role="row" style={{ "grid-template-columns": colTemplate() }}>
        <For each={props.columns}>
          {(col) => (
            <span class="vk-rows__head" role="columnheader" data-align={col.align ?? "left"}>
              {col.label}
            </span>
          )}
        </For>
        <Show when={canEdit()}>
          <span class="vk-rows__head" aria-hidden="true" />
        </Show>
      </div>
      <Show
        when={entries().length > 0}
        fallback={<div class="vk-rows__empty">{props.emptyHint ?? "no entries yet"}</div>}
      >
        <For each={entries()}>
          {(entry, index) => (
            <div class="vk-rows__row" role="row" style={{ "grid-template-columns": colTemplate() }}>
              <For each={props.columns}>
                {(col) => (
                  <div class="vk-rows__cell" role="cell" data-align={col.align ?? "left"}>
                    <EntryCell
                      entry={entry}
                      column={col}
                      canEdit={canEdit()}
                      onCommit={(v) => updateAt(index(), col.key, v)}
                    />
                  </div>
                )}
              </For>
              <Show when={canEdit()}>
                <button
                  type="button"
                  class="vk-rows__remove"
                  aria-label={`remove row ${index() + 1}`}
                  onClick={() => removeAt(index())}
                >
                  ×
                </button>
              </Show>
            </div>
          )}
        </For>
      </Show>
      <Show when={canEdit()}>
        <div class="vk-rows__addrow">
          <input
            type="text"
            class="vk-rows__add-input"
            value={draft()}
            placeholder={props.addPlaceholder ?? "add new…"}
            autocomplete="off"
            spellcheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addRow(draft());
              }
            }}
            onBlur={() => {
              if (draft().trim() !== "") addRow(draft());
            }}
          />
        </div>
      </Show>
    </div>
  );
}

function EntryCell<TEntry extends Record<string, unknown>>(props: {
  entry: TEntry;
  column: EntryColumn<TEntry>;
  canEdit: boolean;
  onCommit: (value: unknown) => void;
}): JSX.Element {
  const value = createMemo(() => (props.entry as Record<string, unknown>)[props.column.key]);
  switch (props.column.type) {
    case "text": {
      const col = props.column;
      return (
        <CellText
          value={typeof value() === "string" ? (value() as string) : ""}
          placeholder={col.placeholder}
          maxLength={col.maxLength}
          multiline={col.multiline}
          canEdit={props.canEdit}
          onCommit={(v) => props.onCommit(v)}
        />
      );
    }
    case "number": {
      const col = props.column;
      return (
        <CellNumber
          value={typeof value() === "number" ? (value() as number) : 0}
          min={col.min}
          max={col.max}
          canEdit={props.canEdit}
          onCommit={(v) => props.onCommit(v)}
        />
      );
    }
    case "check":
      return (
        <CellCheck value={!!value()} canEdit={props.canEdit} onCommit={(v) => props.onCommit(v)} />
      );
    case "dots": {
      const col = props.column;
      const placeholder = createMemo<string | null>(() =>
        col.placeholder ? col.placeholder(props.entry) : null,
      );
      const max = createMemo<number>(() => {
        const m = typeof col.max === "function" ? col.max(props.entry) : col.max;
        return Math.max(0, Math.floor(m));
      });
      return (
        <Show
          when={placeholder() === null}
          fallback={<span class="vk-dots__placeholder">{placeholder()}</span>}
        >
          <CellDots
            value={typeof value() === "number" ? (value() as number) : 0}
            max={max()}
            canEdit={props.canEdit}
            onCommit={(v) => props.onCommit(v)}
          />
        </Show>
      );
    }
  }
}

function CellText(props: {
  value: string;
  canEdit: boolean;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  onCommit: (value: string) => void;
}): JSX.Element {
  const [local, setLocal] = createSignal<string>(props.value);
  const [editing, setEditing] = createSignal(false);
  createEffect(() => {
    if (!editing()) setLocal(props.value);
  });
  const commit = (): void => {
    const next = local();
    setEditing(false);
    if (next !== props.value) props.onCommit(next);
  };
  onCleanup(() => {
    if (editing()) commit();
  });
  return (
    <Show
      when={props.multiline}
      fallback={
        <input
          type="text"
          class="vk-input"
          value={local()}
          disabled={!props.canEdit}
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
              setLocal(props.value);
              setEditing(false);
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
      }
    >
      <AutoGrowTextarea
        value={local()}
        disabled={!props.canEdit}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        onFocus={() => setEditing(true)}
        onInput={(v) => setLocal(v)}
        onBlur={commit}
        onCancel={() => {
          setLocal(props.value);
          setEditing(false);
        }}
        onCommit={commit}
      />
    </Show>
  );
}

/**
 * Textarea that grows to fit its content — no scrollbars, no fixed
 * `rows` cap, no manual drag-resize. The visible height tracks the
 * scrollHeight on every input and whenever the bound value changes
 * from outside (so trait writes from another tab don't leave a stale
 * height behind).
 *
 * Used for the multiline variant of `EntryColumnText`. Keeping the
 * resizing logic in one component keeps the cell render path tiny
 * and lets future kit consumers reuse the behavior.
 */
function AutoGrowTextarea(props: {
  value: string;
  disabled: boolean;
  placeholder?: string;
  maxLength?: number;
  onFocus: () => void;
  onInput: (next: string) => void;
  onBlur: () => void;
  onCancel: () => void;
  onCommit: () => void;
}): JSX.Element {
  let el: HTMLTextAreaElement | undefined;

  const fit = (): void => {
    if (!el) return;
    // Setting `auto` first lets the next read pick up the natural
    // content size; without this the textarea only grows, never
    // shrinks back when the user deletes lines.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // External value change (initial mount + remote trait update) →
  // re-fit. The local-edit path already calls fit() in onInput.
  createEffect(() => {
    void props.value;
    queueMicrotask(fit);
  });

  return (
    <textarea
      ref={el}
      class="vk-input vk-input--textarea"
      value={props.value}
      disabled={props.disabled}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      rows={1}
      autocomplete="off"
      spellcheck={false}
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      style={{
        width: "100%",
        "min-width": 0,
        "white-space": "pre-wrap",
        "word-wrap": "break-word",
        "overflow-wrap": "break-word",
        // Hide both scrollbars — height tracks scrollHeight so the
        // content always fits without scrolling.
        overflow: "hidden",
        resize: "none",
      }}
      onFocus={props.onFocus}
      onInput={(e) => {
        props.onInput(e.currentTarget.value);
        fit();
      }}
      onBlur={props.onBlur}
      onKeyDown={(e) => {
        // Ctrl/Cmd+Enter commits; plain Enter inserts a newline.
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          props.onCommit();
          (e.currentTarget as HTMLTextAreaElement).blur();
        }
        if (e.key === "Escape") {
          props.onCancel();
          (e.currentTarget as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

function CellNumber(props: {
  value: number;
  canEdit: boolean;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
}): JSX.Element {
  const [local, setLocal] = createSignal<string>(String(props.value));
  const [editing, setEditing] = createSignal(false);
  createEffect(() => {
    if (!editing()) setLocal(String(props.value));
  });
  const commit = (): void => {
    const draft = local();
    setEditing(false);
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setLocal(String(props.value));
      return;
    }
    let next = parsed;
    if (typeof props.min === "number" && next < props.min) next = props.min;
    if (typeof props.max === "number" && next > props.max) next = props.max;
    setLocal(String(next));
    if (next !== props.value) props.onCommit(next);
  };
  onCleanup(() => {
    if (editing()) commit();
  });
  return (
    <input
      type="number"
      class="vk-input vk-input--number"
      value={local()}
      disabled={!props.canEdit}
      min={props.min}
      max={props.max}
      onFocus={() => setEditing(true)}
      onInput={(e) => setLocal(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function CellCheck(props: {
  value: boolean;
  canEdit: boolean;
  onCommit: (value: boolean) => void;
}): JSX.Element {
  return (
    <input
      type="checkbox"
      class="vk-check"
      checked={props.value}
      disabled={!props.canEdit}
      onChange={(e) => props.onCommit(e.currentTarget.checked)}
    />
  );
}

function CellDots(props: {
  value: number;
  max: number;
  canEdit: boolean;
  onCommit: (value: number) => void;
}): JSX.Element {
  const dots = createMemo<number[]>(() => {
    const out: number[] = [];
    for (let i = 1; i <= props.max; i++) out.push(i);
    return out;
  });
  const setTo = (n: number): void => {
    if (!props.canEdit) return;
    const cur = props.value;
    // Click filled = clear one (matches kit.DotsField).
    const next = cur === n ? Math.max(0, n - 1) : Math.min(n, props.max);
    if (next === cur) return;
    props.onCommit(next);
  };
  return (
    <span
      class={`vk-dots ${props.canEdit ? "" : "vk-dots--readonly"}`}
      role="group"
      aria-label={`rating ${props.value} of ${props.max}`}
    >
      <For each={dots()}>
        {(n) => (
          <span
            role="button"
            aria-label={`set to ${n}`}
            class={`vk-dot ${n <= props.value ? "vk-dot--filled" : ""}`}
            onClick={() => setTo(n)}
          />
        )}
      </For>
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Re-exports — convenient single-import surface for systems
 * ----------------------------------------------------------------------- */

export { useTraitPath } from "@vtt/substrate/client";
export { useMe, type MeInfo } from "./use-me.js";

// Type re-exports so kit consumers don't need separate substrate imports.
export type { CommandInstance, EventInstance, TraitMeta, TraitName };
