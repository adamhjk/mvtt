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

import { qualifiedName } from "@vtt/substrate";
import { useTrait } from "@vtt/substrate/client";
import { kit } from "@vtt/characters/client";
import type { CharacterSheetRegion } from "@vtt/characters/shared";
import { createMemo, onMount, type JSX } from "solid-js";
import { CharacterTraits, CONDITION_ORDER, Conditions, Pools } from "../shared/index.js";

const TB_POOLS_STYLE_ID = "tb-pools-styles";
const TB_POOLS_CSS = `
.tb-pools { container-type: inline-size; container-name: tb-pools; }
.tb-pools__grid {
  display: grid;
  grid-template-columns:
    minmax(4rem, auto) minmax(3rem, auto) minmax(3rem, auto)
    1.4rem
    auto auto;
  row-gap: 0.4rem;
  column-gap: 0.7rem;
  align-items: center;
}
.tb-pools__head {
  font-family: var(--font-display);
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-fg-muted);
  justify-self: center;
}
.tb-pools__head-current { grid-column: 2; grid-row: 1; }
.tb-pools__head-spent   { grid-column: 3; grid-row: 1; }
.tb-pools__fate-label    { grid-column: 1; grid-row: 2; }
.tb-pools__persona-label { grid-column: 1; grid-row: 3; }
.tb-pools__num { justify-self: center; }
.tb-pools__num-fate-cur     { grid-column: 2; grid-row: 2; }
.tb-pools__num-fate-spent   { grid-column: 3; grid-row: 2; }
.tb-pools__num-persona-cur     { grid-column: 2; grid-row: 3; }
.tb-pools__num-persona-spent   { grid-column: 3; grid-row: 3; }
.tb-pools__checks-label { grid-column: 5; grid-row: 2; }
.tb-pools__checks-input { grid-column: 6; grid-row: 2; }
.tb-pools__checks-readout {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.5rem;
  padding: 0.35rem 0.4rem;
  border: 1px solid var(--color-border-muted);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-fg);
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-size: 1.05rem;
}

/* Narrow rail (≤26rem container): collapse to a single vertical
   list — Fate / Persona stay in the cur/spent table, Checks drops
   to its own labeled row underneath. */
@container tb-pools (max-width: 26rem) {
  .tb-pools__grid {
    grid-template-columns: minmax(4rem, auto) minmax(3rem, auto) minmax(3rem, auto);
  }
  .tb-pools__checks-label { grid-column: 1; grid-row: 4; }
  .tb-pools__checks-input { grid-column: 2; grid-row: 4; justify-self: start; }
}
`;

function injectPoolsStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(TB_POOLS_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = TB_POOLS_STYLE_ID;
  el.textContent = TB_POOLS_CSS;
  document.head.appendChild(el);
}

/**
 * The Torchbearer "health bar": eight named checkboxes in canonical
 * severity order (Fresh → Hungry & Thirsty → Angry → Afraid → Exhausted
 * → Injured → Sick → Dead). Renders via the kit's reusable
 * `LabeledLadder` primitive — the chip styling, layout, and binding
 * are all kit-level concerns; TB just supplies the items.
 *
 * Each chip is independently togglable; the order is mechanically
 * meaningful (players take lighter conditions before heavier ones).
 * Mutual-exclusion of Fresh-vs-rest will land with a SetCondition
 * command + system in the next pass.
 */
function ConditionsLadder(props: { characterId: string }): JSX.Element {
  return (
    <kit.SheetSection title="Conditions">
      <kit.LabeledLadder
        characterId={props.characterId}
        trait={Conditions}
        ariaLabel="Condition ladder, in severity order"
        items={CONDITION_ORDER.map((c) => ({
          id: c.id,
          label: c.label,
          hint: c.recovery ? `${c.effect} — recover with ${c.recovery}` : c.effect,
          tone: c.id === "dead" ? "danger" : "default",
        }))}
      />
    </kit.SheetSection>
  );
}

/**
 * Fate / Persona / Checks pool block. A single grid lays out the
 * fate / persona pair (label + current + spent number boxes under
 * "current" / "spent" headers) on the left, with the Checks counter
 * sitting in the same vertical row as Fate on the right. A container
 * query collapses the whole block to a vertical list when the rail
 * is too narrow (≤26rem) so Checks drops below Persona on its own
 * labeled row.
 */
function PoolsRow(props: { characterId: string }): JSX.Element {
  onMount(injectPoolsStyles);
  return (
    <kit.SheetSection title="Pools">
      <div class="tb-pools">
        <div class="tb-pools__grid">
          <span class="tb-pools__head tb-pools__head-current">current</span>
          <span class="tb-pools__head tb-pools__head-spent">spent</span>

          <span class="vk-row__label tb-pools__fate-label">Fate</span>
          <div class="tb-pools__num tb-pools__num-fate-cur">
            <kit.NumberField
              characterId={props.characterId}
              trait={Pools}
              path={["fate", "current"]}
              min={0}
              max={99}
            />
          </div>
          <div class="tb-pools__num tb-pools__num-fate-spent">
            <kit.NumberField
              characterId={props.characterId}
              trait={Pools}
              path={["fate", "totalSpent"]}
              min={0}
              max={999}
            />
          </div>

          <span class="vk-row__label tb-pools__persona-label">Persona</span>
          <div class="tb-pools__num tb-pools__num-persona-cur">
            <kit.NumberField
              characterId={props.characterId}
              trait={Pools}
              path={["persona", "current"]}
              min={0}
              max={99}
            />
          </div>
          <div class="tb-pools__num tb-pools__num-persona-spent">
            <kit.NumberField
              characterId={props.characterId}
              trait={Pools}
              path={["persona", "totalSpent"]}
              min={0}
              max={999}
            />
          </div>

          <span class="vk-row__label tb-pools__checks-label">Checks</span>
          <div class="tb-pools__checks-input">
            <ChecksTotal characterId={props.characterId} />
          </div>
        </div>
      </div>
    </kit.SheetSection>
  );
}

/**
 * Read-only running total of checks earned across the character's
 * traits. The value is derived from `CharacterTraits.entries[*].checks`
 * — checks are earned per-trait when the player uses a trait against
 * themselves and clicks "Log" on the chat card; the Pools display
 * reflects the sum so the player has one place to see "how much I have
 * to spend at camp" without it being editable directly.
 */
function ChecksTotal(props: { characterId: string }): JSX.Element {
  const traits = useTrait(props.characterId, CharacterTraits);
  const total = createMemo<number>(() => {
    const entries = traits()?.entries ?? [];
    let sum = 0;
    for (const e of entries) {
      sum += typeof e.checks === "number" ? e.checks : 0;
    }
    return sum;
  });
  return (
    <span
      class="tb-pools__checks-readout"
      data-testid="tb-pools-checks-total"
      title="Sum of checks earned across all traits — earned by using a trait against yourself (DH p.80)"
    >
      {total()}
    </span>
  );
}

function VitalsRail(props: { characterId: string }): JSX.Element {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "0.9rem" }}>
      <ConditionsLadder characterId={props.characterId} />
      <PoolsRow characterId={props.characterId} />
    </div>
  );
}

export const TbVitalsFill: CharacterSheetRegion = {
  id: qualifiedName("@vtt/system-torchbearer/vitals-conditions") as CharacterSheetRegion["id"],
  render: ({ characterId }) => VitalsRail({ characterId }),
};
