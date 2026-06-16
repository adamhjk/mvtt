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

import type { Registry, TraitMeta, World } from "@vtt/substrate";

/**
 * A field-path identifies a (trait, sub-path) inside an entity. The
 * trait part is the trait's *short name* — the segment after the
 * final "/" in its plugin-namespaced full name. So `ItemIdentity` not
 * `@vtt/items/ItemIdentity`. The sub-path uses dot notation;
 * "ItemIdentity.name" / "TbWeapon.conflictBonuses.attack.value" /
 * "ItemEconomics.value.dice".
 *
 * Short names are used because field-paths travel inside trait
 * values — the whole point is to identify a slot inside one trait
 * without having to repeat the namespace every time. The registry
 * is consulted to resolve short → full when reading or writing.
 */
export interface FieldPath {
  readonly traitShort: string;
  readonly subPath: ReadonlyArray<string>;
}

/**
 * Split a "TraitShort.path.into.value" string into a structured
 * FieldPath. Leaves the empty-subpath case as `[]` (i.e. the path
 * "ItemIdentity" alone refers to the entire trait value).
 */
export function splitFieldPath(path: string): FieldPath {
  const segs = path.split(".");
  const [traitShort, ...rest] = segs;
  if (!traitShort) throw new Error(`empty field path: ${JSON.stringify(path)}`);
  return { traitShort, subPath: rest };
}

/**
 * Resolve a trait short-name against the active registry. Returns
 * the matching TraitMeta, or null if no trait short-name matches
 * (which is a programmer error in the caller — but the system
 * receiver should refuse rather than throw).
 */
export function findTraitByShortName(registry: Registry, shortName: string): TraitMeta | null {
  for (const t of registry.traits.values()) {
    const tShort = t.name.split("/").pop();
    if (tShort === shortName) return t;
  }
  return null;
}

/**
 * Apply an EditItemField-style change to an entity: read the trait,
 * deep-set the sub-path to `value`, write back through `world.set`.
 * Returns the new value (so the caller can confirm the schema
 * accepted it). Throws if the trait isn't on the entity, the
 * sub-path doesn't exist, or the resulting trait fails schema
 * validation in `world.set`.
 *
 * Deep-set semantics: pure functional — every object/array on the
 * path is shallow-cloned. Arrays use numeric indices ("foo.0.bar").
 */
export function applyEditedField(args: {
  world: World;
  registry: Registry;
  itemId: string;
  path: string;
  value: unknown;
}): { trait: TraitMeta; newValue: unknown } {
  const { world, registry, itemId, path, value } = args;
  const fp = splitFieldPath(path);
  const trait = findTraitByShortName(registry, fp.traitShort);
  if (!trait) {
    throw new Error(`unknown trait short-name: ${fp.traitShort}`);
  }
  const got = world.get(itemId, [trait]);
  if (!got) {
    throw new Error(`item ${itemId} has no ${fp.traitShort} trait`);
  }
  const current = (got as Record<string, unknown>)[fp.traitShort];
  const next = deepSet(current, fp.subPath, value);
  // world.set runs the trait's schema parse, which acts as our
  // validation barrier — bad shape throws here.
  world.set(itemId as never, trait, next);
  return { trait, newValue: next };
}

function deepSet(src: unknown, subPath: ReadonlyArray<string>, value: unknown): unknown {
  if (subPath.length === 0) return value;
  const [head, ...rest] = subPath as [string, ...string[]];
  if (Array.isArray(src)) {
    const idx = Number.parseInt(head, 10);
    if (!Number.isFinite(idx) || idx < 0) {
      throw new Error(`array index expected, got ${head}`);
    }
    const out = src.slice();
    out[idx] = deepSet(out[idx], rest, value);
    return out;
  }
  if (src !== null && typeof src === "object") {
    const obj = src as Record<string, unknown>;
    return { ...obj, [head]: deepSet(obj[head], rest, value) };
  }
  // Setting a leaf inside an absent parent — fabricate the parent.
  return { [head]: deepSet(undefined, rest, value) };
}

/**
 * Copy every shareable trait from `sourceId` onto `destId`. Used by
 * the fork mirror system to materialise a CustomizeItem result on
 * every side. Honours the substrate's `share: false` flag — those
 * traits are skipped, since their contents are identity-bound to
 * the source entity (e.g., per-tab sentinel ids).
 *
 * Returns the list of trait-short-names that were copied — useful
 * for tests asserting "the fork has every TB-specific subtype the
 * source had."
 */
export function copyShareableTraits(args: {
  world: World;
  registry: Registry;
  sourceId: string;
  destId: string;
}): string[] {
  const { world, registry, sourceId, destId } = args;
  const traits = world.traitsOn(sourceId as never);
  const copied: string[] = [];
  for (const [traitFullName, value] of traits) {
    const def = registry.traits.get(traitFullName);
    if (!def) continue;
    if (def.share === false) continue;
    world.set(destId as never, def, value);
    copied.push(traitFullName.split("/").pop() ?? traitFullName);
  }
  return copied;
}
