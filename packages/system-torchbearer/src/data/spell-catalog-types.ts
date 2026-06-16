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

import type { SpellCastingKind, SpellCircle, SpellSchool } from "../shared/spells/spell-traits.js";

/**
 * Hand-curated spell catalog template. The page reference points at
 * the rulebook for the full effect prose; "data needed to play" lives
 * inline so the sheet can resolve the cast roll without flipping to
 * the PDF.
 */
export interface TbSpellTemplate {
  /** Stable plugin-namespaced id, e.g. "tb/spell/wayfinders-friend". */
  readonly id: string;
  readonly name: string;
  readonly circle: SpellCircle;
  readonly school: SpellSchool;
  readonly sourceBook: "DH" | "LMM";
  readonly sourcePage: number;
  readonly casting: {
    readonly kind: SpellCastingKind;
    readonly fixedOb: number | null;
    readonly versusSkill: string | null;
    readonly castingTime: "free" | "action" | "one-turn" | "multi-turn";
    readonly duration: string;
    readonly materials: string;
    readonly focus: string;
  };
  readonly learning: {
    readonly scribeOb: number;
    readonly learnOb: number;
  };
}
