// MVTT, An RPG virtual tabletop
// Copyright (C) 2026, Adam Jacob
//
// This file is part of MVTT.
//
// MVTT is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation, with the Swamp
// Extension and Definition Exception (found in the "COPYING-EXCEPTION"
// file).
//
// MVTT is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with MVTT.  If not, see <https://www.gnu.org/licenses/>.

import { defineRollable, z } from "@vtt/substrate";
import { Character } from "@vtt/characters/shared";
import { type Contribution } from "@vtt/characters/shared";
import { RequestRoll } from "@vtt/resolution/shared";
import { Stats } from "./traits.js";

/**
 * Stat check rollable: rolls 1d6 + the named stat plus any
 * contributions accumulated in a PendingRoll panel.
 *
 * Interactive: the kit's `<RollableLabel>` will dispatch
 * `OpenPendingRoll` instead of dispatching the roll directly, so other
 * players can offer help / modifiers before the initiator commits.
 *
 * Contribution payload shapes recognised by this compute:
 *   - `{ kind: "modifier", payload: { value: number } }` — generic
 *     +/- modifier from any user (panel's built-in input).
 *   - `{ kind: "help", payload: { dice: number, stat: string } }` —
 *     another player's character offering their own stat as bonus
 *     dice. Filled by the system-simple-specific contributor.
 *
 * Anything else is logged in the spec for transparency but doesn't
 * change the dice total.
 */
export const StatCheck = defineRollable({
  name: "@vtt/system-simple/stat-check",
  inputs: [Stats, Character] as const,
  command: RequestRoll,
  interactive: true,
  opts: z.object({
    stat: z.enum(["might", "quickness", "mind", "charm"]),
    contributions: z.array(z.unknown()).optional(),
  }),
  compute: ([stats, character], { opts }) => {
    let total = stats[opts.stat];
    const breakdown: { source: string; value: number }[] = [
      { source: capitalize(opts.stat), value: stats[opts.stat] },
    ];
    const contribs = (opts.contributions ?? []) as Contribution[];
    for (const c of contribs) {
      if (c.kind === "modifier") {
        const v = (c.payload as { value?: number })?.value;
        if (typeof v === "number") {
          total += v;
          breakdown.push({ source: c.label, value: v });
        }
      } else if (c.kind === "help") {
        const dice = (c.payload as { dice?: number })?.dice;
        if (typeof dice === "number") {
          total += dice;
          breakdown.push({ source: c.label, value: dice });
        }
      }
    }
    // Rich label includes the full breakdown — the roll card and the
    // panel both display it. RequestRoll's `reason` is unbounded; the
    // frontend (RollRow + tooltip) handles visual truncation.
    const breakdownText = breakdown
      .map((b) => `${b.source} ${b.value >= 0 ? "+" : ""}${b.value}`)
      .join(", ");
    const label = `${character.name} — ${capitalize(opts.stat)} check [${breakdownText}]`;
    return {
      notation: `1d6${total >= 0 ? "+" : ""}${total}`,
      label,
      breakdown,
      stat: opts.stat,
      value: total,
    };
  },
  toPayload: (spec, { entityId }) => ({
    notation: spec.notation,
    reason: spec.label,
    visibility: "public" as const,
    speakingAsCharacterId: entityId,
  }),
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
