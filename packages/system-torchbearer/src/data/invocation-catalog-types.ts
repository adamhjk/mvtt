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

import type {
  InvocationCircle,
  InvocationRitualKind,
  InvocationTradition,
} from "../shared/invocations/invocation-traits.js";

/**
 * Hand-curated invocation catalog template. Mirrors `TbSpellTemplate`
 * but for the Ritualist-driven invocation subsystem (DH p.98 ff., DH
 * p.209-231 for the theurge list, LMM p.41-58 for the shaman list).
 *
 * The page reference points at the rulebook for the full effect /
 * factor prose; "data needed to play" lives inline so the sheet can
 * resolve the perform roll, the relic effect on time/burden, and the
 * sacramental +1D contribution without flipping to the PDF.
 */
export interface TbInvocationTemplate {
  /** Stable plugin-namespaced id, e.g. "tb/invocation/blessing-of-the-lord-of-labor". */
  readonly id: string;
  readonly name: string;
  readonly circle: InvocationCircle;
  /**
   * Class lists the invocation belongs to. RAW reads strictly: theurge
   * invocations and shaman invocations are separate lists ("do not merge
   * this list"); a few invocations appear on both with subtly different
   * rules text. We carry the union — the Invocations tab filters by the
   * character's class.
   */
  readonly traditions: ReadonlyArray<InvocationTradition>;
  readonly sourceBook: "DH" | "LMM";
  readonly sourcePage: number;
  readonly performing: {
    readonly ritualKind: InvocationRitualKind;
    /** Fixed Ob (when ritualKind === "fixed"). */
    readonly fixedOb: number | null;
    /** For versus tests — what stat the target rolls against. */
    readonly versusAgainst: string | null;
    /**
     * Turns required to perform without and with the relic. Per RAW
     * (DH p.99), an invocation listed as 0 turns does not advance the
     * grind.
     */
    readonly invocationTime: {
      readonly noRelic: number;
      readonly withRelic: number;
    };
    readonly duration: string;
    /**
     * Immortal burden gained when performing without and with the
     * relic (DH p.100).
     */
    readonly immortalBurden: {
      readonly noRelic: number;
      readonly withRelic: number;
    };
    /** Free-text description of the relic. */
    readonly relicName: string;
    /**
     * Inventory-slot annotation as printed in the rulebook
     * (e.g. "[pack 1]", "[worn/neck]", "[carried 1]"). Plain string —
     * we don't enforce the slot grammar at the catalog layer.
     */
    readonly relicSlot: string;
    /**
     * Free-text description of the sacramental component, when the
     * invocation has one (DH p.100). Empty string means no
     * sacramental.
     */
    readonly sacramental: string;
  };
}
