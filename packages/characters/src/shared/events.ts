import { defineEvent, EntityId, z } from "@vtt/substrate";

/**
 * A new character was created. The recording system spawns the entity
 * in lockstep on every side, so we don't carry a server-chosen id —
 * subsequent commands (RenameCharacter, RemoveCharacter) supply the id
 * from the dispatching client's local World.
 */
export const CharacterCreated = defineEvent({
  name: "@vtt/characters/CharacterCreated",
  schema: z.object({
    name: z.string().min(1).max(120),
    /** userId of the player who owns the character. */
    ownerUserId: z.string().min(1),
    createdByUserId: z.string().min(1),
  }),
});

/**
 * The character's display name was updated. Other field changes will
 * arrive via game-system-specific events on their own traits — this
 * event is scoped to the universal name field carried by `Character`.
 */
export const CharacterRenamed = defineEvent({
  name: "@vtt/characters/CharacterRenamed",
  schema: z.object({
    characterId: EntityId,
    name: z.string().min(1).max(120),
  }),
});

export const CharacterRemoved = defineEvent({
  name: "@vtt/characters/CharacterRemoved",
  schema: z.object({
    characterId: EntityId,
  }),
});
