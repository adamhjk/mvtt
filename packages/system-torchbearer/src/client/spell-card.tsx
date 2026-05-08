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

// Shared row card for a single spell — used identically in the
// library, spell-book contents, scrolls, and memory-palace lists.
// Reads its data live from the catalog spell entity so renames and
// circle changes propagate everywhere without snapshots.

import { useTrait } from "@vtt/substrate/client";
import { BookCitation } from "@vtt/books/client";
import { createMemo, Show, type JSX } from "solid-js";
import {
  SpellIdentity,
  TbSpellCasting,
  TbSpellLearning,
} from "../shared/spells/spell-traits.js";
import { tbCanonicalBookAbbreviation } from "../data/seed.js";
import { CircleDots } from "./spell-picker.js";

/**
 * Resolve a `pageRef` into the short label `<BookCitation>` shows
 * ("DH p.97"). Mirrors the helper the monster sheet uses; falls back
 * to the canonicalId when it's a foreign book.
 */
function pageLabel(canonicalId: string, page: number): string {
  const abbrev = tbCanonicalBookAbbreviation(canonicalId);
  return abbrev ? `${abbrev} p.${page}` : `p.${page}`;
}

export interface SpellCardActions {
  /** Optional inline children rendered as an action row underneath the identity strip. */
  readonly actions?: () => JSX.Element;
}

/**
 * Read-only spell row. Renders identity (name + circle dots + school)
 * and a `<BookCitation>` chip; the parent wires action buttons via
 * `actions()` so the same shell drives library / book / scroll /
 * palace contexts without duplicating layout.
 */
export function SpellCard(props: {
  spellId: string;
  /** Optional small status pill rendered to the right of the school. */
  status?: () => JSX.Element | null;
  actions?: () => JSX.Element;
  /** Optional override for the row background. */
  highlight?: boolean;
  testid?: string;
}): JSX.Element {
  const identity = useTrait(props.spellId, SpellIdentity);
  const casting = useTrait(props.spellId, TbSpellCasting);
  const name = createMemo(() => identity()?.name ?? "Unknown spell");
  const circle = createMemo(() => identity()?.circle ?? 1);
  const school = createMemo(() => identity()?.school ?? "Other");
  const pageRef = createMemo(() => identity()?.pageRef ?? null);

  return (
    <div
      data-testid={props.testid ?? `spell-card-${props.spellId}`}
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.3rem",
        padding: "0.4rem 0.55rem",
        "border-radius": "var(--radius-control)",
        background: props.highlight
          ? "var(--color-accent-soft)"
          : "var(--color-surface-elevated)",
        border: props.highlight
          ? "1px solid var(--color-accent)"
          : "1px solid var(--color-border-muted)",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "0.5rem",
          "font-size": "0.8rem",
        }}
      >
        <span style={{ "font-weight": "500" }}>{name()}</span>
        <CircleDots circle={circle()} />
        <span style={{ color: "var(--color-fg-muted)" }}>{school()}</span>
        <Show when={props.status?.()}>{props.status?.()}</Show>
        <span style={{ "margin-left": "auto", display: "inline-flex", gap: "0.5rem" }}>
          <Show when={pageRef()}>
            {(ref) => (
              <BookCitation
                canonicalId={ref().canonicalId}
                page={ref().page}
                label={pageLabel(ref().canonicalId, ref().page)}
              />
            )}
          </Show>
        </span>
      </div>
      <Show when={casting()}>
        <div
          style={{
            "font-size": "0.7rem",
            color: "var(--color-fg-muted)",
            display: "flex",
            gap: "0.7rem",
            "flex-wrap": "wrap",
          }}
        >
          <CastingSummary spellId={props.spellId} />
          <LearningSummary spellId={props.spellId} />
        </div>
      </Show>
      <Show when={props.actions}>
        <div
          style={{
            display: "flex",
            gap: "0.4rem",
            "flex-wrap": "wrap",
            "padding-top": "0.15rem",
          }}
        >
          {props.actions?.()}
        </div>
      </Show>
    </div>
  );
}

/**
 * Compact at-a-glance summary of casting parameters: kind / Ob,
 * casting time, duration, materials/focus. The full prose lives in
 * the rulebook (deep-linked via the citation chip) — this strip is
 * "data needed to play."
 */
function CastingSummary(props: { spellId: string }): JSX.Element {
  const casting = useTrait(props.spellId, TbSpellCasting);
  return (
    <Show when={casting()}>
      {(c) => {
        const v = c();
        const obPart =
          v.kind === "fixed"
            ? v.fixedOb !== null
              ? `Ob ${v.fixedOb}`
              : "Ob varies"
            : v.kind === "factors"
              ? "Factors"
              : "Versus";
        return (
          <>
            <span>{obPart}</span>
            <span>· {castingTimeLabel(v.castingTime)}</span>
            <Show when={v.duration}>
              <span>· {v.duration}</span>
            </Show>
            <Show when={v.materials}>
              <span>· materials: {v.materials}</span>
            </Show>
            <Show when={v.focus}>
              <span>· focus: {v.focus}</span>
            </Show>
          </>
        );
      }}
    </Show>
  );
}

/**
 * Scribe / Learn obstacles strip — surfaces what a strict-RAW table
 * needs to know to call for a Scholar (scribe scroll, library →
 * spell book) or Lore Master (learn from foreign source) test. Plain
 * text; the spell's pageRef chip in the card header above is the
 * deep-link.
 */
function LearningSummary(props: { spellId: string }): JSX.Element {
  const learning = useTrait(props.spellId, TbSpellLearning);
  return (
    <Show when={learning()}>
      {(l) => {
        const v = l();
        return (
          <>
            <span>· scribe Ob {v.scribeOb}</span>
            <span>· learn Ob {v.learnOb}</span>
          </>
        );
      }}
    </Show>
  );
}

function castingTimeLabel(t: string): string {
  switch (t) {
    case "free":
      return "free";
    case "action":
      return "action";
    case "one-turn":
      return "1 turn";
    case "multi-turn":
      return "multi-turn";
    default:
      return t;
  }
}
