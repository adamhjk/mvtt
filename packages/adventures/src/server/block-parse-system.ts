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

import { defineSystem, type EntityId, type World } from "@vtt/substrate";
import { PageBodySet, BelongsToNote } from "@vtt/notes/shared";
import * as YAML from "js-yaml";
import {
  buildBlockKindIndex,
  type BlockKindIndex,
  type AnyBlockKindDef,
} from "../shared/block-kinds.js";
import { scanFencedBlocks } from "../shared/parse-blocks.js";
import { prepareYaml, restoreWikiLinks } from "../shared/yaml-wikilinks.js";
import {
  BLOCK_ENTITY_INDEX_ID,
  BlockEntityIndex,
  PageBlocks,
  Tombstoned,
} from "../shared/traits.js";
import { PageBlocksParsed } from "../shared/events.js";

/**
 * Compose a deterministic entity id for a block. Both server and every
 * client side compute the same id from `(pageId, blockKey)` — no
 * world.allocateId coordination needed because the id derivation is
 * pure. The `block:` prefix makes block-materialised entities visually
 * distinct from substrate-allocated ones.
 *
 * See `design/adventures.md` § "Materialization model" — the doc
 * suggests allocateId, but deterministic ids are equivalent for
 * idempotency and avoid the universal-mirror id-prediction trap.
 */
export function blockEntityId(pageId: EntityId, blockKey: string): EntityId {
  return `block:${pageId}:${blockKey}` as EntityId;
}

function indexKey(noteId: EntityId, blockKey: string): string {
  return `${noteId}::${blockKey}`;
}

function ensureBlockEntityIndex(world: World): void {
  if (!world.has(BLOCK_ENTITY_INDEX_ID)) {
    world.spawnAt(BLOCK_ENTITY_INDEX_ID, [
      BlockEntityIndex({ entries: {} }),
    ]);
  }
}

function readBlockEntityIndex(world: World): Record<
  string,
  {
    noteId: EntityId;
    blockKey: string;
    kind: string;
    entityId: EntityId;
  }
> {
  ensureBlockEntityIndex(world);
  const v = world.get(BLOCK_ENTITY_INDEX_ID, [BlockEntityIndex]) as
    | {
        BlockEntityIndex: {
          entries: Record<
            string,
            {
              noteId: EntityId;
              blockKey: string;
              kind: string;
              entityId: EntityId;
            }
          >;
        };
      }
    | undefined;
  return { ...(v?.BlockEntityIndex.entries ?? {}) };
}

function writeBlockEntityIndex(
  world: World,
  entries: Record<
    string,
    {
      noteId: EntityId;
      blockKey: string;
      kind: string;
      entityId: EntityId;
    }
  >,
): void {
  world.set(BLOCK_ENTITY_INDEX_ID, BlockEntityIndex, { entries });
}

interface ParseError {
  readonly kind: string;
  readonly blockKey: string;
  readonly message: string;
}

/**
 * Parse one fenced block: YAML → schema-validated object → projected
 * traits. Returns null on parse/validation failure (logged via the
 * caller's error sink so the editor can surface diagnostics later).
 */
function projectBlock(
  kindDef: AnyBlockKindDef,
  body: string,
  info: string,
  blockKey: string,
  world: World,
):
  | {
      ok: true;
      traits: ReadonlyArray<{ trait: import("@vtt/substrate").TraitMeta; value: unknown }>;
      spawnIfMissing: ReadonlyArray<{ trait: import("@vtt/substrate").TraitMeta; value: unknown }>;
    }
  | { ok: false; message: string } {
  // Preprocess wiki-links to safe sentinels so YAML's flow syntax
  // doesn't eat `[[ … ]]` as nested arrays. After parsing, we walk
  // the parsed tree and restore each sentinel to its original source
  // text so the kind's schema sees real wiki-link strings — no
  // quoting required by the author.
  const { body: safeBody, table } = prepareYaml(body);
  let yaml: unknown;
  try {
    yaml = YAML.load(safeBody);
  } catch (err) {
    return { ok: false, message: `YAML parse error: ${(err as Error).message}` };
  }
  const restored = restoreWikiLinks(yaml, table);
  const parsed = kindDef.schema.safeParse(restored ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      message: first
        ? `${first.path.join(".") || "(root)"}: ${first.message}`
        : "schema validation failed",
    };
  }
  try {
    const projection = kindDef.project(parsed.data, { world, info, blockKey });
    return {
      ok: true,
      traits: projection.traits,
      spawnIfMissing: projection.spawnIfMissing ?? [],
    };
  } catch (err) {
    return { ok: false, message: `projection failed: ${(err as Error).message}` };
  }
}

/**
 * Universal-mirror system that turns a `PageBodySet` event into block-
 * entity upserts and tombstones, plus a `PageBlocksParsed` event for
 * downstream UI mirrors.
 *
 * Idempotent and deterministic: the entity ids are derived purely from
 * `(pageId, blockKey)`, so server and every client compute the same
 * ids without coordination. Trait writes that don't change the trait
 * value are deduplicated by `world.set`'s deep-equality check, so
 * re-saving an unchanged note is a true no-op end-to-end.
 *
 * Errors (YAML, schema, projection) are logged but never crash the
 * system. The block stays unmaterialised until the next save fixes it
 * — matching the behaviour CLAUDE.md mandates: "systems must not crash
 * the server".
 */
export const BlockParseSystem = defineSystem({
  name: "BlockParse",
  on: PageBodySet,
  reads: [],
  writes: [BlockEntityIndex, Tombstoned],
  run: ({ event, world, registry }) => {
    if (!registry) return [];
    const kindIndex = buildBlockKindIndex(registry);
    return runBlockParse(world, event.pageId as EntityId, event.body, kindIndex);
  },
});

/**
 * The actual parse pass — extracted so tests can drive it without
 * round-tripping through the system runner. Returns the events the
 * system would emit.
 *
 * Steps:
 *   1. Scan the body for fenced blocks of recognized kinds.
 *   2. Project each block (YAML → schema → traits).
 *   3. Diff against the previous index to detect new/updated/removed.
 *   4. For each new/updated: spawnAt(deterministicId, traits) or set traits.
 *   5. For each removed: write Tombstoned trait.
 *   6. Update the index sentinel.
 *   7. Return [PageBlocksParsed].
 */
export function runBlockParse(
  world: World,
  pageId: EntityId,
  body: string,
  kindIndex: BlockKindIndex,
): import("@vtt/substrate").EventInstance[] {
  // Resolve the page's owning note id; the index keys on (noteId, blockKey)
  // because a single note may span pages but the GM mostly thinks at
  // page granularity. We key on pageId for now; the noteId is recorded
  // for cross-reference / debugging only.
  const belongs = world.get(pageId, [BelongsToNote]) as
    | { BelongsToNote: { noteId: EntityId } }
    | undefined;
  const noteId = (belongs?.BelongsToNote.noteId ?? pageId) as EntityId;

  const recognizedKinds = new Set<string>(kindIndex.byName.keys());
  const blocks = scanFencedBlocks(body, recognizedKinds);

  const indexEntries = readBlockEntityIndex(world);
  const seenKeys = new Set<string>();
  const errors: ParseError[] = [];

  for (const block of blocks) {
    const ik = indexKey(pageId, block.blockKey);
    seenKeys.add(ik);
    const kindDef = kindIndex.byName.get(block.kind);
    if (!kindDef) continue;
    const proj = projectBlock(
      kindDef,
      block.body,
      block.info,
      block.blockKey,
      world,
    );
    if (!proj.ok) {
      errors.push({ kind: block.kind, blockKey: block.blockKey, message: proj.message });
      continue;
    }
    const eid = blockEntityId(pageId, block.blockKey);
    const existing = indexEntries[ik];
    if (existing && world.has(existing.entityId)) {
      // Re-set authored traits only. spawnIfMissing is left alone so
      // accumulated runtime state survives.
      for (const t of proj.traits) {
        world.set(existing.entityId, t.trait, t.value);
      }
      // Clear tombstone if previously tombstoned (block came back).
      const tombstone = world.get(existing.entityId, [Tombstoned]);
      if (tombstone) world.remove(existing.entityId, Tombstoned);
    } else if (world.has(eid)) {
      // Entity exists at the deterministic id but the index entry was
      // missing — recover by re-indexing and re-setting traits.
      for (const t of proj.traits) world.set(eid, t.trait, t.value);
      indexEntries[ik] = {
        noteId,
        blockKey: block.blockKey,
        kind: block.kind,
        entityId: eid,
      };
    } else {
      // First time seeing this (noteId, blockKey) — spawn at the
      // deterministic id, write spawnIfMissing + authored traits.
      const initial: Array<{
        name: import("@vtt/substrate").TraitName;
        value: unknown;
      }> = [];
      for (const t of proj.spawnIfMissing) {
        initial.push({ name: t.trait.name, value: t.value });
      }
      for (const t of proj.traits) {
        initial.push({ name: t.trait.name, value: t.value });
      }
      world.spawnAt(eid, initial);
      indexEntries[ik] = {
        noteId,
        blockKey: block.blockKey,
        kind: block.kind,
        entityId: eid,
      };
    }
  }

  // Tombstone every (page, blockKey) that disappeared from this body
  // but is still in the index.
  for (const [ik, entry] of Object.entries(indexEntries)) {
    if (seenKeys.has(ik)) continue;
    // Only tombstone entries belonging to THIS page; entries on other
    // pages of the same note are someone else's problem.
    const [entryPageId] = ik.split("::") as [EntityId, string];
    if (entryPageId !== pageId) continue;
    if (!world.has(entry.entityId)) continue;
    const already = world.get(entry.entityId, [Tombstoned]);
    if (already) continue;
    world.set(entry.entityId, Tombstoned, {
      reason: "block-removed",
      since: Date.now(),
      source: { noteId: entry.noteId, blockKey: entry.blockKey },
    });
  }

  writeBlockEntityIndex(world, indexEntries);

  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[adventures] BlockParseSystem: ${errors.length} block(s) failed to materialize on page ${pageId}:`,
      errors.map((e) => `${e.kind}#${e.blockKey}: ${e.message}`).join("; "),
    );
  }

  return [
    PageBlocksParsed({
      pageId,
      blocks: blocks.map((b) => ({
        kind: b.kind,
        info: b.info,
        blockKey: b.blockKey,
        rangeStart: b.rangeStart,
        rangeEnd: b.rangeEnd,
      })),
    }),
  ];
}

/**
 * Mirror system: write the parsed block list to the page entity's
 * `PageBlocks` trait so renderers and the autocomplete provider can
 * query without re-parsing the body.
 */
export const PageBlocksMirrorSystem = defineSystem({
  name: "PageBlocksMirror",
  on: PageBlocksParsed,
  reads: [],
  writes: [PageBlocks],
  run: ({ event, world }) => {
    world.set(event.pageId as EntityId, PageBlocks, {
      blocks: event.blocks.map((b) => ({ ...b })),
    });
    return [];
  },
});
