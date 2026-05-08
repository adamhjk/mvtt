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

// Conflict-specific weapons and armor — abstract resources that aren't
// physical items in your inventory but live as catalog item entities so
// the disposition weapon/armor picker can offer them as quick-reference
// options. Lifted from:
//   - DH p.234-239 (Capture, Convince, Convince Crowd, Pursue/Flee,
//     Trick, Riddle, Other Conflict Armor)
//   - LMM p.107 (Negotiate Conflict Weapons + Armor)
//   - LMM p.111 (Spiritual Conflict Weapons + Armor)
//
// Each catalog row spawns a real entity with `ItemIdentity + TbWeapon`
// (or `TbArmor`) + `TbConflictResource{applicableConflicts, kind, note}`.
// `slotOptions` is empty so they're not equippable to a body slot —
// they show up in the picker through the conflict-resource path.

import type { CatalogTemplate } from "@vtt/items/shared";
import type { ConflictType } from "../conflict/shared/conflict-types.js";

interface ActionBonus {
  readonly type: "dice" | "rerolls" | "success";
  readonly value: number;
}

interface BonusBag {
  readonly attack: ActionBonus;
  readonly defend: ActionBonus;
  readonly feint: ActionBonus;
  readonly maneuver: ActionBonus;
}

const ZERO: ActionBonus = { type: "dice", value: 0 };

function bonuses(partial: Partial<BonusBag>): BonusBag {
  return {
    attack: partial.attack ?? ZERO,
    defend: partial.defend ?? ZERO,
    feint: partial.feint ?? ZERO,
    maneuver: partial.maneuver ?? ZERO,
  };
}

function weapon(
  id: string,
  name: string,
  conflicts: ReadonlyArray<ConflictType>,
  partial: Partial<BonusBag>,
  note: string,
): CatalogTemplate {
  return {
    templateId: id,
    traits: {
      ItemIdentity: {
        name,
        description: note,
        img: "",
      },
      TbItemSlotOptions: { options: {} },
      TbWeapon: {
        wield: 1,
        conflictBonuses: bonuses(partial),
      },
      TbSkillBonuses: { entries: [] },
      TbItemSpecialRules: { text: note },
      TbConflictResource: {
        applicableConflicts: [...conflicts],
        kind: "weapon",
        note,
      },
    },
  };
}

function armor(
  id: string,
  name: string,
  conflicts: ReadonlyArray<ConflictType>,
  note: string,
  // armorType is informational here — these aren't physical leather/
  // chain/plate. We use "other" so the items system's degradation
  // pipeline doesn't mistake them for real armor.
): CatalogTemplate {
  return {
    templateId: id,
    traits: {
      ItemIdentity: { name, description: note, img: "" },
      TbItemSlotOptions: { options: {} },
      TbArmor: { armorType: "other", absorbs: 1 },
      TbSkillBonuses: { entries: [] },
      TbItemSpecialRules: { text: note },
      TbConflictResource: {
        applicableConflicts: [...conflicts],
        kind: "armor",
        note,
      },
    },
  };
}

export const TB_CONFLICT_RESOURCE_TEMPLATES: ReadonlyArray<CatalogTemplate> = [
  /* ---- Capture (DH p.234) ---- */
  weapon(
    "tb/conflict/capture-camouflage",
    "Camouflage",
    ["capture"],
    { feint: { type: "dice", value: 1 } },
    "Setting up blinds or wearing camouflage to deceive your quarry. DH p.234.",
  ),
  weapon(
    "tb/conflict/capture-lures",
    "Lures",
    ["capture"],
    { maneuver: { type: "dice", value: 1 } },
    "Calls or scents that confuse the quarry. Made via Hunter (Alchemist may help). DH p.234.",
  ),
  weapon(
    "tb/conflict/capture-nets-traps",
    "Nets or Traps",
    ["capture"],
    { attack: { type: "success", value: 1 } },
    "Implements to entangle or slow your quarry. Built to size via Hunter. DH p.234.",
  ),

  /* ---- Convince (DH p.235) ---- */
  weapon(
    "tb/conflict/convince-blackmail",
    "Blackmail",
    ["convince"],
    { attack: { type: "dice", value: 1 } },
    "+1D to one chosen action; sticks to that action for the rest of the conflict. Requires real (or credibly faked) leverage. DH p.235.",
  ),
  weapon(
    "tb/conflict/convince-deception",
    "Deception",
    ["convince"],
    { feint: { type: "success", value: 1 } },
    "Real lies about real facts (no fanciful prattling). DH p.235.",
  ),
  weapon(
    "tb/conflict/convince-evidence",
    "Evidence",
    ["convince"],
    { attack: { type: "success", value: 1 } },
    "Pre-established evidence; explained via the Attack action. DH p.235.",
  ),
  weapon(
    "tb/conflict/convince-finery",
    "Finery",
    ["convince"],
    {},
    "Clean, fashionable finery grants its wearer +1 Precedence (no action bonus). DH p.235.",
  ),
  weapon(
    "tb/conflict/convince-intimidation",
    "Intimidation",
    ["convince"],
    { maneuver: { type: "success", value: 1 } },
    "Real threats, not bluster — must be roleplayed out. DH p.235.",
  ),
  weapon(
    "tb/conflict/convince-promises",
    "Promises",
    ["convince"],
    { defend: { type: "dice", value: 1 } },
    "Promises bind only via the compromise. DH p.235.",
  ),

  /* ---- Convince Crowd (DH p.236) ---- */
  weapon(
    "tb/conflict/crowd-elevated-position",
    "Elevated Position",
    ["convinceCrowd"],
    { attack: { type: "success", value: 1 } },
    "Speak from a raised vantage; entire audience must see you. DH p.236.",
  ),
  weapon(
    "tb/conflict/crowd-mood",
    "Playing to the Mood",
    ["convinceCrowd"],
    { feint: { type: "success", value: 1 } },
    "Pander to the crowd's mood. DH p.236.",
  ),
  weapon(
    "tb/conflict/crowd-uniform",
    "Uniform of Authority",
    ["convinceCrowd"],
    { defend: { type: "dice", value: 1 } },
    "A uniform or outfit lends gravity to your argument. DH p.236.",
  ),

  /* ---- Pursue / Flee (DH p.236-237) ---- */
  weapon(
    "tb/conflict/flee-caltrops",
    "Caltrops or Oil",
    ["flee"],
    { feint: { type: "success", value: 1 } },
    "Dirty tricks; expended when used. DH p.236.",
  ),
  weapon(
    "tb/conflict/chase-locals",
    "Locals",
    ["flee", "pursue"],
    { attack: { type: "dice", value: 1 } },
    "+1D to one chosen action; sticks to that action for the rest of the conflict. DH p.236.",
  ),
  weapon(
    "tb/conflict/chase-maps",
    "Maps",
    ["flee", "pursue"],
    {},
    "+1D to the disposition roll (not an action bonus). DH p.236.",
  ),
  weapon(
    "tb/conflict/chase-right-tools",
    "Right Tools",
    ["flee", "pursue"],
    { attack: { type: "success", value: 1 } },
    "Rope + grappling hook for a wall, boat for a river, etc. DH p.237.",
  ),

  /* ---- Riddle (DH p.237) — riddle is "trick" in the enum ---- */
  weapon(
    "tb/conflict/riddle-answers",
    "Answers",
    ["trick"],
    { defend: { type: "success", value: 2 } },
    "You know the answer (or know you're being tricked). DH p.237.",
  ),
  weapon(
    "tb/conflict/riddle-material-clue",
    "Material Clue",
    ["trick"],
    { maneuver: { type: "dice", value: 2 } },
    "A person, object or terrain feature that points to the truth. DH p.237.",
  ),
  weapon(
    "tb/conflict/riddle-riddle",
    "Riddle",
    ["trick"],
    { attack: { type: "dice", value: 1 } },
    "Produce an actual riddle. DH p.237 — also +1s to that Attack.",
  ),

  /* ---- Trick (DH p.238) ---- */
  weapon(
    "tb/conflict/trick-truth",
    "Truth",
    ["trick"],
    { attack: { type: "dice", value: 1 } },
    "Tell your victim the truth (cease lies for a moment). DH p.238.",
  ),
  weapon(
    "tb/conflict/trick-distraction",
    "Distraction",
    ["trick"],
    { maneuver: { type: "dice", value: 1 } },
    "Explosion, smooth partner — anything diverting. DH p.238.",
  ),
  weapon(
    "tb/conflict/trick-prop",
    "Prop",
    ["trick"],
    { feint: { type: "dice", value: 1 } },
    "Physical prop that builds on the ruse. DH p.238.",
  ),

  /* ---- Negotiate (LMM p.107) — the closest enum match is "convince";
     these will appear in convince conflicts as alternative resources. */
  weapon(
    "tb/conflict/negotiate-possession",
    "Possession",
    ["convince"],
    { attack: { type: "success", value: 1 } },
    "You possess the item or service being bargained for. LMM p.107.",
  ),
  weapon(
    "tb/conflict/negotiate-means",
    "Means",
    ["convince"],
    { maneuver: { type: "dice", value: 2 } },
    "You demonstrate the means to pay. LMM p.107.",
  ),

  /* ---- Spiritual (LMM p.111) — abjure / banish / bind. The enum
     doesn't have a spiritual conflict type yet; flag as "other" so the
     picker still surfaces them. */
  weapon(
    "tb/conflict/spiritual-offering",
    "Offering",
    ["other"],
    { feint: { type: "success", value: 1 } },
    "A sacrifice or offering made to the spirit during the conflict. LMM p.111.",
  ),
  weapon(
    "tb/conflict/spiritual-protective-circle",
    "Protective Circle",
    ["other"],
    { defend: { type: "dice", value: 2 } },
    "Drawn with Lore Master or Theologian before the conflict. LMM p.111.",
  ),
  weapon(
    "tb/conflict/spiritual-religious-amulet",
    "Religious Amulet",
    ["other"],
    { maneuver: { type: "dice", value: 1 } },
    "Worn about the neck. LMM p.111.",
  ),
  weapon(
    "tb/conflict/spiritual-true-name",
    "True Name",
    ["other"],
    { attack: { type: "success", value: 1 } },
    "Researched in advance via Lore Master or Theologian (Ob = Might). LMM p.111.",
  ),

  /* -------------- Conflict armor -------------- */
  armor(
    "tb/conflict/convince-authority",
    "Authority",
    ["convince"],
    "Rank or position absorbs 1pt on a roll of 4-6, once per conflict. DH p.238.",
  ),
  armor(
    "tb/conflict/convince-precedence",
    "Precedence",
    ["convince"],
    "Higher Precedence absorbs 1pt/hit; lost on 1-3. DH p.238.",
  ),
  armor(
    "tb/conflict/crowd-title-office",
    "Title or Office",
    ["convinceCrowd"],
    "Position of power absorbs 1pt/hit; lost on 1-3. DH p.239.",
  ),
  armor(
    "tb/conflict/pursue-shoes",
    "Shoes",
    ["pursue"],
    "Good shoes absorb 1pt on a roll of 4-6, once per conflict. DH p.239.",
  ),
  armor(
    "tb/conflict/flee-darkness",
    "Darkness",
    ["flee"],
    "Cover of darkness absorbs 1pt/hit; lost on 1-3. DH p.239.",
  ),
  armor(
    "tb/conflict/trick-knowledge-of-nature",
    "Knowledge of Nature",
    ["trick"],
    "Knowing one of the mark's Nature descriptors absorbs 1pt/hit; lost on 1-3. DH p.239.",
  ),
  armor(
    "tb/conflict/negotiate-hostage",
    "Hostage",
    ["convince"],
    "Hostages can be expended to absorb 1pt of damage each. LMM p.107.",
  ),
  armor(
    "tb/conflict/negotiate-power",
    "Power",
    ["convince"],
    "Captor / warlord absorbs 1pt/hit; roll 1d6 — illusion shattered on 1-3. LMM p.107.",
  ),
  armor(
    "tb/conflict/spiritual-relic",
    "Relic",
    ["other"],
    "Break a relic to absorb 1pt; destroyed in the process. LMM p.111.",
  ),
  armor(
    "tb/conflict/spiritual-ritual-purification",
    "Ritual Purification",
    ["other"],
    "Bath in holy smoke/sand/water + Ob 3 Ritualist; absorbs 1pt/hit, lost on 1-3. Nullified by meat / dead / killing / fornication / consorting with spirits. LMM p.111.",
  ),
  armor(
    "tb/conflict/spiritual-ritual-tattoo",
    "Ritual Tattoo",
    ["other"],
    "Permanent body markings + Ob 6 Ritualist; absorbs 1pt/hit, lost on 1-2. Permanently -1 Precedence. LMM p.111.",
  ),
  armor(
    "tb/conflict/spiritual-vestments",
    "Vestments",
    ["other"],
    "Clean vestments absorb 1pt on a roll of 4-6. LMM p.111.",
  ),
];
