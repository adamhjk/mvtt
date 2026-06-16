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
  defineCommand,
  defineEvent,
  defineSystem,
  defineTrait,
  EntityId,
  fail,
  ok,
  z,
} from "@vtt/substrate";
import { requireSession } from "@vtt/identity/shared";
import { ItemIdentity } from "@vtt/items/shared";
import { GRIND_SENTINEL_ID, LightSourceWentOut } from "./grind.js";
import { TbCarries, TbSupply } from "./items/item-traits.js";
import { EntryStateChanged } from "./items/item-events.js";

// ---------------------------------------------------------------------------
// Coverage metadata — DH p.42-43, SG p.42-43
// ---------------------------------------------------------------------------

/**
 * How many characters each catalog light source covers.
 * Items not in this map default to 1 (covers the holder only).
 */
const LIGHT_COVERAGE: Record<string, number> = {
  "tb/light-sources/candles-e1f2a3": 1,
  "tb/light-sources/candle-lantern-e1f2a3": 2,
  "tb/light-sources/torches-e1f2a3": 2,
  "tb/light-sources/long-torch-e1f2a3": 3,
  "tb/light-sources/lantern-e1f2a3": 3,
  "tb/light-sources/covered-lantern-e1f2a3": 2,
};

/**
 * Returns the number of characters a light source covers.
 * Checks the catalog lookup first; falls back to a name heuristic;
 * defaults to 1.
 */
export function lightCoverage(itemId: string, itemName?: string): number {
  const known = LIGHT_COVERAGE[itemId];
  if (known !== undefined) return known;
  if (itemName) {
    const lower = itemName.toLowerCase();
    if (lower.includes("lantern")) return 3;
    if (lower.includes("torch")) return 2;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// LightCoverage trait — lives on the grind sentinel
// ---------------------------------------------------------------------------

/**
 * Composite key for a light-source carry entry.
 */
export function lightSourceKey(holderId: string, entryIndex: number): string {
  return `${holderId}:${entryIndex}`;
}

const LightCoverageAssignment = z.object({
  holderId: EntityId,
  entryIndex: z.number().int().min(0),
  itemId: EntityId,
  coveredCharacterIds: z.array(EntityId).default([]),
  maxCoverage: z.number().int().min(1),
});

export const LightCoverage = defineTrait({
  name: "@vtt/system-torchbearer/LightCoverage",
  schema: z.object({
    assignments: z.record(z.string(), LightCoverageAssignment).default({}),
  }),
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const LightCoverageChanged = defineEvent({
  name: "@vtt/system-torchbearer/LightCoverageChanged",
  schema: z.object({
    key: z.string(),
    holderId: EntityId,
    entryIndex: z.number().int().min(0),
    itemId: EntityId,
    coveredCharacterIds: z.array(EntityId),
    maxCoverage: z.number().int().min(1),
  }),
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export const AssignLightCoverage = defineCommand({
  name: "@vtt/system-torchbearer/AssignLightCoverage",
  schema: z.object({
    holderId: EntityId,
    entryIndex: z.number().int().min(0),
    coveredCharacterIds: z.array(EntityId),
  }),
  validate: ({ cmd, world, session }) => {
    const s = requireSession({ session });
    if (!s || s.role !== "gm") return fail("only the GM may assign light coverage");
    const got = world.get(cmd.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<{ itemId: string; state?: { lit?: boolean } }> } }
      | undefined;
    if (!got) return fail(`holder ${cmd.holderId} has no TbCarries`);
    const entry = got.TbCarries.entries[cmd.entryIndex];
    if (!entry) return fail(`no carry entry at index ${cmd.entryIndex}`);
    if (!entry.state?.lit) return fail("light source is not lit");

    // Resolve item name for heuristic coverage.
    const itemGot = world.get(entry.itemId, [ItemIdentity]) as
      | { ItemIdentity: { name: string } }
      | undefined;
    const itemName = itemGot?.ItemIdentity.name;

    const max = lightCoverage(entry.itemId, itemName);
    if (cmd.coveredCharacterIds.length > max) {
      return fail(`this light source covers at most ${max} characters`);
    }
    return ok();
  },
  apply: ({ cmd, world }) => {
    const got = world.get(cmd.holderId, [TbCarries]) as {
      TbCarries: { entries: Array<{ itemId: string }> };
    };
    const entry = got.TbCarries.entries[cmd.entryIndex]!;
    const itemGot = world.get(entry.itemId, [ItemIdentity]) as
      | { ItemIdentity: { name: string } }
      | undefined;
    const itemName = itemGot?.ItemIdentity.name;
    const max = lightCoverage(entry.itemId, itemName);
    const key = lightSourceKey(cmd.holderId, cmd.entryIndex);
    return [
      LightCoverageChanged({
        key,
        holderId: cmd.holderId,
        entryIndex: cmd.entryIndex,
        itemId: entry.itemId,
        coveredCharacterIds: cmd.coveredCharacterIds,
        maxCoverage: max,
      }),
    ];
  },
});

export const ClearLightCoverage = defineCommand({
  name: "@vtt/system-torchbearer/ClearLightCoverage",
  schema: z.object({
    holderId: EntityId,
    entryIndex: z.number().int().min(0),
  }),
  validate: ({ session }) => {
    const s = requireSession({ session });
    if (!s || s.role !== "gm") return fail("only the GM may clear light coverage");
    return ok();
  },
  apply: ({ cmd, world }) => {
    const got = world.get(cmd.holderId, [TbCarries]) as
      | { TbCarries: { entries: Array<{ itemId: string }> } }
      | undefined;
    const entry = got?.TbCarries.entries[cmd.entryIndex];
    const itemId = entry?.itemId ?? ("" as EntityId);
    const key = lightSourceKey(cmd.holderId, cmd.entryIndex);
    return [
      LightCoverageChanged({
        key,
        holderId: cmd.holderId,
        entryIndex: cmd.entryIndex,
        itemId,
        coveredCharacterIds: [],
        maxCoverage: 1,
      }),
    ];
  },
});

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

/**
 * LightCoverageSystem — universal mirror for `LightCoverageChanged`.
 * Writes the assignment into the sentinel's LightCoverage trait.
 * An empty `coveredCharacterIds` removes the key.
 */
export const LightCoverageSystem = defineSystem({
  name: "LightCoverage",
  on: LightCoverageChanged,
  reads: [LightCoverage],
  writes: [LightCoverage],
  run: ({ event, world }) => {
    if (!world.has(GRIND_SENTINEL_ID)) return [];
    const cur = world.get(GRIND_SENTINEL_ID, [LightCoverage]) as
      | { LightCoverage: { assignments: Record<string, unknown> } }
      | undefined;
    const assignments = { ...(cur?.LightCoverage.assignments ?? {}) };
    if (event.coveredCharacterIds.length === 0) {
      delete assignments[event.key];
    } else {
      assignments[event.key] = {
        holderId: event.holderId,
        entryIndex: event.entryIndex,
        itemId: event.itemId,
        coveredCharacterIds: event.coveredCharacterIds,
        maxCoverage: event.maxCoverage,
      };
    }
    world.set(GRIND_SENTINEL_ID, LightCoverage, { assignments });
    return [];
  },
});

/**
 * LightCoverageAutoClearOnDoused — when EntryStateChanged fires
 * with lit=false, auto-clear any coverage for that source.
 */
export const LightCoverageAutoClearOnDouseSystem = defineSystem({
  name: "LightCoverageAutoClearOnDouse",
  on: EntryStateChanged,
  reads: [LightCoverage],
  writes: [LightCoverage],
  run: ({ event, world }) => {
    if (event.state.lit !== false) return [];
    if (!world.has(GRIND_SENTINEL_ID)) return [];
    const cur = world.get(GRIND_SENTINEL_ID, [LightCoverage]) as
      | { LightCoverage: { assignments: Record<string, unknown> } }
      | undefined;
    if (!cur) return [];
    const key = lightSourceKey(event.holderId, event.entryIndex);
    if (!(key in cur.LightCoverage.assignments)) return [];
    const assignments = { ...cur.LightCoverage.assignments };
    delete assignments[key];
    world.set(GRIND_SENTINEL_ID, LightCoverage, { assignments });
    return [];
  },
});

/**
 * LightCoverageAutoClearOnBurnout — when a LightSourceWentOut fires,
 * auto-clear coverage for that source. This catches the grind-tick
 * burnout path, which also fires EntryStateChanged but the system
 * above may already handle it. Belt-and-suspenders: both paths
 * converge on the same idempotent delete.
 */
export const LightCoverageAutoClearOnBurnoutSystem = defineSystem({
  name: "LightCoverageAutoClearOnBurnout",
  on: LightSourceWentOut,
  reads: [LightCoverage, TbCarries],
  writes: [LightCoverage],
  run: ({ event, world }) => {
    if (!world.has(GRIND_SENTINEL_ID)) return [];
    const cur = world.get(GRIND_SENTINEL_ID, [LightCoverage]) as
      | { LightCoverage: { assignments: Record<string, unknown> } }
      | undefined;
    if (!cur) return [];
    // We need to find the key — scan assignments for matching holderId + itemId.
    const assignments = { ...cur.LightCoverage.assignments };
    let changed = false;
    for (const [key, val] of Object.entries(assignments)) {
      const a = val as { holderId: string; itemId: string };
      if (a.holderId === event.holderId && a.itemId === event.itemId) {
        delete assignments[key];
        changed = true;
      }
    }
    if (changed) {
      world.set(GRIND_SENTINEL_ID, LightCoverage, { assignments });
    }
    return [];
  },
});
