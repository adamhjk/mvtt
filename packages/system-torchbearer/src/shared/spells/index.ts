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
  SpellCastConsumed,
  SpellCatalogIndex,
  SpellDerivedFrom,
  SpellIdentity,
  SPELL_SCHOOLS,
  SpellCastingKindSchema,
  SpellSchoolSchema,
  TbLibrary,
  TbMemoryPalace,
  TbScroll,
  TbSpellBook,
  TbSpellCasting,
  TbSpellHomebrewProse,
  TbSpellLearning,
  type SpellCircle,
  type SpellSchool,
  type SpellCastingKind,
} from "./spell-traits.js";
export {
  LibraryLocationSet,
  MemoryPalaceCapacityChanged,
  MemoryPalaceCleared,
  MemoryPalaceFilled,
  MemoryPalaceSpellMarkedCast,
  ScrollConsumed,
  ScrollScribed,
  ScrollSpawned,
  SpellCreated,
  SpellFieldEdited,
  SpellRemoved,
  SpellAddedToBook,
  SpellAddedToLibrary,
  SpellCastConsumeLogged,
  SpellCastInitiated,
  SpellForked,
  SpellRemovedFromBook,
  SpellRemovedFromLibrary,
} from "./spell-events.js";
export {
  AddSpellToBook,
  AddSpellToLibrary,
  BurnScroll,
  BurnSpellbookSpell,
  ClearMemoryPalace,
  CreateBlankSpell,
  EditSpellField,
  RemoveSpell,
  ConsumePalaceSpell,
  FillMemoryPalace,
  RemoveSpellFromBook,
  RemoveSpellFromLibrary,
  ScribeSpellToScroll,
  SetMemoryPalaceCapacity,
} from "./spell-commands.js";
