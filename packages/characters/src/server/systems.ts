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
  PendingRollContributionRemoved,
  PendingRollOpened,
} from "../shared/events.js";
import { setAtPath } from "../shared/path.js";
import { Character, CharacterToken, Team } from "../shared/traits.js";
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
  writes: [Character, Permissions, Team],
  run: ({ event, world }) => {
    world.spawnAt(event.characterId, [
      Character({ name: event.name }),
      Permissions(ownedBy(event.ownerUserId)),
      // Default every new character to the party. NPCs get switched
      // to "enemy" later via SetField (or future GM-side tooling).
      Team({ kind: "party" }),
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
    const incoming = event.contribution as Contribution;
    // Last-wins dedup by `replaces` key: a "setting" contribution
    // (TB obstacle picker, heroic toggle) carries `replaces: "tb:..."`
    // and the system drops earlier contributions sharing that key
    // before appending the new one. Stackable contributions (modifiers,
    // help) leave `replaces` unset and accumulate normally.
    const filtered = incoming.replaces
      ? got.PendingRoll.contributions.filter(
          (c) => c.replaces !== incoming.replaces,
        )
      : got.PendingRoll.contributions;
    const next = {
      ...got.PendingRoll,
      contributions: [...filtered, incoming],
    };
    world.set(event.pendingRollId, PendingRoll, next);
    return [];
  },
});

/**
 * Universal mirror: drop any contribution whose `payload.id`
 * matches the incoming `modifierId`. Used by the chip × affordance
 * to undo accidental contributions. Multiple matches are all
 * removed at once — a defensive choice if a system somehow posted
 * the same id twice (we'd rather wipe both than leave a stub).
 */
export const PendingRollContributionRemoveSystem = defineSystem({
  name: "PendingRollContributionRemove",
  on: PendingRollContributionRemoved,
  reads: [PendingRoll],
  writes: [PendingRoll],
  run: ({ event, world }) => {
    if (!world.has(event.pendingRollId)) return [];
    const got = world.get(event.pendingRollId, [PendingRoll]) as
      | { PendingRoll: { contributions: Contribution[] } & Record<string, unknown> }
      | undefined;
    if (!got) return [];
    const filtered = got.PendingRoll.contributions.filter((c) => {
      const inner = c.payload as { id?: unknown } | undefined;
      return inner?.id !== event.modifierId;
    });
    if (filtered.length === got.PendingRoll.contributions.length) return [];
    world.set(event.pendingRollId, PendingRoll, {
      ...got.PendingRoll,
      contributions: filtered,
    });
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
    // Write both fields verbatim — the event itself stays the source
    // of truth. Asset-first writes carry `{assetId, imageUrl: null}`;
    // legacy / replayed writes carry `{assetId: null, imageUrl}`;
    // clears carry both null. Readers apply precedence at read time
    // via `resolveCharacterTokenUrl`.
    world.set(event.characterId, CharacterToken, {
      assetId: event.assetId ?? null,
      imageUrl: event.imageUrl ?? null,
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
