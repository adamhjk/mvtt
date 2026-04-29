import { defineSystem, readTraitWithDefault } from "@vtt/substrate";
import { OwnedBy } from "@vtt/permissions/shared";
import {
  CharacterAssigned,
  CharacterCreated,
  CharacterFieldSet,
  CharacterRemoved,
  CharacterRenamed,
  PendingRollCancelled,
  PendingRollCommitted,
  PendingRollContributed,
  PendingRollOpened,
} from "../shared/events.js";
import { setAtPath } from "../shared/path.js";
import { Character } from "../shared/traits.js";
import { PendingRoll, type Contribution } from "../shared/pending.js";

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
    const playerUserId =
      event.playerUserId === undefined
        ? event.ownerUserId
        : event.playerUserId.length > 0
          ? event.playerUserId
          : undefined;
    world.spawn([
      Character({ name: event.name, playerUserId }),
      OwnedBy({ userId: event.ownerUserId }),
    ]);
    return [];
  },
});

/**
 * Universal mirror: replace the Character trait's name. Preserves any
 * existing `playerUserId` so a rename doesn't accidentally unassign
 * the character.
 */
export const CharacterRenameSystem = defineSystem({
  name: "CharacterRename",
  on: CharacterRenamed,
  reads: [Character],
  writes: [Character],
  run: ({ event, world }) => {
    if (!world.has(event.characterId)) return [];
    const existing = world.get(event.characterId, [Character]) as
      | { Character: { name: string; playerUserId?: string } }
      | undefined;
    if (!existing) return [];
    world.set(event.characterId, Character, {
      name: event.name,
      playerUserId: existing.Character.playerUserId,
    });
    return [];
  },
});

/**
 * Universal mirror: replace the Character trait's `playerUserId`.
 * An empty string clears the assignment.
 */
export const CharacterAssignmentSystem = defineSystem({
  name: "CharacterAssignment",
  on: CharacterAssigned,
  reads: [Character],
  writes: [Character],
  run: ({ event, world }) => {
    if (!world.has(event.characterId)) return [];
    const existing = world.get(event.characterId, [Character]) as
      | { Character: { name: string; playerUserId?: string } }
      | undefined;
    if (!existing) return [];
    const next =
      event.playerUserId.length > 0 ? event.playerUserId : undefined;
    world.set(event.characterId, Character, {
      name: existing.Character.name,
      playerUserId: next,
    });
    return [];
  },
});

/**
 * Universal mirror: write a path-edited value back to a trait on a
 * character. Resolves the trait by name from the registry — it isn't
 * known at compile time because SetField is generic across every game
 * system's traits. Reads the current value (with Zod default fallback
 * for traits that aren't yet attached) and writes the path-edited
 * result via `world.set`, which re-runs the trait's full Zod schema.
 *
 * The matching SetField command already validated the schema in its
 * `validate` step; the re-validation here is a belt-and-braces guard
 * so a buggy custom command that bypassed validation can't sneak past.
 */
export const CharacterFieldSetSystem = defineSystem({
  name: "CharacterFieldSet",
  on: CharacterFieldSet,
  reads: [],
  writes: [],
  run: ({ event, world, registry }) => {
    if (!world.has(event.characterId)) return [];
    const traitMeta = registry.traits.get(
      event.trait as Parameters<typeof registry.traits.get>[0],
    );
    if (!traitMeta) return [];
    const current = readTraitWithDefault(world, event.characterId, traitMeta);
    if (current === undefined) return [];
    let next: unknown;
    try {
      next = setAtPath(current, event.path, event.value);
    } catch {
      return [];
    }
    world.set(event.characterId, traitMeta, next);
    return [];
  },
});

/**
 * Universal mirror: spawn the PendingRoll sentinel entity. Mounted
 * identically on server + every client so every side agrees on the id
 * (universal-mirror pattern, same as CharacterSpawningSystem).
 */
export const PendingRollSpawnSystem = defineSystem({
  name: "PendingRollSpawn",
  on: PendingRollOpened,
  reads: [],
  writes: [PendingRoll],
  run: ({ event, world }) => {
    world.spawn([
      PendingRoll({
        initiatorUserId: event.initiatorUserId,
        initiatorCharacterId: event.initiatorCharacterId,
        rollableName: event.rollableName,
        opts: event.opts,
        contributions: [],
        openedAt: event.openedAt,
      }),
    ]);
    return [];
  },
});

/**
 * Universal mirror: append the contribution to the PendingRoll's
 * `contributions` array. No-op if the entity is gone (commit / cancel
 * raced this contribution).
 */
export const PendingRollContributionSystem = defineSystem({
  name: "PendingRollContribution",
  on: PendingRollContributed,
  reads: [PendingRoll],
  writes: [PendingRoll],
  run: ({ event, world }) => {
    if (!world.has(event.pendingRollId)) return [];
    const got = world.get(event.pendingRollId, [PendingRoll]) as
      | { PendingRoll: { contributions: Contribution[] } & Record<string, unknown> }
      | undefined;
    if (!got) return [];
    const next = {
      ...got.PendingRoll,
      contributions: [...got.PendingRoll.contributions, event.contribution as Contribution],
    };
    world.set(event.pendingRollId, PendingRoll, next);
    return [];
  },
});

/**
 * Universal mirror: despawn the PendingRoll sentinel on commit. The
 * actual roll lands separately via the rollable's command — this
 * system only cleans up the sentinel.
 */
export const PendingRollCommitSystem = defineSystem({
  name: "PendingRollCommit",
  on: PendingRollCommitted,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.pendingRollId)) world.despawn(event.pendingRollId);
    return [];
  },
});

/**
 * Universal mirror: despawn on cancel. Same shape as CommitSystem.
 */
export const PendingRollCancelSystem = defineSystem({
  name: "PendingRollCancel",
  on: PendingRollCancelled,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.pendingRollId)) world.despawn(event.pendingRollId);
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
