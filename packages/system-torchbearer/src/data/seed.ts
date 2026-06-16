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
import { runCatalogMerge, type CatalogTemplate, ItemCatalogIndex } from "@vtt/items/shared";
import { seedCanonicalBookCatalog } from "@vtt/books/shared";
import { Active, Character, Team } from "@vtt/characters/shared";
import { gmOnly, Permissions } from "@vtt/permissions/shared";
import { TB_ITEM_TEMPLATES } from "./tb-items.generated.js";
import { TB_CONFLICT_RESOURCE_TEMPLATES } from "./tb-conflict-resources.generated.js";
import { TB_SPELL_TEMPLATES } from "./tb-spells.generated.js";
import { TB_ARCANE_ITEM_TEMPLATES } from "./tb-arcane-items.generated.js";
import { TB_MONSTER_TEMPLATES } from "./tb-monsters.generated.js";
import { TB_NPC_TEMPLATES } from "./tb-npcs.generated.js";
import type { TbItemTemplate } from "./catalog-types.js";
import type { TbSpellTemplate } from "./spell-catalog-types.js";
import type { TbInvocationTemplate } from "./invocation-catalog-types.js";
import type { TbMonsterTemplate } from "./monster-catalog-types.js";
import type { TbNpcTemplate } from "./npc-catalog-types.js";
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
import {
  MonsterCatalogIndex,
  MonsterTemplate,
  TbMonster,
  TbMonsterDerivedFrom,
  TbMonsterSpecialRules,
  TbMonsterWeapons,
} from "../shared/monster-traits.js";
import { NpcCatalogIndex, NpcTemplate, TbNpc, TbNpcDerivedFrom } from "../shared/npc-traits.js";
import {
  Conditions,
  Heroic,
  Identity,
  Pools,
  RawAbilities,
  Skills,
  TownAbilities,
  WhatYouFightFor,
  Wises,
  CharacterTraits,
} from "../shared/traits.js";
import { TbCarries, TbContainer } from "../shared/items/item-traits.js";
import { ALL_SKILLS, isKnownSkillId } from "../shared/skills.js";

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
  {
    id: "tb/book/cartographers-compendium",
    name: "Torchbearer 2e: Cartographer's Compendium",
  },
] as const;

/** Map of `sourceBook` abbreviation -> canonicalId for citation rendering. */
export const TB_CANONICAL_BOOK_BY_ABBREVIATION = {
  SG: "tb/book/scholars-guide",
  LMM: "tb/book/loremasters-manual",
  DH: "tb/book/dungeoneers-handbook",
  CC: "tb/book/cartographers-compendium",
} as const;

/**
 * Reverse lookup: canonicalId → short abbreviation. Returns the
 * abbreviation (`"SG"`, `"LMM"`, `"DH"`, `"CC"`) for a known TB
 * canonicalId, or null for any other id (foreign plugins, future
 * books). The monster sheet uses this to render labels like "LMM p.261".
 */
export function tbCanonicalBookAbbreviation(
  canonicalId: string,
): "SG" | "LMM" | "DH" | "CC" | null {
  for (const [abbrev, id] of Object.entries(TB_CANONICAL_BOOK_BY_ABBREVIATION)) {
    if (id === canonicalId) return abbrev as "SG" | "LMM" | "DH" | "CC";
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
  if (t.liquid) {
    bag.TbLiquidVessel = {
      contents: t.liquid.defaultContents,
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
        ? (spellIdByTemplateId[t.kind.spellTemplateId] ?? null)
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
    const relicTemplateId = `tb/relic/${tmpl.id.replace(/^tb\/invocation\//, "")}`;
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
  return book === "DH" ? "tb/book/dungeoneers-handbook" : "tb/book/loremasters-manual";
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
      world.set(existing as never, SpellIdentity, bag.SpellIdentity as never);
      world.set(existing as never, TbSpellCasting, bag.TbSpellCasting as never);
      world.set(existing as never, TbSpellLearning, bag.TbSpellLearning as never);
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

function readSpellTemplateMap(world: World): Readonly<Record<string, string>> {
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
  return world.spawn([SpellCatalogIndex({ pluginName: PLUGIN_NAME, entries: {} })]);
}

/**
 * Build the trait bag the invocation catalog merge wants for one
 * TbInvocationTemplate. Always emits InvocationIdentity +
 * TbInvocationPerforming.
 */
function invocationTemplateToTraitBag(t: TbInvocationTemplate): Record<string, unknown> {
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
      world.set(existing as never, InvocationIdentity, bag.InvocationIdentity as never);
      world.set(existing as never, TbInvocationPerforming, bag.TbInvocationPerforming as never);
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
  return world.spawn([InvocationCatalogIndex({ pluginName: PLUGIN_NAME, entries: {} })]);
}

/**
 * Read the invocation catalog index back from the world after the
 * merge has run, returning the `templateId → invocationEntityId` map
 * needed to wire `TbInvocationRelicLink` traits onto the relic items.
 */
function readInvocationTemplateMap(world: World): Readonly<Record<string, string>> {
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
 * Resolve a TB items-catalog templateId to its world entity id by
 * walking `ItemCatalogIndex` sentinels. Returns null when the catalog
 * hasn't been seeded yet OR the template is missing — callers proceed
 * without that gear entry rather than failing the seed.
 *
 * Used by monster + NPC catalog merges to wire armor/gear references
 * after the items catalog has finished seeding.
 */
function resolveCatalogItemId(world: World, itemTemplateId: string): string | null {
  for (const row of world.query([ItemCatalogIndex])) {
    const v = row.values.ItemCatalogIndex as {
      pluginName: string;
      entries: Record<string, string>;
    };
    if (v.pluginName !== PLUGIN_NAME) continue;
    const eid = v.entries[itemTemplateId];
    if (eid && world.has(eid as never)) return eid;
  }
  return null;
}

function ensureMonsterCatalogIndex(world: World): string {
  for (const row of world.query([MonsterCatalogIndex])) {
    const v = row.values.MonsterCatalogIndex as { pluginName: string };
    if (v.pluginName === PLUGIN_NAME) return row.id;
  }
  return world.spawn([MonsterCatalogIndex({ pluginName: PLUGIN_NAME, entries: {} })]);
}

function ensureNpcCatalogIndex(world: World): string {
  for (const row of world.query([NpcCatalogIndex])) {
    const v = row.values.NpcCatalogIndex as { pluginName: string };
    if (v.pluginName === PLUGIN_NAME) return row.id;
  }
  return world.spawn([NpcCatalogIndex({ pluginName: PLUGIN_NAME, entries: {} })]);
}

/**
 * Build the trait bag for one monster template — the same shape the
 * MonsterSpawningSystem writes when spawning an instance, minus the
 * per-instance weapon items (templates carry weapon DATA in
 * TbMonsterWeapons; per-instance forks spawn the per-weapon item
 * entities). Templates also carry the `MonsterTemplate` marker.
 *
 * `armorItemId` is resolved from the items catalog at seed time. When
 * the items catalog hasn't seeded yet (shouldn't happen — items merge
 * runs first) or the template is missing, the armor reference is
 * dropped and the template ships without an equipped-armor entry.
 */
function buildMonsterTemplateTraits(
  tmpl: TbMonsterTemplate,
  armorItemId: string | null,
): Array<{ name: import("@vtt/substrate").TraitName; value: unknown }> {
  const traits: Array<{ name: import("@vtt/substrate").TraitName; value: unknown }> = [
    Character({ name: tmpl.name }),
    Permissions({ read: gmOnly(), write: gmOnly() }),
    Team({ kind: "enemy" }),
    RawAbilities({
      will: { rating: 0, advancement: { pass: 0, fail: 0 } },
      health: { rating: 0, advancement: { pass: 0, fail: 0 } },
      nature: {
        rating: tmpl.nature.rating,
        maximum: tmpl.nature.rating,
        advancement: { pass: 0, fail: 0 },
        descriptors: [...tmpl.nature.descriptors],
      },
    }),
    TownAbilities({
      resources: { rating: 0, advancement: { pass: 0, fail: 0 } },
      circles: { rating: 0, advancement: { pass: 0, fail: 0 } },
      precedence: tmpl.precedence,
      might: tmpl.might,
    }),
    Conditions({
      fresh: false,
      hungryThirsty: false,
      angry: false,
      afraid: false,
      exhausted: false,
      injured: false,
      sick: false,
      dead: false,
    }),
    Heroic({ abilities: [], townAbilities: [], skills: [] }),
    TbMonster({
      type: tmpl.type,
      instinct: "",
      armorDescription: "",
      dispositions: tmpl.dispositions.map((d) => ({ ...d })),
      pageRef: { canonicalId: tmpl.pageRef.canonicalId, page: tmpl.pageRef.page },
    }),
    TbMonsterWeapons({
      entries: tmpl.weapons.map((w) => ({
        name: w.name,
        conflicts: [...w.conflicts],
        bonuses: {
          attack: { ...w.bonuses.attack },
          defend: { ...w.bonuses.defend },
          feint: { ...w.bonuses.feint },
          maneuver: { ...w.bonuses.maneuver },
        },
      })),
    }),
    TbMonsterSpecialRules({
      entries: tmpl.specialRules.map((r) => ({
        name: r.name,
        text: "",
        pageRef: { canonicalId: r.pageRef.canonicalId, page: r.pageRef.page },
      })),
    }),
    TbMonsterDerivedFrom({
      templateId: tmpl.id,
      overrides: [],
    }),
    MonsterTemplate({}),
  ];
  if (armorItemId) {
    traits.push(
      TbCarries({
        entries: [
          {
            slot: "torso",
            slotIndex: 0,
            channel: "default" as const,
            slotsConsumed: 1,
            itemId: armorItemId,
            quantity: 1,
          },
        ],
      }),
    );
  }
  return traits;
}

/**
 * Build the trait bag for one NPC template. Mirrors NpcSpawningSystem
 * but writes traits directly (no command pipeline) and stamps the
 * `NpcTemplate` marker. Gear references resolve through the items
 * catalog index; missing gear is silently dropped (the GM can equip
 * later via the inventory UI).
 */
function buildNpcTemplateTraits(
  tmpl: TbNpcTemplate,
  resolvedGear: Array<{ itemId: string; slot: string }>,
): Array<{ name: import("@vtt/substrate").TraitName; value: unknown }> {
  const skillsRecord: Record<
    string,
    {
      rating: number;
      advancement: { pass: number; fail: number };
      taxed: boolean;
      learningTests: number;
    }
  > = {};
  for (const s of ALL_SKILLS) {
    skillsRecord[s.id] = {
      rating: 0,
      advancement: { pass: 0, fail: 0 },
      taxed: false,
      learningTests: 0,
    };
  }
  for (const seedEntry of tmpl.skills) {
    if (!isKnownSkillId(seedEntry.skillId)) continue;
    const e = skillsRecord[seedEntry.skillId];
    if (!e) continue;
    e.rating = seedEntry.rating;
  }
  const traits: Array<{ name: import("@vtt/substrate").TraitName; value: unknown }> = [
    Character({ name: tmpl.name }),
    Identity({
      name: tmpl.name,
      stock: "",
      class: "",
      level: 1,
      age: 20,
      home: "",
      raiment: "",
      parents: "",
      mentor: "",
      friend: "",
      enemy: "",
    }),
    Permissions({ read: gmOnly(), write: gmOnly() }),
    Team({ kind: "enemy" }),
    RawAbilities({
      will: { rating: tmpl.will, advancement: { pass: 0, fail: 0 } },
      health: { rating: tmpl.health, advancement: { pass: 0, fail: 0 } },
      nature: {
        rating: tmpl.nature.rating,
        maximum: tmpl.nature.rating,
        advancement: { pass: 0, fail: 0 },
        descriptors: [...tmpl.nature.descriptors],
      },
    }),
    TownAbilities({
      resources: { rating: tmpl.resources, advancement: { pass: 0, fail: 0 } },
      circles: { rating: tmpl.circles, advancement: { pass: 0, fail: 0 } },
      precedence: tmpl.precedence,
      might: tmpl.might,
    }),
    Conditions({
      fresh: false,
      hungryThirsty: false,
      angry: false,
      afraid: false,
      exhausted: false,
      injured: false,
      sick: false,
      dead: false,
    }),
    Heroic({ abilities: [], townAbilities: [], skills: [] }),
    Pools({
      fate: { current: 0, totalSpent: 0 },
      persona: { current: 0, totalSpent: 0 },
    }),
    WhatYouFightFor({ belief: "", creed: "", goal: "", instinct: "" }),
    Skills({ entries: skillsRecord }),
    Wises({
      entries: tmpl.wises.map((name) => ({
        name,
        pass: false,
        fail: false,
        fate: false,
        persona: false,
      })),
    }),
    CharacterTraits({
      entries: tmpl.traits.map((t) => ({
        name: t.name,
        level: t.level,
        beneficialUses: 0,
        checks: 0,
        usedAgainst: false,
      })),
    }),
    TbNpc({
      role: tmpl.role,
      description: "",
      pageRef: { canonicalId: tmpl.pageRef.canonicalId, page: tmpl.pageRef.page },
    }),
    TbNpcDerivedFrom({
      templateId: tmpl.id,
      overrides: [],
    }),
    NpcTemplate({}),
  ];
  if (resolvedGear.length > 0) {
    traits.push(
      TbCarries({
        entries: resolvedGear.map((g) => ({
          slot: g.slot,
          slotIndex: 0,
          channel: (g.slot === "handR" || g.slot === "handL" ? "carried" : "default") as
            | "default"
            | "carried",
          slotsConsumed: 1,
          itemId: g.itemId,
          quantity: 1,
        })),
      }),
    );
  }
  return traits;
}

/**
 * Catalog merge for monsters. Mirrors `runSpellCatalogMerge` shape-for-
 * shape: index sentinel maps `templateId → entityId`, existing entries
 * get re-set (last-write-wins on the canonical fields), missing
 * entries get fresh entities, withdrawn entries flip
 * `TbMonsterDerivedFrom.deprecated`.
 *
 * v1 simplicity: every re-seed overwrites every authored field.
 * Per-field GM overrides will land alongside the items merge engine
 * when monsters get a customize-and-edit story.
 */
function runMonsterCatalogMerge(world: World, _registry: Registry): void {
  const indexEntity = ensureMonsterCatalogIndex(world);
  const indexValue = world.get(indexEntity, [MonsterCatalogIndex]) as
    | {
        MonsterCatalogIndex: {
          pluginName: string;
          entries: Record<string, string>;
        };
      }
    | undefined;
  const entries = { ...(indexValue?.MonsterCatalogIndex.entries ?? {}) };
  const seenTemplateIds = new Set<string>();

  for (const tmpl of TB_MONSTER_TEMPLATES) {
    seenTemplateIds.add(tmpl.id);
    const armorItemId = tmpl.armorItemTemplateId
      ? resolveCatalogItemId(world, tmpl.armorItemTemplateId)
      : null;
    const traitFactories = buildMonsterTemplateTraits(tmpl, armorItemId);
    const existing = entries[tmpl.id];
    if (existing && world.has(existing as never)) {
      for (const t of traitFactories) {
        const traitDef = traitDefForName(t.name);
        if (traitDef) world.set(existing as never, traitDef, t.value);
      }
      const gotDerived = world.get(existing as never, [TbMonsterDerivedFrom]) as
        | { TbMonsterDerivedFrom: { deprecated?: boolean } }
        | undefined;
      if (gotDerived?.TbMonsterDerivedFrom.deprecated) {
        world.set(existing as never, TbMonsterDerivedFrom, {
          templateId: tmpl.id,
          overrides: [],
        });
      }
    } else {
      // First-spawn-only: seed catalog templates as inactive so
      // wiki-link targets / quantifiable encounter references exist
      // without flooding the conflict pickers or helper rosters. The
      // GM flips a template active when bringing it into play; we do
      // NOT re-set Active during the re-merge loop above, so user
      // flips survive subsequent reseeds.
      const newId = world.spawn([
        ...traitFactories,
        { name: Active.name, value: { active: false } },
      ]);
      entries[tmpl.id] = newId;
    }
  }

  for (const [templateId, monsterId] of Object.entries(entries)) {
    if (seenTemplateIds.has(templateId)) continue;
    if (!world.has(monsterId as never)) continue;
    const got = world.get(monsterId as never, [TbMonsterDerivedFrom]) as
      | { TbMonsterDerivedFrom: { templateId: string; overrides: string[]; deprecated?: boolean } }
      | undefined;
    if (!got || got.TbMonsterDerivedFrom.deprecated) continue;
    world.set(monsterId as never, TbMonsterDerivedFrom, {
      ...got.TbMonsterDerivedFrom,
      deprecated: true,
    });
  }

  world.set(indexEntity, MonsterCatalogIndex, {
    pluginName: PLUGIN_NAME,
    entries,
  });
}

function runNpcCatalogMerge(world: World, _registry: Registry): void {
  const indexEntity = ensureNpcCatalogIndex(world);
  const indexValue = world.get(indexEntity, [NpcCatalogIndex]) as
    | {
        NpcCatalogIndex: {
          pluginName: string;
          entries: Record<string, string>;
        };
      }
    | undefined;
  const entries = { ...(indexValue?.NpcCatalogIndex.entries ?? {}) };
  const seenTemplateIds = new Set<string>();

  for (const tmpl of TB_NPC_TEMPLATES) {
    seenTemplateIds.add(tmpl.id);
    const resolvedGear: Array<{ itemId: string; slot: string }> = [];
    for (const g of tmpl.gear) {
      const itemId = resolveCatalogItemId(world, g.itemTemplateId);
      if (itemId) resolvedGear.push({ itemId, slot: g.slot });
    }
    const traitFactories = buildNpcTemplateTraits(tmpl, resolvedGear);
    const existing = entries[tmpl.id];
    if (existing && world.has(existing as never)) {
      for (const t of traitFactories) {
        const traitDef = traitDefForName(t.name);
        if (traitDef) world.set(existing as never, traitDef, t.value);
      }
      const gotDerived = world.get(existing as never, [TbNpcDerivedFrom]) as
        | { TbNpcDerivedFrom: { deprecated?: boolean } }
        | undefined;
      if (gotDerived?.TbNpcDerivedFrom.deprecated) {
        world.set(existing as never, TbNpcDerivedFrom, {
          templateId: tmpl.id,
          overrides: [],
        });
      }
    } else {
      // First-spawn-only: seed NPC templates inactive (same rationale
      // as monsters). GM flips active on bringing one into play.
      const newId = world.spawn([
        ...traitFactories,
        { name: Active.name, value: { active: false } },
      ]);
      entries[tmpl.id] = newId;
    }
  }

  for (const [templateId, npcId] of Object.entries(entries)) {
    if (seenTemplateIds.has(templateId)) continue;
    if (!world.has(npcId as never)) continue;
    const got = world.get(npcId as never, [TbNpcDerivedFrom]) as
      | { TbNpcDerivedFrom: { templateId: string; overrides: string[]; deprecated?: boolean } }
      | undefined;
    if (!got || got.TbNpcDerivedFrom.deprecated) continue;
    world.set(npcId as never, TbNpcDerivedFrom, {
      ...got.TbNpcDerivedFrom,
      deprecated: true,
    });
  }

  world.set(indexEntity, NpcCatalogIndex, {
    pluginName: PLUGIN_NAME,
    entries,
  });
}

/**
 * Resolve a trait factory's name to its TraitMeta. The trait factories
 * we build above carry the trait's brand name (`@vtt/.../X`) on the
 * `name` field; the trait merge needs the actual `defineTrait`-returned
 * meta to call `world.set`. This map is fixed for the seed's purposes.
 */
function traitDefForName(name: import("@vtt/substrate").TraitName) {
  // Rather than build a full registry-style map, return the meta
  // we know we wrote in build*TemplateTraits. Order doesn't matter;
  // the lookup is O(1) on a small table.
  switch (name) {
    case Character.name:
      return Character;
    case Identity.name:
      return Identity;
    case Permissions.name:
      return Permissions;
    case Team.name:
      return Team;
    case RawAbilities.name:
      return RawAbilities;
    case TownAbilities.name:
      return TownAbilities;
    case Conditions.name:
      return Conditions;
    case Heroic.name:
      return Heroic;
    case Pools.name:
      return Pools;
    case WhatYouFightFor.name:
      return WhatYouFightFor;
    case Skills.name:
      return Skills;
    case Wises.name:
      return Wises;
    case CharacterTraits.name:
      return CharacterTraits;
    case TbCarries.name:
      return TbCarries;
    case TbMonster.name:
      return TbMonster;
    case TbMonsterWeapons.name:
      return TbMonsterWeapons;
    case TbMonsterSpecialRules.name:
      return TbMonsterSpecialRules;
    case TbMonsterDerivedFrom.name:
      return TbMonsterDerivedFrom;
    case MonsterTemplate.name:
      return MonsterTemplate;
    case TbNpc.name:
      return TbNpc;
    case TbNpcDerivedFrom.name:
      return TbNpcDerivedFrom;
    case NpcTemplate.name:
      return NpcTemplate;
    default:
      return null;
  }
}

/**
 * Strip the legacy `TbContainer` trait from items that have since
 * been re-classified as liquid vessels (bottle, jug, waterskin,
 * wooden-canteen, clay-pot, horn-of-drenge). Earlier seeds emitted
 * `TbContainer { containerSlots: 0 }` for these — inert container
 * data the inventory UI never used. The new shape is `ItemBundle`
 * (draught count) + `TbLiquidVessel` (contents); `TbContainer` is
 * stale and confuses the inventory views that key off "do I have
 * a container?" predicates.
 *
 * The merge engine adds NEW traits but never removes ones the
 * template no longer carries (a deliberately conservative default
 * — silently dropping data is dangerous). We do the removal here
 * after `runCatalogMerge` so existing worlds converge to the new
 * shape on next boot.
 *
 * Limited to the specific catalog ids we changed so the pass is a
 * scalpel, not a sledgehammer: future TbContainer-on-vessel items
 * (like the Barrel/Cask/Tun storage containers, which still carry
 * inventory slots dry) keep their TbContainer untouched.
 */
const LIQUID_VESSEL_TEMPLATE_IDS = new Set<string>([
  "tb/containers/bottle-a1b2c3",
  "tb/containers/jug-a1b2c3",
  "tb/containers/waterskin-a1b2c3",
  "tb/containers/wooden-canteen-a1b2c3",
  "tb/containers/clay-pot-a1b2c3",
  "tb/magic-items/horn-of-drenge-cc0000",
]);

function stripStaleContainerTraitsOnLiquidVessels(world: World): void {
  for (const row of world.query([ItemCatalogIndex])) {
    const idx = row.values.ItemCatalogIndex as {
      pluginName: string;
      entries: Record<string, string>;
    };
    if (idx.pluginName !== PLUGIN_NAME) continue;
    for (const [templateId, itemId] of Object.entries(idx.entries)) {
      if (!LIQUID_VESSEL_TEMPLATE_IDS.has(templateId)) continue;
      if (!world.has(itemId as never)) continue;
      const got = world.get(itemId as never, [TbContainer]);
      if (got) {
        world.remove(itemId as never, TbContainer);
      }
    }
  }
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
 * `SpellCatalogIndex` during item seeding. Items seed before
 * monsters/NPCs so their gear/armor cross-references resolve to live
 * entity ids.
 */
export const tbSeed: SeedFn = ({ world, registry }) => {
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
    templates: templatesAsCatalog(spellIdByTemplateId, invocationIdByTemplateId),
  });
  stripStaleContainerTraitsOnLiquidVessels(world);
  // Monsters + NPCs come AFTER items because their templates reference
  // armor/gear by template id; we need the items catalog index in place
  // before monsters/NPCs can resolve those references to live entity ids.
  runMonsterCatalogMerge(world, registry);
  runNpcCatalogMerge(world, registry);
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
