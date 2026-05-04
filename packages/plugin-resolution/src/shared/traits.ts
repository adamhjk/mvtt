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

import { defineTrait, EntityId, z } from "@vtt/substrate";

export const Formula = defineTrait({
  name: "@vtt/resolution/Formula",
  schema: z.object({
    notation: z.string().min(1),
    reason: z.string().optional(),
    /**
     * Optional system-specific structured payload attached at roll time.
     * Conventionally `{ system: "<plugin-name>", spec: <system-spec> }`
     * — the resolution layer never inspects it, but downstream chat rows
     * can decode their own roll-spec data here (modifier breakdowns,
     * obstacles, success thresholds, advantage flags) so per-system
     * rendering stays lossless. The chat-timeline contributor uses
     * `meta.system` as a discriminator: when present, the generic
     * resolution row defers to whichever system claims that tag.
     */
    meta: z.unknown().optional(),
  }),
});

/**
 * Who initiated the roll. We capture both `userId` (stable across sessions
 * and reconnects) and `displayName` (the name at the moment the roll
 * happened — denormalized so the card still reads correctly after the
 * player disconnects).
 *
 * When the roll was made through the chat composer / dice tray's
 * "speak as" dropdown, `displayName` is the character's name (resolved
 * by `RollRecordingSystem`) and `speakingAsCharacterId` is the entity
 * — renderers can use that to e.g. open the sheet on click. With no
 * speak-as selection it's just the rolling user's display name, same
 * as before.
 */
export const RolledBy = defineTrait({
  name: "@vtt/resolution/RolledBy",
  schema: z.object({
    userId: z.string().min(1),
    displayName: z.string().min(1),
    speakingAsCharacterId: EntityId.optional(),
  }),
});

/**
 * Structured per-die outcome attached to a roll. Mirror of the
 * `RollResolved.dice` event field — denormalised onto the trait so
 * downstream consumers (system-aware chat rows, automation, replay
 * inspectors) can read individual die faces without subscribing to
 * the event itself or string-parsing rpg-dice-roller's output.
 */
const DieOutcome = z.object({
  sides: z.union([z.number().int().positive(), z.literal("F")]),
  value: z.number().int(),
});

export const RollResult = defineTrait({
  name: "@vtt/resolution/RollResult",
  schema: z.object({
    total: z.number(),
    output: z.string(),
    rolledAt: z.number(),
    /**
     * Flat list of every die rolled, in display order. Empty for
     * notations without dice (`/r 4` is a degenerate but legal case).
     * Defaulted so older snapshots that lacked the field continue to
     * decode cleanly.
     */
    dice: z.array(DieOutcome).default([]),
  }),
});
