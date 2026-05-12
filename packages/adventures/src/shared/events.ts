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

/**
 * Emitted by `BlockParseSystem` when a fenced block has been parsed
 * and projected to an entity. Universal mirror systems use it to
 * write the projected traits to the entity (spawning if missing).
 */
export const BlockEntityUpserted = defineEvent({
  name: "@vtt/adventures/BlockEntityUpserted",
  schema: z.object({
    /** Pre-allocated server-authoritative id. */
    entityId: EntityId,
    /** Block kind (`npc`, `item`, …) — the registry uses this. */
    kind: z.string().min(1).max(60),
    /** Note + slug pair this block belongs to. */
    noteId: EntityId,
    blockKey: z.string().min(1).max(240),
    /**
     * `true` when the entity is being spawned for the first time;
     * `false` when an existing entity is being re-set with new authored
     * fields.
     */
    spawn: z.boolean(),
    /**
     * Trait writes — each carries a fully-qualified trait name + JSON
     * value. The mirror system parses each value against the registry's
     * trait def at apply time. Carried as `name + value` (rather than
     * full `TraitInstance`) so the wire format stays JSON.
     */
    traits: z.array(
      z.object({
        name: z.string().min(1).max(120),
        value: z.unknown(),
      }),
    ),
  }),
});

/**
 * Emitted when a parsed block disappears from a note (the GM deleted
 * the fenced block). The entity is NOT despawned — it may be referenced
 * from a running conflict or another note. Instead a `Tombstoned`
 * trait is written; renderers consume tombstoned entities normally,
 * the orphan list surfaces them, and the GM decides whether to
 * resurrect or hard-delete.
 */
export const BlockEntityTombstoned = defineEvent({
  name: "@vtt/adventures/BlockEntityTombstoned",
  schema: z.object({
    entityId: EntityId,
    noteId: EntityId,
    blockKey: z.string().min(1).max(240),
    reason: z.string().min(1).max(120),
  }),
});

/**
 * Emitted by `BlockParseSystem` after every parse pass with the
 * complete list of recognized blocks on the page. The PageBlocks
 * mirror system writes the trait so renderers/autocomplete can query
 * blocks without re-parsing.
 */
export const PageBlocksParsed = defineEvent({
  name: "@vtt/adventures/PageBlocksParsed",
  schema: z.object({
    pageId: EntityId,
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
