import { defineEvent, EntityId, z } from "@vtt/substrate";

/**
 * A new character was created. `characterId` is allocated by the
 * server's command `apply` and embedded in the event so every recipient
 * spawns at the same id — no per-side counter prediction.
 */
export const CharacterCreated = defineEvent({
  name: "@vtt/characters/CharacterCreated",
  schema: z.object({
    characterId: EntityId,
    name: z.string().min(1).max(120),
    /** userId of the player who owns the character. */
    ownerUserId: z.string().min(1),
    createdByUserId: z.string().min(1),
    /**
     * Optional initial player assignment — the userId of the player
     * who plays this character. Defaults to the owner when absent so
     * the common case (player creates their own character) is also
     * the player who plays it; a GM creating an NPC sheet can leave
     * it unassigned by passing the empty string.
     */
    playerUserId: z.string().optional(),
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

/**
 * The player assignment for a character changed — `playerUserId` is the
 * userId of the new player, or the empty string to clear the assignment.
 * Owner-or-GM gated by the AssignCharacter command.
 */
export const CharacterAssigned = defineEvent({
  name: "@vtt/characters/CharacterAssigned",
  schema: z.object({
    characterId: EntityId,
    playerUserId: z.string(),
  }),
});

/**
 * A PendingRoll entity was opened. `pendingRollId` is allocated by the
 * server's command `apply` and embedded in the event so every recipient
 * spawns at the same id.
 */
export const PendingRollOpened = defineEvent({
  name: "@vtt/characters/PendingRollOpened",
  schema: z.object({
    pendingRollId: EntityId,
    initiatorUserId: z.string().min(1),
    initiatorCharacterId: EntityId,
    rollableName: z.string().min(1),
    opts: z.unknown(),
    openedAt: z.number(),
  }),
});

/**
 * A contribution was appended to a PendingRoll. The receiving system
 * pushes onto the entity's `contributions` array.
 */
export const PendingRollContributed = defineEvent({
  name: "@vtt/characters/PendingRollContributed",
  schema: z.object({
    pendingRollId: EntityId,
    contribution: z.object({
      kind: z.string(),
      label: z.string(),
      fromUserId: z.string(),
      fromCharacterId: EntityId.optional(),
      payload: z.unknown(),
    }),
  }),
});

/**
 * A PendingRoll was committed by its initiator. The receiving system
 * despawns the entity. The actual roll is dispatched separately by the
 * committing client (so the rollable's command flows through its normal
 * apply path with no system-dispatch detour).
 */
export const PendingRollCommitted = defineEvent({
  name: "@vtt/characters/PendingRollCommitted",
  schema: z.object({
    pendingRollId: EntityId,
  }),
});

/**
 * A PendingRoll was discarded without rolling. Despawn-only.
 */
export const PendingRollCancelled = defineEvent({
  name: "@vtt/characters/PendingRollCancelled",
  schema: z.object({
    pendingRollId: EntityId,
  }),
});

/**
 * A field on a character was set via the generic SetField command.
 * `trait` is the qualified trait name; `path` is the segment list into
 * the trait value; `value` is the new value at that path. The receiving
 * system resolves the trait by name from the registry and writes the
 * path-edited result back to the world.
 *
 * Game-system plugins that want to emit their own domain events for
 * specific traits (e.g., `HpChanged` instead of a generic field-set)
 * dispatch their own commands instead of SetField — the kit lets a
 * field opt out of SetField via a per-field `command` override.
 */
export const CharacterFieldSet = defineEvent({
  name: "@vtt/characters/CharacterFieldSet",
  schema: z.object({
    characterId: EntityId,
    trait: z.string(),
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
    value: z.unknown(),
  }),
});
