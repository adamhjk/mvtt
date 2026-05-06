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

export {
  AdvancementLogged as AdvancementLoggedTrait,
  AlliesEnemies,
  CharacterTraits,
  Conditions,
  Heroic,
  Identity,
  Pools,
  RawAbilities,
  Relics,
  RollSpends,
  SkillImprovementOpportunity,
  SkillLearningOpportunity,
  Skills,
  Spells,
  SynergyAdvancementLogged as SynergyAdvancementLoggedTrait,
  TownAbilities,
  TraitUsageLogged as TraitUsageLoggedTrait,
  WhatYouFightFor,
  Wises,
  type RollSpendEntry,
  type RollSpendKind,
} from "./traits.js";
export {
  ImproveSkill,
  LearnSkill,
  LogAdvancement,
  LogTraitUsage,
  OpenSkillImprovement,
  OpenSkillLearning,
  UseTraitOnRoll,
  traitUsageFromSpec,
} from "./commands.js";
export {
  LogSynergyAdvancement,
  SpendDeeperUnderstanding,
  SpendLuck,
  SpendOfCourse,
  helperOptionFromContributions,
  helperOptionFromSpec,
} from "./spend-commands.js";
export {
  AdvancementLogged,
  DeeperUnderstandingSpent,
  LuckSpent,
  OfCourseSpent,
  SkillImproved,
  SkillImprovementOpened,
  SkillLearned,
  SkillLearningOpened,
  SynergyAdvancementLoggedEvent,
  TraitUsageLogged,
} from "./events.js";
export {
  ALL_SKILLS,
  ADVENTURING_SKILLS,
  TOWN_SKILLS,
  LORE_MASTER_SKILLS,
  getSkill,
  isKnownSkillId,
  type SkillEntry,
  type SkillCategory,
  type SkillSourceBook,
  type BeginnersLuck,
} from "./skills.js";
export {
  CONDITION_ORDER,
  type ConditionId,
  type ConditionDef,
} from "./conditions.js";
export {
  ALL_TB_ROLLABLES,
  CirclesCheck,
  HealthCheck,
  NatureCheck,
  ResourcesCheck,
  SkillCheck,
  WillCheck,
} from "./rollables.js";
export {
  buildTbNotation,
  countSuccesses,
  foldBlModifiers,
  foldModifiers,
  isBlPreHalfModifier,
  resolveSuccessCount,
  TB_ROLL_META_SYSTEM,
  TbRollKindSchema,
  TbRollMetaSchema,
  TbRollModifierApplySchema,
  TbRollModifierKindSchema,
  TbRollModifierSchema,
  TbRollModifierSourceSchema,
  TbRollSpecSchema,
  type TbRollKind,
  type TbRollMeta,
  type TbRollModifier,
  type TbRollModifierApply,
  type TbRollModifierKind,
  type TbRollModifierSource,
  type TbRollSpec,
} from "./roll-spec.js";
export {
  eligibleHelpFor,
  helpProvidedBy,
  helpReplacesKey,
  type HelpOption,
  type HelperContext,
} from "./help.js";
export {
  ANGRY_AFFECTED_SKILLS,
  TB_CHANNEL_NATURE_CONTRIB_KIND,
  TB_DISPOSITION_CONTRIB_KIND,
  TB_HEROIC_CONTRIB_KIND,
  TB_MODIFIER_CONTRIB_KIND,
  TB_OBSTACLE_CONTRIB_KIND,
  TB_PERSONA_SPEND_CONTRIB_KIND,
  TB_SYNERGY_CONTRIB_KIND,
  TB_VERSUS_CONTRIB_KIND,
  autoModifiersFromConditions,
  channelNatureFromContributions,
  dispositionFromContributions,
  formatModifier,
  heroicFromContributions,
  modifiersFromContributions,
  obstacleFromContributions,
  personaSpendsFromContributions,
  personaSpendTotalFromContributions,
  suggestedItemModifiersFor,
  suggestedQuickModifiersFor,
  synergyDeclsFromContributions,
  synergyHelpersFromContributions,
  teamPenaltiesForDisposition,
  versusFromContributions,
  type ChannelNatureDecl,
  type PersonaSpendDecl,
  type SynergyDecl,
  type TbSuggestedQuickModifier,
} from "./roll-modifiers.js";
export {
  TbRollModifierProvidersSlot,
  type TbRollModifierProvider,
} from "./roll-providers.js";
export * from "./items/index.js";
export {
  DismissLightWentOut,
  GRIND_SENTINEL_ID,
  Grind,
  GrindExtremeSet,
  GrindToll,
  GrindTollOpened,
  GrindTollRowApplied,
  GrindTurnSet,
  LightSourceWentOut,
  LightWentOutNotice,
  MarkGrindToll,
  NoticeDismissed,
  SetGrindExtreme,
  SetGrindTurn,
  nextGrindCondition,
  tollCadence,
  type GrindCondition,
} from "./grind.js";
