import { definePlugin } from "@vtt/substrate";
import { PagesSlot } from "@vtt/shell-workbench/shared";
import { Character } from "./shared/traits.js";
import {
  CharacterCreated,
  CharacterRenamed,
  CharacterRemoved,
} from "./shared/events.js";
import {
  CreateCharacter,
  RemoveCharacter,
  RenameCharacter,
} from "./shared/commands.js";
import { CharacterSheetSectionsSlot } from "./shared/slot.js";
import {
  CharacterSpawningSystem,
  CharacterRenameSystem,
  CharacterRemovalSystem,
} from "./server/systems.js";
import { CharactersPageProvider } from "./client/index.js";

export const characters = definePlugin({
  name: "@vtt/characters",
  version: "0.1.0",
  dependsOn: [
    "@vtt/substrate@^0",
    "@vtt/identity@^0",
    "@vtt/permissions@^0",
    "@vtt/shell-workbench@^0",
  ],
  traits: [Character],
  events: [CharacterCreated, CharacterRenamed, CharacterRemoved],
  commands: [CreateCharacter, RemoveCharacter, RenameCharacter],
  systems: [
    CharacterSpawningSystem,
    CharacterRenameSystem,
    CharacterRemovalSystem,
  ],
  slots: [CharacterSheetSectionsSlot],
  fills: {
    [PagesSlot.name]: [CharactersPageProvider],
  },
});

export default characters;
