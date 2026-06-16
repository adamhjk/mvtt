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

import { createSignal, For, Show, type JSX } from "solid-js";
import {
  ALL_ACTIONS,
  TB_ACTION_MATRIX,
  TB_ACTION_RULES,
  TB_MATCHUP_NOTES,
  type ConflictAction,
} from "../shared/index.js";
import { ACTION_COLORS, ACTION_LABELS } from "./styles.js";

interface MatrixCellHighlight {
  /** The action played by the party (row of the rules-as-written table). */
  readonly partyAction: ConflictAction;
  /** The action played by the enemy (column of the rules-as-written table). */
  readonly enemyAction: ConflictAction;
}

/**
 * Symbol the book prints for cell `[rowAction][colAction]` —
 * row-perspective per SG p.70. The matrix data IS the cell, no
 * derivation needed: the cells are not symmetric (Defend/Feint = —
 * but Feint/Defend = I).
 */
function rowSymbol(rowAction: ConflictAction, colAction: ConflictAction): "V" | "I" | "—" {
  switch (TB_ACTION_MATRIX[rowAction][colAction]) {
    case "versus":
      return "V";
    case "independent":
      return "I";
    case "noTest":
      return "—";
  }
}

const SYMBOL_LABEL: Record<"V" | "I" | "—", string> = {
  V: "Versus test",
  I: "Independent test",
  "—": "Do not roll",
};

/**
 * Action Interaction Table — typeset to match Scholar's Guide p.70.
 *
 * Row = your action, column = opponent's action. Cells carry one of
 * `V` / `I` / `—`. Hovering or focusing a row/column header dims the
 * other rows/columns to make scanning easier; the active matchup
 * pulses when the resolution panel hands us a `highlight`. Click a
 * row label to expand the action's full rule text.
 */
export function ActionMatrix(props: { highlight?: MatrixCellHighlight }): JSX.Element {
  const [hoveredRow, setHoveredRow] = createSignal<ConflictAction | null>(null);
  const [hoveredCol, setHoveredCol] = createSignal<ConflictAction | null>(null);
  const [expanded, setExpanded] = createSignal<ConflictAction | null>(null);

  const isRowDimmed = (a: ConflictAction): boolean => {
    const r = hoveredRow();
    if (r) return r !== a;
    return false;
  };
  const isColDimmed = (a: ConflictAction): boolean => {
    const c = hoveredCol();
    if (c) return c !== a;
    return false;
  };

  return (
    <section class="px-3 py-3 border-t border-border-muted" data-testid="action-matrix">
      <header class="flex items-baseline justify-between mb-2">
        <h2 class="font-display text-sm uppercase tracking-[0.18em]">Action Interaction Table</h2>
        <span class="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-fg-subtle">
          SG p.70
        </span>
      </header>
      <div class="overflow-x-auto">
        <table
          class="border-collapse text-center"
          style={{
            "font-family": "var(--font-mono, ui-monospace, monospace)",
            "font-feature-settings": "'tnum'",
          }}
        >
          <thead>
            <tr>
              <th class="pb-1.5 pr-3 w-24"></th>
              <For each={ALL_ACTIONS}>
                {(col) => (
                  <th
                    onMouseEnter={() => setHoveredCol(col)}
                    onMouseLeave={() => setHoveredCol(null)}
                    onFocus={() => setHoveredCol(col)}
                    onBlur={() => setHoveredCol(null)}
                    tabindex="0"
                    class="px-2 pb-1.5 font-display text-[0.78rem] tracking-wider transition cursor-default"
                    style={{
                      color: ACTION_COLORS[col],
                      opacity: isColDimmed(col) ? 0.35 : 1,
                    }}
                    data-testid={`matrix-col-header-${col}`}
                  >
                    {ACTION_LABELS[col]}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={ALL_ACTIONS}>
              {(row) => (
                <tr>
                  <th
                    onMouseEnter={() => setHoveredRow(row)}
                    onMouseLeave={() => setHoveredRow(null)}
                    onFocus={() => setHoveredRow(row)}
                    onBlur={() => setHoveredRow(null)}
                    onClick={() => setExpanded(expanded() === row ? null : row)}
                    tabindex="0"
                    class="text-right pr-3 py-1 font-display text-[0.78rem] tracking-wider transition cursor-pointer"
                    style={{
                      color: ACTION_COLORS[row],
                      opacity: isRowDimmed(row) ? 0.35 : 1,
                    }}
                    data-testid={`matrix-row-header-${row}`}
                    aria-expanded={expanded() === row}
                  >
                    {ACTION_LABELS[row]}
                  </th>
                  <For each={ALL_ACTIONS}>
                    {(col) => {
                      const sym = rowSymbol(row, col);
                      const isActive = (): boolean =>
                        props.highlight?.partyAction === row &&
                        props.highlight?.enemyAction === col;
                      const dim = (): boolean => isRowDimmed(row) || isColDimmed(col);
                      return (
                        <td
                          class="px-3 py-1.5 border border-border-muted/60 text-base font-semibold transition"
                          style={{
                            "background-color": isActive()
                              ? `${ACTION_COLORS[row]}1F`
                              : "transparent",
                            "box-shadow": isActive()
                              ? `inset 0 0 0 1px ${ACTION_COLORS[row]}`
                              : "none",
                            opacity: dim() ? 0.3 : 1,
                            color:
                              sym === "V"
                                ? ACTION_COLORS[row]
                                : sym === "I"
                                  ? "var(--color-fg, #1A1815)"
                                  : "var(--color-fg-subtle, #888)",
                          }}
                          title={TB_MATCHUP_NOTES[row][col] + ` — ${SYMBOL_LABEL[sym]}`}
                          data-testid={`matrix-cell-${row}-${col}`}
                          aria-label={`${ACTION_LABELS[row]} versus ${ACTION_LABELS[col]}: ${SYMBOL_LABEL[sym]}`}
                        >
                          {sym}
                        </td>
                      );
                    }}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-[0.7rem] text-fg-subtle italic">
        Find your action on the left and your opponent's action along the top row.
      </p>
      {/* Legend keyed to the V / I / — symbols in the matrix body.
          Inline-style grid template — Tailwind v4's bracketed
          arbitrary value with comma separators (`grid-cols-[1.4rem,auto]`)
          emits invalid CSS, so the column layout never lands and the
          symbols drift to wherever the line happens to break. The
          inline style is bulletproof. The chip column is fixed-width
          so the descriptions align flush across rows; the description
          column is `1fr` so it fills the section width without
          overflowing the matrix above. */}
      <dl
        class="mt-2 text-[0.72rem]"
        style={{
          display: "grid",
          "grid-template-columns": "1.25rem 1fr",
          "column-gap": "0.6rem",
          "row-gap": "0.2rem",
          "align-items": "baseline",
        }}
      >
        <dt class="font-mono font-semibold text-center" style={{ color: "var(--color-fg)" }}>
          I
        </dt>
        <dd class="text-fg-subtle">
          Independent test. Test both actions separately; both can succeed or fail.
        </dd>
        <dt class="font-mono font-semibold text-center" style={{ color: "var(--color-accent)" }}>
          V
        </dt>
        <dd class="text-fg-subtle">
          Versus test. Make a versus test between the indicated skills or abilities.
        </dd>
        <dt class="font-mono font-semibold text-center text-fg-subtle">—</dt>
        <dd class="text-fg-subtle">
          Do not roll for your action. Your opponent rolls, but you do not.
        </dd>
      </dl>
      <Show when={expanded()}>
        {(actAcc) => {
          const a = actAcc() as ConflictAction;
          return (
            <div
              class="mt-2 px-3 py-2 border-l-2 text-sm"
              style={{ "border-color": ACTION_COLORS[a] }}
              data-testid={`matrix-rule-text-${a}`}
            >
              <p class="font-display text-xs uppercase tracking-wider mb-1">
                {TB_ACTION_RULES[a].label}
              </p>
              <p>{TB_ACTION_RULES[a].description}</p>
            </div>
          );
        }}
      </Show>
    </section>
  );
}
