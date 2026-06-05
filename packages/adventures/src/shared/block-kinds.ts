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

import {
  defineSlot,
  type EntityId,
  type Registry,
  type TraitMeta,
  type World,
  z,
} from "@vtt/substrate";

/**
 * What a parsed block becomes when projected into the world: a bag of
 * trait writes.
 *
 * - `traits` are written on every save — they're the *authored* fields
 *   the GM types into the YAML and that should reflect the latest text.
 * - `spawnIfMissing` are written ONCE, only on first creation. Use this
 *   for runtime defaults (full HP, no conditions, empty inventory)
 *   that the entity then accumulates state into; subsequent saves of
 *   the block leave them alone.
 *
 * See `design/adventures.md` § "The block-kind registry".
 */
export interface EntityProjection {
  readonly traits: ReadonlyArray<{ trait: TraitMeta; value: unknown }>;
  readonly spawnIfMissing?: ReadonlyArray<{ trait: TraitMeta; value: unknown }>;
}

/**
 * One context object passed to every kind callback. Lets a kind read
 * the world (e.g. resolve wiki-links to their entity ids) and the
 * registry (slot fills, other kinds).
 *
 * `info` carries the fence's info-string — typically the block's
 * canonical name (e.g. "Greta the Smith"). `blockKey` is the
 * slugified form used for entity ids. Both are optional because the
 * autocomplete provider invokes the same callbacks at edit time
 * before the fence info exists.
 */
export interface BlockKindContext {
  readonly world: World;
  readonly registry?: Registry;
  readonly info?: string;
  readonly blockKey?: string;
}

/**
 * What a single button on the rendered widget contributes. The
 * renderer's job is to lay out the buttons; the kind's `actions` list
 * decides which buttons exist and what they do.
 */
export interface BlockAction {
  readonly id: string;
  readonly label: string;
  /**
   * Should this action be visible to a given user? Default: visible to
   * everyone. Set to "gm" to hide from non-GM viewers (e.g. encounter's
   * `Start encounter` button).
   */
  readonly visibility?: "everyone" | "gm";
  /**
   * Run when the button is clicked. Receives the entity id, the world,
   * an optional command-dispatch hook, and the active session. The
   * dispatch hook is `unknown`-typed because the action lives in the
   * shared layer; cast at the call site to the command shape.
   */
  readonly run: (ctx: {
    entityId: EntityId;
    world: World;
    dispatch?: (cmd: unknown) => unknown;
    session?: { role: "gm" | "player" } | null;
  }) => Promise<void> | void;
}

/**
 * A block kind's behaviour. Every system plugin that wants to author
 * its content via fenced markdown blocks ships one of these per kind
 * and registers via `BlockKindsSlot`.
 *
 * The schema is doing most of the work — it's the source for parsing,
 * validation, *and* autocomplete. A kind def is intentionally small.
 *
 * See `design/adventures.md` § "The block-kind registry" and
 * § "Autocomplete".
 */
export interface BlockKindDef<Parsed = unknown> {
  /** Fence info string, e.g. "npc", "monster", "item", "encounter". */
  readonly name: string;
  /**
   * Optional human-readable one-liner shown in the fenced-info-string
   * autocomplete popover.
   */
  readonly description?: string;
  /**
   * Zod schema for the block body (parsed from YAML). Drives parsing,
   * inline validation, and autocomplete. Brand wiki-link slots with
   * `wikiLink(kind)` and dice slots with `dice()` (see `./brands.js`).
   */
  readonly schema: z.ZodTypeAny;
  /**
   * Project a parsed block to the trait writes its entity should
   * carry. Authored fields go in `traits`; runtime defaults that
   * should only land on first creation go in `spawnIfMissing`.
   */
  readonly project: (parsed: Parsed, ctx: BlockKindContext) => EntityProjection;
  /**
   * Display string for the entity (used by chip rendering and the
   * orphan list).
   */
  readonly display?: (entityId: EntityId, world: World) => string;
  /**
   * Optional empty-fence snippet — `${1:placeholder}`-style CodeMirror
   * snippet expanded when the GM types the kind into an empty fence.
   */
  readonly snippet?: () => string;
  /**
   * Action buttons surfaced in the rendered widget. Permission-gated
   * by `visibility`.
   */
  readonly actions?: ReadonlyArray<BlockAction>;
  /**
   * Optional escape hatch for autocomplete suggestions the schema
   * can't express (runtime-registered skills, world-derived enums, …).
   */
  readonly complete?: (
    path: ReadonlyArray<string>,
    ctx: BlockKindContext,
  ) => ReadonlyArray<{ value: string; detail?: string }>;
}

/** Existential storage — kinds in the registry are heterogeneous. */
export type AnyBlockKindDef = BlockKindDef<unknown>;

/**
 * Plugin-side helper. Identity function with type inference; mirrors
 * `defineLinkKind`, `defineCommand`, `defineEvent`.
 */
export function defineBlockKind<Parsed>(
  def: BlockKindDef<Parsed>,
): BlockKindDef<Parsed> {
  return def;
}

/**
 * Plugins fill this slot with `BlockKindDef` contributions. The
 * adventures plugin's parse system reads
 * `registry.fills.get(BlockKindsSlot.name)` to find the schema +
 * projection for each fence info string it encounters.
 *
 * Schema is permissive on functions — same shape as `LinkKindsSlot`.
 * The runtime trusts that fills are `BlockKindDef`-shaped.
 */
export const BlockKindsSlot = defineSlot({
  name: "@vtt/adventures/block-kinds",
  schema: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    schema: z.any(),
    project: z.any(),
    display: z.any().optional(),
    snippet: z.any().optional(),
    actions: z.any().optional(),
    complete: z.any().optional(),
  }),
  description:
    "Plugins contribute a BlockKindDef per fence info-string they want to author from notes. The adventures parse system reads the slot to materialize block entities.",
});

/**
 * Build the live block-kind registry from the substrate's `Registry`.
 * The parse system calls this once per parse pass to look up kinds
 * by their info string.
 */
export interface BlockKindIndex {
  readonly all: ReadonlyArray<AnyBlockKindDef>;
  readonly byName: ReadonlyMap<string, AnyBlockKindDef>;
}

export function buildBlockKindIndex(registry: Registry): BlockKindIndex {
  const fills = registry.fills.get(BlockKindsSlot.name) ?? [];
  const all: AnyBlockKindDef[] = fills as AnyBlockKindDef[];
  const byName = new Map<string, AnyBlockKindDef>();
  for (const k of all) byName.set(k.name, k);
  return { all, byName };
}

/**
 * Build a block-kind index directly from a list of plugin definitions,
 * without standing up a `Registry` / `World`. Reads each plugin's
 * static `fills[BlockKindsSlot.name]` contribution — the same array the
 * Registry would surface after `validate()`. Intended for offline tools
 * (the bundle CLI) that want a game system's block schemas to validate
 * authored content but don't need a live world.
 *
 * Later plugins win on name collisions, matching registry load order.
 */
export function buildBlockKindIndexFromPlugins(
  plugins: ReadonlyArray<{ fills: Readonly<Record<string, ReadonlyArray<unknown>>> }>,
): BlockKindIndex {
  const all: AnyBlockKindDef[] = [];
  for (const p of plugins) {
    const fills = p.fills[BlockKindsSlot.name] ?? [];
    for (const k of fills) all.push(k as AnyBlockKindDef);
  }
  const byName = new Map<string, AnyBlockKindDef>();
  for (const k of all) byName.set(k.name, k);
  return { all, byName };
}
