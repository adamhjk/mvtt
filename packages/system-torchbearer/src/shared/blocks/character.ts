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

import { type World, z } from "@vtt/substrate";
import {
  defineBlockKind,
  wikiLink,
  type BlockKindContext,
  type EntityProjection,
} from "@vtt/adventures/shared";
import { Active, Character, Team } from "@vtt/characters/shared";
import { gmOnly, Permissions } from "@vtt/permissions/shared";
import {
  CharacterTraits,
  Conditions,
  Heroic,
  Identity,
  Pools,
  RawAbilities,
  Skills,
  TownAbilities,
  WhatYouFightFor,
  Wises,
} from "../traits.js";
import { ALL_SKILLS, isKnownSkillId } from "../skills.js";
import { MonsterTemplate, TbMonster } from "../monster-traits.js";
import { TbCarries } from "../items/item-traits.js";
import { TB_BODY_SLOTS_AUTHORING } from "./item.js";
import {
  channelFor,
  defaultSlotForItem,
  peelWikiLink,
  resolveItemId,
  slotsConsumedFor,
} from "./resolve-item.js";

const NatureSchema = z
  .object({
    rating: z.number().int().min(0).max(10).default(0),
    descriptors: z.array(z.string().min(1).max(40)).default([]),
  })
  .default({ rating: 0, descriptors: [] });

const SkillsRecordSchema = z
  .record(z.string().min(1).max(40), z.number().int().min(0).max(10))
  .default({});

const TraitsArraySchema = z
  .array(
    z.object({
      name: z.string().min(1).max(80),
      level: z.number().int().min(1).max(3).default(1),
    }),
  )
  .default([]);

const CarriesItemString = wikiLink("item").describe(
  'String form: a bare item wiki-link, e.g. `[[item:e123|Sword]]`. Quote the YAML string when authoring this form. The item is placed in its default slot at quantity 1.',
);

const CarriesItemObject = z
  .object({
    item: wikiLink("item").describe(
      "Item wiki-link, e.g. `[[item:e123|Sword]]`.",
    ),
    slot: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe(
        "Where the character carries the item. See the body-slot vocabulary below.",
      ),
    quantity: z
      .number()
      .int()
      .min(1)
      .max(99)
      .default(1)
      .describe("How many copies. Stacks into one bundle for bundleable items."),
  })
  .describe(
    "Object form: use when you need to pin the slot (e.g. `handR` vs `handL`) or set a quantity. The item field is the same wiki-link the string form accepts.",
  );

const CarriesArraySchema = z
  .array(z.union([CarriesItemString, CarriesItemObject]))
  .default([])
  .describe(
    "Inventory. Each entry is either a bare wiki-link or `{ item, slot?, quantity? }`. Slot strings list under `carries.[] (object form).slot` below.",
  );

/**
 * Schema for the body of a `character` fenced block — used for named
 * NPCs the GM authors directly on a note. Mirrors the trait set the
 * NpcSpawningSystem writes; values default to sane "blank NPC"
 * starting points so a sparse YAML still parses.
 *
 * The fence info-string is the canonical name (e.g. "Greta the Smith");
 * the body covers everything else.
 */
export const CharacterBlockSchema = z.object({
  // Identity / flavor.
  stock: z.string().max(40).default(""),
  class: z.string().max(40).default(""),
  level: z.number().int().min(1).max(10).default(1),
  age: z.number().int().min(0).max(2000).default(20),
  home: z.string().max(120).default(""),
  raiment: z.string().max(240).default(""),
  parents: z.string().max(240).default(""),
  mentor: z.string().max(240).default(""),
  friend: z.string().max(240).default(""),
  enemy: z.string().max(240).default(""),

  // Team — "party" / "enemy" / "neutral". Drives conflict-side
  // resolution and friend/foe rendering. Defaults to "enemy" because
  // most named-NPC blocks describe antagonists; PCs explicitly set
  // `team: party`.
  team: z.enum(["party", "enemy", "neutral"]).default("enemy"),

  // Abilities.
  will: z.number().int().min(0).max(10).default(0),
  health: z.number().int().min(0).max(10).default(0),
  resources: z.number().int().min(0).max(10).default(0),
  circles: z.number().int().min(0).max(10).default(0),
  precedence: z.number().int().min(0).max(10).default(0),
  might: z.number().int().min(0).max(10).default(2),
  nature: NatureSchema,
  skills: SkillsRecordSchema,
  traits: TraitsArraySchema,
  wises: z.array(z.string().min(1).max(60)).default([]),

  // Inventory.
  carries: CarriesArraySchema,

  // What you fight for.
  belief: z.string().max(2000).default(""),
  creed: z.string().max(2000).default(""),
  goal: z.string().max(2000).default(""),
  instinct: z.string().max(2000).default(""),

  // GM notes / NPC description. Free-text the GM-only sheet shows
  // alongside the printed stats. On the `npc` block this maps to
  // `TbNpc.description`; on `character` it informs the sheet's
  // free-form notes section.
  notes: z.string().max(4000).default(""),
});

export type CharacterBlockParsed = z.infer<typeof CharacterBlockSchema>;

/**
 * Schema for the body of a `monster` fenced block — a stat block for
 * a mob template that encounters spawn copies from. Smaller surface
 * than `character` (no skills/wises/CharacterTraits/will/health) plus
 * monster-specific fields (might, dispositions, monstrous weapons).
 */
export const MonsterBlockSchema = z.object({
  type: z.string().min(1).max(40).default("beast"),
  might: z.number().int().min(0).max(10),
  precedence: z.number().int().min(0).max(10).default(0),
  nature: NatureSchema,
  /**
   * Per-conflict-type hit points. Map form: `{ kill: 5, capture: 4, ... }`.
   * The TB conflict subsystem reads these to pick predetermined HP
   * when the conflict type matches; other conflict types roll Nature.
   */
  disposition: z
    .record(z.string().min(1).max(40), z.number().int().min(0).max(60))
    .default({}),
  weapons: z.array(wikiLink("item")).default([]),
  armor: wikiLink("item").optional(),
  instinct: z.string().max(2000).default(""),
  notes: z.string().max(4000).default(""),
  treasure: z.string().max(2000).default(""),
});

export type MonsterBlockParsed = z.infer<typeof MonsterBlockSchema>;

function buildSkillsRecord(
  seed: Record<string, number>,
): Record<
  string,
  { rating: number; advancement: { pass: number; fail: number }; taxed: boolean; learningTests: number }
> {
  const out: Record<
    string,
    { rating: number; advancement: { pass: number; fail: number }; taxed: boolean; learningTests: number }
  > = {};
  for (const s of ALL_SKILLS) {
    out[s.id] = {
      rating: 0,
      advancement: { pass: 0, fail: 0 },
      taxed: false,
      learningTests: 0,
    };
  }
  for (const [skillId, rating] of Object.entries(seed)) {
    if (!isKnownSkillId(skillId)) continue;
    const e = out[skillId];
    if (!e) continue;
    e.rating = rating;
  }
  return out;
}

/**
 * One entry in the parsed `carries:` (or `weapons:` / `armor:`) array
 * after Zod has validated. Normalised across string and object form
 * so the projection has a single shape to work with.
 */
interface CarryInput {
  /** Item reference body — wiki-link string or just an id / name. */
  readonly ref: string;
  /** Author-supplied slot, or undefined to default from the item. */
  readonly slot?: string;
  /** Author-supplied quantity, default 1. */
  readonly quantity?: number;
}

/**
 * Resolve a list of authored carry inputs to real `TbCarries` entries
 * pointed at live item entities. Entries whose wiki-link doesn't
 * resolve to an existing `ItemIdentity` are skipped (logged via
 * console.warn — equipping a missing item would crash the renderer).
 *
 * `slotIndex` increments per-slot so a character authored to carry
 * two waterskins on the belt occupies belt[0] and belt[1] rather
 * than colliding.
 */
function buildCarriesEntries(
  inputs: ReadonlyArray<CarryInput>,
  world: World | undefined,
): Array<{
  slot: string;
  slotIndex: number;
  channel: "default" | "carried" | "worn";
  slotsConsumed: number;
  itemId: string;
  quantity: number;
}> {
  if (!world) return [];
  const out: Array<{
    slot: string;
    slotIndex: number;
    channel: "default" | "carried" | "worn";
    slotsConsumed: number;
    itemId: string;
    quantity: number;
  }> = [];
  const slotCounters = new Map<string, number>();
  for (const input of inputs) {
    const body = peelWikiLink(input.ref);
    if (body.length === 0) continue;
    const itemId = resolveItemId(body, world);
    if (!itemId) {
      // eslint-disable-next-line no-console
      console.warn(
        `[tb] character/monster carries references unknown item "${input.ref}" — skipping`,
      );
      continue;
    }
    // Author slot wins. `hand` is an authoring shorthand for either
    // hand — we expand it to handR (left can still be selected
    // explicitly).
    let slot = input.slot ?? defaultSlotForItem(itemId, world) ?? "loose:0";
    if (slot === "hand") slot = "handR";
    const slotsConsumed = slotsConsumedFor(itemId, slot, world);
    const channel = channelFor(slot);
    const idx = slotCounters.get(slot) ?? 0;
    slotCounters.set(slot, idx + 1);
    out.push({
      slot,
      slotIndex: idx,
      channel,
      slotsConsumed,
      itemId,
      quantity: input.quantity ?? 1,
    });
  }
  return out;
}

/**
 * Build the trait writes shared between the `character` and `npc`
 * block kinds — same TB stat surface, same carries resolution. The
 * caller (in `npc.ts`) layers `TbNpc` on top to mark the entity as
 * an NPC; the `character` projection wraps this directly.
 *
 * Exported so the NPC kind can reuse it without duplicating ~70
 * lines of trait-write boilerplate. NOT for outside-the-blocks-dir
 * use — block projections shouldn't be invoked outside the parse
 * pipeline.
 */
export function buildCharacterTraitWrites(
  parsed: CharacterBlockParsed,
  info: string,
  ctx: BlockKindContext,
): EntityProjection {
  // Normalise carries entries: the schema accepts either a string
  // (wiki-link body) or `{ item, slot?, quantity? }`. Map both into
  // a single `CarryInput` shape, then resolve.
  const carryInputs: CarryInput[] = parsed.carries.map((c) => {
    if (typeof c === "string") return { ref: c };
    return {
      ref: c.item,
      ...(c.slot !== undefined && { slot: c.slot }),
      ...(c.quantity !== undefined && { quantity: c.quantity }),
    };
  });
  const carriesEntries = buildCarriesEntries(carryInputs, ctx.world);
  const traits: Array<{ trait: import("@vtt/substrate").TraitMeta; value: unknown }> = [
    { trait: Character, value: { name: info } },
    {
      trait: Identity,
      value: {
        name: info,
        stock: parsed.stock,
        class: parsed.class,
        level: parsed.level,
        age: parsed.age,
        home: parsed.home,
        raiment: parsed.raiment,
        parents: parsed.parents,
        mentor: parsed.mentor,
        friend: parsed.friend,
        enemy: parsed.enemy,
      },
    },
    { trait: Permissions, value: { read: gmOnly(), write: gmOnly() } },
    { trait: Team, value: { kind: parsed.team } },
    {
      trait: RawAbilities,
      value: {
        will: { rating: parsed.will, advancement: { pass: 0, fail: 0 } },
        health: { rating: parsed.health, advancement: { pass: 0, fail: 0 } },
        nature: {
          rating: parsed.nature.rating,
          maximum: parsed.nature.rating,
          advancement: { pass: 0, fail: 0 },
          descriptors: [...parsed.nature.descriptors],
        },
      },
    },
    {
      trait: TownAbilities,
      value: {
        resources: { rating: parsed.resources, advancement: { pass: 0, fail: 0 } },
        circles: { rating: parsed.circles, advancement: { pass: 0, fail: 0 } },
        precedence: parsed.precedence,
        might: parsed.might,
      },
    },
    { trait: Heroic, value: { abilities: [], townAbilities: [], skills: [] } },
    { trait: Skills, value: { entries: buildSkillsRecord(parsed.skills) } },
    {
      trait: Wises,
      value: {
        entries: parsed.wises.map((name) => ({
          name,
          pass: false,
          fail: false,
          fate: false,
          persona: false,
        })),
      },
    },
    {
      trait: CharacterTraits,
      value: {
        entries: parsed.traits.map((t) => ({
          name: t.name,
          level: t.level,
          beneficialUses: 0,
          checks: 0,
          usedAgainst: false,
        })),
      },
    },
    {
      trait: WhatYouFightFor,
      value: {
        belief: parsed.belief,
        creed: parsed.creed,
        goal: parsed.goal,
        instinct: parsed.instinct,
      },
    },
    // TbCarries: the character's full inventory, resolved from
    // `parsed.carries` entries. Each entry points at a live item
    // entity (catalog or block-authored) with the right slot,
    // channel, and slot-cost. This is what makes
    // `carries: [...]` actually attach the gear — without it the
    // YAML was parsed but silently dropped.
    { trait: TbCarries, value: { entries: carriesEntries } },
  ];

  return {
    traits,
    spawnIfMissing: [
      // Runtime defaults — set ONCE at first spawn, never re-written
      // on subsequent saves. Conditions accumulate from play; Pools
      // tick up as the character spends fate / persona.
      {
        trait: Conditions,
        value: {
          fresh: false,
          hungryThirsty: false,
          angry: false,
          afraid: false,
          exhausted: false,
          injured: false,
          sick: false,
          dead: false,
        },
      },
      {
        trait: Pools,
        value: {
          fate: { current: 0, totalSpent: 0 },
          persona: { current: 0, totalSpent: 0 },
        },
      },
      // Block-materialised character/NPC starts inactive — adventure
      // imports populate the library without flooding pickers. The GM
      // flips it active via the sheet header toggle when bringing it
      // into play. spawnIfMissing so a yaml re-save doesn't clobber a
      // GM flip.
      { trait: Active, value: { active: false } },
    ],
  };
}

function projectMonster(
  parsed: MonsterBlockParsed,
  info: string,
  ctx: BlockKindContext,
): EntityProjection {
  // Build dispositions array from the map form. The TB conflict
  // subsystem reads `dispositions: Array<{ conflictType, value }>`,
  // so we convert here.
  const dispositions: Array<{ conflictType: string; value: number }> = [];
  for (const [conflictType, value] of Object.entries(parsed.disposition)) {
    dispositions.push({ conflictType, value });
  }

  // Resolve `weapons:` + `armor:` (the monster-block shorthand for
  // "what this thing has on it") into the same TbCarries shape a
  // character uses. Weapons go in the carried hands; armor in torso.
  // The author can still use the full TB body-slot vocabulary if
  // they need something more specific — that path goes through a
  // `character` block instead.
  const carryInputs: CarryInput[] = [];
  for (const w of parsed.weapons) {
    carryInputs.push({ ref: w });
  }
  if (parsed.armor) {
    carryInputs.push({ ref: parsed.armor, slot: "torso" });
  }
  const carriesEntries = buildCarriesEntries(carryInputs, ctx.world);

  // We project to the same Character + RawAbilities + TownAbilities +
  // TbMonster shape the existing per-spawn flow uses, plus the
  // MonsterTemplate marker so encounter blocks can quantify against
  // it (see design/adventures.md § "Encounter instantiation").
  // Monsters' skills/wises/traits aren't in the schema — TB monsters
  // don't have them by RAW; they roll Nature + Might.
  return {
    traits: [
      { trait: Character, value: { name: info } },
      { trait: Permissions, value: { read: gmOnly(), write: gmOnly() } },
      { trait: Team, value: { kind: "enemy" } },
      {
        trait: RawAbilities,
        value: {
          will: { rating: 0, advancement: { pass: 0, fail: 0 } },
          health: { rating: 0, advancement: { pass: 0, fail: 0 } },
          nature: {
            rating: parsed.nature.rating,
            maximum: parsed.nature.rating,
            advancement: { pass: 0, fail: 0 },
            descriptors: [...parsed.nature.descriptors],
          },
        },
      },
      {
        trait: TownAbilities,
        value: {
          resources: { rating: 0, advancement: { pass: 0, fail: 0 } },
          circles: { rating: 0, advancement: { pass: 0, fail: 0 } },
          precedence: parsed.precedence,
          might: parsed.might,
        },
      },
      { trait: Heroic, value: { abilities: [], townAbilities: [], skills: [] } },
      // The TbMonster trait carries the per-conflict dispositions and
      // the (free-text) instinct + armor description.
      {
        trait: TbMonster,
        value: {
          type: parsed.type,
          instinct: parsed.instinct,
          armorDescription: "",
          dispositions,
          pageRef: null,
        },
      },
      // MonsterTemplate marker — encounter blocks check this trait to
      // know "you can quantify a reference to me".
      { trait: MonsterTemplate, value: {} },
      // TbCarries: monster's gear from `weapons:` + `armor:`.
      { trait: TbCarries, value: { entries: carriesEntries } },
    ],
    spawnIfMissing: [
      // Runtime defaults — set ONCE on first spawn. Preserves
      // accumulated state if a mid-fight GM tweaks the template's
      // YAML body. Mirrors the character block's spawnIfMissing
      // contract.
      {
        trait: Conditions,
        value: {
          fresh: false,
          hungryThirsty: false,
          angry: false,
          afraid: false,
          exhausted: false,
          injured: false,
          sick: false,
          dead: false,
        },
      },
      {
        trait: Pools,
        value: {
          fate: { current: 0, totalSpent: 0 },
          persona: { current: 0, totalSpent: 0 },
        },
      },
      // Block-materialised monster templates start inactive. They're
      // library content awaiting an `encounter` block or a manual flip.
      { trait: Active, value: { active: false } },
    ],
  };
}

/**
 * Dynamic key-completion for character/monster YAML bodies.
 * Returns:
 *   - For `skills`: every TB skill id with its display name.
 *   - For `traits` / `wises` / `nature.descriptors`: returns nothing
 *     today (free-text) — could be extended with the canonical lists.
 */
export function completeCharacterKeys(
  path: ReadonlyArray<string>,
): ReadonlyArray<{ value: string; detail?: string }> {
  if (path.length === 1 && path[0] === "skills") {
    return ALL_SKILLS.map((s) => ({ value: s.id, detail: s.name }));
  }
  // Object-form `carries[i].slot` — the schema is `z.string()` so the
  // value side falls through the enum branch; expose the canonical
  // TB body-slot vocabulary so authors don't have to guess.
  if (
    path.length >= 2 &&
    path[0] === "carries" &&
    path[path.length - 1] === "slot"
  ) {
    return TB_BODY_SLOTS_AUTHORING.map((s) => ({ value: s }));
  }
  return [];
}

/** The `character` block kind — authored named NPCs. */
export const characterBlockKind = defineBlockKind<CharacterBlockParsed>({
  name: "character",
  description: "TB character / named NPC",
  schema: CharacterBlockSchema,
  project: (parsed, ctx) =>
    buildCharacterTraitWrites(parsed, ctx.info ?? "Unnamed", ctx),
  complete: (path) => completeCharacterKeys(path),
  display: (entityId, world) => {
    const got = world.get(entityId, [Character]) as
      | { Character: { name: string } }
      | undefined;
    return got?.Character.name ?? "(unnamed character)";
  },
  // Snippet covers the high-value PC fields: identity, abilities,
  // skills, carries (with both forms), and what-you-fight-for. The
  // Reference panel's expand-fields surfaces every field on the
  // schema (including identity flavor like home / raiment / mentor).
  // Wiki-links don't require quotes — the adventures parser handles
  // \`[[…]]\` natively.
  snippet: () => `\${1:name}
stock: \${2:Human}
class: \${3:Warrior}
level: \${4:1}
team: party
will: \${5:4}
health: \${6:5}
nature:
  rating: \${7:4}
  descriptors: [\${8:descriptor}]
skills:
  fighter: \${9:3}
wises: [\${10:wise}]
carries:
  - item: [[item:\${11:hammer}]]
    slot: handR
  - item: [[item:\${12:traveling ration}]]
    quantity: \${13:2}
belief: \${14:belief}
goal: \${15:goal}
instinct: \${16:instinct}
notes: |
  \${0}`,
});

/** The `monster` block kind — authored mob templates. */
export const monsterBlockKind = defineBlockKind<MonsterBlockParsed>({
  name: "monster",
  description: "TB monster template — encounter blocks spawn copies of these",
  schema: MonsterBlockSchema,
  project: (parsed, ctx) =>
    projectMonster(parsed, ctx.info ?? "Unnamed Monster", ctx),
  display: (entityId, world) => {
    const got = world.get(entityId, [Character, TbMonster]) as
      | { Character: { name: string }; TbMonster: { type: string } }
      | undefined;
    if (!got) return "(unknown monster)";
    return `${got.Character.name} · ${got.TbMonster.type}`;
  },
  // Wiki-links in YAML are pre-escaped by the adventures parser, so
  // \`[[…]]\` literals appear bare here — no quoting required.
  snippet: () => `\${1:name}
might: \${2:2}
precedence: \${3:1}
nature:
  rating: \${4:3}
  descriptors: [\${5:descriptor}]
disposition:
  kill: \${6:5}
  drive_off: \${7:3}
weapons:
  - [[item:\${8:claws}]]
armor: [[item:\${9:thick hide}]]
instinct: \${0:Always run when outnumbered.}`,
});
