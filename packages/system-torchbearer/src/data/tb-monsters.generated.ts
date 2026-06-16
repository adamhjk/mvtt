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

// Monster catalog. Lifted from the printed Torchbearer 2nd Edition
// books — Scholar's Guide denizen chapter (pp.178–200) and
// Loremaster's Manual bestiary (pp.246–262). Like
// `tb-items.generated.ts`, this file is the source of truth — edits
// made here are preserved across re-import via the
// TbMonsterDerivedFrom override-tracking trait. Re-run an importer
// only when upstream rule fixes need to flow through.
//
// Per the canonical-book deep-link substrate, the catalog never
// reproduces rulebook prose — no italic flavor blurb, no instinct
// text, no armor description, no special-rule body. Each template
// carries a `pageRef` (and per-special-rule pageRef) into one of the
// canonical TB2 books. The monster sheet renders `<BookCitation>`
// inline so the GM clicks through to their bound rulebook PDF.
//
// Conflict-type mapping for non-enum book labels:
//   "K"        ⇒ kill
//   "Cap"      ⇒ capture
//   "D/O"      ⇒ driveOff
//   "Trap/Kill"⇒ kill   (creeping ooze's special trap-and-kill)
//   "Banish"   ⇒ other  (LMM-only conflict type; no plugin enum yet)
//   "Negotiate"⇒ other  (LMM-only; Halja uses it as a third dispo)
//   "Flee/Pursue" ⇒ both flee and pursue (same disposition value)

import type { TbMonsterTemplate } from "./monster-catalog-types.js";

const SG = "tb/book/scholars-guide";
const LMM = "tb/book/loremasters-manual";

export const TB_MONSTER_TEMPLATES: ReadonlyArray<TbMonsterTemplate> = [
  // -----------------------------------------------------------------
  // Scholar's Guide bestiary (denizens chapter, pp.178–200)
  // -----------------------------------------------------------------
  {
    id: "tb/monster/barrow-wight",
    name: "Barrow Wight",
    sourceBook: "SG",
    sourcePage: 178,
    pageRef: { canonicalId: SG, page: 178 },
    img: "",
    nature: { rating: 6, descriptors: ["Slaying", "Draining Souls", "Hiding in Darkness"] },
    might: 5,
    precedence: 1,
    type: "undead",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "driveOff", value: 14 },
      { conflictType: "kill", value: 8 },
      { conflictType: "pursue", value: 5 },
    ],
    specialRules: [
      { name: "Unlife", pageRef: { canonicalId: SG, page: 178 } },
      { name: "Iron will", pageRef: { canonicalId: SG, page: 178 } },
      { name: "Now I am become Death", pageRef: { canonicalId: SG, page: 178 } },
    ],
    weapons: [
      {
        name: "Cursed Blade",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 2 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Terrifying Aura",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Stench of Death",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "success", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Grave Shoes",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Entrancing Gaze",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Shadow Step",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
    ],
  },
  {
    id: "tb/monster/black-dragon",
    name: "Black Dragon",
    sourceBook: "SG",
    sourcePage: 179,
    pageRef: { canonicalId: SG, page: 179 },
    img: "",
    nature: { rating: 9, descriptors: ["Devastating", "Lurking", "Hoarding"] },
    might: 6,
    precedence: 6,
    type: "dragon",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "capture", value: 20 },
      { conflictType: "kill", value: 11 },
      { conflictType: "driveOff", value: 7 },
    ],
    specialRules: [
      { name: "Corrosive blood", pageRef: { canonicalId: SG, page: 179 } },
      { name: "Serpentine strike", pageRef: { canonicalId: SG, page: 179 } },
    ],
    weapons: [
      {
        name: "Spitting Venom",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Lashing Tail",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Sinuous Form",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Dragon Terror",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Inhuman Strength",
        conflicts: ["capture"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Glossy Scales",
        conflicts: ["capture"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "success", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/bugbear",
    name: "Bugbear",
    sourceBook: "SG",
    sourcePage: 180,
    pageRef: { canonicalId: SG, page: 180 },
    img: "",
    nature: { rating: 6, descriptors: ["Stalking", "Terrorizing", "Cracking Bones"] },
    might: 4,
    precedence: 1,
    type: "troll",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "flee", value: 13 },
      { conflictType: "pursue", value: 13 },
      { conflictType: "kill", value: 7 },
      { conflictType: "driveOff", value: 4 },
    ],
    specialRules: [
      { name: "Silent", pageRef: { canonicalId: SG, page: 180 } },
      { name: "Matriarchal", pageRef: { canonicalId: SG, page: 180 } },
      { name: "Polearms", pageRef: { canonicalId: SG, page: 180 } },
    ],
    weapons: [
      {
        name: "Polearm",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Silent Tread",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/creeping-ooze",
    name: "Creeping Ooze",
    sourceBook: "SG",
    sourcePage: 181,
    pageRef: { canonicalId: SG, page: 181 },
    img: "",
    nature: { rating: 6, descriptors: ["Creeping", "Dissolving", "Smothering"] },
    might: 4,
    precedence: 0,
    type: "ooze",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 15 },
      { conflictType: "driveOff", value: 8 },
      { conflictType: "flee", value: 3 },
    ],
    specialRules: [
      { name: "Alien death stalker", pageRef: { canonicalId: SG, page: 181 } },
      { name: "Ooze", pageRef: { canonicalId: SG, page: 181 } },
      { name: "Mindless", pageRef: { canonicalId: SG, page: 181 } },
    ],
    weapons: [
      {
        name: "Pseudopods",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Oozing Mass",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 2 },
        },
      },
      {
        name: "Sticky Fluid",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Hydra",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 2 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Suffocating Grip",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "success", value: 2 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/dire-wolf",
    name: "Dire Wolf",
    sourceBook: "SG",
    sourcePage: 182,
    pageRef: { canonicalId: SG, page: 182 },
    img: "",
    nature: { rating: 5, descriptors: ["Hunting", "Stalking", "Playing"] },
    might: 3,
    precedence: 1,
    type: "beast",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "flee", value: 12 },
      { conflictType: "pursue", value: 12 },
      { conflictType: "capture", value: 7 },
      { conflictType: "kill", value: 5 },
    ],
    specialRules: [
      { name: "Pack hunter", pageRef: { canonicalId: SG, page: 182 } },
      { name: "Pack leader", pageRef: { canonicalId: SG, page: 182 } },
      { name: "High speech", pageRef: { canonicalId: SG, page: 182 } },
    ],
    weapons: [
      {
        name: "Rangy Legs",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 2 },
        },
      },
      {
        name: "Keen Smell",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Camouflaged Coat",
        conflicts: ["capture"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Keen Hearing",
        conflicts: ["capture"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Crushing Jaws",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Lunging Leap",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Low Cunning",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/disturbed-spirit",
    name: "Disturbed Spirit",
    sourceBook: "SG",
    sourcePage: 183,
    pageRef: { canonicalId: SG, page: 183 },
    img: "",
    nature: { rating: 6, descriptors: ["Possessing", "Punishing", "Seeking Knowledge"] },
    might: 5,
    precedence: 0,
    type: "spirit",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "convince", value: 12 },
      { conflictType: "other", value: 7 },
      { conflictType: "pursue", value: 7 },
    ],
    specialRules: [
      { name: "Possession", pageRef: { canonicalId: SG, page: 183 } },
      { name: "Discorporate", pageRef: { canonicalId: SG, page: 183 } },
      { name: "Iron will", pageRef: { canonicalId: SG, page: 183 } },
    ],
    weapons: [
      {
        name: "Cursed Blade",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 2 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Terrifying Aura",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Stench of Death",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Discorporate",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Entrancing Gaze",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Shadow Step",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Terrifying Visions",
        conflicts: ["other"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/dragefolk",
    name: "Dragefolk",
    sourceBook: "SG",
    sourcePage: 184,
    pageRef: { canonicalId: SG, page: 184 },
    img: "",
    nature: { rating: 4, descriptors: ["Swimming", "Hunting", "Feasting"] },
    might: 3,
    precedence: 1,
    type: "folk",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "capture", value: 11 },
      { conflictType: "kill", value: 7 },
      { conflictType: "driveOff", value: 5 },
    ],
    specialRules: [
      { name: "Dragehilmar", pageRef: { canonicalId: SG, page: 184 } },
      { name: "Lizard king", pageRef: { canonicalId: SG, page: 184 } },
    ],
    weapons: [
      {
        name: "Trident",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Battle Net",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Hurled Stone",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Thoughtful Demeanor",
        conflicts: ["convince"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/ghoul",
    name: "Ghoul",
    sourceBook: "SG",
    sourcePage: 185,
    pageRef: { canonicalId: SG, page: 185 },
    img: "",
    nature: { rating: 4, descriptors: ["Eating the Dead", "Hiding", "Hunting the Living"] },
    might: 3,
    precedence: 0,
    type: "undead",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "capture", value: 10 },
      { conflictType: "kill", value: 6 },
      { conflictType: "trick", value: 4 },
    ],
    specialRules: [
      { name: "Paralyzing touch", pageRef: { canonicalId: SG, page: 185 } },
      { name: "Will of the grave", pageRef: { canonicalId: SG, page: 185 } },
      { name: "Grave master", pageRef: { canonicalId: SG, page: 185 } },
    ],
    weapons: [
      {
        name: "Shambling Gait",
        conflicts: ["capture"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Undead Strength",
        conflicts: ["capture"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Filthy Claws",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Iron Sinews",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Low Cunning",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Memories of Life",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/gnoll",
    name: "Gnoll",
    sourceBook: "SG",
    sourcePage: 186,
    pageRef: { canonicalId: SG, page: 186 },
    img: "",
    nature: { rating: 5, descriptors: ["Ambushing", "Devouring", "Worshipping"] },
    might: 3,
    precedence: 1,
    type: "troll",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "capture", value: 12 },
      { conflictType: "flee", value: 6 },
      { conflictType: "pursue", value: 6 },
      { conflictType: "driveOff", value: 4 },
    ],
    specialRules: [
      { name: "Hyenas", pageRef: { canonicalId: SG, page: 186 } },
      { name: "Matriarchal", pageRef: { canonicalId: SG, page: 186 } },
    ],
    weapons: [
      {
        name: "Flail",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: -1 },
          feint: { type: "dice", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Battle Axe",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: -1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Bow",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 2 },
        },
      },
      {
        name: "Iron Grip",
        conflicts: ["capture"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Loping Stride",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 2 },
        },
      },
      {
        name: "Intimidating Bark",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/goblin",
    name: "Goblin",
    sourceBook: "SG",
    sourcePage: 187,
    pageRef: { canonicalId: SG, page: 187 },
    img: "",
    nature: { rating: 3, descriptors: ["Lying", "Stealing", "Fighting"] },
    might: 2,
    precedence: 0,
    type: "spirit",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 7 },
      { conflictType: "trick", value: 3 },
      { conflictType: "flee", value: 3 },
    ],
    specialRules: [
      { name: "Dark sight", pageRef: { canonicalId: SG, page: 187 } },
      { name: "Enemy of the sun", pageRef: { canonicalId: SG, page: 187 } },
      { name: "Pointy ends", pageRef: { canonicalId: SG, page: 187 } },
      { name: "Czar", pageRef: { canonicalId: SG, page: 187 } },
    ],
    weapons: [
      {
        name: "Short Sword",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 1 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Snaggle-Toothed Bite",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Cruel Sense of Humor",
        conflicts: ["convince"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Scrawny Little Legs",
        conflicts: ["flee"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "success", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/guardian-statue",
    name: "Guardian Statue",
    sourceBook: "SG",
    sourcePage: 188,
    pageRef: { canonicalId: SG, page: 188 },
    img: "",
    nature: { rating: 5, descriptors: ["Guarding", "Smashing", "Avenging"] },
    might: 4,
    precedence: 0,
    type: "automaton",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "driveOff", value: 12 },
      { conflictType: "kill", value: 7 },
      { conflictType: "pursue", value: 5 },
    ],
    specialRules: [
      { name: "Mindless", pageRef: { canonicalId: SG, page: 188 } },
      { name: "Stone mace", pageRef: { canonicalId: SG, page: 188 } },
      { name: "Bound", pageRef: { canonicalId: SG, page: 188 } },
    ],
    weapons: [
      {
        name: "Fearless Heart",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Nerveless Flesh",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "success", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Stone Mace",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Stone Arms",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Crushing Grip",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Heavy Tread",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
    ],
  },
  {
    id: "tb/monster/harpy",
    name: "Harpy",
    sourceBook: "SG",
    sourcePage: 189,
    pageRef: { canonicalId: SG, page: 189 },
    img: "",
    nature: { rating: 4, descriptors: ["Beguiling", "Flying", "Scavenging"] },
    might: 4,
    precedence: 0,
    type: "troll",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "flee", value: 10 },
      { conflictType: "pursue", value: 10 },
      { conflictType: "capture", value: 6 },
      { conflictType: "trick", value: 4 },
    ],
    specialRules: [
      { name: "Winged", pageRef: { canonicalId: SG, page: 189 } },
      { name: "Captive of love", pageRef: { canonicalId: SG, page: 189 } },
    ],
    weapons: [
      {
        name: "Filthy Wings",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Piercing Screech",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Choking Stench",
        conflicts: ["capture"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Savage Talons",
        conflicts: ["capture"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Enchanting Song",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Beguiling Promises",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
    ],
  },
  {
    id: "tb/monster/hobgoblin",
    name: "Hobgoblin",
    sourceBook: "SG",
    sourcePage: 190,
    pageRef: { canonicalId: SG, page: 190 },
    img: "",
    nature: { rating: 3, descriptors: ["Bullying", "Raiding", "Murdering"] },
    might: 3,
    precedence: 1,
    type: "troll",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 7 },
      { conflictType: "flee", value: 4 },
      { conflictType: "pursue", value: 4 },
      { conflictType: "driveOff", value: 3 },
    ],
    specialRules: [
      { name: "Slavers", pageRef: { canonicalId: SG, page: 190 } },
      { name: "Raid captain", pageRef: { canonicalId: SG, page: 190 } },
      { name: "Warlord", pageRef: { canonicalId: SG, page: 190 } },
    ],
    weapons: [
      {
        name: "Mace",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Spear",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Shield",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 2 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Crossbow",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Hunting Hounds",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/kobold",
    name: "Kobold",
    sourceBook: "SG",
    sourcePage: 191,
    pageRef: { canonicalId: SG, page: 191 },
    img: "",
    nature: { rating: 2, descriptors: ["Trapping", "Lurking", "Swarming"] },
    might: 1,
    precedence: 1,
    type: "troll",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "flee", value: 5 },
      { conflictType: "pursue", value: 5 },
      { conflictType: "capture", value: 3 },
      { conflictType: "trick", value: 1 },
    ],
    specialRules: [
      { name: "Swarms", pageRef: { canonicalId: SG, page: 191 } },
      { name: "Mine knockers", pageRef: { canonicalId: SG, page: 191 } },
      { name: "Bombs", pageRef: { canonicalId: SG, page: 191 } },
      { name: "Size matters", pageRef: { canonicalId: SG, page: 191 } },
    ],
    weapons: [
      {
        name: "Sling",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 2 },
        },
      },
      {
        name: "Bomb",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Spear",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Deadfalls",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Mantrap",
        conflicts: ["capture"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Sharp Bite",
        conflicts: ["capture"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/orc",
    name: "Orc",
    sourceBook: "SG",
    sourcePage: 192,
    pageRef: { canonicalId: SG, page: 192 },
    img: "",
    nature: { rating: 4, descriptors: ["Fighting", "Skulking", "Looting"] },
    might: 3,
    precedence: 1,
    type: "troll",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "capture", value: 9 },
      { conflictType: "kill", value: 5 },
      { conflictType: "flee", value: 4 },
      { conflictType: "pursue", value: 4 },
    ],
    specialRules: [
      { name: "Named", pageRef: { canonicalId: SG, page: 192 } },
      { name: "Like burning coals", pageRef: { canonicalId: SG, page: 192 } },
      { name: "Enemy of the sun", pageRef: { canonicalId: SG, page: 192 } },
    ],
    weapons: [
      {
        name: "Spear",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Shield",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 2 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Hand Axe",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Hobnailed Boots",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Tireless Endurance",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/red-dragon",
    name: "Red Dragon",
    sourceBook: "SG",
    sourcePage: 193,
    pageRef: { canonicalId: SG, page: 193 },
    img: "",
    nature: { rating: 12, descriptors: ["Devastating", "Outwitting", "Hoarding"] },
    might: 6,
    precedence: 6,
    type: "dragon",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 26 },
      { conflictType: "flee", value: 14 },
      { conflictType: "pursue", value: 14 },
      { conflictType: "trick", value: 8 },
    ],
    specialRules: [
      { name: "Sleep with one eye open", pageRef: { canonicalId: SG, page: 193 } },
      { name: "Fire breath", pageRef: { canonicalId: SG, page: 193 } },
    ],
    weapons: [
      {
        name: "Fiery Breath",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 2 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Serpentine Neck",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Swooping Wings",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Dragon Terror",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Long Memory",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Gold Greed",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/stone-spider",
    name: "Stone Spider",
    sourceBook: "SG",
    sourcePage: 194,
    pageRef: { canonicalId: SG, page: 194 },
    img: "",
    nature: { rating: 5, descriptors: ["Hunting", "Hiding", "Climbing"] },
    might: 4,
    precedence: 1,
    type: "beast",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "capture", value: 12 },
      { conflictType: "kill", value: 7 },
      { conflictType: "driveOff", value: 5 },
    ],
    specialRules: [{ name: "Venomous", pageRef: { canonicalId: SG, page: 194 } }],
    weapons: [
      {
        name: "Camouflaged Carapace",
        conflicts: ["capture"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Silk Webs",
        conflicts: ["capture"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Fangs",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: -1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Eight Horrible Legs",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Wall Climbing",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Eight Eyes",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/tomb-guardian",
    name: "Tomb Guardian",
    sourceBook: "SG",
    sourcePage: 195,
    pageRef: { canonicalId: SG, page: 195 },
    img: "",
    nature: { rating: 3, descriptors: ["Guarding", "Pursuing", "Slaying the Living"] },
    might: 2,
    precedence: 0,
    type: "undead",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "driveOff", value: 7 },
      { conflictType: "kill", value: 4 },
      { conflictType: "flee", value: 3 },
    ],
    specialRules: [
      { name: "Mindless", pageRef: { canonicalId: SG, page: 195 } },
      { name: "Skeletal honor guard", pageRef: { canonicalId: SG, page: 195 } },
    ],
    weapons: [
      {
        name: "Battle Axe",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: -1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Mace",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Spear",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Shield",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 2 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Sword",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 1 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Tireless Tread",
        conflicts: ["flee"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
    ],
  },
  {
    id: "tb/monster/troll-haunt",
    name: "Troll Haunt",
    sourceBook: "SG",
    sourcePage: 196,
    pageRef: { canonicalId: SG, page: 196 },
    img: "",
    nature: { rating: 8, descriptors: ["Tricking", "Slaughtering", "Skulking"] },
    might: 5,
    precedence: 1,
    type: "troll",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 18 },
      { conflictType: "trick", value: 10 },
      { conflictType: "driveOff", value: 6 },
    ],
    specialRules: [
      { name: "Dark eyes", pageRef: { canonicalId: SG, page: 196 } },
      { name: "Regeneration", pageRef: { canonicalId: SG, page: 196 } },
      { name: "Lucifugous", pageRef: { canonicalId: SG, page: 196 } },
    ],
    weapons: [
      {
        name: "Claws",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Rubbery Flesh",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Stubborn Mind",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Book of Riddles",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Long Legs",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Terrifying Bellow",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/troll-bat",
    name: "Troll Bat",
    sourceBook: "SG",
    sourcePage: 197,
    pageRef: { canonicalId: SG, page: 197 },
    img: "",
    nature: { rating: 2, descriptors: ["Spying", "Biting", "Flying"] },
    might: 1,
    precedence: 0,
    type: "beast",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "flee", value: 6 },
      { conflictType: "pursue", value: 6 },
      { conflictType: "driveOff", value: 3 },
      { conflictType: "kill", value: 2 },
    ],
    specialRules: [
      { name: "Bat sight", pageRef: { canonicalId: SG, page: 197 } },
      { name: "Swarm", pageRef: { canonicalId: SG, page: 197 } },
      { name: "Ancient chiropteran", pageRef: { canonicalId: SG, page: 197 } },
    ],
    weapons: [
      {
        name: "Leathery Wings",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Keen Hearing",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Looping Flight",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Painful Bite",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/troll-rat",
    name: "Troll Rat",
    sourceBook: "SG",
    sourcePage: 198,
    pageRef: { canonicalId: SG, page: 198 },
    img: "",
    nature: { rating: 2, descriptors: ["Consuming", "Burrowing", "Swarming"] },
    might: 1,
    precedence: 0,
    type: "beast",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 5 },
      { conflictType: "driveOff", value: 3 },
      { conflictType: "flee", value: 2 },
    ],
    specialRules: [
      { name: "Swarms", pageRef: { canonicalId: SG, page: 198 } },
      { name: "Diseased", pageRef: { canonicalId: SG, page: 198 } },
    ],
    weapons: [
      {
        name: "Sharp Bite",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Lithe Body",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Quick Claws",
        conflicts: ["flee"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/vengeful-spirit",
    name: "Vengeful Spirit",
    sourceBook: "SG",
    sourcePage: 199,
    pageRef: { canonicalId: SG, page: 199 },
    img: "",
    nature: { rating: 3, descriptors: ["Stalking", "Harrowing", "Frightening"] },
    might: 3,
    precedence: 1,
    type: "spirit",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 8 },
      { conflictType: "driveOff", value: 5 },
      { conflictType: "other", value: 3 },
    ],
    specialRules: [{ name: "Eldritch sink", pageRef: { canonicalId: SG, page: 199 } }],
    weapons: [
      {
        name: "Gnashing Teeth",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Broken Bones",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Squawling Yowl",
        conflicts: ["other"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Bestial Fury",
        conflicts: ["flee", "pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
    ],
  },
  {
    id: "tb/monster/wererat",
    name: "Wererat",
    sourceBook: "SG",
    sourcePage: 200,
    pageRef: { canonicalId: SG, page: 200 },
    img: "",
    nature: { rating: 5, descriptors: ["Scheming", "Skulking", "Betraying"] },
    might: 4,
    precedence: 0,
    type: "troll",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "trick", value: 11 },
      { conflictType: "convince", value: 6 },
      { conflictType: "driveOff", value: 4 },
    ],
    specialRules: [
      { name: "Half rat", pageRef: { canonicalId: SG, page: 200 } },
      { name: "Accursed bite", pageRef: { canonicalId: SG, page: 200 } },
      { name: "Cursed", pageRef: { canonicalId: SG, page: 200 } },
    ],
    weapons: [
      {
        name: "Accursed Bite",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: -1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Sword",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 1 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Bow",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 2 },
        },
      },
      {
        name: "Rat Buddies",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Ratiquette",
        conflicts: ["convince"],
        bonuses: {
          attack: { type: "success", value: -1 },
          defend: { type: "dice", value: 1 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 1 },
        },
      },
    ],
  },
  // -----------------------------------------------------------------
  // Loremaster's Manual bestiary (pp.246–262)
  // -----------------------------------------------------------------
  {
    id: "tb/monster/aptrgangr",
    name: "Aptrgangr (Again-Walker)",
    sourceBook: "LMM",
    sourcePage: 246,
    pageRef: { canonicalId: LMM, page: 246 },
    img: "",
    nature: { rating: 3, descriptors: ["Devouring Flesh", "Hunting", "Shambling"] },
    might: 2,
    precedence: 0,
    type: "undead",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 4 },
      { conflictType: "driveOff", value: 7 },
      { conflictType: "flee", value: 3 },
    ],
    specialRules: [
      { name: "Soulless", pageRef: { canonicalId: LMM, page: 246 } },
      { name: "Slow", pageRef: { canonicalId: LMM, page: 246 } },
      { name: "Hunger", pageRef: { canonicalId: LMM, page: 246 } },
    ],
    weapons: [
      {
        name: "Ragged Nails",
        conflicts: ["kill", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Unreasoning Hunger",
        conflicts: ["kill", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Mindless Persistence",
        conflicts: ["flee"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "success", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/aurochs",
    name: "Aurochs",
    sourceBook: "LMM",
    sourcePage: 247,
    pageRef: { canonicalId: LMM, page: 247 },
    img: "",
    nature: { rating: 6, descriptors: ["Goring", "Trampling", "Herding"] },
    might: 4,
    precedence: 0,
    type: "beast",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 8 },
      { conflictType: "capture", value: 15 },
      { conflictType: "flee", value: 4 },
    ],
    specialRules: [
      { name: "Powerful", pageRef: { canonicalId: LMM, page: 247 } },
      { name: "Massive", pageRef: { canonicalId: LMM, page: 247 } },
      { name: "Protect the herd", pageRef: { canonicalId: LMM, page: 247 } },
      { name: "Trampled under hoof", pageRef: { canonicalId: LMM, page: 247 } },
      { name: "Bull", pageRef: { canonicalId: LMM, page: 247 } },
    ],
    weapons: [
      {
        name: "Horns",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Hooves",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Massive Stature",
        conflicts: ["flee", "capture"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/cinder-imp",
    name: "Cinder Imp",
    sourceBook: "LMM",
    sourcePage: 248,
    pageRef: { canonicalId: LMM, page: 248 },
    img: "",
    nature: { rating: 3, descriptors: ["Hiding", "Tricking", "Burning"] },
    might: 4,
    precedence: 1,
    type: "demon",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "trick", value: 5 },
      { conflictType: "driveOff", value: 9 },
      { conflictType: "capture", value: 5 },
    ],
    specialRules: [
      { name: "Vain", pageRef: { canonicalId: LMM, page: 248 } },
      { name: "Glowing", pageRef: { canonicalId: LMM, page: 248 } },
      { name: "Hearth imp", pageRef: { canonicalId: LMM, page: 248 } },
    ],
    weapons: [
      {
        name: "Burning Ash",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 2 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Acrid Smoke Cloud",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Fire Breath",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Nasty Attitude",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Mischief",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 2 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/cyclops",
    name: "Cyclops",
    sourceBook: "LMM",
    sourcePage: 249,
    pageRef: { canonicalId: LMM, page: 249 },
    img: "",
    nature: { rating: 9, descriptors: ["Cooking", "Smashing", "Herding (or Crafting)"] },
    might: 7,
    precedence: 1,
    type: "troll",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 11 },
      { conflictType: "driveOff", value: 20 },
      { conflictType: "trick", value: 6 },
    ],
    specialRules: [
      { name: "Crushing blow", pageRef: { canonicalId: LMM, page: 249 } },
      { name: "Massive", pageRef: { canonicalId: LMM, page: 249 } },
      { name: "One eye", pageRef: { canonicalId: LMM, page: 249 } },
    ],
    weapons: [
      {
        name: "Massive Cudgel",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Tremendous Stride",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Dull",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/devil-boar",
    name: "Devil Boar",
    sourceBook: "LMM",
    sourcePage: 250,
    pageRef: { canonicalId: LMM, page: 250 },
    img: "",
    nature: { rating: 5, descriptors: ["Rooting", "Goring", "Devouring"] },
    might: 4,
    precedence: 0,
    type: "troll",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 7 },
      { conflictType: "pursue", value: 12 },
      { conflictType: "trick", value: 3 },
    ],
    specialRules: [{ name: "Death blow", pageRef: { canonicalId: LMM, page: 250 } }],
    weapons: [
      {
        name: "Razor-sharp Tusks",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Ferocious Charge",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Thunderous Hooves (driveOff)",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Leathery Hide",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Thunderous Hooves (pursue)",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Limitless Endurance",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "success", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/elder-nixie",
    name: "Elder Nixie",
    sourceBook: "LMM",
    sourcePage: 251,
    pageRef: { canonicalId: LMM, page: 251 },
    img: "",
    nature: { rating: 8, descriptors: ["Sea-dwelling", "Shapeshifting", "Scourging"] },
    might: 6,
    precedence: 7,
    type: "immortal",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "driveOff", value: 11 },
      { conflictType: "kill", value: 19 },
      { conflictType: "capture", value: 7 },
    ],
    specialRules: [
      { name: "Aquatelepathy", pageRef: { canonicalId: LMM, page: 251 } },
      { name: "Shapeshifting", pageRef: { canonicalId: LMM, page: 251 } },
      { name: "Reflection", pageRef: { canonicalId: LMM, page: 251 } },
    ],
    weapons: [
      {
        name: "Protean Claws",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Unearthly Fluke",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Ancient Fury",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "success", value: 2 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Unearthly Fluke (pursue)",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Sleek Form",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/frosk",
    name: "Frosk",
    sourceBook: "LMM",
    sourcePage: 252,
    pageRef: { canonicalId: LMM, page: 252 },
    img: "",
    nature: { rating: 3, descriptors: ["Leaping", "Spawning", "Guarding"] },
    might: 2,
    precedence: 0,
    type: "folk",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "driveOff", value: 5 },
      { conflictType: "capture", value: 8 },
      { conflictType: "convince", value: 3 },
    ],
    specialRules: [
      { name: "Leap", pageRef: { canonicalId: LMM, page: 252 } },
      { name: "Membrane", pageRef: { canonicalId: LMM, page: 252 } },
      { name: "Froggish", pageRef: { canonicalId: LMM, page: 252 } },
      { name: "Groak", pageRef: { canonicalId: LMM, page: 252 } },
      { name: "Froskemoth", pageRef: { canonicalId: LMM, page: 252 } },
    ],
    weapons: [
      {
        name: "Spear",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Leap Attack",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Frog Legs",
        conflicts: ["flee"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Simple",
        conflicts: ["convince", "trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 2 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/gruxu",
    name: "Gruxu",
    sourceBook: "LMM",
    sourcePage: 253,
    pageRef: { canonicalId: LMM, page: 253 },
    img: "",
    nature: { rating: 5, descriptors: ["Reaving", "Scheming", "Swimming"] },
    might: 4,
    precedence: 1,
    type: "folk",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 7 },
      { conflictType: "capture", value: 12 },
      { conflictType: "convince", value: 5 },
    ],
    specialRules: [
      { name: "Slow blood", pageRef: { canonicalId: LMM, page: 253 } },
      { name: "Champion", pageRef: { canonicalId: LMM, page: 253 } },
    ],
    weapons: [
      {
        name: "Venomous Bite",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Lightning Reflexes",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Sad Lizard Eyes",
        conflicts: ["convince"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Ancient Memory",
        conflicts: ["convince"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Tireless Tread",
        conflicts: ["flee"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Sensitive Ears",
        conflicts: ["flee"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "success", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/halja-queen-of-the-dead",
    name: "Halja, Queen of the Dead",
    sourceBook: "LMM",
    sourcePage: 254,
    pageRef: { canonicalId: LMM, page: 254 },
    img: "",
    nature: { rating: 14, descriptors: ["Claiming the Dead", "Judging", "Ruling Hel"] },
    might: 8,
    precedence: 7,
    type: "jotunn",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "convince", value: 17 },
      { conflictType: "trick", value: 30 },
      { conflictType: "other", value: 9 },
    ],
    specialRules: [{ name: "Helreginn", pageRef: { canonicalId: LMM, page: 254 } }],
    weapons: [
      {
        name: "Piercing Gaze",
        conflicts: ["trick", "convince", "other"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Impenetrable Gloom",
        conflicts: ["trick", "convince"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "success", value: 1 },
          feint: { type: "dice", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Protectiveness",
        conflicts: ["convince", "other"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Ancient Strength",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 2 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/manticore",
    name: "Manticore",
    sourceBook: "LMM",
    sourcePage: 255,
    pageRef: { canonicalId: LMM, page: 255 },
    img: "",
    nature: { rating: 6, descriptors: ["Ambushing", "Devouring", "Mimicking"] },
    might: 5,
    precedence: 0,
    type: "beast",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "trick", value: 9 },
      { conflictType: "kill", value: 15 },
      { conflictType: "driveOff", value: 6 },
    ],
    specialRules: [{ name: "Tail-spikes", pageRef: { canonicalId: LMM, page: 255 } }],
    weapons: [
      {
        name: "Razor Sharp Teeth",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Springing Leap",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Tail Spikes",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Cunning Mind",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Mimicry",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 2 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Many Faced",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
    ],
  },
  {
    id: "tb/monster/ogre",
    name: "Ogre",
    sourceBook: "LMM",
    sourcePage: 256,
    pageRef: { canonicalId: LMM, page: 256 },
    img: "",
    nature: { rating: 6, descriptors: ["Eating and Drinking", "Lumbering", "Smashing"] },
    might: 5,
    precedence: 1,
    type: "troll",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "capture", value: 8 },
      { conflictType: "kill", value: 14 },
      { conflictType: "trick", value: 4 },
    ],
    specialRules: [
      { name: "Bludgeon", pageRef: { canonicalId: LMM, page: 256 } },
      { name: "Warty mitts", pageRef: { canonicalId: LMM, page: 256 } },
    ],
    weapons: [
      {
        name: "Bludgeon",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: -1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Ponderous",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: -1 },
        },
      },
      {
        name: "Tricksy",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Charming to Children",
        conflicts: ["convince"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Intimidation",
        conflicts: ["convince"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Cunning",
        conflicts: ["convince"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "success", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/owlbear",
    name: "Owlbear",
    sourceBook: "LMM",
    sourcePage: 257,
    pageRef: { canonicalId: LMM, page: 257 },
    img: "",
    nature: { rating: 7, descriptors: ["Hunting", "Terrorizing", "Tearing Limb from Limb"] },
    might: 4,
    precedence: 0,
    type: "troll",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "flee", value: 9 },
      { conflictType: "kill", value: 16 },
      { conflictType: "driveOff", value: 6 },
    ],
    specialRules: [{ name: "Huggable", pageRef: { canonicalId: LMM, page: 257 } }],
    weapons: [
      {
        name: "Rending Claws",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Crushing Beak",
        conflicts: ["kill"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 2 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Unusual Agility (flee)",
        conflicts: ["flee"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Owl Eyes",
        conflicts: ["flee"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Monstrous Bulk",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Unusual Agility (driveOff)",
        conflicts: ["driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
    ],
  },
  {
    id: "tb/monster/sprikken",
    name: "Sprikken",
    sourceBook: "LMM",
    sourcePage: 258,
    pageRef: { canonicalId: LMM, page: 258 },
    img: "",
    nature: { rating: 4, descriptors: ["Robbing", "Blighting", "Terrorizing"] },
    might: 3,
    precedence: 0,
    type: "troll",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "trick", value: 5 },
      { conflictType: "convince", value: 9 },
      { conflictType: "pursue", value: 3 },
    ],
    specialRules: [
      { name: "Moody", pageRef: { canonicalId: LMM, page: 258 } },
      { name: "Prim", pageRef: { canonicalId: LMM, page: 258 } },
      { name: "Angry growth", pageRef: { canonicalId: LMM, page: 258 } },
    ],
    weapons: [
      {
        name: "Surprising Strength",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Seven League Boots",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Blatant Falsehoods",
        conflicts: ["convince", "trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/strix",
    name: "Strix",
    sourceBook: "LMM",
    sourcePage: 259,
    pageRef: { canonicalId: LMM, page: 259 },
    img: "",
    nature: { rating: 2, descriptors: ["Flying", "Swarming", "Drinking Blood"] },
    might: 2,
    precedence: 0,
    type: "beast",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 4 },
      { conflictType: "pursue", value: 6 },
      { conflictType: "driveOff", value: 3 },
    ],
    specialRules: [
      { name: "Alien", pageRef: { canonicalId: LMM, page: 259 } },
      { name: "Swarms", pageRef: { canonicalId: LMM, page: 259 } },
      { name: "Blood drinker", pageRef: { canonicalId: LMM, page: 259 } },
    ],
    weapons: [
      {
        name: "Evil Proboscis",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Leathery Wings",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Four Buzzing Wings",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Low Profile",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/turtloid",
    name: "Turtloid",
    sourceBook: "LMM",
    sourcePage: 260,
    pageRef: { canonicalId: LMM, page: 260 },
    img: "",
    nature: { rating: 4, descriptors: ["Turtling", "Creeping", "Snatching (with the Claw)"] },
    might: 4,
    precedence: 0,
    type: "folk",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "kill", value: 7 },
      { conflictType: "capture", value: 11 },
      { conflictType: "trick", value: 3 },
    ],
    specialRules: [
      { name: "Strong swimmer", pageRef: { canonicalId: LMM, page: 260 } },
      { name: "Hard shell", pageRef: { canonicalId: LMM, page: 260 } },
      { name: "Marshfield", pageRef: { canonicalId: LMM, page: 260 } },
      { name: "Turtlocracy", pageRef: { canonicalId: LMM, page: 260 } },
    ],
    weapons: [
      {
        name: "Snapping Beak",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Retractable Neck",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "success", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Webbed Feet (water)",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 1 },
          maneuver: { type: "success", value: 1 },
        },
      },
      {
        name: "Fawning Mockery",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Vengeful Personality",
        conflicts: ["trick"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  // -----------------------------------------------------------------
  // Vampire Lord — kept verbatim from the prior commit (pp.261-262).
  // -----------------------------------------------------------------
  {
    id: "tb/monster/vampire-lord",
    name: "Vampire Lord",
    sourceBook: "LMM",
    sourcePage: 261,
    pageRef: { canonicalId: LMM, page: 261 },
    img: "",
    nature: {
      rating: 7,
      descriptors: ["Hunting", "Scheming", "Subjugating"],
    },
    might: 5,
    precedence: 4,
    type: "undead",
    armorItemTemplateId: "tb/armor/byrnie-6801c4",
    dispositions: [
      { conflictType: "capture", value: 10 },
      { conflictType: "kill", value: 17 },
      { conflictType: "convince", value: 6 },
    ],
    specialRules: [
      { name: "Dominant mind", pageRef: { canonicalId: LMM, page: 261 } },
      { name: "Shapeshifter", pageRef: { canonicalId: LMM, page: 261 } },
      { name: "Vampirism", pageRef: { canonicalId: LMM, page: 261 } },
      { name: "Night walker", pageRef: { canonicalId: LMM, page: 261 } },
      { name: "Vulnerabilities", pageRef: { canonicalId: LMM, page: 261 } },
    ],
    weapons: [
      {
        name: "Hideous Bite",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "success", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Monstrous Fortitude",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 2 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Cloak of Shadow",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Terrifying Visage",
        conflicts: ["convince"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Air of Nobility",
        conflicts: ["convince"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "dice", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 2 },
        },
      },
      {
        name: "Inhuman Alacrity",
        conflicts: ["flee"],
        bonuses: {
          attack: { type: "dice", value: 2 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Predatory Senses",
        conflicts: ["flee"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "success", value: 1 },
          feint: { type: "dice", value: 2 },
          maneuver: { type: "dice", value: 0 },
        },
      },
    ],
  },
  {
    id: "tb/monster/war-wasp",
    name: "War Wasp",
    sourceBook: "LMM",
    sourcePage: 262,
    pageRef: { canonicalId: LMM, page: 262 },
    img: "",
    nature: { rating: 2, descriptors: ["Nesting", "Flying", "Hunting"] },
    might: 2,
    precedence: 0,
    type: "beast",
    armorItemTemplateId: null,
    dispositions: [
      { conflictType: "driveOff", value: 4 },
      { conflictType: "pursue", value: 5 },
      { conflictType: "kill", value: 3 },
    ],
    specialRules: [
      { name: "Barbed stinger", pageRef: { canonicalId: LMM, page: 262 } },
      { name: "Vulnerable to fire", pageRef: { canonicalId: LMM, page: 262 } },
      { name: "Wasp nest", pageRef: { canonicalId: LMM, page: 262 } },
    ],
    weapons: [
      {
        name: "Stinger",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "success", value: 1 },
          maneuver: { type: "dice", value: 0 },
        },
      },
      {
        name: "Insectile Agility",
        conflicts: ["kill", "capture", "driveOff"],
        bonuses: {
          attack: { type: "dice", value: 0 },
          defend: { type: "success", value: 1 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "dice", value: 1 },
        },
      },
      {
        name: "Buzzing Wings",
        conflicts: ["pursue"],
        bonuses: {
          attack: { type: "dice", value: 1 },
          defend: { type: "dice", value: 0 },
          feint: { type: "dice", value: 0 },
          maneuver: { type: "success", value: 1 },
        },
      },
    ],
  },
];
