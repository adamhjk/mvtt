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
 * Helping (DH p.37, p.11).
 *
 * "Help is a potent mechanism in Torchbearer." (DH p.11)
 *
 * Help adds **+1D** to the test the helper assists with. The eligibility
 * rules differ by what's being tested:
 *
 *   - **Skill tests**: a helper may help if they have the same skill, OR
 *     one of the skill's printed *suggested-help* skills (DH p.37,
 *     "Suggested Help" — see each skill entry's `suggestedHelp[]`), OR
 *     one additional skill the GM rules appropriate. The GM-discretion
 *     slot is left to the panel's labelled-modifier form, not enumerated
 *     here.
 *
 *   - **Skill BL tests** (no rating in the tested skill, defaulting to
 *     Will/Health halved-rounded-up): if the helper has the actual skill,
 *     they help with that. Otherwise they may help with the BL ability
 *     (Will or Health, depending on the skill's BL) — DH p.37 "Helping
 *     Beginners".
 *
 *   - **Ability tests** (Will, Health, Resources, Circles): a helper may
 *     help with the same ability (DH p.37 "Abilities Help Abilities").
 *
 *   - **Nature tests**: a helper may help if they have a Nature
 *     descriptor that relates to the test. Descriptor-relevance is a
 *     judgment call — the eligibility helper offers Nature when the
 *     helper has *any* descriptor and lets the player decide; UI surface
 *     should make the descriptor-pick legible.
 *
 *   - **Versus / disposition / future kinds**: not enumerated here. The
 *     panel's labelled-modifier form covers these.
 *
 * Rating-0 skills/abilities cannot help (DH p.37 "Rating 0 Help"). The
 * eligibility helper filters them out.
 */

import { getSkill, type BeginnersLuck } from "./skills.js";
import type { TbRollKind } from "./roll-spec.js";

/**
 * One way the helper character can offer help. The panel renders a
 * picker over these (or a single button when there's only one); the
 * helper picks which to offer if they have multiple eligible ratings.
 */
export interface HelpOption {
  /**
   * Stable id used as the source of help — `skill:<id>`, `ability:will`,
   * `ability:nature`, etc. Carried in the modifier's `providedBy` so the
   * chat row can label "Bryn helps with Scout".
   */
  readonly id: string;
  /** Human-readable label for the picker, e.g. "Scout 4". */
  readonly label: string;
  /** Numeric rating — used only for label/sort, not the +1D value. */
  readonly rating: number;
  /**
   * What kind of eligibility lit this row up:
   *   - `same-skill` — helper has the exact skill the roller is testing.
   *   - `suggested-skill` — helper has one of the skill's listed helps.
   *   - `same-ability` — Will/Health/Resources/Circles parity.
   *   - `nature` — Nature, descriptor-relates situational; UI surfaces
   *     the descriptor list.
   *   - `bl-ability` — DH p.37 "Helping Beginners": helper has no
   *     matching skill but offers the BL ability.
   */
  readonly via: "same-skill" | "suggested-skill" | "same-ability" | "nature" | "bl-ability";
}

/**
 * Inputs the eligibility helper needs to evaluate a helper character.
 * Defensive shape — tolerates traits that haven't been materialised yet.
 */
export interface HelperContext {
  readonly skills: ReadonlyMap<string, number>;
  readonly will: number;
  readonly health: number;
  readonly nature: number;
  readonly natureDescriptors: ReadonlyArray<string>;
  readonly resources: number;
  readonly circles: number;
}

interface RollContext {
  readonly kind: TbRollKind;
  readonly sourceId: string;
}

/**
 * Compute the list of help options a helper may offer for a given roll.
 * Empty list means "this helper cannot help this test."
 *
 * The list is ordered most-canonical first: same-skill / same-ability,
 * then suggested-skill helps in the order they appear in the skill's
 * `suggestedHelp[]`, then nature/BL fallbacks.
 *
 * Skills/abilities at rating 0 are filtered (DH p.37 "Rating 0 Help").
 */
export function eligibleHelpFor(
  roll: RollContext,
  helper: HelperContext,
): HelpOption[] {
  const out: HelpOption[] = [];
  if (roll.kind === "skill") {
    appendSkillOptions(out, roll.sourceId, helper);
    return out;
  }
  if (roll.kind === "skill-bl") {
    appendSkillOptions(out, roll.sourceId, helper);
    // DH p.37 "Helping Beginners": if the helper does not have the
    // tested skill, they may help with the BL ability (Will/Health).
    const skill = getSkill(roll.sourceId);
    if (skill) {
      const haveSkill = (helper.skills.get(roll.sourceId) ?? 0) > 0;
      if (!haveSkill) {
        appendBlAbility(out, skill.bl, helper);
      }
    }
    return out;
  }
  if (roll.kind === "ability") {
    appendAbilityOption(out, roll.sourceId, helper);
    return out;
  }
  if (roll.kind === "town-ability") {
    appendTownAbilityOption(out, roll.sourceId, helper);
    return out;
  }
  // versus / future kinds — no automatic help offering. The labelled-
  // modifier form remains available for GM-allowed help.
  return out;
}

function appendSkillOptions(
  out: HelpOption[],
  skillId: string,
  helper: HelperContext,
): void {
  const skill = getSkill(skillId);
  // Same-skill help wins the top slot.
  const same = helper.skills.get(skillId) ?? 0;
  if (same > 0) {
    out.push({
      id: `skill:${skillId}`,
      label: `${skill?.name ?? skillId} ${same}`,
      rating: same,
      via: "same-skill",
    });
  }
  if (!skill) return;
  for (const helpSkillId of skill.suggestedHelp) {
    const r = helper.skills.get(helpSkillId) ?? 0;
    if (r <= 0) continue;
    const helpSkill = getSkill(helpSkillId);
    out.push({
      id: `skill:${helpSkillId}`,
      label: `${helpSkill?.name ?? helpSkillId} ${r}`,
      rating: r,
      via: "suggested-skill",
    });
  }
}

function appendBlAbility(
  out: HelpOption[],
  bl: BeginnersLuck,
  helper: HelperContext,
): void {
  const r = bl === "will" ? helper.will : helper.health;
  if (r <= 0) return;
  out.push({
    id: `ability:${bl}`,
    label: `${bl === "will" ? "Will" : "Health"} ${r}`,
    rating: r,
    via: "bl-ability",
  });
}

function appendAbilityOption(
  out: HelpOption[],
  abilityId: string,
  helper: HelperContext,
): void {
  if (abilityId === "will" && helper.will > 0) {
    out.push({
      id: "ability:will",
      label: `Will ${helper.will}`,
      rating: helper.will,
      via: "same-ability",
    });
    return;
  }
  if (abilityId === "health" && helper.health > 0) {
    out.push({
      id: "ability:health",
      label: `Health ${helper.health}`,
      rating: helper.health,
      via: "same-ability",
    });
    return;
  }
  if (abilityId === "nature" && helper.nature > 0) {
    out.push({
      id: "ability:nature",
      label:
        helper.natureDescriptors.length > 0
          ? `Nature ${helper.nature} (${helper.natureDescriptors.join(", ")})`
          : `Nature ${helper.nature}`,
      rating: helper.nature,
      via: "nature",
    });
  }
}

function appendTownAbilityOption(
  out: HelpOption[],
  abilityId: string,
  helper: HelperContext,
): void {
  if (abilityId === "resources" && helper.resources > 0) {
    out.push({
      id: "ability:resources",
      label: `Resources ${helper.resources}`,
      rating: helper.resources,
      via: "same-ability",
    });
    return;
  }
  if (abilityId === "circles" && helper.circles > 0) {
    out.push({
      id: "ability:circles",
      label: `Circles ${helper.circles}`,
      rating: helper.circles,
      via: "same-ability",
    });
  }
}

/**
 * Encode a helper's chosen contribution into the modifier's `providedBy`.
 * Decoded by the chat row to label the helper visibly.
 *   `help:<helperCharacterId>:<optionId>`
 * where `<optionId>` is e.g. `skill:fighter` or `ability:will`.
 */
export function helpProvidedBy(
  helperCharacterId: string,
  optionId: string,
): string {
  return `help:${helperCharacterId}:${optionId}`;
}

/**
 * Stable `replaces` key for a helper's contribution. Posting a second
 * help from the same helper (e.g. switching skills) supersedes the
 * first. Different helpers have different keys so they don't collide.
 */
export function helpReplacesKey(helperCharacterId: string): string {
  return `tb:help:${helperCharacterId}`;
}
