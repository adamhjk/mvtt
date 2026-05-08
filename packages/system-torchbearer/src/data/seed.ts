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

import type { SeedFn, World, Registry } from "@vtt/substrate";
import { runCatalogMerge, type CatalogTemplate } from "@vtt/items/shared";
import { seedCanonicalBookCatalog } from "@vtt/books/shared";
import { TB_ITEM_TEMPLATES } from "./tb-items.generated.js";
import { TB_CONFLICT_RESOURCE_TEMPLATES } from "./tb-conflict-resources.generated.js";
import { TB_SPELL_TEMPLATES } from "./tb-spells.generated.js";
import { TB_ARCANE_ITEM_TEMPLATES } from "./tb-arcane-items.generated.js";
import type { TbItemTemplate } from "./catalog-types.js";
import type { TbSpellTemplate } from "./spell-catalog-types.js";
import type { TbInvocationTemplate } from "./invocation-catalog-types.js";
import { TB_INVOCATION_TEMPLATES } from "./tb-invocations.generated.js";
import { GRIND_SENTINEL_ID, Grind } from "../shared/grind.js";
import {
  SpellCatalogIndex,
  SpellDerivedFrom,
  SpellIdentity,
  TbSpellCasting,
  TbSpellLearning,
} from "../shared/spells/spell-traits.js";
import {
  InvocationCatalogIndex,
  InvocationDerivedFrom,
  InvocationIdentity,
  TbInvocationPerforming,
} from "../shared/invocations/invocation-traits.js";
import { parseRelicSlotOptions } from "../shared/invocations/relic-slot-parse.js";

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
 * subtype trait (TbWeapon / TbArmor / TbSupply / TbContainer /
 * TbSpellBook / TbScroll) only when the template's `kind.type`
 * matches.
 *
 * `spellIdByTemplateId` resolves a scroll's `spellTemplateId` to its
 * spell entity id (so `TbScroll.spellId` can be a real EntityId).
 * Pass an empty map when seeding non-scroll items.
 */
export function templateToTraitBag(
  t: TbItemTemplate,
  spellIdByTemplateId: Readonly<Record<string, string>> = {},
): Record<string, unknown> {
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
    case "spellbook":
      bag.TbSpellBook = {
        folios: t.kind.folios,
        contents: [],
      };
      break;
    case "scroll": {
      const resolved = t.kind.spellTemplateId
        ? spellIdByTemplateId[t.kind.spellTemplateId] ?? null
        : null;
      bag.TbScroll = {
        spellId: resolved,
        consumed: false,
      };
      break;
    }
    case "gear":
    default:
      break;
  }
  return bag;
}

function templatesAsCatalog(
  spellIdByTemplateId: Readonly<Record<string, string>>,
  invocationIdByTemplateId: Readonly<Record<string, string>>,
): CatalogTemplate[] {
  return [
    ...TB_ITEM_TEMPLATES.map((t) => ({
      templateId: t.id,
      traits: templateToTraitBag(t, spellIdByTemplateId),
    })),
    ...TB_ARCANE_ITEM_TEMPLATES.map((t) => ({
      templateId: t.id,
      traits: templateToTraitBag(t, spellIdByTemplateId),
    })),
    // Conflict-specific abstract weapons + armor (Blackmail, Hostage,
    // True Name, Vestments, …). These ride the same items catalog
    // index so the merge engine handles re-seed / override tracking
    // identically. Each entity also carries `TbConflictResource` so
    // the disposition pickers can find them.
    ...TB_CONFLICT_RESOURCE_TEMPLATES,
    // Relic items — one per invocation. The slot options come from
    // the invocation's `relicSlot` annotation parsed at seed time, so
    // each relic can be equipped to its rules-correct location (e.g.
    // Bone Knitter's needles → head or pack). The
    // `TbInvocationRelicLink` back-reference lets the
    // `AcquireRelic` / `LoseRelic` flow find the catalog entity.
    ...buildRelicCatalogTemplates(invocationIdByTemplateId),
  ];
}

/**
 * Build one CatalogTemplate per invocation that has a relic. The
 * template id is `tb/relic/<invocation-suffix>` so it stays stable
 * across re-seed; the `TbInvocationRelicLink` trait points at the
 * already-spawned invocation entity (via the
 * `invocationIdByTemplateId` map populated by the prior invocation
 * catalog merge).
 *
 * Relics are ordinary items in every other respect — `ItemIdentity`
 * for the name, `TbItemSlotOptions` parsed from the rulebook
 * annotation, the standard `ItemEconomics` / `TbSkillBonuses` /
 * `TbItemSpecialRules` zero-values so the merge engine doesn't trip.
 */
function buildRelicCatalogTemplates(
  invocationIdByTemplateId: Readonly<Record<string, string>>,
): CatalogTemplate[] {
  const out: CatalogTemplate[] = [];
  for (const tmpl of TB_INVOCATION_TEMPLATES) {
    const invocationId = invocationIdByTemplateId[tmpl.id];
    if (!invocationId) continue; // skip if invocation merge hasn't run
    const relicName = tmpl.performing.relicName?.trim();
    if (!relicName) continue;
    const slotOptions = parseRelicSlotOptions(tmpl.performing.relicSlot ?? "");
    const relicTemplateId = `tb/relic/${tmpl.id.replace(
      /^tb\/invocation\//,
      "",
    )}`;
    out.push({
      templateId: relicTemplateId,
      traits: {
        ItemIdentity: {
          name: relicName,
          description: `Relic for ${tmpl.name} — performing with the relic shortens the ritual and lowers its Immortal burden cost.`,
          img: "",
        },
        ItemEconomics: {},
        TbItemSlotOptions: { options: slotOptions },
        TbSkillBonuses: { entries: [] },
        TbItemSpecialRules: { text: "" },
        TbInvocationRelicLink: { invocationId },
      },
    });
  }
  return out;
}

/**
 * Resolve a `sourceBook` abbreviation into the canonical-book id used
 * by `<BookCitation>`. Mirrors the abbreviation table above.
 */
function canonicalBookIdFor(book: "DH" | "LMM"): string {
  return book === "DH"
    ? "tb/book/dungeoneers-handbook"
    : "tb/book/loremasters-manual";
}

/**
 * Build the trait bag the spell catalog merge wants for one
 * TbSpellTemplate. Always emits SpellIdentity + TbSpellCasting +
 * TbSpellLearning; consumers that want richer data can layer on
 * additional traits (TbSpellHomebrewProse for homebrew, TbSpellMaterialsItem
 * for an inventory-resolved focus, etc.) in a later pass.
 */
function spellTemplateToTraitBag(t: TbSpellTemplate): Record<string, unknown> {
  return {
    SpellIdentity: {
      name: t.name,
      circle: t.circle,
      school: t.school,
      pageRef: { canonicalId: canonicalBookIdFor(t.sourceBook), page: t.sourcePage },
    },
    TbSpellCasting: { ...t.casting },
    TbSpellLearning: { ...t.learning },
  };
}

/**
 * TB-local catalog merge for spells. Mirrors `runCatalogMerge` in
 * `@vtt/items` but indexes through `SpellCatalogIndex` and stamps
 * `SpellDerivedFrom` instead of `ItemDerivedFrom`. Kept simple for v1
 * (no field-level override tracking — every re-seed overwrites every
 * trait); when GMs want to fork-and-edit a spell, the right tool is a
 * future `CustomizeSpell` command that allocates a new entity outside
 * the catalog index.
 */
function runSpellCatalogMerge(world: World, registry: Registry): void {
  const indexEntity = ensureSpellCatalogIndex(world);
  const indexValue = world.get(indexEntity, [SpellCatalogIndex]) as
    | {
        SpellCatalogIndex: {
          pluginName: string;
          entries: Record<string, string>;
        };
      }
    | undefined;
  const entries = { ...(indexValue?.SpellCatalogIndex.entries ?? {}) };
  void registry;

  const seenTemplateIds = new Set<string>();

  for (const tmpl of TB_SPELL_TEMPLATES) {
    seenTemplateIds.add(tmpl.id);
    const bag = spellTemplateToTraitBag(tmpl);
    const existing = entries[tmpl.id];
    if (existing && world.has(existing as never)) {
      // v1 simplicity: overwrite every trait. CustomizeSpell forks
      // outside the index, so re-seed never clobbers a forked entity.
      world.set(
        existing as never,
        SpellIdentity,
        bag.SpellIdentity as never,
      );
      world.set(
        existing as never,
        TbSpellCasting,
        bag.TbSpellCasting as never,
      );
      world.set(
        existing as never,
        TbSpellLearning,
        bag.TbSpellLearning as never,
      );
      const got = world.get(existing as never, [SpellDerivedFrom]) as
        | {
            SpellDerivedFrom: {
              templateId: string;
              pluginName: string;
              overrides: string[];
              deprecated?: boolean;
            };
          }
        | undefined;
      if (got?.SpellDerivedFrom.deprecated) {
        world.set(existing as never, SpellDerivedFrom, {
          templateId: tmpl.id,
          pluginName: PLUGIN_NAME,
          overrides: got.SpellDerivedFrom.overrides,
        });
      } else if (!got) {
        world.set(existing as never, SpellDerivedFrom, {
          templateId: tmpl.id,
          pluginName: PLUGIN_NAME,
          overrides: [],
        });
      }
    } else {
      const newId = world.spawn([
        SpellIdentity(bag.SpellIdentity as never),
        TbSpellCasting(bag.TbSpellCasting as never),
        TbSpellLearning(bag.TbSpellLearning as never),
        SpellDerivedFrom({
          templateId: tmpl.id,
          pluginName: PLUGIN_NAME,
          overrides: [],
        }),
      ]);
      entries[tmpl.id] = newId;
    }
  }

  for (const [templateId, spellId] of Object.entries(entries)) {
    if (seenTemplateIds.has(templateId)) continue;
    if (!world.has(spellId as never)) continue;
    const got = world.get(spellId as never, [SpellDerivedFrom]) as
      | {
          SpellDerivedFrom: {
            templateId: string;
            pluginName: string;
            overrides: string[];
            deprecated?: boolean;
          };
        }
      | undefined;
    if (!got || got.SpellDerivedFrom.deprecated) continue;
    world.set(spellId as never, SpellDerivedFrom, {
      ...got.SpellDerivedFrom,
      deprecated: true,
    });
  }

  world.set(indexEntity, SpellCatalogIndex, {
    pluginName: PLUGIN_NAME,
    entries,
  });
}

function readSpellTemplateMap(
  world: World,
): Readonly<Record<string, string>> {
  for (const row of world.query([SpellCatalogIndex])) {
    const v = row.values.SpellCatalogIndex as {
      pluginName: string;
      entries: Record<string, string>;
    };
    if (v.pluginName === PLUGIN_NAME) {
      return { ...v.entries };
    }
  }
  return {};
}

function ensureSpellCatalogIndex(world: World): string {
  for (const row of world.query([SpellCatalogIndex])) {
    const v = row.values.SpellCatalogIndex as { pluginName: string };
    if (v.pluginName === PLUGIN_NAME) return row.id;
  }
  return world.spawn([
    SpellCatalogIndex({ pluginName: PLUGIN_NAME, entries: {} }),
  ]);
}

/**
 * Build the trait bag the invocation catalog merge wants for one
 * TbInvocationTemplate. Always emits InvocationIdentity +
 * TbInvocationPerforming.
 */
function invocationTemplateToTraitBag(
  t: TbInvocationTemplate,
): Record<string, unknown> {
  return {
    InvocationIdentity: {
      name: t.name,
      circle: t.circle,
      traditions: t.traditions,
      pageRef: { canonicalId: canonicalBookIdFor(t.sourceBook), page: t.sourcePage },
    },
    TbInvocationPerforming: { ...t.performing },
  };
}

/**
 * TB-local catalog merge for invocations. Mirrors `runSpellCatalogMerge`
 * shape-for-shape; indexes through `InvocationCatalogIndex` and stamps
 * `InvocationDerivedFrom`.
 */
function runInvocationCatalogMerge(world: World, registry: Registry): void {
  const indexEntity = ensureInvocationCatalogIndex(world);
  const indexValue = world.get(indexEntity, [InvocationCatalogIndex]) as
    | {
        InvocationCatalogIndex: {
          pluginName: string;
          entries: Record<string, string>;
        };
      }
    | undefined;
  const entries = { ...(indexValue?.InvocationCatalogIndex.entries ?? {}) };
  void registry;

  const seenTemplateIds = new Set<string>();

  for (const tmpl of TB_INVOCATION_TEMPLATES) {
    seenTemplateIds.add(tmpl.id);
    const bag = invocationTemplateToTraitBag(tmpl);
    const existing = entries[tmpl.id];
    if (existing && world.has(existing as never)) {
      world.set(
        existing as never,
        InvocationIdentity,
        bag.InvocationIdentity as never,
      );
      world.set(
        existing as never,
        TbInvocationPerforming,
        bag.TbInvocationPerforming as never,
      );
      const got = world.get(existing as never, [InvocationDerivedFrom]) as
        | {
            InvocationDerivedFrom: {
              templateId: string;
              pluginName: string;
              overrides: string[];
              deprecated?: boolean;
            };
          }
        | undefined;
      if (got?.InvocationDerivedFrom.deprecated) {
        world.set(existing as never, InvocationDerivedFrom, {
          templateId: tmpl.id,
          pluginName: PLUGIN_NAME,
          overrides: got.InvocationDerivedFrom.overrides,
        });
      } else if (!got) {
        world.set(existing as never, InvocationDerivedFrom, {
          templateId: tmpl.id,
          pluginName: PLUGIN_NAME,
          overrides: [],
        });
      }
    } else {
      const newId = world.spawn([
        InvocationIdentity(bag.InvocationIdentity as never),
        TbInvocationPerforming(bag.TbInvocationPerforming as never),
        InvocationDerivedFrom({
          templateId: tmpl.id,
          pluginName: PLUGIN_NAME,
          overrides: [],
        }),
      ]);
      entries[tmpl.id] = newId;
    }
  }

  for (const [templateId, invocationId] of Object.entries(entries)) {
    if (seenTemplateIds.has(templateId)) continue;
    if (!world.has(invocationId as never)) continue;
    const got = world.get(invocationId as never, [InvocationDerivedFrom]) as
      | {
          InvocationDerivedFrom: {
            templateId: string;
            pluginName: string;
            overrides: string[];
            deprecated?: boolean;
          };
        }
      | undefined;
    if (!got || got.InvocationDerivedFrom.deprecated) continue;
    world.set(invocationId as never, InvocationDerivedFrom, {
      ...got.InvocationDerivedFrom,
      deprecated: true,
    });
  }

  world.set(indexEntity, InvocationCatalogIndex, {
    pluginName: PLUGIN_NAME,
    entries,
  });
}

function ensureInvocationCatalogIndex(world: World): string {
  for (const row of world.query([InvocationCatalogIndex])) {
    const v = row.values.InvocationCatalogIndex as { pluginName: string };
    if (v.pluginName === PLUGIN_NAME) return row.id;
  }
  return world.spawn([
    InvocationCatalogIndex({ pluginName: PLUGIN_NAME, entries: {} }),
  ]);
}

/**
 * Read the invocation catalog index back from the world after the
 * merge has run, returning the `templateId → invocationEntityId` map
 * needed to wire `TbInvocationRelicLink` traits onto the relic items.
 */
function readInvocationTemplateMap(
  world: World,
): Readonly<Record<string, string>> {
  for (const row of world.query([InvocationCatalogIndex])) {
    const v = row.values.InvocationCatalogIndex as {
      pluginName: string;
      entries: Record<string, string>;
    };
    if (v.pluginName === PLUGIN_NAME) {
      return { ...v.entries };
    }
  }
  return {};
}

/**
 * Seed hook for the TB plugin. Runs once per world after cold-boot
 * replay (see definePlugin.seed in substrate). Idempotent: the
 * merge engine spawns brand-new templates as fresh entities, runs
 * field-override merge against existing entities, and marks
 * deprecated entries for templates that have been withdrawn.
 *
 * Order matters: spells seed first because scroll item templates
 * resolve their `spellTemplateId` against the freshly populated
 * `SpellCatalogIndex` during item seeding. Invocations are
 * independent of items / spells and merge separately.
 */
export const tbItemsSeed: SeedFn = ({ world, registry }) => {
  runSpellCatalogMerge(world, registry);
  runInvocationCatalogMerge(world, registry);
  // After spell + invocation merges, read both indexes back so item-
  // side templates can resolve their cross-references to freshly-
  // seeded entity ids: scroll templates → spell entities, relic
  // templates → invocation entities.
  const spellIdByTemplateId = readSpellTemplateMap(world);
  const invocationIdByTemplateId = readInvocationTemplateMap(world);
  runCatalogMerge({
    world,
    registry,
    pluginName: PLUGIN_NAME,
    templates: templatesAsCatalog(
      spellIdByTemplateId,
      invocationIdByTemplateId,
    ),
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
export { TB_ITEM_TEMPLATES, TB_SPELL_TEMPLATES, TB_INVOCATION_TEMPLATES };
