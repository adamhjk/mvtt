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

import { defineSystem } from "@vtt/substrate";
import { ItemDestroyed, ItemIdentity } from "@vtt/items/shared";
import { TbCarries } from "../../shared/items/index.js";
import {
  LibraryLocationSet,
  MemoryPalaceCapacityChanged,
  MemoryPalaceCleared,
  MemoryPalaceFilled,
  MemoryPalaceSpellMarkedCast,
  ScrollConsumed,
  ScrollScribed,
  ScrollSpawned,
  SpellAddedToBook,
  SpellAddedToLibrary,
  SpellCastConsumeLogged,
  SpellCreated,
  SpellFieldEdited,
  SpellRemoved,
  SpellRemovedFromBook,
  SpellRemovedFromLibrary,
} from "../../shared/spells/spell-events.js";
import {
  SpellCastConsumed,
  SpellIdentity,
  TbLibrary,
  TbMemoryPalace,
  TbScroll,
  TbSpellBook,
  TbSpellCasting,
  TbSpellHomebrewProse,
  TbSpellLearning,
} from "../../shared/spells/spell-traits.js";

/* -------------------------------------------------------------------------
 * Library
 * ----------------------------------------------------------------------- */

export const TbSpellAddedToLibrarySystem = defineSystem({
  name: "TbSpellAddedToLibrary",
  on: SpellAddedToLibrary,
  reads: [TbLibrary],
  writes: [TbLibrary],
  run: ({ event, world }) => {
    const got = world.get(event.characterId, [TbLibrary]) as
      | { TbLibrary: { spellIds: string[]; location: "home" | "loner"; lonerLocation: string } }
      | undefined;
    const current = got?.TbLibrary ?? {
      spellIds: [],
      location: "home" as const,
      lonerLocation: "",
    };
    if (current.spellIds.includes(event.spellId)) return [];
    world.set(event.characterId, TbLibrary, {
      ...current,
      spellIds: [...current.spellIds, event.spellId],
    });
    return [];
  },
});

export const TbSpellRemovedFromLibrarySystem = defineSystem({
  name: "TbSpellRemovedFromLibrary",
  on: SpellRemovedFromLibrary,
  reads: [TbLibrary],
  writes: [TbLibrary],
  run: ({ event, world }) => {
    const got = world.get(event.characterId, [TbLibrary]) as
      | { TbLibrary: { spellIds: string[]; location: "home" | "loner"; lonerLocation: string } }
      | undefined;
    if (!got) return [];
    world.set(event.characterId, TbLibrary, {
      ...got.TbLibrary,
      spellIds: got.TbLibrary.spellIds.filter((s) => s !== event.spellId),
    });
    return [];
  },
});

export const TbLibraryLocationSetSystem = defineSystem({
  name: "TbLibraryLocationSet",
  on: LibraryLocationSet,
  reads: [TbLibrary],
  writes: [TbLibrary],
  run: ({ event, world }) => {
    const got = world.get(event.characterId, [TbLibrary]) as
      | { TbLibrary: { spellIds: string[]; location: "home" | "loner"; lonerLocation: string } }
      | undefined;
    const current = got?.TbLibrary ?? {
      spellIds: [],
      location: "home" as const,
      lonerLocation: "",
    };
    world.set(event.characterId, TbLibrary, {
      spellIds: current.spellIds,
      location: event.location,
      lonerLocation: event.lonerLocation,
    });
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Spell book
 * ----------------------------------------------------------------------- */

export const TbSpellAddedToBookSystem = defineSystem({
  name: "TbSpellAddedToBook",
  on: SpellAddedToBook,
  reads: [TbSpellBook],
  writes: [TbSpellBook],
  run: ({ event, world }) => {
    const got = world.get(event.bookId, [TbSpellBook]) as
      | { TbSpellBook: { folios: number; contents: string[] } }
      | undefined;
    if (!got) return [];
    if (got.TbSpellBook.contents.includes(event.spellId)) return [];
    world.set(event.bookId, TbSpellBook, {
      folios: got.TbSpellBook.folios,
      contents: [...got.TbSpellBook.contents, event.spellId],
    });
    return [];
  },
});

export const TbSpellRemovedFromBookSystem = defineSystem({
  name: "TbSpellRemovedFromBook",
  on: SpellRemovedFromBook,
  reads: [TbSpellBook],
  writes: [TbSpellBook],
  run: ({ event, world }) => {
    const got = world.get(event.bookId, [TbSpellBook]) as
      | { TbSpellBook: { folios: number; contents: string[] } }
      | undefined;
    if (!got) return [];
    world.set(event.bookId, TbSpellBook, {
      folios: got.TbSpellBook.folios,
      contents: got.TbSpellBook.contents.filter((s) => s !== event.spellId),
    });
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Scroll
 * ----------------------------------------------------------------------- */

export const TbScrollSpawnedSystem = defineSystem({
  name: "TbScrollSpawned",
  on: ScrollSpawned,
  reads: [],
  writes: [TbScroll],
  run: ({ event, world }) => {
    if (!world.has(event.scrollId)) {
      // The scroll item entity must already exist (it's an item with
      // ItemIdentity etc.). The seed wires those up; this system only
      // stamps the TbScroll trait. Defensive — if the entity is gone
      // (legacy world), no-op.
      return [];
    }
    world.set(event.scrollId, TbScroll, {
      spellId: event.spellId,
      consumed: false,
    });
    return [];
  },
});

export const TbScrollScribedSystem = defineSystem({
  name: "TbScrollScribed",
  on: ScrollScribed,
  reads: [TbScroll, SpellIdentity, ItemIdentity],
  writes: [TbScroll, ItemIdentity],
  run: ({ event, world }) => {
    if (!world.has(event.scrollId)) return [];
    const got = world.get(event.scrollId, [TbScroll]) as
      | { TbScroll: { spellId: string | null; consumed: boolean } }
      | undefined;
    world.set(event.scrollId, TbScroll, {
      spellId: event.spellId,
      consumed: got?.TbScroll.consumed ?? false,
    });
    // Auto-rename the scroll's inventory entry to "Scroll of <SpellName>"
    // so the inventory tab and chat-row references read clearly. The
    // GM can still rename it manually from the Items page; we only
    // overwrite when the current name is the generic "Scroll" / blank.
    const ident = world.get(event.spellId, [SpellIdentity]) as
      | { SpellIdentity: { name: string } }
      | undefined;
    const spellName = ident?.SpellIdentity.name?.trim();
    if (spellName) {
      const itemIdent = world.get(event.scrollId, [ItemIdentity]) as
        | { ItemIdentity: { name: string; description: string; img: string } }
        | undefined;
      const desired = `Scroll of ${spellName}`;
      if (itemIdent && itemIdent.ItemIdentity.name !== desired) {
        world.set(event.scrollId, ItemIdentity, {
          name: desired,
          description: itemIdent.ItemIdentity.description,
          img: itemIdent.ItemIdentity.img,
        });
      }
    }
    return [];
  },
});

/**
 * When any item is destroyed (e.g. a burned scroll), strip its id
 * out of every holder's TbCarries entries. The items plugin's
 * `ItemDestroySystem` handles the entity despawn; this system is
 * the TB-specific counterpart that cleans the inventory side so
 * the slot frees up immediately.
 *
 * Generic by design: applies to any destroyed item, not just
 * scrolls — so the same behaviour kicks in for any future
 * "destroy on use" item type without per-kind plumbing.
 */
export const TbItemDestroyedSweepSystem = defineSystem({
  name: "TbItemDestroyedSweep",
  on: ItemDestroyed,
  reads: [TbCarries],
  writes: [TbCarries],
  run: ({ event, world }) => {
    const target = event.itemId;
    for (const row of world.query([TbCarries])) {
      const v = row.values.TbCarries as {
        entries: ReadonlyArray<{ itemId: string }>;
      };
      const before = v.entries.length;
      const next = v.entries.filter((e) => e.itemId !== target);
      if (next.length !== before) {
        world.set(row.id, TbCarries, { entries: next });
      }
    }
    return [];
  },
});

export const TbScrollConsumedSystem = defineSystem({
  name: "TbScrollConsumed",
  on: ScrollConsumed,
  reads: [TbScroll],
  writes: [TbScroll],
  run: ({ event, world }) => {
    const got = world.get(event.scrollId, [TbScroll]) as
      | { TbScroll: { spellId: string | null; consumed: boolean } }
      | undefined;
    if (!got) return [];
    world.set(event.scrollId, TbScroll, {
      spellId: got.TbScroll.spellId,
      consumed: true,
    });
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Memory palace
 * ----------------------------------------------------------------------- */

export const TbMemoryPalaceFilledSystem = defineSystem({
  name: "TbMemoryPalaceFilled",
  on: MemoryPalaceFilled,
  reads: [TbMemoryPalace],
  writes: [TbMemoryPalace],
  run: ({ event, world }) => {
    const got = world.get(event.characterId, [TbMemoryPalace]) as
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
    const capacity = got?.TbMemoryPalace.capacity ?? 0;
    world.set(event.characterId, TbMemoryPalace, {
      capacity,
      memorized: event.picks.map((p) => ({
        spellId: p.spellId,
        slotsConsumed: p.slotsConsumed,
        cast: false,
      })),
    });
    return [];
  },
});

export const TbMemoryPalaceClearedSystem = defineSystem({
  name: "TbMemoryPalaceCleared",
  on: MemoryPalaceCleared,
  reads: [TbMemoryPalace],
  writes: [TbMemoryPalace],
  run: ({ event, world }) => {
    const got = world.get(event.characterId, [TbMemoryPalace]) as
      | {
          TbMemoryPalace: {
            capacity: number;
            memorized: ReadonlyArray<unknown>;
          };
        }
      | undefined;
    const capacity = got?.TbMemoryPalace.capacity ?? 0;
    world.set(event.characterId, TbMemoryPalace, {
      capacity,
      memorized: [],
    });
    return [];
  },
});

export const TbMemoryPalaceCapacityChangedSystem = defineSystem({
  name: "TbMemoryPalaceCapacityChanged",
  on: MemoryPalaceCapacityChanged,
  reads: [TbMemoryPalace],
  writes: [TbMemoryPalace],
  run: ({ event, world }) => {
    const got = world.get(event.characterId, [TbMemoryPalace]) as
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
    const memorized = got?.TbMemoryPalace.memorized ?? [];
    world.set(event.characterId, TbMemoryPalace, {
      capacity: event.capacity,
      memorized: memorized.map((m) => ({
        spellId: m.spellId,
        slotsConsumed: m.slotsConsumed,
        cast: m.cast,
      })),
    });
    return [];
  },
});

export const TbMemoryPalaceSpellMarkedCastSystem = defineSystem({
  name: "TbMemoryPalaceSpellMarkedCast",
  on: MemoryPalaceSpellMarkedCast,
  reads: [TbMemoryPalace],
  writes: [TbMemoryPalace],
  run: ({ event, world }) => {
    const got = world.get(event.characterId, [TbMemoryPalace]) as
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
    if (!got) return [];
    // Remove the FIRST matching slot (in case the same spell is
    // memorized twice — rare but legal at high palace capacity).
    // RAW p.93: "When arcanists cast a spell, it is removed from the
    // memory palace until they have the opportunity to replenish it."
    // The user-visible effect is that the slot is freed; the
    // empty-palace-before-refill rule still gates re-memorization.
    let removed = false;
    const next: Array<{ spellId: string; slotsConsumed: number; cast: boolean }> = [];
    for (const m of got.TbMemoryPalace.memorized) {
      if (!removed && m.spellId === event.spellId) {
        removed = true;
        continue;
      }
      next.push({ ...m });
    }
    if (!removed) return [];
    world.set(event.characterId, TbMemoryPalace, {
      capacity: got.TbMemoryPalace.capacity,
      memorized: next,
    });
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Cast consume marker
 * ----------------------------------------------------------------------- */

/**
 * Stamp a `SpellCastConsumed` marker on the Roll entity once any
 * post-roll commit fires. Mirrors the role `AdvancementLogged` plays
 * for advancement clicks: presence of the marker gates the chat-row
 * commit button so it can only be clicked once per roll.
 */
export const TbSpellCastConsumeLoggedSystem = defineSystem({
  name: "TbSpellCastConsumeLogged",
  on: SpellCastConsumeLogged,
  reads: [],
  writes: [SpellCastConsumed],
  run: ({ event, world }) => {
    if (!world.has(event.rollId)) return [];
    world.set(event.rollId, SpellCastConsumed, {
      characterId: event.characterId,
      spellId: event.spellId,
      sourceKind: event.sourceKind,
      bookId: event.bookId,
      scrollId: event.scrollId,
      consumedAt: event.consumedAt,
    });
    return [];
  },
});

/* -------------------------------------------------------------------------
 * Catalog management — homebrew create / remove / field-edit
 * ----------------------------------------------------------------------- */

const SPELL_TRAITS_BY_NAME = {
  SpellIdentity,
  TbSpellCasting,
  TbSpellLearning,
  TbSpellHomebrewProse,
} as const;
type EditableSpellTrait = keyof typeof SPELL_TRAITS_BY_NAME;

/**
 * Deep-set a value at a dotted path inside an object, returning a new
 * object. Empty path replaces the whole object.
 */
function setAtPath(root: unknown, path: ReadonlyArray<string>, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const obj = (
    root && typeof root === "object" ? { ...(root as Record<string, unknown>) } : {}
  ) as Record<string, unknown>;
  obj[head!] = setAtPath(obj[head!], rest, value);
  return obj;
}

export const TbSpellCreatedSystem = defineSystem({
  name: "TbSpellCreated",
  on: SpellCreated,
  reads: [],
  writes: [SpellIdentity, TbSpellCasting, TbSpellLearning, TbSpellHomebrewProse],
  run: ({ event, world }) => {
    if (!world.has(event.spellId)) {
      // The id was allocated in CreateBlankSpell.apply via
      // world.allocateId(); spawnAt to materialise the entity.
      world.spawnAt(event.spellId, [
        SpellIdentity({
          name: event.name,
          circle: 1,
          school: "Other",
          pageRef: null,
        }),
        TbSpellCasting({
          kind: "fixed",
          fixedOb: null,
          versusSkill: null,
          castingTime: "action",
          duration: "",
          materials: "",
          focus: "",
        }),
        TbSpellLearning({ scribeOb: 2, learnOb: 2 }),
        TbSpellHomebrewProse({ effect: "", casting: "" }),
      ]);
    }
    return [];
  },
});

export const TbSpellRemovedSystem = defineSystem({
  name: "TbSpellRemoved",
  on: SpellRemoved,
  reads: [],
  writes: [],
  run: ({ event, world }) => {
    if (world.has(event.spellId)) {
      world.despawn(event.spellId);
    }
    return [];
  },
});

export const TbSpellFieldEditedSystem = defineSystem({
  name: "TbSpellFieldEdited",
  on: SpellFieldEdited,
  reads: [SpellIdentity, TbSpellCasting, TbSpellLearning, TbSpellHomebrewProse],
  writes: [SpellIdentity, TbSpellCasting, TbSpellLearning, TbSpellHomebrewProse],
  run: ({ event, world }) => {
    if (!world.has(event.spellId)) return [];
    const traitName = event.trait as EditableSpellTrait;
    const trait = SPELL_TRAITS_BY_NAME[traitName];
    const got = world.get(event.spellId, [trait]) as Record<string, unknown> | undefined;
    const shortName = trait.name.split("/").pop()!;
    const current = (got?.[shortName] ?? {}) as unknown;
    const next = setAtPath(current, event.path, event.value);
    try {
      world.set(event.spellId, trait, next as never);
    } catch {
      // Schema parse rejected the new value — drop it. The chat row
      // already displayed the edit in the audit; future passes can
      // surface a toast on the editor.
    }
    return [];
  },
});

export const TB_SPELL_SYSTEMS = [
  TbSpellAddedToLibrarySystem,
  TbSpellRemovedFromLibrarySystem,
  TbLibraryLocationSetSystem,
  TbSpellAddedToBookSystem,
  TbSpellRemovedFromBookSystem,
  TbScrollSpawnedSystem,
  TbScrollScribedSystem,
  TbScrollConsumedSystem,
  TbMemoryPalaceFilledSystem,
  TbMemoryPalaceClearedSystem,
  TbMemoryPalaceCapacityChangedSystem,
  TbMemoryPalaceSpellMarkedCastSystem,
  TbSpellCastConsumeLoggedSystem,
  TbSpellCreatedSystem,
  TbSpellRemovedSystem,
  TbSpellFieldEditedSystem,
  TbItemDestroyedSweepSystem,
] as const;
