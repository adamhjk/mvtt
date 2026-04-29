import { definePlugin, qualifiedName } from "@vtt/substrate";
import {
  ChatRailWidgetsSlot,
  PagesSlot,
  type ChatRailWidget,
} from "@vtt/shell-workbench/shared";
import { LinkKindsSlot } from "@vtt/notes/shared";
import { characterLinkKind } from "./shared/character-link-kind.js";
import { Character, CharacterToken } from "./shared/traits.js";
import { PendingRoll } from "./shared/pending.js";
import {
  CharacterAssigned,
  CharacterCreated,
  CharacterFieldSet,
  CharacterRenamed,
  CharacterRemoved,
  CharacterTokenImageSet,
  PendingRollCancelled,
  PendingRollCommitted,
  PendingRollContributed,
  PendingRollOpened,
} from "./shared/events.js";
import {
  AssignCharacter,
  CancelPendingRoll,
  CommitPendingRoll,
  ContributeToPendingRoll,
  CreateCharacter,
  OpenPendingRoll,
  RemoveCharacter,
  RenameCharacter,
  SetCharacterTokenImage,
  SetField,
} from "./shared/commands.js";
import {
  CharacterSheetActionsSlot,
  CharacterSheetIdentitySlot,
  CharacterSheetStatusSlot,
  CharacterSheetTabsSlot,
  CharacterSheetVitalsSlot,
  PendingRollContributorsSlot,
  type CharacterSheetRegion,
} from "./shared/slot.js";
import {
  CharacterAssignmentSystem,
  CharacterFieldSetSystem,
  CharacterSpawningSystem,
  CharacterRenameSystem,
  CharacterRemovalSystem,
  CharacterTokenImageSetSystem,
  PendingRollCancelSystem,
  PendingRollCommitSystem,
  PendingRollContributionSystem,
  PendingRollSpawnSystem,
} from "./server/systems.js";
import {
  CharactersPageProvider,
  IdentityFill,
  PendingRollPanels,
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
 * Chat-rail widget that mounts one panel per active PendingRoll
 * entity. Renders nothing when no rolls are in flight; appears when
 * an interactive rollable opens one. Priority sits above the chat
 * stream so the panel is always visible at the top of the rail when
 * present.
 */
const pendingRollWidget: ChatRailWidget = {
  id: qualifiedName("@vtt/characters/pending-roll-widget") as ChatRailWidget["id"],
  priority: 80,
  render: () => PendingRollPanels(),
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
  traits: [Character, CharacterToken, PendingRoll],
  events: [
    CharacterCreated,
    CharacterRenamed,
    CharacterRemoved,
    CharacterAssigned,
    CharacterFieldSet,
    CharacterTokenImageSet,
    PendingRollOpened,
    PendingRollContributed,
    PendingRollCommitted,
    PendingRollCancelled,
  ],
  commands: [
    CreateCharacter,
    RemoveCharacter,
    RenameCharacter,
    AssignCharacter,
    SetCharacterTokenImage,
    SetField,
    OpenPendingRoll,
    ContributeToPendingRoll,
    CommitPendingRoll,
    CancelPendingRoll,
  ],
  systems: [
    CharacterSpawningSystem,
    CharacterRenameSystem,
    CharacterRemovalSystem,
    CharacterAssignmentSystem,
    CharacterFieldSetSystem,
    CharacterTokenImageSetSystem,
    PendingRollSpawnSystem,
    PendingRollContributionSystem,
    PendingRollCommitSystem,
    PendingRollCancelSystem,
  ],
  slots: [
    CharacterSheetIdentitySlot,
    CharacterSheetVitalsSlot,
    CharacterSheetStatusSlot,
    CharacterSheetTabsSlot,
    CharacterSheetActionsSlot,
    PendingRollContributorsSlot,
  ],
  fills: {
    [PagesSlot.name]: [CharactersPageProvider],
    [CharacterSheetIdentitySlot.name]: [defaultIdentityFill],
    [ChatRailWidgetsSlot.name]: [pendingRollWidget],
    [LinkKindsSlot.name]: [characterLinkKind],
  },
});

export default characters;
