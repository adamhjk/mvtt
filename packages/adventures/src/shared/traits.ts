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

/**
 * Sentinel id for the per-world `BlockEntityIndex` entity. Deterministic
 * so every side converges (mirrors the GRIND_SENTINEL_ID pattern).
 */
export const BLOCK_ENTITY_INDEX_ID = "block-entity-index";

/**
 * Maps `(noteId, blockKey)` to the entity id allocated for that block
 * the first time the parse system saw it. Stable across renames inside
 * the YAML body — only the fence info-string drives the blockKey.
 *
 * Key shape: `${noteId}::${blockKey}` (string-keyed for JSON-friendliness).
 *
 * See `design/adventures.md` § "Locked decisions" #3 and § "Materialization model".
 */
export const BlockEntityIndex = defineTrait({
  name: "@vtt/adventures/BlockEntityIndex",
  schema: z.object({
    entries: z.record(
      z.string(),
      z.object({
        noteId: EntityId,
        blockKey: z.string().min(1).max(240),
        kind: z.string().min(1).max(60),
        entityId: EntityId,
      }),
    ),
  }),
});

/**
 * Marks an entity as tombstoned — its source block has been removed
 * from a note, but the entity itself stays around because something
 * else (a running conflict, an inventory entry) may still reference it.
 *
 * Renderers consume tombstoned entities normally; the orphan-list view
 * surfaces them so the GM can promote (un-tombstone), restore (re-add
 * a block), or hard-delete.
 */
export const Tombstoned = defineTrait({
  name: "@vtt/adventures/Tombstoned",
  schema: z.object({
    reason: z.string().min(1).max(120),
    since: z.number().int().min(0),
    /** Original `(noteId, blockKey)` pair the entity came from. */
    source: z.object({
      noteId: EntityId,
      blockKey: z.string().min(1).max(240),
    }),
  }),
});

/**
 * Provenance trait stamped on every note created by importing a bundle.
 * Keys on stable `bundleId` (UUID); `bundleName` and `version` are
 * display metadata. The update flow uses this to detect re-imports
 * and compute per-block diffs.
 */
export const AdventureProvenance = defineTrait({
  name: "@vtt/adventures/AdventureProvenance",
  schema: z.object({
    bundleId: z.string().min(1).max(120),
    bundleName: z.string().min(1).max(240),
    version: z.string().min(1).max(60),
    bundlePath: z.string().min(1).max(480),
    /** Original sha256 of the note body when the bundle was imported. */
    originalSha256: z.string().length(64),
  }),
});

/**
 * Recipe entity for an encounter — produced by parsing an `encounter`
 * fenced block. Carries the static description (sides, opening
 * actions, treasure, read-aloud); each `StartEncounter` dispatch
 * spawns a fresh `TbConflict` (or game-system-equivalent) using this
 * as the template.
 */
export const EncounterTemplate = defineTrait({
  name: "@vtt/adventures/EncounterTemplate",
  schema: z.object({
    name: z.string().min(1).max(240),
    /** Conflict-type discriminator (game-system specific). */
    type: z.string().min(1).max(60),
    /** Optional location reference (note or scene). */
    locationRef: z
      .object({
        kind: z.string().min(1).max(60),
        body: z.string().min(1).max(240),
      })
      .nullable(),
    sides: z.array(
      z.object({
        name: z.string().min(1).max(60),
        participants: z.array(
          z.object({
            kind: z.string().min(1).max(60),
            body: z.string().min(1).max(240),
            /** 1 or undefined for singular references; >1 for mob spawns. */
            quantity: z.number().int().min(1).max(99).optional(),
          }),
        ),
      }),
    ),
    openingActions: z
      .array(
        z.object({
          actor: z.string().min(1).max(240),
          action: z.string().min(1).max(60),
          note: z.string().max(2000).default(""),
          round: z.number().int().min(1).max(99).optional(),
        }),
      )
      .default([]),
    treasure: z.string().max(2000).default(""),
    readAloud: z.string().max(4000).default(""),
    trigger: z.string().max(2000).default(""),
  }),
});

/**
 * Recipe entity for a treasure parcel — produced by parsing a `loot`
 * fenced block. The `Award loot` action dispatches `AwardLoot` which
 * spawns the items into a chosen holder.
 */
export const LootParcel = defineTrait({
  name: "@vtt/adventures/LootParcel",
  schema: z.object({
    name: z.string().min(1).max(240),
    items: z.array(
      z.object({
        kind: z.string().min(1).max(60),
        body: z.string().min(1).max(240),
        quantity: z.number().int().min(1).max(99).default(1),
      }),
    ),
    cash: z
      .object({
        copper: z.number().int().min(0).max(999999).default(0),
        silver: z.number().int().min(0).max(999999).default(0),
        gold: z.number().int().min(0).max(999999).default(0),
      })
      .default({ copper: 0, silver: 0, gold: 0 }),
    notes: z.string().max(4000).default(""),
  }),
});

/**
 * On a NotePage entity: the parsed list of fenced blocks in that page,
 * maintained by the BlockParseSystem. Lets renderers, the orphan list,
 * and autocomplete query "what blocks does this page have" without
 * re-parsing the body.
 */
export const PageBlocks = defineTrait({
  name: "@vtt/adventures/PageBlocks",
  schema: z.object({
    blocks: z.array(
      z.object({
        kind: z.string().min(1).max(60),
        info: z.string().max(240),
        blockKey: z.string().min(1).max(240),
        rangeStart: z.number().int().min(0),
        rangeEnd: z.number().int().min(0),
      }),
    ),
  }),
});
