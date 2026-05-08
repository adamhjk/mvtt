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

import type { SeedFn } from "@vtt/substrate";
import { runCatalogMerge, type CatalogTemplate } from "@vtt/items/shared";
import { seedCanonicalBookCatalog } from "@vtt/books/shared";
import { TB_ITEM_TEMPLATES } from "./tb-items.generated.js";
import { TB_CONFLICT_RESOURCE_TEMPLATES } from "./tb-conflict-resources.generated.js";
import type { TbItemTemplate } from "./catalog-types.js";
import { GRIND_SENTINEL_ID, Grind } from "../shared/grind.js";

const PLUGIN_NAME = "@vtt/system-torchbearer";

/**
 * Plugin-namespaced ids for the canonical TB2 books. Plugin content
 * (monster stat blocks, spell entries, item cards) cites these ids +
 * a printed page; the GM binds each id to one of their uploaded Book
 * entities from the Config tab dropdown.
 *
 * Stable across worlds — surviving different GMs uploading the same
 * rulebook with different filenames. Plugins must never copy rulebook
 * prose into data files; deep-link instead via `<BookCitation>`.
 */
export const TB_CANONICAL_BOOKS = [
  { id: "tb/book/scholars-guide", name: "Torchbearer 2e: Scholar's Guide" },
  { id: "tb/book/loremasters-manual", name: "Torchbearer 2e: Loremaster's Manual" },
  { id: "tb/book/dungeoneers-handbook", name: "Torchbearer 2e: Dungeoneer's Handbook" },
] as const;

/** Map of `sourceBook` abbreviation -> canonicalId for citation rendering. */
export const TB_CANONICAL_BOOK_BY_ABBREVIATION = {
  SG: "tb/book/scholars-guide",
  LMM: "tb/book/loremasters-manual",
  DH: "tb/book/dungeoneers-handbook",
} as const;

/**
 * Reverse lookup: canonicalId → short abbreviation. Returns the
 * abbreviation (`"SG"`, `"LMM"`, `"DH"`) for a known TB canonicalId,
 * or null for any other id (foreign plugins, future books). The
 * monster sheet uses this to render labels like "LMM p.261".
 */
export function tbCanonicalBookAbbreviation(
  canonicalId: string,
): "SG" | "LMM" | "DH" | null {
  for (const [abbrev, id] of Object.entries(TB_CANONICAL_BOOK_BY_ABBREVIATION)) {
    if (id === canonicalId) return abbrev as "SG" | "LMM" | "DH";
  }
  return null;
}

/**
 * Build the per-template trait bag the merge engine expects, given
 * one TbItemTemplate. Always emits ItemIdentity + ItemEconomics +
 * TbItemSlotOptions + TbSkillBonuses + TbItemSpecialRules; emits a
 * subtype trait (TbWeapon / TbArmor / TbSupply / TbContainer) only
 * when the template's `kind.type` matches.
 */
export function templateToTraitBag(t: TbItemTemplate): Record<string, unknown> {
  const bag: Record<string, unknown> = {
    ItemIdentity: {
      name: t.name,
      description: t.description,
      img: t.img,
    },
    ItemEconomics: {
      ...(t.cost !== undefined ? { cost: t.cost } : {}),
      ...(t.value ? { value: t.value } : {}),
    },
    TbItemSlotOptions: {
      options: t.slotOptions,
    },
    TbSkillBonuses: {
      entries: t.skillBonuses.map((sb) => ({
        skill: sb.skill,
        value: sb.value,
        condition: sb.condition,
      })),
    },
    TbItemSpecialRules: {
      text: t.specialRules,
    },
  };
  if (t.bundle) {
    bag.ItemBundle = {
      count: t.bundle.count,
      capacity: t.bundle.capacity,
    };
  }
  switch (t.kind.type) {
    case "armor":
      bag.TbArmor = { armorType: t.kind.armorType, absorbs: t.kind.absorbs };
      break;
    case "weapon":
      bag.TbWeapon = {
        wield: t.kind.wield,
        conflictBonuses: t.kind.conflictBonuses,
      };
      break;
    case "supply":
      bag.TbSupply = {
        supplyType: t.kind.supplyType,
        turnsRemaining: t.kind.turnsRemaining,
        lit: t.kind.lit,
        nameSingular: t.kind.nameSingular,
      };
      break;
    case "container":
      bag.TbContainer = {
        containerType: t.kind.containerType,
        containerSlots: t.kind.containerSlots,
      };
      break;
    case "gear":
    default:
      break;
  }
  return bag;
}

function templatesAsCatalog(): CatalogTemplate[] {
  return [
    ...TB_ITEM_TEMPLATES.map((t) => ({
      templateId: t.id,
      traits: templateToTraitBag(t),
    })),
    // Conflict-specific abstract weapons + armor (Blackmail, Hostage,
    // True Name, Vestments, …). These ride the same items catalog
    // index so the merge engine handles re-seed / override tracking
    // identically. Each entity also carries `TbConflictResource` so
    // the disposition pickers can find them.
    ...TB_CONFLICT_RESOURCE_TEMPLATES,
  ];
}

/**
 * Seed hook for the TB plugin. Runs once per world after cold-boot
 * replay (see definePlugin.seed in substrate). Idempotent: the
 * merge engine spawns brand-new templates as fresh entities, runs
 * field-override merge against existing entities, and marks
 * deprecated entries for templates that have been withdrawn.
 *
 * Only validates schema-clean templates from `TB_ITEM_TEMPLATES`.
 * Items the GM has forked via CustomizeItem (allocated outside the
 * catalog index) are not touched.
 */
export const tbItemsSeed: SeedFn = ({ world, registry }) => {
  runCatalogMerge({
    world,
    registry,
    pluginName: PLUGIN_NAME,
    templates: templatesAsCatalog(),
  });
  // Register the canonical TB2 book ids the plugin's content cites.
  // The Config-tab dropdown reads from this sentinel; binding a Book
  // entity to one of these ids makes its <BookCitation> deep-links
  // light up.
  seedCanonicalBookCatalog(
    world,
    PLUGIN_NAME,
    TB_CANONICAL_BOOKS.map((b) => ({ id: b.id, name: b.name })),
  );
  // Spawn the Grind sentinel — one per world, deterministic id so
  // every side converges. Idempotent: skip if already there.
  if (!world.has(GRIND_SENTINEL_ID)) {
    world.spawnAt(GRIND_SENTINEL_ID, [Grind({ turn: 0, extreme: false })]);
  }
};

/** Re-exported for tests that want the raw list. */
export { TB_ITEM_TEMPLATES };
