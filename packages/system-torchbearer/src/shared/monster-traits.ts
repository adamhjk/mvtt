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
import { ConflictTypeEnum } from "../conflict/shared/conflict-types.js";

/**
 * The action-bonus shape from the printed monster table — one column
 * per ConflictAction. Mirrors `TbWeapon.conflictBonuses` so the monster
 * weapons UI can reuse the same display + the conflict subsystem can
 * fold them in identically when a monster picks a weapon.
 *
 * "type" is which kind of bonus the value applies as — dice (+1D),
 * rerolls, or successes (+1s) — exactly like real-weapon bonuses.
 */
const MonstrousActionBonus = z.object({
  type: z.enum(["dice", "rerolls", "success"]).default("dice"),
  value: z.number().int().default(0),
});

const MonstrousActionBonuses = z
  .object({
    attack: MonstrousActionBonus,
    defend: MonstrousActionBonus,
    feint: MonstrousActionBonus,
    maneuver: MonstrousActionBonus,
  })
  .default({
    attack: { type: "dice", value: 0 },
    defend: { type: "dice", value: 0 },
    feint: { type: "dice", value: 0 },
    maneuver: { type: "dice", value: 0 },
  });

/**
 * Reference into a canonical TB2 rulebook (`canonicalId` + printed
 * `page`). Drives `<BookCitation>` rendering on the monster sheet —
 * for canon monsters the GM clicks through to the actual rulebook
 * page rather than reading prose copied into plugin data.
 */
const BookPageRef = z.object({
  canonicalId: z.string().min(1).max(120),
  page: z.number().int().min(1).max(2000),
});

/**
 * TbMonster — the monster-specific stat block (SG p.171-177). Sits
 * alongside the universal `Character` (name) and TB's `RawAbilities`
 * (Nature) / `TownAbilities` (Might + Precedence) so existing rolling
 * machinery — NatureCheck, condition modifiers, the Identity slot —
 * keeps working without a parallel monster code path.
 *
 * `dispositions` carries the predetermined per-conflict-type HP from
 * the book. Monsters list exactly three; `Other Conflict Hit Points`
 * is computed at conflict-declare time per SG p.172 (Within Nature ⇒
 * roll Nature; Outside Nature ⇒ roll half) and is NOT stored here.
 *
 * Two co-existing surfaces describe the monster's "Always X" instinct
 * and worn armor:
 *   - `pageRef` (header), `instinct`, `armorDescription` are
 *     editable free-text the GM can fill in for *homebrew* monsters
 *     where there's no rulebook to deep-link.
 *   - `pageRef` deep-links the printed stat block for *canon* monsters.
 *     The sheet renders a `<BookCitation>` next to each prose section
 *     so the GM can click through to the rulebook PDF — but the
 *     prose fields stay editable in case the GM wants to add a
 *     custom note alongside the citation.
 *
 * The actual equipped armor item, if any, lives on `TbCarries` so
 * disarmable / breakable / shield-of-choice mechanics work identically
 * to PC armor.
 *
 * Presence of this trait is the load-bearing marker for "this entity
 * is a monster": the monsters page provider lists by `[Character,
 * TbMonster]`, the characters page hides anyone carrying this trait
 * via `CharacterListExclusionSlot`, and the monster sheet renders.
 */
export const TbMonster = defineTrait({
  name: "@vtt/system-torchbearer/TbMonster",
  schema: z.object({
    /**
     * Free-text monstrous type — "undead", "troll", "spirit", "beast",
     * "dragon", "ooze", "automaton", "folk". Used for spell targeting
     * (per SG p.172 "Type is used when targeting monsters with magical
     * effects"). Free-text rather than enum so homebrew monsters work.
     */
    type: z.string().min(1).max(40).default("beast"),
    /**
     * One-line "always X" instinct (SG p.174). Free-text so homebrew
     * monsters can describe their own instinct; for canon monsters it
     * defaults to empty and the sheet shows the rulebook citation.
     */
    instinct: z.string().max(280).default(""),
    /**
     * Free-text armor description ("Chain or plate armor (in combat as
     * appropriate)"). For canon monsters the prose stays in the
     * rulebook (deep-linked via `pageRef`); homebrew monsters use
     * this field to describe their own armor. The actual equipped
     * armor (chain mail, plate, etc.) lives in TbCarries so it can
     * be disarmed / damaged / shared with other systems.
     */
    armorDescription: z.string().max(240).default(""),
    /**
     * Predetermined hit points by conflict type (SG p.172 "Disposition
     * Breakdown"). Up to three entries — kill/capture/drive-off, kill/
     * convince/pursue, etc. Other conflict types are rolled at
     * conflict-declare time using Nature.
     */
    dispositions: z
      .array(
        z.object({
          conflictType: ConflictTypeEnum,
          value: z.number().int().min(0).max(60).default(1),
        }),
      )
      .max(8)
      .default([]),
    /**
     * Canonical-book deep-link to the printed stat block, or null for
     * homebrew monsters with no rulebook reference. When set, the
     * sheet renders a `<BookCitation>` next to the header / instinct
     * / armor lines.
     */
    pageRef: BookPageRef.nullable().default(null),
  }),
});

/**
 * TbMonsterWeapons — the per-monster weapon table from the stat block
 * (SG p.173 "Monstrous Weapons"). Each entry binds the weapon to one
 * or more conflict types and supplies the action-column bonuses
 * exactly as printed.
 *
 * Monstrous weapons are intrinsic to the monster; they do NOT live in
 * the items catalog because they're typically unique (Hideous Bite,
 * Cloak of Shadow). When a monster wields a *real* weapon (sword,
 * polearm), it goes on the monster's `TbCarries` like any equipped
 * item AND the monster's stat block typically grants the per-conflict
 * override bonuses via this trait — the printed Bugbear "Polearm" row
 * is an *override* of the catalog's polearm stats.
 *
 * Two weapons may share a name across stat blocks but represent
 * distinct game objects — the monster table is the authority for its
 * monster's printed bonuses.
 */
export const TbMonsterWeapons = defineTrait({
  name: "@vtt/system-torchbearer/TbMonsterWeapons",
  schema: z.object({
    entries: z
      .array(
        z.object({
          name: z.string().min(1).max(60),
          /**
           * Conflict types this weapon is usable in. Empty = unusable
           * (rare; the printed table never has this).
           */
          conflicts: z.array(ConflictTypeEnum).max(8).default([]),
          bonuses: MonstrousActionBonuses,
        }),
      )
      .max(20)
      .default([]),
  }),
});

/**
 * TbMonsterSpecialRules — the named "Special Rules" section under the
 * stat block (SG p.174 "Special rules describe characteristics unique
 * to a particular monster. Follow the rules listed with each creature,
 * even if it breaks another rule or subverts a standard procedure of
 * the game.").
 *
 * Free-text body so any rule fits, however idiosyncratic. The runtime
 * doesn't parse this — the GM reads it at the table. Future systems
 * may grow structured "auto-apply" hooks (e.g. spell immunity registries)
 * but those will live alongside this trait, not replace it.
 */
export const TbMonsterSpecialRules = defineTrait({
  name: "@vtt/system-torchbearer/TbMonsterSpecialRules",
  schema: z.object({
    entries: z
      .array(
        z.object({
          name: z.string().min(1).max(80),
          /**
           * Free-text rule body. Empty for canon monsters seeded from
           * the catalog (the sheet renders a `<BookCitation>` against
           * `pageRef` instead of reproducing the rulebook prose).
           * Homebrew monsters — and GMs who want to add a custom
           * note alongside a canon rule — fill this in directly.
           */
          text: z.string().max(2000).default(""),
          /**
           * Canonical-book deep-link for this rule, or null. The sheet
           * renders a `<BookCitation>` next to the rule name when set.
           */
          pageRef: BookPageRef.nullable().default(null),
        }),
      )
      .max(20)
      .default([]),
  }),
});

/**
 * TbMonsterDerivedFrom — origin tracking for monsters spawned from
 * the catalog. Lets a future re-import push upstream rule fixes onto
 * existing instances while honouring local GM edits via `overrides`.
 * Mirrors the items system's `ItemDerivedFrom` exactly so the same
 * mental model carries over.
 */
export const TbMonsterDerivedFrom = defineTrait({
  name: "@vtt/system-torchbearer/TbMonsterDerivedFrom",
  schema: z.object({
    templateId: z.string().min(1).max(240),
    overrides: z.array(z.string().min(1).max(120)).default([]),
    deprecated: z.boolean().optional(),
  }),
});

/**
 * MonsterTemplate — empty marker on entities seeded from
 * `TB_MONSTER_TEMPLATES`. Templates are real entities so wiki-links can
 * resolve to stable ids, the monsters page can browse them, and the
 * `encounter` block can reference them with `4× [[character:goblin
 * scout]]` quantification. Per-instance copies (the goblins spawned
 * into a live conflict) carry `MonsterCopy` instead, never this trait.
 *
 * See `design/adventures.md` § "NPC/PC/template/copy distinction".
 */
export const MonsterTemplate = defineTrait({
  name: "@vtt/system-torchbearer/MonsterTemplate",
  schema: z.object({}),
});

/**
 * MonsterCopy — marker on entities spawned as a per-encounter copy of
 * a `MonsterTemplate`. Carries the template id so the renderer can show
 * "Goblin Scout #2" labels and so a future "rebase mob copies" admin
 * action can find them. Templates and copies are otherwise structurally
 * identical (both `Character` + the same TB stat-block traits); the
 * marker is what keeps the monsters list, the mob-merge engine, and the
 * cleanup-on-conflict-end flow honest.
 */
export const MonsterCopy = defineTrait({
  name: "@vtt/system-torchbearer/MonsterCopy",
  schema: z.object({
    templateId: z.string().min(1).max(240),
    ordinal: z.number().int().min(1).max(999),
  }),
});

/**
 * MonsterCatalogIndex — sentinel mapping `templateId → entityId` for
 * every seeded monster template. Mirrors `ItemCatalogIndex` /
 * `SpellCatalogIndex`. The seed step uses this to make re-seed
 * idempotent: existing entries get their traits merged in place; new
 * templates get fresh entities; templates withdrawn from the catalog
 * get `TbMonsterDerivedFrom.deprecated = true`.
 */
export const MonsterCatalogIndex = defineTrait({
  name: "@vtt/system-torchbearer/MonsterCatalogIndex",
  schema: z.object({
    pluginName: z.string().min(1).max(120),
    entries: z.record(z.string(), z.string()).default({}),
  }),
});

/**
 * TbConflictResource — marks an item entity as an abstract weapon or
 * armor whose only meaning is in conflict resolution (e.g. Blackmail,
 * Hostage, Maps, Caltrops, True Name, Vestments — DH p.234-239,
 * LMM p.107-111). These items aren't physical things the character
 * carries in inventory; they're situational resources usable in the
 * relevant conflict types.
 *
 * `applicableConflicts` records which conflict types the entry is
 * "designed for" per the printed table. Informational only — the
 * weapon picker shows every such resource regardless of conflict
 * type so the table can use them as a quick reference (the GM picks
 * the right one). The chat row can surface the constraint.
 *
 * Spawned per-monster instances of `TbMonsterWeapons` carry this
 * trait too so they appear alongside catalog conflict resources in
 * the picker without special-case wiring.
 */
export const TbConflictResource = defineTrait({
  name: "@vtt/system-torchbearer/TbConflictResource",
  schema: z.object({
    applicableConflicts: z.array(ConflictTypeEnum).max(8).default([]),
    /**
     * Free-text classification:
     *   - "weapon"  ⇒ surfaced in weapon-pickers
     *   - "armor"   ⇒ surfaced in armor-pickers
     *   - "other"   ⇒ informational
     * Lets the picker partition without importing the items system's
     * subtype traits everywhere.
     */
    kind: z.enum(["weapon", "armor", "other"]).default("weapon"),
    /**
     * Free-text note for the picker tooltip / chat row — typically a
     * short rules paraphrase ("absorbs 1pt; roll 1d6 lost on 1-3").
     */
    note: z.string().max(400).default(""),
    /**
     * The character that owns this resource, or `null` for a shared
     * catalog resource (Blackmail, Hostage — anyone can pick it).
     *
     * Spawned monster weapons (Hideous Bite, Cloak of Shadow) record
     * their lord here so the shared "Conflict Weapons — Quick
     * Reference" section can exclude them: those weapons surface
     * under the lord's per-participant row, never alongside catalog
     * resources. Public-readable so players don't need read access
     * to the monster's `TbCarries` for the filter to work.
     */
    ownerCharacterId: EntityId.nullable().optional(),
    /**
     * Canonical-book deep-link for the printed stat block this
     * resource was lifted from. Set on spawned monster weapons (so
     * the conflict UI can render a `<BookCitation>` next to the
     * weapon name); null for homebrew or for catalog items whose
     * citation lives elsewhere.
     */
    pageRef: BookPageRef.nullable().default(null),
  }),
});
