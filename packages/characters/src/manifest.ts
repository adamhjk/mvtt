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

import { definePlugin, qualifiedName } from "@vtt/substrate";
import { ChatRailWidgetsSlot, PagesSlot, type ChatRailWidget } from "@vtt/shell-workbench/shared";
import {
  PendingRollEditorsSlot,
  QuickRollComposerSlot,
  ResolvedRollFeedSlot,
  ROLL_ATELIER_KIND,
  RollAtelierRailSlot,
  RollAtelierUiState,
  RollAtelierUiStateChanged,
  RollAtelierUiStateMirror,
  SetRollAtelierUiState,
} from "./shared/atelier.js";
import { LinkKindsSlot } from "@vtt/notes/shared";
import { characterLinkKind } from "./shared/character-link-kind.js";
import { Active, Character, CharacterToken, Team } from "./shared/traits.js";
import { PendingRoll } from "./shared/pending.js";
import {
  CharacterSheetUiState,
  CharacterSheetUiStateChanged,
  CharacterSheetUiStateMirror,
  SetCharacterSheetUiState,
} from "./shared/sheet-ui-state.js";
import {
  CharacterCreated,
  CharacterFieldSet,
  CharacterRenamed,
  CharacterRemoved,
  CharacterTokenImageSet,
  PendingRollCancelled,
  PendingRollCommitted,
  PendingRollContributed,
  PendingRollContributionRemoved,
  PendingRollOpened,
} from "./shared/events.js";
import {
  CancelPendingRoll,
  CommitPendingRoll,
  ContributeToPendingRoll,
  CreateCharacter,
  OpenPendingRoll,
  RemoveCharacter,
  RemoveContribution,
  RenameCharacter,
  SetCharacterTokenImage,
  SetField,
} from "./shared/commands.js";
import {
  CharacterListExclusionSlot,
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
  PendingRollContributorsSlot,
  type CharacterSheetRegion,
} from "./shared/slot.js";
import {
  CharacterFieldSetSystem,
  CharacterSpawningSystem,
  CharacterRenameSystem,
  CharacterRemovalSystem,
  CharacterTokenImageSetSystem,
  PendingRollCancelSystem,
  PendingRollCommitSystem,
  PendingRollContributionRemoveSystem,
  PendingRollContributionSystem,
  PendingRollSpawnSystem,
} from "./server/systems.js";
import {
  AtelierAutoFocusMount,
  CharactersPageProvider,
  GenericPendingRollEditor,
  IdentityFill,
  RollAtelierPageProvider,
} from "./client/index.js";

/**
 * Default fill for the identity region — name + player-assignment
 * fields. Game systems extend this with sub-lines (level/class/ancestry)
 * by registering their own fills with higher priority placement.
 */
const defaultIdentityFill: CharacterSheetRegion = {
  id: qualifiedName("@vtt/characters/identity-default") as CharacterSheetRegion["id"],
  priority: 100,
  render: ({ characterId }) => IdentityFill({ characterId }),
};

/**
 * Chat-rail widget that mounts the Atelier's auto-focus side effect.
 * Renders nothing visible — the widget exists only to anchor the
 * reactive `useQuery(PendingRoll)` effect that dispatches `OpenPage` on
 * the Roll tab when a PendingRoll belonging to the current user lands.
 *
 * Priority is below other widgets so it doesn't take rail space (it has
 * none to give); the chat composer + visible widgets render above it.
 */
const atelierAutoFocusWidget: ChatRailWidget = {
  id: qualifiedName("@vtt/characters/atelier-auto-focus") as ChatRailWidget["id"],
  priority: -1000,
  render: () => AtelierAutoFocusMount(),
};

export const characters = definePlugin({
  name: "@vtt/characters",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    "@vtt/shell-workbench@^0",
    "@vtt/notes@^0",
  ],
  traits: [
    Character,
    CharacterToken,
    PendingRoll,
    Team,
    Active,
    CharacterSheetUiState,
    RollAtelierUiState,
  ],
  events: [
    CharacterCreated,
    CharacterRenamed,
    CharacterRemoved,
    CharacterFieldSet,
    CharacterTokenImageSet,
    PendingRollOpened,
    PendingRollContributed,
    PendingRollContributionRemoved,
    PendingRollCommitted,
    PendingRollCancelled,
    CharacterSheetUiStateChanged,
    RollAtelierUiStateChanged,
  ],
  commands: [
    CreateCharacter,
    RemoveCharacter,
    RenameCharacter,
    SetCharacterTokenImage,
    SetField,
    OpenPendingRoll,
    ContributeToPendingRoll,
    RemoveContribution,
    CommitPendingRoll,
    CancelPendingRoll,
    SetCharacterSheetUiState,
    SetRollAtelierUiState,
  ],
  systems: [
    CharacterSpawningSystem,
    CharacterRenameSystem,
    CharacterRemovalSystem,
    CharacterFieldSetSystem,
    CharacterTokenImageSetSystem,
    PendingRollSpawnSystem,
    PendingRollContributionSystem,
    PendingRollContributionRemoveSystem,
    PendingRollCommitSystem,
    PendingRollCancelSystem,
    CharacterSheetUiStateMirror,
    RollAtelierUiStateMirror,
  ],
  slots: [
    CharacterSheetIdentitySlot,
    CharacterSheetVitalsSlot,
    CharacterSheetStatusSlot,
    CharacterSheetTabsSlot,
    CharacterSheetActionsSlot,
    CharacterListExclusionSlot,
    PendingRollContributorsSlot,
    PendingRollEditorsSlot,
    RollAtelierRailSlot,
    ResolvedRollFeedSlot,
    QuickRollComposerSlot,
  ],
  fills: {
    [PagesSlot.name]: [CharactersPageProvider, RollAtelierPageProvider],
    [CharacterSheetIdentitySlot.name]: [defaultIdentityFill],
    [ChatRailWidgetsSlot.name]: [atelierAutoFocusWidget],
    [LinkKindsSlot.name]: [characterLinkKind],
    [PendingRollEditorsSlot.name]: [GenericPendingRollEditor],
  },
});

void ROLL_ATELIER_KIND;

export default characters;
