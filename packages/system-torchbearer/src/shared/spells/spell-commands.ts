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

import { defineCommand, EntityId, fail, ok, z, type EventInstance } from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { requireWrite } from "@vtt/permissions/shared";
import { Formula } from "@vtt/resolution/shared";
import { ItemDestroyed } from "@vtt/items/shared";
import {
  SpellAddedToBook,
  SpellAddedToLibrary,
  SpellCastConsumeLogged,
  SpellFieldEdited,
  SpellRemoved,
  SpellRemovedFromBook,
  SpellRemovedFromLibrary,
  SpellCreated,
  ScrollConsumed,
  ScrollScribed,
  ScrollSpawned,
  MemoryPalaceCapacityChanged,
  MemoryPalaceCleared,
  MemoryPalaceFilled,
  MemoryPalaceSpellMarkedCast,
} from "./spell-events.js";
import {
  SpellCastConsumed,
  SpellIdentity,
  TbLibrary,
  TbMemoryPalace,
  TbScroll,
  TbSpellBook,
} from "./spell-traits.js";

/* -------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------- */

function readSpellIdentity(
  world: import("@vtt/substrate").World,
  spellId: string,
): { name: string; circle: 1 | 2 | 3 | 4 | 5 } | null {
  const got = world.get(spellId, [SpellIdentity]) as
    | { SpellIdentity: { name: string; circle: 1 | 2 | 3 | 4 | 5 } }
    | undefined;
  if (!got) return null;
  return { name: got.SpellIdentity.name, circle: got.SpellIdentity.circle };
}

/* -------------------------------------------------------------------------
 * Spell catalog management — create / edit / remove
 * ----------------------------------------------------------------------- */

/**
 * Spawn a homebrew spell with a default stat block. GM-only — players
 * can't conjure new catalog entries. The spawned entity carries
 * SpellIdentity + TbSpellCasting + TbSpellLearning + an empty
 * TbSpellHomebrewProse so the page-detail editor can fill in the
 * effect prose inline (canon spells leave the prose trait absent and
 * rely on `SpellIdentity.pageRef` for the rulebook deep-link).
 *
 * The new entity is NOT in any plugin's SpellCatalogIndex — it's
 * "ad-hoc," which means it won't be touched by re-seed and the
 * Arcane page lists it under the "Homebrew" origin filter.
 */
export const CreateBlankSpell = defineCommand({
  name: "@vtt/system-torchbearer/CreateBlankSpell",
  schema: z.object({
    name: z.string().min(1).max(120),
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") return fail("only a GM can create a spell");
    return ok();
  },
  apply: ({ cmd, world }) => {
    const spellId = world.allocateId();
    return [
      SpellCreated({
        spellId,
        name: cmd.name,
      }),
    ];
  },
});

/**
 * Despawn a spell entity. GM-only. Doesn't remove the spell from any
 * library / spell-book / scroll that already references it — those
 * stay as dangling ids until the GM cleans them up. (Mirrors the
 * RemoveMonster pattern; the ID-stays-but-entity-gone state is
 * legible in the UI as "Unknown spell.")
 */
export const RemoveSpell = defineCommand({
  name: "@vtt/system-torchbearer/RemoveSpell",
  schema: z.object({
    spellId: EntityId,
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") return fail("only a GM can remove a spell");
    if (!ctx.world.has(ctx.cmd.spellId)) return fail("unknown spell");
    return ok();
  },
  apply: ({ cmd }) => [SpellRemoved({ spellId: cmd.spellId })],
});

/**
 * Edit a single field on a spell entity. GM-only. Trait + path +
 * value triple — the system applies it via deep-set, mirroring the
 * `EditItemField` pattern.
 */
export const EditSpellField = defineCommand({
  name: "@vtt/system-torchbearer/EditSpellField",
  schema: z.object({
    spellId: EntityId,
    /** Trait short-name: "SpellIdentity", "TbSpellCasting", "TbSpellLearning", "TbSpellHomebrewProse". */
    trait: z.enum(["SpellIdentity", "TbSpellCasting", "TbSpellLearning", "TbSpellHomebrewProse"]),
    /** Path inside the trait — array of string keys. Empty for whole-trait set. */
    path: z.array(z.string().min(1).max(60)).default([]),
    value: z.unknown(),
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") return fail("only a GM can edit a spell");
    if (!ctx.world.has(ctx.cmd.spellId)) return fail("unknown spell");
    return ok();
  },
  apply: ({ cmd }) => [
    SpellFieldEdited({
      spellId: cmd.spellId,
      trait: cmd.trait,
      path: cmd.path,
      value: cmd.value,
    }),
  ],
});

/* -------------------------------------------------------------------------
 * Library mutations
 * ----------------------------------------------------------------------- */

/**
 * Direct add to a character's library. GM-only convenience for chargen
 * and homebrew. The roll-routed variant ("Learn from source") opens a
 * Lore Master roll first; both end up emitting `SpellAddedToLibrary`.
 */
export const AddSpellToLibrary = defineCommand({
  name: "@vtt/system-torchbearer/AddSpellToLibrary",
  schema: z.object({
    characterId: EntityId,
    spellId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`unknown character ${ctx.cmd.characterId}`);
    }
    if (!ctx.world.has(ctx.cmd.spellId)) {
      return fail(`unknown spell ${ctx.cmd.spellId}`);
    }
    if (readSpellIdentity(ctx.world, ctx.cmd.spellId) === null) {
      return fail(`entity ${ctx.cmd.spellId} is not a spell`);
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [
    SpellAddedToLibrary({
      characterId: cmd.characterId,
      spellId: cmd.spellId,
    }),
  ],
});

export const RemoveSpellFromLibrary = defineCommand({
  name: "@vtt/system-torchbearer/RemoveSpellFromLibrary",
  schema: z.object({
    characterId: EntityId,
    spellId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`unknown character ${ctx.cmd.characterId}`);
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [
    SpellRemovedFromLibrary({
      characterId: cmd.characterId,
      spellId: cmd.spellId,
    }),
  ],
});

/* -------------------------------------------------------------------------
 * Spell book mutations
 * ----------------------------------------------------------------------- */

/**
 * Add a spell to a spell book. RAW p.92: "Copying spells from library
 * to spell book counts as personal business in town." No test in the
 * v1 implementation. Validator enforces the folio-capacity invariant
 * (sum of contained spell circles ≤ folios).
 */
export const AddSpellToBook = defineCommand({
  name: "@vtt/system-torchbearer/AddSpellToBook",
  schema: z.object({
    bookId: EntityId,
    spellId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.bookId)) {
      return fail(`unknown book ${ctx.cmd.bookId}`);
    }
    if (!ctx.world.has(ctx.cmd.spellId)) {
      return fail(`unknown spell ${ctx.cmd.spellId}`);
    }
    const book = ctx.world.get(ctx.cmd.bookId, [TbSpellBook]) as
      | { TbSpellBook: { folios: number; contents: string[] } }
      | undefined;
    if (!book) {
      return fail(`entity ${ctx.cmd.bookId} is not a spell book`);
    }
    if (book.TbSpellBook.contents.includes(ctx.cmd.spellId)) {
      return fail("spell is already in this book");
    }
    const ident = readSpellIdentity(ctx.world, ctx.cmd.spellId);
    if (!ident) return fail(`entity ${ctx.cmd.spellId} is not a spell`);
    let used = 0;
    for (const sid of book.TbSpellBook.contents) {
      const i = readSpellIdentity(ctx.world, sid);
      used += i?.circle ?? 0;
    }
    if (used + ident.circle > book.TbSpellBook.folios) {
      return fail(
        `not enough folios (${book.TbSpellBook.folios - used} free, ${ident.circle} needed)`,
      );
    }
    return ok();
  },
  apply: ({ cmd }) => [SpellAddedToBook({ bookId: cmd.bookId, spellId: cmd.spellId })],
});

export const RemoveSpellFromBook = defineCommand({
  name: "@vtt/system-torchbearer/RemoveSpellFromBook",
  schema: z.object({
    bookId: EntityId,
    spellId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.bookId)) {
      return fail(`unknown book ${ctx.cmd.bookId}`);
    }
    return ok();
  },
  apply: ({ cmd }) => [SpellRemovedFromBook({ bookId: cmd.bookId, spellId: cmd.spellId })],
});

/* -------------------------------------------------------------------------
 * Memory palace mutations
 * ----------------------------------------------------------------------- */

/**
 * Direct fill of the memory palace from a list of spell ids. v1
 * skips the Lore Master roll — RAW p.90 calls for one with Ob = sum
 * of circles + 1 per spell already in the palace. Roll-routed variant
 * lands later via a `[Fill palace]` button on the resolved Lore Master
 * card. Validator enforces capacity and an empty-palace precondition
 * (RAW: "Refilling your memory palace requires uninterrupted time").
 */
export const FillMemoryPalace = defineCommand({
  name: "@vtt/system-torchbearer/FillMemoryPalace",
  schema: z.object({
    characterId: EntityId,
    picks: z
      .array(
        z.object({
          spellId: EntityId,
        }),
      )
      .min(1),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`unknown character ${ctx.cmd.characterId}`);
    }
    const palace = ctx.world.get(ctx.cmd.characterId, [TbMemoryPalace]) as
      | {
          TbMemoryPalace: {
            capacity: number;
            memorized: ReadonlyArray<{
              spellId: string;
              slotsConsumed: number;
              cast: boolean;
            }>;
          };
        }
      | undefined;
    if (!palace) {
      return fail("character has no memory palace");
    }
    if (palace.TbMemoryPalace.memorized.length > 0) {
      return fail("memory palace must be empty before refilling — discharge first");
    }
    let used = 0;
    for (const p of ctx.cmd.picks) {
      if (!ctx.world.has(p.spellId)) {
        return fail(`unknown spell ${p.spellId}`);
      }
      const ident = readSpellIdentity(ctx.world, p.spellId);
      if (!ident) return fail(`entity ${p.spellId} is not a spell`);
      used += ident.circle;
    }
    if (used > palace.TbMemoryPalace.capacity) {
      return fail(
        `over capacity (${used} slots needed, ${palace.TbMemoryPalace.capacity} available)`,
      );
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd, world }) => {
    const picks = cmd.picks.map((p) => {
      const ident = readSpellIdentity(world, p.spellId)!;
      return { spellId: p.spellId, slotsConsumed: ident.circle };
    });
    return [
      MemoryPalaceFilled({
        characterId: cmd.characterId,
        picks,
      }),
    ];
  },
});

/**
 * Empty the memory palace immediately. RAW p.91 "Temerarious
 * Discharge" calls for a Will roll with Ob = sum of circles; for v1
 * the Will integration is deferred and this command fires the
 * unconditional clear. (When the roll-routed variant lands the player
 * will click `[Empty palace]` on a Will roll's chat card; that
 * dispatches this same command.)
 */
export const ClearMemoryPalace = defineCommand({
  name: "@vtt/system-torchbearer/ClearMemoryPalace",
  schema: z.object({
    characterId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`unknown character ${ctx.cmd.characterId}`);
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => [MemoryPalaceCleared({ characterId: cmd.characterId })],
});

export const SetMemoryPalaceCapacity = defineCommand({
  name: "@vtt/system-torchbearer/SetMemoryPalaceCapacity",
  schema: z.object({
    characterId: EntityId,
    capacity: z.number().int().min(0).max(20),
  }),
  validate: (ctx) => {
    const session = requireSession(ctx);
    if (!session) return fail("not authenticated");
    if (session.role !== "gm") return fail("only the GM can change palace capacity");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`unknown character ${ctx.cmd.characterId}`);
    }
    return ok();
  },
  apply: ({ cmd }) => [
    MemoryPalaceCapacityChanged({
      characterId: cmd.characterId,
      capacity: cmd.capacity,
    }),
  ],
});

/* -------------------------------------------------------------------------
 * Post-roll commit commands
 * ----------------------------------------------------------------------- */

function readRollSpellCast(
  world: import("@vtt/substrate").World,
  rollId: string,
): {
  characterId: string;
  spellId: string;
  sourceKind: "palace" | "spellbook" | "scroll";
  bookId?: string;
  scrollId?: string;
} | null {
  const got = world.get(rollId, [Formula]) as { Formula: { meta?: unknown } } | undefined;
  // The spell-cast context lives on `spec.spellCast` (the rollable
  // builds it there). Read through `meta.spec.spellCast`, not the
  // legacy `meta.spellCast` sibling.
  const meta = got?.Formula.meta as
    | {
        spec?: {
          spellCast?: {
            characterId: string;
            spellId: string;
            source:
              | { kind: "palace" }
              | { kind: "spellbook"; bookId: string; bookName?: string }
              | { kind: "scroll"; scrollId: string };
          };
        };
      }
    | undefined;
  const sc = meta?.spec?.spellCast;
  if (!sc) return null;
  return {
    characterId: sc.characterId,
    spellId: sc.spellId,
    sourceKind: sc.source.kind,
    bookId: sc.source.kind === "spellbook" ? sc.source.bookId : undefined,
    scrollId: sc.source.kind === "scroll" ? sc.source.scrollId : undefined,
  };
}

/**
 * Post-roll commit: consume the spell from the memory palace. The
 * matching slot is REMOVED from `memorized[]` (RAW p.93 — "removed
 * from the memory palace until they have the opportunity to
 * replenish it"). Idempotent — a second click after
 * `SpellCastConsumed` is attached returns a fail.
 */
export const ConsumePalaceSpell = defineCommand({
  name: "@vtt/system-torchbearer/ConsumePalaceSpell",
  schema: z.object({
    rollId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.rollId)) {
      return fail(`unknown roll ${ctx.cmd.rollId}`);
    }
    if (ctx.world.get(ctx.cmd.rollId, [SpellCastConsumed]) !== undefined) {
      return fail("this cast has already been consumed");
    }
    const sc = readRollSpellCast(ctx.world, ctx.cmd.rollId);
    if (!sc) return fail("roll has no spell-cast context");
    if (sc.sourceKind !== "palace") {
      return fail(`source is ${sc.sourceKind}, expected palace`);
    }
    return requireWrite(ctx, sc.characterId);
  },
  apply: ({ cmd, world }) => {
    const sc = readRollSpellCast(world, cmd.rollId)!;
    return [
      MemoryPalaceSpellMarkedCast({
        characterId: sc.characterId,
        spellId: sc.spellId,
      }),
      SpellCastConsumeLogged({
        rollId: cmd.rollId,
        characterId: sc.characterId,
        spellId: sc.spellId,
        sourceKind: "palace",
        consumedAt: Date.now(),
      }),
    ];
  },
});

/**
 * Post-roll commit: burn the cast spell out of its spell book. RAW
 * p.93: "Doing so consumes the spell as if it were a scroll." Removes
 * the spell from the book's contents (recovering its folios).
 */
export const BurnSpellbookSpell = defineCommand({
  name: "@vtt/system-torchbearer/BurnSpellbookSpell",
  schema: z.object({
    rollId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.rollId)) {
      return fail(`unknown roll ${ctx.cmd.rollId}`);
    }
    if (ctx.world.get(ctx.cmd.rollId, [SpellCastConsumed]) !== undefined) {
      return fail("this cast has already been consumed");
    }
    const sc = readRollSpellCast(ctx.world, ctx.cmd.rollId);
    if (!sc) return fail("roll has no spell-cast context");
    if (sc.sourceKind !== "spellbook") {
      return fail(`source is ${sc.sourceKind}, expected spellbook`);
    }
    return requireWrite(ctx, sc.characterId);
  },
  apply: ({ cmd, world }) => {
    const sc = readRollSpellCast(world, cmd.rollId)!;
    return [
      SpellRemovedFromBook({
        bookId: sc.bookId!,
        spellId: sc.spellId,
      }),
      SpellCastConsumeLogged({
        rollId: cmd.rollId,
        characterId: sc.characterId,
        spellId: sc.spellId,
        sourceKind: "spellbook",
        bookId: sc.bookId,
        consumedAt: Date.now(),
      }),
    ];
  },
});

/**
 * Post-roll commit: burn the scroll. RAW p.95 — scrolls are
 * single-use. We mark `consumed: true` (audit trail), emit
 * `ItemDestroyed` to despawn the entity AND clean any TbCarries
 * entries pointing at it (`TbItemDestroyedSweepSystem` handles the
 * inventory side), and stamp the roll with `SpellCastConsumed` so
 * the chat-row commit button gates on subsequent renders.
 */
export const BurnScroll = defineCommand({
  name: "@vtt/system-torchbearer/BurnScroll",
  schema: z.object({
    rollId: EntityId,
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.rollId)) {
      return fail(`unknown roll ${ctx.cmd.rollId}`);
    }
    if (ctx.world.get(ctx.cmd.rollId, [SpellCastConsumed]) !== undefined) {
      return fail("this cast has already been consumed");
    }
    const sc = readRollSpellCast(ctx.world, ctx.cmd.rollId);
    if (!sc) return fail("roll has no spell-cast context");
    if (sc.sourceKind !== "scroll") {
      return fail(`source is ${sc.sourceKind}, expected scroll`);
    }
    return requireWrite(ctx, sc.characterId);
  },
  apply: ({ cmd, world }) => {
    const sc = readRollSpellCast(world, cmd.rollId)!;
    return [
      ScrollConsumed({ scrollId: sc.scrollId! }),
      ItemDestroyed({ itemId: sc.scrollId! }),
      SpellCastConsumeLogged({
        rollId: cmd.rollId,
        characterId: sc.characterId,
        spellId: sc.spellId,
        sourceKind: "scroll",
        scrollId: sc.scrollId,
        consumedAt: Date.now(),
      }),
    ];
  },
});

void ScrollSpawned;

/* -------------------------------------------------------------------------
 * Scribing — direct (non-roll-routed) for v1
 * ----------------------------------------------------------------------- */

/**
 * Scribe a spell onto a blank scroll. RAW DH p.95: scrolls hold a
 * single spell each, and scribing one consumes a spell from the
 * source — either a copy in the magician's library OR a spell
 * memorized in the palace (RAW p.90 lists scribing as one of the
 * three ways to remove a spell from the palace).
 *
 * v1 ships the direct version: no Scholar roll yet. The roll-routed
 * variant (Scholar Ob = `spell.scribeOb`, with a post-roll
 * `[Stamp scroll]` button on the chat card) lands when the broader
 * roll-routed library/memorize/discharge flows do.
 *
 * Validator preconditions:
 *   - scroll exists, has TbScroll, is blank (`spellId === null`),
 *     not consumed
 *   - spell exists and carries SpellIdentity
 *   - source matches reality: `library` ⇒ spell is in the
 *     character's TbLibrary; `palace` ⇒ spell is memorized and
 *     uncast in the character's TbMemoryPalace
 */
export const ScribeSpellToScroll = defineCommand({
  name: "@vtt/system-torchbearer/ScribeSpellToScroll",
  schema: z.object({
    characterId: EntityId,
    scrollId: EntityId,
    spellId: EntityId,
    source: z.enum(["library", "palace"]),
  }),
  validate: (ctx) => {
    if (!requireSession(ctx)) return fail("not authenticated");
    if (!ctx.world.has(ctx.cmd.characterId)) {
      return fail(`unknown character ${ctx.cmd.characterId}`);
    }
    if (!ctx.world.has(ctx.cmd.scrollId)) {
      return fail(`unknown scroll ${ctx.cmd.scrollId}`);
    }
    if (!ctx.world.has(ctx.cmd.spellId)) {
      return fail(`unknown spell ${ctx.cmd.spellId}`);
    }
    if (readSpellIdentity(ctx.world, ctx.cmd.spellId) === null) {
      return fail(`entity ${ctx.cmd.spellId} is not a spell`);
    }
    const scroll = ctx.world.get(ctx.cmd.scrollId, [TbScroll]) as
      | { TbScroll: { spellId: string | null; consumed: boolean } }
      | undefined;
    if (!scroll) return fail(`entity ${ctx.cmd.scrollId} is not a scroll`);
    if (scroll.TbScroll.consumed) return fail("scroll has been consumed");
    if (scroll.TbScroll.spellId !== null) {
      return fail("scroll is not blank — it already holds a spell");
    }
    if (ctx.cmd.source === "library") {
      const lib = ctx.world.get(ctx.cmd.characterId, [TbLibrary]) as
        | { TbLibrary: { spellIds: ReadonlyArray<string> } }
        | undefined;
      if (!lib?.TbLibrary.spellIds.includes(ctx.cmd.spellId)) {
        return fail("spell is not in your library");
      }
    } else {
      const palace = ctx.world.get(ctx.cmd.characterId, [TbMemoryPalace]) as
        | {
            TbMemoryPalace: {
              memorized: ReadonlyArray<{ spellId: string; cast: boolean }>;
            };
          }
        | undefined;
      const slot = palace?.TbMemoryPalace.memorized.find((m) => m.spellId === ctx.cmd.spellId);
      if (!slot) return fail("spell is not memorized in your palace");
      if (slot.cast) return fail("spell has already been cast — re-memorize first");
    }
    return requireWrite(ctx, ctx.cmd.characterId);
  },
  apply: ({ cmd }) => {
    const events: EventInstance[] = [
      ScrollScribed({
        scrollId: cmd.scrollId,
        spellId: cmd.spellId,
        fromSource: cmd.source,
        characterId: cmd.characterId,
      }),
    ];
    if (cmd.source === "palace") {
      // RAW p.90: scribing removes the spell from the palace.
      events.push(
        MemoryPalaceSpellMarkedCast({
          characterId: cmd.characterId,
          spellId: cmd.spellId,
        }),
      );
    }
    return events;
  },
});
