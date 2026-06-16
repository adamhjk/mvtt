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

// Post-roll commit button for an invocation perform. Mirrors
// `SpellCastActions`: reads `meta.spec.invocationPerform` off the roll's
// Formula trait and renders an `[Apply burden]` button. Once clicked,
// the marker stamps and the button replaces itself with a confirmation
// footer. The button is gated on roll pass/fail visually only — the
// burden cost applies regardless (RAW DH p.100: "When performing an
// invocation, increase your burden by the amount listed for it").

import { useClient, useTrait } from "@vtt/substrate/client";
import { createMemo, Show, type JSX } from "solid-js";
import { Formula } from "@vtt/resolution/shared";
import {
  ApplyImmortalBurden,
  InvocationPerformConsumed,
  InvocationPerformContextSchema,
  type InvocationPerformContext,
} from "../shared/index.js";

function readInvocationPerform(meta: unknown): InvocationPerformContext | null {
  if (!meta || typeof meta !== "object") return null;
  const spec = (meta as { spec?: { invocationPerform?: unknown } }).spec;
  const ip = spec?.invocationPerform;
  if (!ip) return null;
  const parsed = InvocationPerformContextSchema.safeParse(ip);
  return parsed.success ? parsed.data : null;
}

export function InvocationPerformActions(props: { rollId: string }): JSX.Element {
  const client = useClient();
  const formula = useTrait(props.rollId, Formula);
  const consumed = useTrait(props.rollId, InvocationPerformConsumed);
  const perform = createMemo<InvocationPerformContext | null>(() =>
    readInvocationPerform(formula()?.meta),
  );

  return (
    <Show when={perform() !== null}>
      <div
        class="flex flex-wrap items-center justify-end gap-1.5"
        data-testid="tb-roll-row-invocation-perform-actions"
      >
        <Show
          when={consumed() === undefined}
          fallback={
            <p
              class="text-[0.65rem] text-fg-subtle text-right"
              data-testid="tb-roll-row-invocation-perform-confirmation"
            >
              ✓ {perform()!.invocationName}: +{consumed()!.burdenAdded} Immortal burden
            </p>
          }
        >
          <button
            type="button"
            class="rounded-(--radius-control) border border-accent bg-transparent px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-accent transition hover:bg-accent hover:text-accent-fg disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="tb-roll-row-apply-burden"
            onClick={() => client.dispatch(ApplyImmortalBurden({ rollId: props.rollId as never }))}
          >
            Apply +{perform()!.burdenAdded} Immortal burden
            <Show when={perform()!.withRelic}> (with relic)</Show>
          </button>
        </Show>
      </div>
    </Show>
  );
}
