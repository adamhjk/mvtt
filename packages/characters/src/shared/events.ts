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

import { defineEvent, EntityId, z } from "@vtt/substrate";
import { ContributionSchema } from "./pending.js";

/**
 * A new character was created. `characterId` is allocated by the
 * server's command `apply` and embedded in the event so every recipient
 * spawns at the same id — no per-side counter prediction.
 *
 * The recording system spawns Character + a default Permissions trait
 * with `read: everyone, write: users:[ownerUserId]`. Subsequent
 * "assignment" / "transfer" / "GM-only NPC" decisions are handled by
 * the universal `SetPermissions` command — there's no character-specific
 * assignment verb.
 */
export const CharacterCreated = defineEvent({
  name: "@vtt/characters/CharacterCreated",
  schema: z.object({
    characterId: EntityId,
    name: z.string().min(1).max(120),
    /** userId who initially owns the character (Permissions.write). */
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
    /**
     * The full contribution payload — uses the canonical
     * ContributionSchema so the optional `replaces` dedup key is
     * preserved end-to-end (panel → command → event → system).
     * Earlier this event inlined a stripped-down shape that silently
     * dropped `replaces`, defeating the dedup system.
     */
    contribution: ContributionSchema,
  }),
});

/**
 * A previously-posted contribution was removed from a PendingRoll.
 * `modifierId` matches the inner `payload.id` of the contribution
 * being removed — anything in the contributions list with a payload
 * carrying that id is filtered out. Used by the panel's chip ×
 * affordance to undo accidental quick-button presses.
 */
export const PendingRollContributionRemoved = defineEvent({
  name: "@vtt/characters/PendingRollContributionRemoved",
  schema: z.object({
    pendingRollId: EntityId,
    modifierId: z.string().min(1).max(80),
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
 * The GM (or owner) set or cleared a character's uploaded token image.
 * The recording system attaches/updates the CharacterToken trait.
 *
 * Post-refactor: new uploads carry `assetId` (the asset entity holding
 * the bytes) and leave `imageUrl` null. The legacy `imageUrl` field
 * remains on the event for backwards compatibility — entities written
 * before the asset-first refactor still emit events with `imageUrl` set
 * and `assetId` null/absent. The token-image system writes both
 * fields verbatim so readers can apply asset-first precedence at read
 * time via `resolveCharacterTokenUrl`.
 *
 * Either or both fields may be null in the same event: null/null
 * means "clear the portrait." Setting both is forbidden (the command
 * validates this) so the wire stays unambiguous.
 */
export const CharacterTokenImageSet = defineEvent({
  name: "@vtt/characters/CharacterTokenImageSet",
  schema: z.object({
    characterId: EntityId,
    imageUrl: z.string().nullable().default(null),
    assetId: EntityId.nullable().default(null),
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
