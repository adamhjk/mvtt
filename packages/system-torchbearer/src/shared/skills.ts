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

/**
 * Torchbearer skill catalog.
 *
 * The complete cross-book set of skills:
 *   - 25 adventuring skills printed on the standard character sheet
 *     (Dungeoneer's Handbook p.249).
 *   - 8 town / laborer skills also referenced in DH p.249 but not
 *     pre-printed on the sheet — earned through training.
 *   - 8 additional skills introduced in the Lore Master's Manual
 *     "Skills" chapter (LMM p.36-40).
 *
 * Citations use the printed page number, per the rules-lookup skill
 * convention. PDF page indices are not stable across re-exports.
 */

export type BeginnersLuck = "will" | "health";

export type SkillCategory = "adventuring" | "town" | "lmm";

export type SkillSourceBook = "DH" | "LMM";

export interface SkillEntry {
  /** Stable id used as the key in the Skills trait. */
  readonly id: string;
  /** Display name as printed in the rulebook. */
  readonly name: string;
  /** Beginner's Luck ability for tests when the skill is unlearned. */
  readonly bl: BeginnersLuck;
  /** Which group the skill sits in on a fresh sheet. */
  readonly category: SkillCategory;
  /** Source book + printed page for citations. */
  readonly source: { book: SkillSourceBook; page: number };
  /**
   * Suggested-help skill ids — the skills the rulebook lists under
   * "Help:" for this skill (DH p.160–176, LMM p.36–40).
   *
   * Per DH p.37 ("Suggested Help"), help on a test of this skill is
   * **limited** to: the same skill, any of these listed skills, plus
   * one additional skill the GM rules appropriate for the situation.
   * The GM-discretion slot is handled by the panel's "labelled
   * modifier" form rather than this list.
   */
  readonly suggestedHelp: readonly string[];
}

/**
 * Adventuring skills — the 25 pre-printed skills on the standard sheet.
 * BL assignments per Dungeoneer's Handbook p.249 (Skill Reference).
 */
export const ADVENTURING_SKILLS: ReadonlyArray<SkillEntry> = [
  { id: "alchemist",    name: "Alchemist",    bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["loreMaster", "laborer"] },
  { id: "arcanist",     name: "Arcanist",     bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["loreMaster"] },
  { id: "armorer",      name: "Armorer",      bl: "health", category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["smith", "laborer"] },
  { id: "cartographer", name: "Cartographer", bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["scholar", "pathfinder"] },
  { id: "commander",    name: "Commander",    bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["steward", "orator"] },
  { id: "cook",         name: "Cook",         bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["alchemist", "laborer"] },
  { id: "criminal",     name: "Criminal",     bl: "health", category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["scout", "scholar"] },
  { id: "dungeoneer",   name: "Dungeoneer",   bl: "health", category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["sapper", "survivalist"] },
  { id: "fighter",      name: "Fighter",      bl: "health", category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["hunter"] },
  { id: "haggler",      name: "Haggler",      bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["manipulator"] },
  { id: "healer",       name: "Healer",       bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["survivalist", "alchemist"] },
  { id: "hunter",       name: "Hunter",       bl: "health", category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["survivalist", "laborer"] },
  { id: "loreMaster",   name: "Lore Master",  bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["arcanist", "theologian"] },
  { id: "manipulator",  name: "Manipulator",  bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["haggler", "persuader"] },
  { id: "mentor",       name: "Mentor",       bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["persuader"] },
  { id: "orator",       name: "Orator",       bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["manipulator"] },
  { id: "pathfinder",   name: "Pathfinder",   bl: "health", category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["scout", "cartographer"] },
  { id: "persuader",    name: "Persuader",    bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["manipulator"] },
  { id: "rider",        name: "Rider",        bl: "health", category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["peasant"] },
  { id: "ritualist",    name: "Ritualist",    bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["theologian"] },
  { id: "scavenger",    name: "Scavenger",    bl: "health", category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["scout"] },
  { id: "scholar",      name: "Scholar",      bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["loreMaster", "steward"] },
  { id: "scout",        name: "Scout",        bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["pathfinder", "hunter"] },
  { id: "survivalist",  name: "Survivalist",  bl: "health", category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["peasant"] },
  { id: "theologian",   name: "Theologian",   bl: "will",   category: "adventuring", source: { book: "DH", page: 249 }, suggestedHelp: ["scholar", "ritualist"] },
];

/**
 * Town / laborer skills from the Skill Reference (DH p.249) — not on
 * the standard sheet, learned through training. Used by NPC stat blocks
 * (Sage, Smith, etc. in Scholar's Guide) and available to PCs who put
 * in the Nature tests to learn them.
 */
export const TOWN_SKILLS: ReadonlyArray<SkillEntry> = [
  { id: "carpenter",   name: "Carpenter",   bl: "health", category: "town", source: { book: "DH", page: 249 }, suggestedHelp: ["alchemist", "laborer"] },
  { id: "laborer",     name: "Laborer",     bl: "health", category: "town", source: { book: "DH", page: 249 }, suggestedHelp: ["peasant"] },
  { id: "peasant",     name: "Peasant",     bl: "health", category: "town", source: { book: "DH", page: 249 }, suggestedHelp: ["laborer"] },
  { id: "sailor",      name: "Sailor",      bl: "health", category: "town", source: { book: "DH", page: 249 }, suggestedHelp: ["survivalist", "laborer"] },
  { id: "sapper",      name: "Sapper",      bl: "health", category: "town", source: { book: "DH", page: 249 }, suggestedHelp: ["alchemist", "laborer"] },
  { id: "steward",     name: "Steward",     bl: "will",   category: "town", source: { book: "DH", page: 249 }, suggestedHelp: ["scholar", "theologian"] },
  { id: "stonemason",  name: "Stonemason",  bl: "health", category: "town", source: { book: "DH", page: 249 }, suggestedHelp: ["laborer"] },
  { id: "weaver",      name: "Weaver",      bl: "will",   category: "town", source: { book: "DH", page: 249 }, suggestedHelp: ["laborer", "peasant"] },
];

/**
 * Lore Master's Manual additional skills (LMM "Skills" chapter, p.36–40).
 * Each ships with full factor tables in the LMM; players may learn them
 * as home skills for new settlements or in the course of adventures.
 */
export const LORE_MASTER_SKILLS: ReadonlyArray<SkillEntry> = [
  { id: "beggar",      name: "Beggar",      bl: "will",   category: "lmm", source: { book: "LMM", page: 36 }, suggestedHelp: ["orator", "manipulator"] },
  { id: "butcher",     name: "Butcher",     bl: "health", category: "lmm", source: { book: "LMM", page: 37 }, suggestedHelp: ["cook", "laborer"] },
  { id: "enchanter",   name: "Enchanter",   bl: "will",   category: "lmm", source: { book: "LMM", page: 37 }, suggestedHelp: ["alchemist", "arcanist"] },
  { id: "fisher",      name: "Fisher",      bl: "will",   category: "lmm", source: { book: "LMM", page: 38 }, suggestedHelp: ["laborer", "sailor"] },
  { id: "jeweler",     name: "Jeweler",     bl: "will",   category: "lmm", source: { book: "LMM", page: 39 }, suggestedHelp: ["laborer", "alchemist"] },
  { id: "smith",       name: "Smith",       bl: "health", category: "lmm", source: { book: "LMM", page: 39 }, suggestedHelp: ["laborer", "armorer"] },
  { id: "strategist",  name: "Strategist",  bl: "will",   category: "lmm", source: { book: "LMM", page: 40 }, suggestedHelp: ["commander", "scholar", "steward"] },
  { id: "tanner",      name: "Tanner",      bl: "health", category: "lmm", source: { book: "LMM", page: 40 }, suggestedHelp: ["laborer", "armorer"] },
];

/**
 * Master skill list — concatenation of every defined skill across the
 * three player-facing books. Iterated by sheet rendering and by skill-
 * lookup helpers; the per-category arrays drive the UI's grouping.
 */
export const ALL_SKILLS: ReadonlyArray<SkillEntry> = [
  ...ADVENTURING_SKILLS,
  ...TOWN_SKILLS,
  ...LORE_MASTER_SKILLS,
];

const BY_ID: ReadonlyMap<string, SkillEntry> = new Map(
  ALL_SKILLS.map((s) => [s.id, s] as const),
);

export function getSkill(id: string): SkillEntry | undefined {
  return BY_ID.get(id);
}

export function isKnownSkillId(id: string): boolean {
  return BY_ID.has(id);
}
