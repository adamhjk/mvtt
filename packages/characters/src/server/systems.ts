import { defineSystem } from "@vtt/substrate";
import { OwnedBy } from "@vtt/permissions/shared";
import {
  CharacterCreated,
  CharacterRemoved,
  CharacterRenamed,
} from "../shared/events.js";
import { Character } from "../shared/traits.js";

/**
 * Universal mirror: spawn the Character entity carrying Character +
 * OwnedBy. Runs identically on server and every client so every side
 * agrees on the resulting EntityId.
 */
export const CharacterSpawningSystem = defineSystem({
  name: "CharacterSpawning",
  on: CharacterCreated,
  reads: [],
  writes: [Character, OwnedBy],
  run: ({ event, world }) => {
    world.spawn([
      Character({ name: event.name }),
      OwnedBy({ userId: event.ownerUserId }),
    ]);
    return [];
  },
});

/**
 * Universal mirror: replace the Character trait with the new name.
 * `world.set` keeps the entity id stable — game-system traits attached
 * by other plugins survive the rename.
 */
export const CharacterRenameSystem = defineSystem({
  name: "CharacterRename",
  on: CharacterRenamed,
  reads: [Character],
  writes: [Character],
  run: ({ event, world }) => {
    if (!world.has(event.characterId)) return [];
    world.set(event.characterId, Character, { name: event.name });
    return [];
  },
});

/**
 * Universal mirror: despawn the entity. Any game-system traits attached
 * to it disappear at the same moment on every side.
 */
export const CharacterRemovalSystem = defineSystem({
  name: "CharacterRemoval",
  on: CharacterRemoved,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.characterId)) world.despawn(event.characterId);
    return [];
  },
});
