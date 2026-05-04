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

import { definePlugin } from "@vtt/substrate";
import {
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
} from "@vtt/characters/shared";
import {
  AdvancementLogged,
  AdvancementLoggedTrait,
  AlliesEnemies,
  CharacterTraits,
  CirclesCheck,
  Conditions,
  HealthCheck,
  Heroic,
  Identity,
  ImproveSkill,
  Inventory,
  LearnSkill,
  LogAdvancement,
  NatureCheck,
  OpenSkillImprovement,
  OpenSkillLearning,
  Pools,
  RawAbilities,
  Relics,
  ResourcesCheck,
  SkillCheck,
  SkillImproved,
  SkillImprovementOpened,
  SkillImprovementOpportunity,
  SkillLearned,
  SkillLearningOpened,
  SkillLearningOpportunity,
  Skills,
  Spells,
  TbRollModifierProvidersSlot,
  TownAbilities,
  TraitUsageLogged,
  TraitUsageLoggedTrait,
  LogTraitUsage,
  UseTraitOnRoll,
  WhatYouFightFor,
  WillCheck,
  Wises,
} from "./shared/index.js";
import {
  AdvancementLoggedSystem,
  FreshCancellationSystem,
  SkillImprovedSystem,
  SkillImprovementOpenedSystem,
  SkillLearnedSystem,
  SkillLearningOpenedSystem,
  SkillLearningSweepSystem,
  SkillOpportunitySweepSystem,
  TraitUsageLoggedSystem,
} from "./server/index.js";
import {
  TbAbilitiesSkillsTabFill,
  TbActionsFill,
  TbArcaneTabFill,
  TbChatTimelineContributor,
  TbIdentityFill,
  TbInventoryTabFill,
  TbPendingRollContributor,
  TbRollChatTimelineContributor,
  TbSkillLearningTimelineContributor,
  TbTraitsWisesTabFill,
  TbVitalsFill,
  TbWhatYouFightForTabFill,
  TbWhoYouAreTabFill,
} from "./client/index.js";
import { ChatTimelineContributorSlot } from "@vtt/comms/shared";
import { PendingRollContributorsSlot } from "@vtt/characters/shared";

/**
 * Torchbearer 2nd Edition game system. Shape-only first pass:
 *   - All character-sheet traits modeled with full Zod schemas.
 *   - Skill catalog covers all three player-facing books
 *     (Dungeoneer's Handbook 33 + Lore Master's Manual 8 = 41 skills;
 *     Scholar's Guide adds NPC profession blocks but no new player
 *     skills).
 *   - Five top-level tabs in printed-sheet order, plus an Arcane tab
 *     that mounts unconditionally for now (class-conditional tab
 *     visibility lands when the slot system supports a `visible`
 *     predicate or a class-class registry).
 *   - Rollables compute notation only; modifiers from conditions /
 *     traits / wises / help / fate / persona / advantage all land
 *     with the next pass.
 *
 * Citations in code comments use printed page numbers (DH/LMM/SG)
 * per the rules-lookup skill convention. PDF page indices are not
 * stable across re-exports.
 */
export const systemTorchbearer = definePlugin({
  name: "@vtt/system-torchbearer",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/characters@^0",
    "@vtt/comms@^0",
    "@vtt/dice-tray@^0",
    "@vtt/scene@^0",
    "@vtt/resolution@^0",
  ],
  gameSystem: true,
  traits: [
    Identity,
    WhatYouFightFor,
    Pools,
    Conditions,
    RawAbilities,
    TownAbilities,
    Skills,
    CharacterTraits,
    Wises,
    Inventory,
    Spells,
    Relics,
    AlliesEnemies,
    Heroic,
    SkillImprovementOpportunity,
    SkillLearningOpportunity,
    AdvancementLoggedTrait,
    TraitUsageLoggedTrait,
  ],
  events: [
    AdvancementLogged,
    SkillImproved,
    SkillImprovementOpened,
    SkillLearned,
    SkillLearningOpened,
    TraitUsageLogged,
  ],
  commands: [
    ImproveSkill,
    LearnSkill,
    LogAdvancement,
    LogTraitUsage,
    OpenSkillImprovement,
    OpenSkillLearning,
    UseTraitOnRoll,
  ],
  slots: [TbRollModifierProvidersSlot],
  systems: [
    AdvancementLoggedSystem,
    FreshCancellationSystem,
    SkillImprovedSystem,
    SkillImprovementOpenedSystem,
    SkillLearnedSystem,
    SkillLearningOpenedSystem,
    SkillLearningSweepSystem,
    SkillOpportunitySweepSystem,
    TraitUsageLoggedSystem,
  ],
  rollables: [
    WillCheck,
    HealthCheck,
    NatureCheck,
    ResourcesCheck,
    CirclesCheck,
    SkillCheck,
  ],
  fills: {
    [CharacterSheetIdentitySlot.name]: [TbIdentityFill],
    [CharacterSheetVitalsSlot.name]: [TbVitalsFill],
    [CharacterSheetTabsSlot.name]: [
      TbWhoYouAreTabFill,
      TbWhatYouFightForTabFill,
      TbAbilitiesSkillsTabFill,
      TbTraitsWisesTabFill,
      TbArcaneTabFill,
      TbInventoryTabFill,
    ],
    [CharacterSheetActionsSlot.name]: [TbActionsFill],
    [ChatTimelineContributorSlot.name]: [
      TbChatTimelineContributor,
      TbRollChatTimelineContributor,
      TbSkillLearningTimelineContributor,
    ],
    [PendingRollContributorsSlot.name]: [TbPendingRollContributor],
  },
});

export default systemTorchbearer;
