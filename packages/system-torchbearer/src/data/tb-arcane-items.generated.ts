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

import type { TbItemTemplate } from "./catalog-types.js";

/**
 * Arcane-specific item templates: scrolls. Spell books live on the
 * existing canonical "Spell Book" entry in `tb-items.generated.ts`
 * (kind: spellbook); we don't ship a parallel "empty" template.
 *
 * Scrolls hold one spell each (DH p.95); the scroll's
 * `spellTemplateId` is resolved to a spell entity id at seed time
 * via SpellCatalogIndex.
 *
 * These items ride the same items catalog index as everything
 * else — the merge engine handles re-seed and override tracking
 * identically.
 */
export const TB_ARCANE_ITEM_TEMPLATES: ReadonlyArray<TbItemTemplate> = [
  /* ----- Scrolls (canonical, one per starter spell) ----------------- */
  {
    id: "tb/scroll/wayfinders-friend",
    name: "Scroll: Wayfinder's Friend",
    category: "arcane",
    sourceBook: "DH",
    sourcePage: 190,
    description: "A single-use scroll bearing Wayfinder's Friend.",
    img: "/icons/delapouite/scroll-quill.svg",
    cost: 2,
    slotOptions: { pack: 1, carried: 1 },
    skillBonuses: [],
    specialRules: "Single-use; consumed on cast (DH p.95).",
    kind: { type: "scroll", spellTemplateId: "tb/spell/wayfinders-friend" },
  },
  {
    id: "tb/scroll/wyrd-lights",
    name: "Scroll: Wyrd Lights",
    category: "arcane",
    sourceBook: "DH",
    sourcePage: 192,
    description: "A single-use scroll bearing Wyrd Lights.",
    img: "/icons/delapouite/scroll-quill.svg",
    cost: 2,
    slotOptions: { pack: 1, carried: 1 },
    skillBonuses: [],
    specialRules: "Single-use; consumed on cast (DH p.95).",
    kind: { type: "scroll", spellTemplateId: "tb/spell/wyrd-lights" },
  },
  {
    id: "tb/scroll/lightning-step",
    name: "Scroll: Lightning Step",
    category: "arcane",
    sourceBook: "DH",
    sourcePage: 205,
    description: "A single-use scroll bearing Lightning Step.",
    img: "/icons/delapouite/scroll-quill.svg",
    cost: 3,
    slotOptions: { pack: 1, carried: 1 },
    skillBonuses: [],
    specialRules: "Single-use; consumed on cast (DH p.95).",
    kind: { type: "scroll", spellTemplateId: "tb/spell/lightning-step" },
  },
  {
    id: "tb/scroll/blank",
    name: "Scroll (blank)",
    category: "arcane",
    sourceBook: "DH",
    sourcePage: 95,
    description: "A blank scroll, ready to receive a scribed spell.",
    img: "/icons/delapouite/scroll-unfurled.svg",
    cost: 1,
    slotOptions: { pack: 1, carried: 1 },
    skillBonuses: [],
    specialRules: "Writable medium. Scribe a spell to fill it (DH p.95).",
    kind: { type: "scroll", spellTemplateId: null },
  },
];
