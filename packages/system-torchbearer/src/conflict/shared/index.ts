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
  ALL_ACTIONS,
  ConflictActionEnum,
  TB_ACTION_INDEP_OB,
  TB_ACTION_MATRIX,
  TB_ACTION_RULES,
  TB_ACTION_SUMMARIES,
  TB_MANEUVER_COMBINATIONS,
  TB_MANEUVER_EFFECTS,
  testForAction,
  type ActionRules,
  type ConflictAction,
  type ManeuverEffectDef,
  type MatchupCell,
  type MatchupType,
} from "./actions.js";
export {
  ALL_CONFLICT_TYPES,
  ConflictTypeEnum,
  TB_CONFLICT_TYPES,
  actionSkillLabel,
  dispoRollLabel,
  skillLabel,
  type ConflictType,
  type ConflictTypeDef,
  type DispoSkillSpec,
} from "./conflict-types.js";
export { ConflictSideEnum, otherSide, type ConflictSide } from "./sides.js";
export {
  ScriptSlotSchema,
  scrubSlot,
  type ScriptSlot,
} from "./resolution.js";
export {
  ALL_CONFLICT_TRAITS,
  TbConflict,
  TbConflictParticipant,
  TbConflictScript,
  TbConflictWeapon,
  type RevealedSlotEntry,
} from "./traits.js";
export {
  ALL_CONFLICT_EVENTS,
  CaptainElected,
  CompromiseApplied,
  ConflictDeclared,
  ConflictEnded,
  ConflictParticipantsAdded,
  RoundAdvanced,
  ConflictWeaponChosen,
  DispositionRolled,
  HpAssigned,
  ParticipantHpSet,
  ScriptLocked,
  ScriptUnlocked,
  ScriptSlotCleared,
  ScriptSlotSet,
  SlotRevealed,
  TeamDispositionSet,
} from "./events.js";
export {
  ALL_CONFLICT_COMMANDS,
  AddConflictParticipants,
  AdvanceRound,
  ApplyCompromise,
  AssignHp,
  ChooseWeapon,
  ClearScriptSlot,
  DeclareConflict,
  ElectCaptain,
  EndConflict,
  LockScript,
  UnlockScript,
  RevealNextSlot,
  RollDisposition,
  SetParticipantHp,
  SetScriptSlot,
  SetTeamDisposition,
} from "./commands.js";
export {
  TB_ARMOR_RULES,
  TB_COMPROMISE_LEVELS,
  TB_CONDITION_RULES,
  TB_DISPO_FACTOR_REMINDERS,
  TB_MATCHUP_NOTES,
  type ArmorRulesEntry,
  type CompromiseLevelEntry,
  type ConditionRulesEntry,
  type DispoFactorReminder,
} from "./rules-text.js";
