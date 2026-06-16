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
import { ItemCatalogIndex, ItemDerivedFrom } from "./traits.js";
import { findTraitByShortName } from "./field-paths.js";

/**
 * A catalog template, expressed as a bundle of trait values. Used
 * by `runCatalogMerge` as the input to seeding/merging. The
 * `templateId` is opaque but must be stable across boots — the
 * merge engine uses it to find the existing entity in the catalog
 * index. The `traits` map is keyed by trait *short* name (so a
 * caller can hand in `{ ItemIdentity: {...}, TbWeapon: {...} }`
 * without repeating the plugin namespace).
 */
export interface CatalogTemplate {
  readonly templateId: string;
  readonly traits: Readonly<Record<string, unknown>>;
}

/**
 * Run the catalog seed + merge cycle for a plugin.
 *
 *  1. Find or spawn the plugin's catalog index sentinel entity.
 *  2. For each template in `templates`:
 *      - Not in the index → spawn a fresh entity with the template
 *        traits + `ItemDerivedFrom { overrides: [] }`, register it.
 *      - In the index → for each trait the template specifies,
 *        for each top-level field on the trait, only update if the
 *        full path "Trait.field" is NOT in the entity's overrides.
 *        Update `ItemDerivedFrom.deprecated` to false in case the
 *        template was previously withdrawn and is back.
 *  3. For each entry in the index whose templateId is gone from
 *     `templates` → mark the entity's ItemDerivedFrom.deprecated.
 *     Don't delete it — someone may still be holding it.
 *
 * The granularity of override tracking is "trait + first-level
 * field" by default — anything deeper is treated as one unit. Game
 * systems that need finer-grained merge for nested structures (e.g.
 * weapon conflictBonuses) can extend overrides with deeper paths;
 * this engine just checks `path === "Trait.field"` membership.
 */
export function runCatalogMerge(args: {
  world: World;
  registry: Registry;
  pluginName: string;
  templates: ReadonlyArray<CatalogTemplate>;
}): void {
  const { world, registry, pluginName, templates } = args;
  const indexEntity = ensureCatalogIndex(world, pluginName);
  const indexValue = world.get(indexEntity, [ItemCatalogIndex]) as
    | { ItemCatalogIndex: { pluginName: string; entries: Record<string, string> } }
    | undefined;
  const entries = { ...(indexValue?.ItemCatalogIndex.entries ?? {}) };

  const seenTemplateIds = new Set<string>();

  for (const tmpl of templates) {
    seenTemplateIds.add(tmpl.templateId);
    const existing = entries[tmpl.templateId];
    if (existing && world.has(existing as never)) {
      mergeTemplateInto({
        world,
        registry,
        itemId: existing,
        templateId: tmpl.templateId,
        pluginName,
        traits: tmpl.traits,
      });
    } else {
      const itemId = spawnTemplateEntity({
        world,
        registry,
        templateId: tmpl.templateId,
        pluginName,
        traits: tmpl.traits,
      });
      entries[tmpl.templateId] = itemId;
    }
  }

  // Mark any indexed entity whose template has been withdrawn.
  for (const [templateId, itemId] of Object.entries(entries)) {
    if (seenTemplateIds.has(templateId)) continue;
    if (!world.has(itemId as never)) continue;
    const got = world.get(itemId as never, [ItemDerivedFrom]) as
      | {
          ItemDerivedFrom: {
            templateId: string;
            pluginName: string;
            overrides: string[];
            deprecated?: boolean;
          };
        }
      | undefined;
    if (!got) continue;
    if (got.ItemDerivedFrom.deprecated) continue;
    world.set(itemId as never, ItemDerivedFrom, {
      ...got.ItemDerivedFrom,
      deprecated: true,
    });
  }

  // If anything new was added (or restored), refresh the index.
  world.set(indexEntity, ItemCatalogIndex, {
    pluginName,
    entries,
  });
}

function ensureCatalogIndex(world: World, pluginName: string): string {
  for (const row of world.query([ItemCatalogIndex])) {
    const v = row.values.ItemCatalogIndex as { pluginName: string };
    if (v.pluginName === pluginName) return row.id;
  }
  return world.spawn([ItemCatalogIndex({ pluginName, entries: {} })]);
}

function spawnTemplateEntity(args: {
  world: World;
  registry: Registry;
  templateId: string;
  pluginName: string;
  traits: Readonly<Record<string, unknown>>;
}): string {
  const { world, registry, templateId, pluginName, traits } = args;
  const traitFactories: Array<{ name: import("@vtt/substrate").TraitName; value: unknown }> = [];
  for (const [shortName, value] of Object.entries(traits)) {
    const def = findTraitByShortName(registry, shortName);
    if (!def) {
      throw new Error(
        `catalog template ${templateId}: unknown trait ${shortName} (plugin ${pluginName})`,
      );
    }
    traitFactories.push({ name: def.name, value: def.schema.parse(value) });
  }
  traitFactories.push(
    ItemDerivedFrom({
      templateId,
      pluginName,
      overrides: [],
    }),
  );
  return world.spawn(traitFactories);
}

function mergeTemplateInto(args: {
  world: World;
  registry: Registry;
  itemId: string;
  templateId: string;
  pluginName: string;
  traits: Readonly<Record<string, unknown>>;
}): void {
  const { world, registry, itemId, templateId, pluginName, traits } = args;
  const derivedGet = world.get(itemId as never, [ItemDerivedFrom]) as
    | {
        ItemDerivedFrom: {
          templateId: string;
          pluginName: string;
          overrides: string[];
          deprecated?: boolean;
        };
      }
    | undefined;
  const overrides = new Set(derivedGet?.ItemDerivedFrom.overrides ?? []);

  for (const [shortName, templateValue] of Object.entries(traits)) {
    const def = findTraitByShortName(registry, shortName);
    if (!def) {
      throw new Error(
        `catalog template ${templateId}: unknown trait ${shortName} during merge (plugin ${pluginName})`,
      );
    }
    const parsedTemplate = def.schema.parse(templateValue) as Record<string, unknown>;
    const currentGet = world.get(itemId as never, [def]);
    if (!currentGet) {
      // Trait is on the template but missing from the entity — adopt
      // the whole thing (no overrides to honour because nothing was
      // there).
      world.set(itemId as never, def, parsedTemplate);
      continue;
    }
    const current = (currentGet as Record<string, unknown>)[shortName] as Record<string, unknown>;
    const merged = mergeOneTrait({
      shortName,
      current,
      template: parsedTemplate,
      overrides,
      registry,
      def,
    });
    world.set(itemId as never, def, merged);
  }

  world.set(itemId as never, ItemDerivedFrom, {
    templateId,
    pluginName,
    overrides: [...overrides],
    deprecated: false,
  });
}

function mergeOneTrait(args: {
  shortName: string;
  current: Record<string, unknown>;
  template: Record<string, unknown>;
  overrides: Set<string>;
  registry: Registry;
  def: TraitMeta;
}): unknown {
  const { shortName, current, template, overrides } = args;
  if (current === null || typeof current !== "object" || Array.isArray(current)) {
    // Whole-trait scalar/array: treat as one path.
    return overrides.has(shortName) ? current : template;
  }
  const out: Record<string, unknown> = { ...current };
  const keys = new Set([...Object.keys(template), ...Object.keys(current)]);
  for (const key of keys) {
    const path = `${shortName}.${key}`;
    if (overrides.has(path)) continue;
    if (key in template) {
      out[key] = (template as Record<string, unknown>)[key];
    }
    // If the template no longer has the key, leave the entity's
    // current value alone — schema migrations are out of scope here.
  }
  return out;
}
