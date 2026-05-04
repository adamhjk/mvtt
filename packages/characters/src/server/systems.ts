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

import { defineSystem, readTraitWithDefault } from "@vtt/substrate";
import { Permissions, ownedBy } from "@vtt/permissions/shared";
import {
  CharacterCreated,
  CharacterFieldSet,
  CharacterRemoved,
  CharacterRenamed,
  CharacterTokenImageSet,
  PendingRollCancelled,
  PendingRollCommitted,
  PendingRollContributed,
  PendingRollOpened,
} from "../shared/events.js";
import { setAtPath } from "../shared/path.js";
import { Character, CharacterToken } from "../shared/traits.js";
import { PendingRoll, type Contribution } from "../shared/pending.js";

/**
 * Universal mirror: spawn the Character entity at the server-allocated
 * id carried by the event. Both server and clients call `spawnAt` so
 * the resulting EntityId is identical everywhere — no per-side counter
 * prediction.
 *
 * The default Permissions are `read: everyone, write: users:[ownerUserId]`:
 * the world sees the character, only the owner can edit. Subsequent
 * grants ("assign to a player", "GM-only NPC") flow through the
 * universal `SetPermissions` command.
 */
export const CharacterSpawningSystem = defineSystem({
  name: "CharacterSpawning",
  on: CharacterCreated,
  reads: [],
  writes: [Character, Permissions],
  run: ({ event, world }) => {
    world.spawnAt(event.characterId, [
      Character({ name: event.name }),
      Permissions(ownedBy(event.ownerUserId)),
    ]);
    return [];
  },
});

/**
 * Universal mirror: replace the Character trait's name.
 */
export const CharacterRenameSystem = defineSystem({
  name: "CharacterRename",
  on: CharacterRenamed,
  reads: [Character],
  writes: [Character],
  run: ({ event, world }) => {
    if (!world.has(event.characterId)) return [];
    const existing = world.get(event.characterId, [Character]) as
      | { Character: { name: string } }
      | undefined;
    if (!existing) return [];
    world.set(event.characterId, Character, {
      name: event.name,
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
 * Universal mirror: spawn the PendingRoll sentinel entity at the
 * server-allocated id from the event. `spawnAt` keeps server and every
 * client agreed on the EntityId regardless of how many events each side
 * has processed.
 */
export const PendingRollSpawnSystem = defineSystem({
  name: "PendingRollSpawn",
  on: PendingRollOpened,
  reads: [],
  writes: [PendingRoll, Permissions],
  run: ({ event, world }) => {
    world.spawnAt(event.pendingRollId, [
      PendingRoll({
        initiatorUserId: event.initiatorUserId,
        initiatorCharacterId: event.initiatorCharacterId,
        rollableName: event.rollableName,
        opts: event.opts,
        contributions: [],
        openedAt: event.openedAt,
      }),
      // Initiator owns the pending roll; commit/cancel gate on
      // `requireWrite`. GM bypass keeps GMs in charge as always.
      Permissions(ownedBy(event.initiatorUserId)),
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
 * Universal mirror: attach (or replace) the CharacterToken trait on
 * the target Character entity. `world.set` creates the trait if not
 * present, so the same system handles both first-upload and
 * replace/clear flows. No-op if the character has been despawned
 * between dispatch and apply.
 */
export const CharacterTokenImageSetSystem = defineSystem({
  name: "CharacterTokenImageSet",
  on: CharacterTokenImageSet,
  reads: [],
  writes: [CharacterToken],
  run: ({ event, world }) => {
    if (!world.has(event.characterId)) return [];
    world.set(event.characterId, CharacterToken, {
      imageUrl: event.imageUrl,
    });
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
