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
  TB_BODY_SLOTS,
  TB_CHARACTER_SLOT_CAPACITY,
  TbBodySlotSchema,
  TbEquipChannel,
  type TbBodySlot,
  type TbEquipChannelT,
} from "./body-slots.js";
export {
  ItemPosition,
  TbArmor,
  TbCarries,
  TbContainer,
  TbItemSlotOptions,
  TbItemSpecialRules,
  TbSkillBonuses,
  TbSupply,
  TbWeapon,
} from "./item-traits.js";
export {
  EntryStateChanged,
  ItemDropped,
  ItemEquipped,
  ItemMoved,
  ItemPickedUp,
  ItemUnequipped,
} from "./item-events.js";
export {
  DropItem,
  EquipItem,
  MoveItem,
  PickUpItem,
  SetEntryState,
  UnequipItem,
} from "./item-commands.js";
export {
  capacityForCharacterSlot,
  checkPlacement,
  nextSlotIndex,
  type PlacementCheck,
  type PlacementRequest,
} from "./capacity.js";
