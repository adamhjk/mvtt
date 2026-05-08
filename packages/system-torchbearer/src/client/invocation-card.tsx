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

// Shared row card for a single invocation — the parallel of `SpellCard`
// for the Ritualist subsystem. Reads its data live from the catalog
// invocation entity so renames and rules edits propagate everywhere
// without snapshots.

import { useTrait } from "@vtt/substrate/client";
import { BookCitation } from "@vtt/books/client";
import { createMemo, Show, type JSX } from "solid-js";
import {
  InvocationIdentity,
  TbInvocationPerforming,
} from "../shared/invocations/invocation-traits.js";
import { tbCanonicalBookAbbreviation } from "../data/seed.js";
import { CircleDots } from "./spell-picker.js";

function pageLabel(canonicalId: string, page: number): string {
  const abbrev = tbCanonicalBookAbbreviation(canonicalId);
  return abbrev ? `${abbrev} p.${page}` : `p.${page}`;
}

export function InvocationCard(props: {
  invocationId: string;
  /** Whether this character holds the relic. Drives the time/burden display. */
  hasRelic?: () => boolean;
  /** Optional small status pill rendered to the right of the tradition tags. */
  status?: () => JSX.Element | null;
  actions?: () => JSX.Element;
  highlight?: boolean;
  testid?: string;
}): JSX.Element {
  const identity = useTrait(props.invocationId, InvocationIdentity);
  const performing = useTrait(props.invocationId, TbInvocationPerforming);
  const name = createMemo(() => identity()?.name ?? "Unknown invocation");
  const circle = createMemo(() => identity()?.circle ?? 1);
  const traditions = createMemo(() => identity()?.traditions ?? []);
  const pageRef = createMemo(() => identity()?.pageRef ?? null);

  return (
    <div
      data-testid={props.testid ?? `invocation-card-${props.invocationId}`}
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
        <Show when={traditions().length > 0}>
          <span
            style={{
              color: "var(--color-fg-muted)",
              "font-size": "0.7rem",
              "font-variant": "small-caps",
            }}
            title={traditions().join(", ")}
          >
            {traditions().join("/")}
          </span>
        </Show>
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
      <Show when={performing()}>
        <PerformingSummary
          invocationId={props.invocationId}
          hasRelic={props.hasRelic ?? (() => false)}
        />
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
 * "Data needed to play" strip: ritual kind / Ob, time, duration,
 * burden, relic, sacramental. Picks the with-relic vs no-relic values
 * from `TbInvocationPerforming` per the holder's relic state.
 */
function PerformingSummary(props: {
  invocationId: string;
  hasRelic: () => boolean;
}): JSX.Element {
  const performing = useTrait(props.invocationId, TbInvocationPerforming);
  return (
    <Show when={performing()}>
      {(p) => {
        const v = p();
        const obPart =
          v.ritualKind === "fixed"
            ? v.fixedOb !== null
              ? `Ob ${v.fixedOb}`
              : "Ob varies"
            : v.ritualKind === "factors"
              ? "Factors"
              : v.ritualKind === "versus"
                ? `Versus ${v.versusAgainst ?? ""}`.trim()
                : "Skill swap";
        const time = props.hasRelic()
          ? v.invocationTime.withRelic
          : v.invocationTime.noRelic;
        const burden = props.hasRelic()
          ? v.immortalBurden.withRelic
          : v.immortalBurden.noRelic;
        const timeLabel = time === 0 ? "0 turns" : time === 1 ? "1 turn" : `${time} turns`;
        return (
          <div
            style={{
              "font-size": "0.7rem",
              color: "var(--color-fg-muted)",
              display: "flex",
              gap: "0.7rem",
              "flex-wrap": "wrap",
            }}
          >
            <span>{obPart}</span>
            <span>· {timeLabel}</span>
            <Show when={v.duration}>
              <span>· {v.duration}</span>
            </Show>
            <span>· burden +{burden}</span>
            <Show when={v.relicName}>
              <span title={v.relicSlot}>
                · relic: {v.relicName}
                <Show when={v.relicSlot}> [{v.relicSlot}]</Show>
              </span>
            </Show>
            <Show when={v.sacramental}>
              <span>· sacramental: {v.sacramental} (+1D)</span>
            </Show>
          </div>
        );
      }}
    </Show>
  );
}
