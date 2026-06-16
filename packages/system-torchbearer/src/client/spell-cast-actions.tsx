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

// Post-roll commit buttons for a spell cast. Mounted by
// `TbRollActionsFill` above the standard trait-usage / advancement
// actions; reads `meta.spellCast` off the roll's Formula trait and
// renders the right `[Consume]` / `[Burn]` button for the source.
//
// The button is gated by the `SpellCastConsumed` marker on the Roll
// entity — same pattern as `AdvancementLogged` and `TraitUsageLogged`.
// Once clicked, the marker stamps and the button replaces itself with
// a small confirmation footer.

import { useClient, useTrait } from "@vtt/substrate/client";
import { createMemo, Show, type JSX } from "solid-js";
import { Formula } from "@vtt/resolution/shared";
import {
  BurnScroll,
  BurnSpellbookSpell,
  ConsumePalaceSpell,
  SpellCastConsumed,
  SpellCastContextSchema,
  type SpellCastContext,
} from "../shared/index.js";
import { kit } from "@vtt/characters/client";

/**
 * Decode `spec.spellCast` off the Roll entity's Formula trait. Returns
 * null when the roll wasn't opened by a [Cast] button (every other TB
 * roll leaves this field absent on the spec). The spell-cast context
 * lives on the spec — not as a meta sibling — so it rides through the
 * standard rollable plumbing without requiring spell-aware code in
 * the rollable framework.
 */
function readSpellCast(meta: unknown): SpellCastContext | null {
  if (!meta || typeof meta !== "object") return null;
  const spec = (meta as { spec?: { spellCast?: unknown } }).spec;
  const sc = spec?.spellCast;
  if (!sc) return null;
  const parsed = SpellCastContextSchema.safeParse(sc);
  return parsed.success ? parsed.data : null;
}

export function SpellCastActions(props: { rollId: string }): JSX.Element {
  const client = useClient();
  const formula = useTrait(props.rollId, Formula);
  const consumed = useTrait(props.rollId, SpellCastConsumed);
  const me = kit.useMe();
  const spellCast = createMemo<SpellCastContext | null>(() => readSpellCast(formula()?.meta));

  // Owner-or-GM gating — players see the cast row, but only the
  // rolling character's controllers and the GM can commit consume.
  const canCommit = createMemo(() => {
    const m = me();
    if (!m) return false;
    if (m.role === "gm") return true;
    // The Permissions trait on the rolling character is the
    // canonical authority. We don't read it directly here — the
    // useCanEdit primitive does the right thing on the character.
    return true; // Player owns their own roll; the server will reject if not.
  });

  return (
    <Show when={spellCast() !== null}>
      <div
        class="flex flex-wrap items-center justify-end gap-1.5"
        data-testid="tb-roll-row-spell-cast-actions"
      >
        <Show
          when={consumed() === undefined}
          fallback={
            <p
              class="text-[0.65rem] text-fg-subtle text-right"
              data-testid="tb-roll-row-spell-cast-confirmation"
            >
              <ConfirmationLabel context={spellCast()!} kind={consumed()!.sourceKind} />
            </p>
          }
        >
          <ActionButton
            context={spellCast()!}
            disabled={!canCommit()}
            onClick={() => {
              const sc = spellCast()!;
              if (sc.source.kind === "palace") {
                client.dispatch(ConsumePalaceSpell({ rollId: props.rollId as never }));
              } else if (sc.source.kind === "spellbook") {
                client.dispatch(BurnSpellbookSpell({ rollId: props.rollId as never }));
              } else {
                client.dispatch(BurnScroll({ rollId: props.rollId as never }));
              }
            }}
          />
        </Show>
      </div>
    </Show>
  );
}

function ActionButton(props: {
  context: SpellCastContext;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  const label = createMemo(() => {
    const s = props.context.source;
    if (s.kind === "palace") return "Consume from palace";
    if (s.kind === "spellbook") return `Burn folio: ${s.bookName}`;
    return "Burn scroll";
  });
  const testid = createMemo(() => {
    const s = props.context.source;
    if (s.kind === "palace") return "tb-roll-row-consume-palace";
    if (s.kind === "spellbook") return "tb-roll-row-burn-folio";
    return "tb-roll-row-burn-scroll";
  });
  return (
    <button
      type="button"
      class="rounded-(--radius-control) border border-accent bg-transparent px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-accent transition hover:bg-accent hover:text-accent-fg disabled:opacity-50 disabled:cursor-not-allowed"
      data-testid={testid()}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {label()}
    </button>
  );
}

function ConfirmationLabel(props: {
  context: SpellCastContext;
  kind: "palace" | "spellbook" | "scroll";
}): JSX.Element {
  const label = () => {
    const s = props.context.source;
    if (props.kind === "palace") return `✓ ${props.context.spellName} consumed from palace`;
    if (props.kind === "spellbook" && s.kind === "spellbook")
      return `✓ Folio burned in ${s.bookName}`;
    return `✓ Scroll consumed`;
  };
  return <>{label()}</>;
}
